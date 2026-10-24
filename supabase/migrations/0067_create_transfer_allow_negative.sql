-- Same reasoning as migration 0006 (sales) and 0064 (furgon_load_stock):
-- branch stock counts are known to be stale/unreliable, so a traslado must
-- never be blocked by "stock insuficiente" — staff need to move fardos that
-- are physically there even when the system's number for that variant/
-- branch shows 0 or something lower than reality. Drop the check and
-- switch the origin decrement to the same negative-safe upsert create_sale
-- and furgon_load_stock already use, so a variant with no inventory row
-- yet still gets one (starting negative) instead of the plain UPDATE
-- silently affecting zero rows.

drop function if exists public.create_transfer(uuid, uuid, jsonb, text);

create or replace function public.create_transfer(
  p_origin_branch_id uuid,
  p_destination_branch_id uuid,
  p_items jsonb, -- [{variant_id, quantity, unit_price}]
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_transfer_id uuid;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_unit_price numeric;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para crear traslados';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> p_origin_branch_id then
    raise exception 'Solo puede trasladar desde su propia sucursal';
  end if;

  if p_origin_branch_id = p_destination_branch_id then
    raise exception 'La sucursal de origen y destino no pueden ser la misma';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El traslado debe tener al menos un producto';
  end if;

  insert into public.transfers (origin_branch_id, destination_branch_id, sent_by, notes)
  values (p_origin_branch_id, p_destination_branch_id, v_user_id, p_notes)
  returning id into v_transfer_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_price := nullif(v_item ->> 'unit_price', '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad inválida para variante %', v_variant_id;
    end if;

    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_variant_id, p_origin_branch_id, -v_quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity - v_quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_variant_id, p_origin_branch_id, 'transfer_out', -v_quantity, 'transfer', v_transfer_id, v_user_id);

    insert into public.transfer_items (transfer_id, variant_id, quantity, unit_price)
    values (v_transfer_id, v_variant_id, v_quantity, v_unit_price);
  end loop;

  return v_transfer_id;
end;
$$;

grant execute on function public.create_transfer(uuid, uuid, jsonb, text) to authenticated;
