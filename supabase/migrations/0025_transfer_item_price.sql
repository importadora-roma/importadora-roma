-- Lets a transfer record the internal value of each fardo sent to another
-- branch, so reports can show "goods sent to stores" as a figure distinct
-- from sales revenue (a transfer is not a sale). Nullable so existing
-- transfers (created before this feature) simply show no value instead of
-- breaking.
alter table public.transfer_items add column unit_price numeric(12, 2);

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
  v_available integer;
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

    select quantity into v_available
    from public.inventory
    where variant_id = v_variant_id and branch_id = p_origin_branch_id
    for update;

    if v_available is null or v_available < v_quantity then
      raise exception 'Stock insuficiente para variante %', v_variant_id;
    end if;

    update public.inventory
    set quantity = quantity - v_quantity, updated_at = now()
    where variant_id = v_variant_id and branch_id = p_origin_branch_id;

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_variant_id, p_origin_branch_id, 'transfer_out', -v_quantity, 'transfer', v_transfer_id, v_user_id);

    insert into public.transfer_items (transfer_id, variant_id, quantity, unit_price)
    values (v_transfer_id, v_variant_id, v_quantity, v_unit_price);
  end loop;

  return v_transfer_id;
end;
$$;

grant execute on function public.create_transfer(uuid, uuid, jsonb, text) to authenticated;
