-- Completing a container (counting -> completed) now automatically pushes
-- every already-mapped item straight to inventory — no separate manual
-- "enviar a inventario" step for the common case, since SKU auto-recognition
-- (0020) means most items already have a variant_id by the time counting
-- finishes. push_container_to_inventory becomes safely re-callable (no
-- longer a one-shot per container) so leftover unmapped items can still be
-- mapped and pushed later without re-processing what was already pushed.

alter table public.container_items add column pushed_to_inventory_at timestamptz;

-- =========================================================
-- push_container_to_inventory — idempotent per item via
-- container_items.pushed_to_inventory_at instead of a container-level
-- one-shot guard, so it can be called again (by set_container_status on
-- completion, or manually later for newly-mapped leftovers) without
-- double-counting inventory for items already pushed.
-- =========================================================
create or replace function public.push_container_to_inventory(
  p_container_id uuid,
  p_variant_mappings jsonb default null -- [{container_item_id, variant_id}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_container record;
  v_mapping jsonb;
  v_item record;
  v_variant_kilo numeric;
  v_landed_cost numeric;
  v_net_qty integer;
  v_pushed integer := 0;
  v_skipped integer := 0;
  v_costed integer := 0;
  v_usd_clp_rate numeric;
  v_markup_pct numeric;
  v_rounding integer;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para trasladar a inventario';
  end if;

  select * into v_container from public.containers where id = p_container_id for update;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede procesar contenedores de otra sucursal';
  end if;

  if v_container.status <> 'completed' then
    raise exception 'El contenedor debe estar completado antes de enviarlo a inventario';
  end if;

  select coalesce(usd_clp_rate, 950), coalesce(operational_markup_pct, 10), coalesce(cost_rounding, 500)
  into v_usd_clp_rate, v_markup_pct, v_rounding
  from public.container_settings
  where branch_id is null;

  if p_variant_mappings is not null then
    for v_mapping in select * from jsonb_array_elements(p_variant_mappings)
    loop
      update public.container_items
      set variant_id = (v_mapping ->> 'variant_id')::uuid, mapped_at = now(), mapped_by = v_user_id
      where id = (v_mapping ->> 'container_item_id')::uuid and container_id = p_container_id;
    end loop;
  end if;

  for v_item in
    select * from public.container_items
    where container_id = p_container_id and deleted_at is null and pushed_to_inventory_at is null
  loop
    if v_item.variant_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_item.cost_usd_per_kilo is not null then
      select kilo into v_variant_kilo from public.product_variants where id = v_item.variant_id;

      if v_variant_kilo is not null and v_variant_kilo > 0 then
        v_landed_cost := v_item.cost_usd_per_kilo * v_variant_kilo * v_usd_clp_rate * (1 + v_markup_pct / 100);
        v_landed_cost := round(v_landed_cost / v_rounding) * v_rounding;

        update public.product_variants set cost = v_landed_cost where id = v_item.variant_id;
        v_costed := v_costed + 1;
      end if;
    end if;

    select coalesce(sum(delta), 0) into v_net_qty
    from public.container_scan_events
    where container_item_id = v_item.id;

    if v_net_qty <= 0 then
      -- nothing scanned yet for this item — leave it for a future pass
      -- (e.g. after a reopen + recount), don't mark it pushed
      continue;
    end if;

    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_item.variant_id, v_container.branch_id, v_net_qty)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
    values (v_item.variant_id, v_container.branch_id, 'purchase', v_net_qty, 'container', p_container_id, v_user_id, 'Contenedor ' || v_container.internal_number);

    update public.container_items set pushed_to_inventory_at = now() where id = v_item.id;

    v_pushed := v_pushed + 1;
  end loop;

  update public.containers
  set pushed_to_inventory_at = coalesce(pushed_to_inventory_at, now()), pushed_to_inventory_by = v_user_id
  where id = p_container_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'container.push_to_inventory', 'containers', p_container_id,
    null, jsonb_build_object('itemsPushed', v_pushed, 'itemsSkippedUnmapped', v_skipped, 'itemsCosted', v_costed)
  );

  return jsonb_build_object('itemsPushed', v_pushed, 'itemsSkippedUnmapped', v_skipped, 'itemsCosted', v_costed);
end;
$$;

-- =========================================================
-- set_container_status — completing a container now auto-runs the push
-- above for whatever's already mapped. Unmapped items are simply left for
-- the admin to map and push later (VariantMappingModal, now re-callable).
-- =========================================================
create or replace function public.set_container_status(
  p_container_id uuid,
  p_new_status text,
  p_override_mismatch boolean default false,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_container record;
  v_item_count integer;
  v_has_mismatch boolean;
  v_has_pending_unknown boolean;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para cambiar el estado del contenedor';
  end if;

  select * into v_container from public.containers where id = p_container_id for update;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede modificar contenedores de otra sucursal';
  end if;

  if p_new_status not in ('importing', 'counting', 'completed') then
    raise exception 'Estado inválido';
  end if;

  if p_new_status = 'counting' and v_container.status in ('draft', 'importing') then
    select count(*) into v_item_count from public.container_items where container_id = p_container_id and deleted_at is null;

    if v_item_count = 0 then
      raise exception 'El contenedor no tiene productos importados';
    end if;

    update public.containers set status = 'counting' where id = p_container_id;

  elsif p_new_status = 'completed' and v_container.status = 'counting' then
    select exists (
      select 1 from public.container_items ci
      where ci.container_id = p_container_id and ci.deleted_at is null
        and ci.expected_qty <> coalesce((select sum(se.delta) from public.container_scan_events se where se.container_item_id = ci.id), 0)
    ) into v_has_mismatch;

    select exists (
      select 1 from public.container_unknown_codes
      where container_id = p_container_id and status in ('pending', 'review_later')
    ) into v_has_pending_unknown;

    if (v_has_mismatch or v_has_pending_unknown) and not p_override_mismatch then
      raise exception 'El contenedor tiene diferencias sin resolver. Use la confirmación de cierre con diferencias.';
    end if;

    if (v_has_mismatch or v_has_pending_unknown) and p_override_mismatch and (p_reason is null or trim(p_reason) = '') then
      raise exception 'Debe indicar un motivo para completar con diferencias';
    end if;

    update public.containers
    set status = 'completed', completed_at = now(), completed_by = v_user_id
    where id = p_container_id;

    if v_has_mismatch or v_has_pending_unknown then
      insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
      values (v_user_id, 'container.complete_override', 'containers', p_container_id, null, jsonb_build_object('reason', p_reason));
    end if;

    -- auto-push whatever's already mapped straight to inventory; items
    -- without a variant_id are simply skipped and can be mapped + pushed
    -- later from the container detail screen.
    perform public.push_container_to_inventory(p_container_id, null);

  elsif p_new_status = 'counting' and v_container.status = 'completed' then
    update public.containers
    set status = 'counting', reopened_at = now(), reopened_by = v_user_id, reopen_count = reopen_count + 1,
      completed_at = null, completed_by = null
    where id = p_container_id;

  else
    raise exception 'Transición de estado inválida: % -> %', v_container.status, p_new_status;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'container.status_change', 'containers', p_container_id,
    jsonb_build_object('status', v_container.status), jsonb_build_object('status', p_new_status)
  );
end;
$$;
