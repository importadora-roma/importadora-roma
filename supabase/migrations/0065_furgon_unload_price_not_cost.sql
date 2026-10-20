-- Migration 0061 deliberately switched furgon_unload_stock to value
-- returned stock at cost, matching create_transfer/furgon_load_stock's
-- (then-)convention of valuing internal stock movements at cost rather
-- than sale price. That convention is reversed now: guías (traslados,
-- despacho, descarga) should show the product's sale price, not its
-- cost — cost stays reserved for profitability reports (Reportes,
-- Rentabilidad), which read sale_items.cost directly and are unaffected
-- by this. furgon_unload_stock is the one remaining place that still
-- hardcoded cost server-side (create_transfer/furgon_load_stock already
-- take whatever unit_price the client sends, and the frontend default
-- there was switched to price in the same change as this migration).

drop function if exists public.furgon_unload_stock(uuid, jsonb, text);

create or replace function public.furgon_unload_stock(
  p_destination_branch_id uuid,
  p_items jsonb, -- [{variant_id, quantity}]
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
  v_furgon_branch_id uuid;
  v_transfer_id uuid;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_available integer;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para descargar el furgón';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> p_destination_branch_id then
    raise exception 'Solo puede descargar el furgón hacia su propia sucursal';
  end if;

  select id into v_furgon_branch_id from public.branches where is_furgon limit 1;
  if v_furgon_branch_id is null then
    raise exception 'No existe la sucursal del furgón';
  end if;

  if p_destination_branch_id = v_furgon_branch_id then
    raise exception 'La sucursal de destino no puede ser el furgón';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Debe indicar al menos un producto';
  end if;

  insert into public.transfers (origin_branch_id, destination_branch_id, sent_by, received_by, received_at, status, notes)
  values (v_furgon_branch_id, p_destination_branch_id, v_user_id, v_user_id, now(), 'recibido', p_notes)
  returning id into v_transfer_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    select price into v_unit_price from public.product_variants where id = v_variant_id;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad inválida para variante %', v_variant_id;
    end if;

    select quantity into v_available
    from public.inventory
    where variant_id = v_variant_id and branch_id = v_furgon_branch_id
    for update;

    if v_available is null or v_available < v_quantity then
      raise exception 'Stock insuficiente en el furgón para variante %', v_variant_id;
    end if;

    update public.inventory
    set quantity = quantity - v_quantity, updated_at = now()
    where variant_id = v_variant_id and branch_id = v_furgon_branch_id;

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_variant_id, v_furgon_branch_id, 'transfer_out', -v_quantity, 'transfer', v_transfer_id, v_user_id);

    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_variant_id, p_destination_branch_id, v_quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_variant_id, p_destination_branch_id, 'transfer_in', v_quantity, 'transfer', v_transfer_id, v_user_id);

    insert into public.transfer_items (transfer_id, variant_id, quantity, unit_price)
    values (v_transfer_id, v_variant_id, v_quantity, v_unit_price);
  end loop;

  return v_transfer_id;
end;
$$;

grant execute on function public.furgon_unload_stock(uuid, jsonb, text) to authenticated;
