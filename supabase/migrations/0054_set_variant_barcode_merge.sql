-- Editing a variant's barcode in Inventario raises a raw "duplicate key value violates
-- unique constraint product_variants_sku_unique_idx" whenever the admin types in a code
-- that's already on record for another variant -- typically a leftover duplicate product
-- row (same product/calidad/kilo, created twice under slightly different names over time)
-- that was never folded together. The error just blocks the edit instead of resolving it.
--
-- This RPC replaces the raw update: when the barcode being assigned already belongs to a
-- different, still-active variant, it merges that variant into the one being edited (sums
-- on-hand stock per branch so totals don't change in either sucursal, moves its sale/
-- transfer/quotation/container history and any extra barcode aliases, keeps its old code as
-- an alias so a fardo still wearing that sticker keeps scanning correctly, then soft-deletes
-- it) and only then assigns the barcode. No conflict -> plain update, same as before.
create or replace function public.set_variant_barcode(p_variant_id uuid, p_barcode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := nullif(trim(p_barcode), '');
  v_code_normalized text;
  v_variant record;
  v_conflict_variant_id uuid;
  v_conflict_old_sku text;
  v_conflict_product_name text;
begin
  if not public.is_supervisor_or_admin() then
    raise exception 'No tiene permisos para editar códigos de barra';
  end if;

  select * into v_variant from public.product_variants where id = p_variant_id and deleted_at is null;
  if v_variant.id is null then
    raise exception 'Variante no encontrada';
  end if;

  if v_code is null then
    update public.product_variants set sku = null, updated_at = now() where id = p_variant_id;
    return jsonb_build_object('merged', false);
  end if;

  v_code_normalized := upper(regexp_replace(v_code, '[[:space:]-]', '', 'g'));

  select pv.id, pv.sku into v_conflict_variant_id, v_conflict_old_sku
  from public.product_variants pv
  where pv.id <> p_variant_id and pv.deleted_at is null and pv.sku is not null
    and upper(regexp_replace(pv.sku, '[[:space:]-]', '', 'g')) = v_code_normalized
  limit 1;

  if v_conflict_variant_id is null then
    select vb.variant_id into v_conflict_variant_id
    from public.variant_barcodes vb
    where vb.code_normalized = v_code_normalized and vb.variant_id <> p_variant_id
    limit 1;
  end if;

  if v_conflict_variant_id is not null then
    select p.name into v_conflict_product_name
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id = v_conflict_variant_id;

    update public.sale_items set variant_id = p_variant_id where variant_id = v_conflict_variant_id;
    update public.container_items set variant_id = p_variant_id where variant_id = v_conflict_variant_id;
    update public.inventory_movements set variant_id = p_variant_id where variant_id = v_conflict_variant_id;
    update public.transfer_items set variant_id = p_variant_id where variant_id = v_conflict_variant_id;
    update public.quotation_items set variant_id = p_variant_id where variant_id = v_conflict_variant_id;
    update public.variant_barcodes set variant_id = p_variant_id where variant_id = v_conflict_variant_id;

    insert into public.inventory (variant_id, branch_id, quantity)
    select p_variant_id, i.branch_id, i.quantity
    from public.inventory i where i.variant_id = v_conflict_variant_id
    on conflict (variant_id, branch_id) do update
      set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();
    delete from public.inventory where variant_id = v_conflict_variant_id;

    if v_conflict_old_sku is not null
       and upper(regexp_replace(v_conflict_old_sku, '[[:space:]-]', '', 'g')) <> v_code_normalized then
      insert into public.variant_barcodes (variant_id, code)
      values (p_variant_id, v_conflict_old_sku)
      on conflict (code_normalized) do nothing;
    end if;

    update public.product_variants
    set active = false, deleted_at = now(), deleted_by = v_user_id, sku = null, updated_at = now(),
        delete_reason = 'Fusionado automáticamente al asignar el código ' || v_code
          || ' (duplicado de "' || coalesce(v_conflict_product_name, '') || '")'
    where id = v_conflict_variant_id;

    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (
      v_user_id, 'merge_variant_barcode', 'product_variants', p_variant_id,
      jsonb_build_object('loser_variant_id', v_conflict_variant_id, 'loser_product_name', v_conflict_product_name),
      jsonb_build_object('barcode', v_code)
    );
  end if;

  -- drop any other stray alias left pointing elsewhere under this same code
  delete from public.variant_barcodes where code_normalized = v_code_normalized and variant_id <> p_variant_id;

  update public.product_variants set sku = v_code, updated_at = now() where id = p_variant_id;

  return jsonb_build_object('merged', v_conflict_variant_id is not null, 'merged_product_name', v_conflict_product_name);
end;
$$;

grant execute on function public.set_variant_barcode(uuid, text) to authenticated;
