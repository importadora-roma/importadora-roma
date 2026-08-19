-- Atomic business-logic RPCs. Each function does its own permission checks
-- (branch scoping, role checks) since security definer bypasses RLS.
-- Client code calls these via supabase.rpc(...) instead of raw table writes
-- for anything that must touch stock + sale + cash together.

-- Safe to re-run: drop anything from an earlier version of this migration
-- before recreating it below.
drop function if exists public.return_sale_item(uuid, text);
drop trigger if exists audit_product_variant_price_change on public.product_variants;
drop trigger if exists audit_user_role_change on public.users;

-- =========================================================
-- SALES
-- =========================================================
create or replace function public.create_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb, -- [{variant_id, quantity, sold_price}]
  p_payments jsonb, -- [{payment_method, amount}]
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
  v_sale_id uuid;
  v_item jsonb;
  v_payment jsonb;
  v_variant record;
  v_available integer;
  v_subtotal numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_payments_total numeric(12, 2) := 0;
  v_cash_register_id uuid;
  v_cash_total numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
  v_quantity integer;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role is null then
    raise exception 'Usuario no autorizado';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> p_branch_id then
    raise exception 'No puede registrar ventas para otra sucursal';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un producto';
  end if;

  insert into public.sales (branch_id, customer_id, user_id, notes)
  values (p_branch_id, p_customer_id, v_user_id, p_notes)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad inválida para variante %', v_item ->> 'variant_id';
    end if;

    select id, cost, price into v_variant
    from public.product_variants
    where id = (v_item ->> 'variant_id')::uuid and active and deleted_at is null;

    if v_variant.id is null then
      raise exception 'Variante % no encontrada o inactiva', v_item ->> 'variant_id';
    end if;

    select quantity into v_available
    from public.inventory
    where variant_id = v_variant.id and branch_id = p_branch_id
    for update;

    if v_available is null or v_available < v_quantity then
      raise exception 'Stock insuficiente para variante %', v_variant.id;
    end if;

    v_line_total := (v_item ->> 'sold_price')::numeric * v_quantity;

    insert into public.sale_items (sale_id, variant_id, quantity, original_price, sold_price, cost, line_total)
    values (v_sale_id, v_variant.id, v_quantity, v_variant.price, (v_item ->> 'sold_price')::numeric, v_variant.cost, v_line_total);

    update public.inventory
    set quantity = quantity - v_quantity, updated_at = now()
    where variant_id = v_variant.id and branch_id = p_branch_id;

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_variant.id, p_branch_id, 'sale', -v_quantity, 'sale', v_sale_id, v_user_id);

    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := v_subtotal;

  update public.sales set subtotal = v_subtotal, total = v_total where id = v_sale_id;

  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    raise exception 'La venta debe tener al menos un pago';
  end if;

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    insert into public.sale_payments (sale_id, payment_method, amount)
    values (v_sale_id, v_payment ->> 'payment_method', (v_payment ->> 'amount')::numeric);

    v_payments_total := v_payments_total + (v_payment ->> 'amount')::numeric;

    if v_payment ->> 'payment_method' = 'efectivo' then
      v_cash_total := v_cash_total + (v_payment ->> 'amount')::numeric;
    end if;
  end loop;

  if round(v_payments_total, 2) <> round(v_total, 2) then
    raise exception 'El total de pagos (%) no coincide con el total de la venta (%)', v_payments_total, v_total;
  end if;

  if v_cash_total > 0 then
    select id into v_cash_register_id
    from public.cash_registers
    where branch_id = p_branch_id and status = 'open';

    if v_cash_register_id is null then
      raise exception 'No hay una caja abierta en esta sucursal';
    end if;

    insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, created_by)
    values (v_cash_register_id, p_branch_id, 'sale_payment', 'venta', v_cash_total, 'sale', v_sale_id, v_user_id);
  end if;

  return v_sale_id;
end;
$$;

create or replace function public.cancel_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_sale record;
  v_item record;
  v_cash_register_id uuid;
  v_payment record;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para anular ventas';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;

  if v_sale.id is null then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status = 'cancelled' then
    raise exception 'La venta ya está anulada';
  end if;

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch then
    raise exception 'No puede anular ventas de otra sucursal';
  end if;

  for v_item in select * from public.sale_items where sale_id = p_sale_id and status = 'active'
  loop
    update public.inventory
    set quantity = quantity + v_item.quantity, updated_at = now()
    where variant_id = v_item.variant_id and branch_id = v_sale.branch_id;

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
    values (v_item.variant_id, v_sale.branch_id, 'sale_cancel', v_item.quantity, 'sale', p_sale_id, v_user_id, p_reason);

    update public.sale_items
    set status = 'cancelled', return_reason = p_reason, returned_by = v_user_id, returned_at = now()
    where id = v_item.id;
  end loop;

  select id into v_cash_register_id from public.cash_registers where branch_id = v_sale.branch_id and status = 'open';

  if v_cash_register_id is not null then
    for v_payment in select * from public.sale_payments where sale_id = p_sale_id and payment_method = 'efectivo'
    loop
      insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, created_by, description)
      values (v_cash_register_id, v_sale.branch_id, 'sale_cancel_refund', 'devolucion', -v_payment.amount, 'sale', p_sale_id, v_user_id, p_reason);
    end loop;
  end if;

  update public.sales
  set status = 'cancelled', cancel_reason = p_reason, cancelled_by = v_user_id, cancelled_at = now()
  where id = p_sale_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (v_user_id, 'sale.cancel', 'sales', p_sale_id, to_jsonb(v_sale), jsonb_build_object('status', 'cancelled', 'reason', p_reason));
end;
$$;

-- Exchange (cambio) of a single sale item — cash refunds are not offered
-- (not legally required for this kind of wholesale sale), so a customer
-- issue is resolved by swapping the item for another of equal or greater
-- value; any positive difference is collected as an additional payment.
-- Exchanging for a lower-value replacement is rejected outright.
create or replace function public.exchange_sale_item(
  p_sale_item_id uuid,
  p_new_variant_id uuid,
  p_new_quantity integer,
  p_reason text,
  p_additional_payments jsonb default null -- [{payment_method, amount}], required iff there's a price difference
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
  v_old_item record;
  v_sale record;
  v_new_variant record;
  v_available integer;
  v_new_line_total numeric(12, 2);
  v_difference numeric(12, 2);
  v_payments_total numeric(12, 2) := 0;
  v_cash_total numeric(12, 2) := 0;
  v_cash_register_id uuid;
  v_payment jsonb;
  v_new_item_id uuid;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para procesar cambios';
  end if;

  select * into v_old_item from public.sale_items where id = p_sale_item_id for update;

  if v_old_item.id is null then
    raise exception 'Ítem no encontrado';
  end if;

  if v_old_item.status <> 'active' then
    raise exception 'Este ítem ya fue cambiado o anulado';
  end if;

  select * into v_sale from public.sales where id = v_old_item.sale_id;

  if v_sale.status <> 'completed' then
    raise exception 'Solo se pueden cambiar ítems de ventas completadas';
  end if;

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch then
    raise exception 'No puede procesar cambios de otra sucursal';
  end if;

  if p_new_quantity is null or p_new_quantity <= 0 then
    raise exception 'Cantidad inválida';
  end if;

  select id, cost, price into v_new_variant
  from public.product_variants
  where id = p_new_variant_id and active and deleted_at is null;

  if v_new_variant.id is null then
    raise exception 'Variante de reemplazo no encontrada o inactiva';
  end if;

  select quantity into v_available
  from public.inventory
  where variant_id = v_new_variant.id and branch_id = v_sale.branch_id
  for update;

  if v_available is null or v_available < p_new_quantity then
    raise exception 'Stock insuficiente para el producto de reemplazo';
  end if;

  v_new_line_total := v_new_variant.price * p_new_quantity;
  v_difference := v_new_line_total - v_old_item.line_total;

  if v_difference < 0 then
    raise exception 'El producto de reemplazo no puede ser de menor valor que el original';
  end if;

  -- restore stock for the old item
  update public.inventory
  set quantity = quantity + v_old_item.quantity, updated_at = now()
  where variant_id = v_old_item.variant_id and branch_id = v_sale.branch_id;

  insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
  values (v_old_item.variant_id, v_sale.branch_id, 'sale_cancel', v_old_item.quantity, 'sale_item', p_sale_item_id, v_user_id, p_reason);

  update public.sale_items
  set status = 'returned', return_reason = p_reason, returned_by = v_user_id, returned_at = now()
  where id = p_sale_item_id;

  -- create the replacement item, then deduct its stock
  insert into public.sale_items (sale_id, variant_id, quantity, original_price, sold_price, cost, line_total, status)
  values (v_sale.id, v_new_variant.id, p_new_quantity, v_new_variant.price, v_new_variant.price, v_new_variant.cost, v_new_line_total, 'active')
  returning id into v_new_item_id;

  update public.inventory
  set quantity = quantity - p_new_quantity, updated_at = now()
  where variant_id = v_new_variant.id and branch_id = v_sale.branch_id;

  insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
  values (v_new_variant.id, v_sale.branch_id, 'sale', -p_new_quantity, 'sale_item', v_new_item_id, v_user_id, p_reason);

  if v_difference > 0 then
    if p_additional_payments is null or jsonb_array_length(p_additional_payments) = 0 then
      raise exception 'Debe registrar el pago de la diferencia de %', v_difference;
    end if;

    for v_payment in select * from jsonb_array_elements(p_additional_payments)
    loop
      insert into public.sale_payments (sale_id, payment_method, amount)
      values (v_sale.id, v_payment ->> 'payment_method', (v_payment ->> 'amount')::numeric);

      v_payments_total := v_payments_total + (v_payment ->> 'amount')::numeric;
      if v_payment ->> 'payment_method' = 'efectivo' then
        v_cash_total := v_cash_total + (v_payment ->> 'amount')::numeric;
      end if;
    end loop;

    if round(v_payments_total, 2) <> round(v_difference, 2) then
      raise exception 'El pago de la diferencia (%) no coincide con la diferencia calculada (%)', v_payments_total, v_difference;
    end if;

    if v_cash_total > 0 then
      select id into v_cash_register_id from public.cash_registers where branch_id = v_sale.branch_id and status = 'open';

      if v_cash_register_id is null then
        raise exception 'No hay una caja abierta en esta sucursal';
      end if;

      insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, created_by, description)
      values (v_cash_register_id, v_sale.branch_id, 'sale_payment', 'cambio_diferencia', v_cash_total, 'sale_item', v_new_item_id, v_user_id, p_reason);
    end if;
  end if;

  update public.sales
  set subtotal = subtotal + v_difference, total = total + v_difference
  where id = v_sale.id;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'sale_item.exchange', 'sale_items', p_sale_item_id,
    to_jsonb(v_old_item),
    jsonb_build_object('new_sale_item_id', v_new_item_id, 'new_variant_id', v_new_variant.id, 'difference', v_difference, 'reason', p_reason)
  );

  return v_new_item_id;
end;
$$;

-- =========================================================
-- TRANSFERS
-- =========================================================
create or replace function public.create_transfer(
  p_origin_branch_id uuid,
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
  v_transfer_id uuid;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
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

    insert into public.transfer_items (transfer_id, variant_id, quantity)
    values (v_transfer_id, v_variant_id, v_quantity);
  end loop;

  return v_transfer_id;
end;
$$;

create or replace function public.receive_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_transfer record;
  v_item record;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para recibir traslados';
  end if;

  select * into v_transfer from public.transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'Traslado no encontrado';
  end if;

  if v_transfer.status <> 'en_transito' then
    raise exception 'Este traslado ya fue procesado';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> v_transfer.destination_branch_id then
    raise exception 'Solo la sucursal destino puede recibir este traslado';
  end if;

  for v_item in select * from public.transfer_items where transfer_id = p_transfer_id
  loop
    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_item.variant_id, v_transfer.destination_branch_id, v_item.quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_item.variant_id, v_transfer.destination_branch_id, 'transfer_in', v_item.quantity, 'transfer', p_transfer_id, v_user_id);
  end loop;

  update public.transfers
  set status = 'recibido', received_by = v_user_id, received_at = now()
  where id = p_transfer_id;
end;
$$;

-- =========================================================
-- QUOTATIONS
-- =========================================================
create or replace function public.convert_quotation_to_sale(
  p_quotation_id uuid,
  p_payments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation record;
  v_items jsonb;
  v_sale_id uuid;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id for update;

  if v_quotation.id is null then
    raise exception 'Cotización no encontrada';
  end if;

  if v_quotation.status <> 'pending' then
    raise exception 'Esta cotización ya no está pendiente';
  end if;

  select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity, 'sold_price', unit_price))
  into v_items
  from public.quotation_items
  where quotation_id = p_quotation_id;

  v_sale_id := public.create_sale(
    v_quotation.branch_id,
    v_quotation.customer_id,
    v_items,
    p_payments,
    'Convertida de cotización ' || v_quotation.quotation_number
  );

  update public.quotations
  set status = 'converted', converted_sale_id = v_sale_id
  where id = p_quotation_id;

  return v_sale_id;
end;
$$;

-- =========================================================
-- CASH
-- =========================================================
create or replace function public.open_cash_register(p_branch_id uuid, p_opening_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_register_id uuid;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para abrir caja';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> p_branch_id then
    raise exception 'Solo puede abrir la caja de su propia sucursal';
  end if;

  if exists (select 1 from public.cash_registers where branch_id = p_branch_id and status = 'open') then
    raise exception 'Ya existe una caja abierta en esta sucursal';
  end if;

  insert into public.cash_registers (branch_id, opened_by, opening_amount)
  values (p_branch_id, v_user_id, p_opening_amount)
  returning id into v_register_id;

  return v_register_id;
end;
$$;

create or replace function public.close_cash_register(p_cash_register_id uuid, p_actual_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_register record;
  v_movements_total numeric;
  v_expected numeric;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para cerrar caja';
  end if;

  select * into v_register from public.cash_registers where id = p_cash_register_id for update;

  if v_register.id is null then
    raise exception 'Caja no encontrada';
  end if;

  if v_register.status <> 'open' then
    raise exception 'Esta caja ya está cerrada';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> v_register.branch_id then
    raise exception 'Solo puede cerrar la caja de su propia sucursal';
  end if;

  select coalesce(sum(amount), 0) into v_movements_total
  from public.cash_movements
  where cash_register_id = p_cash_register_id;

  v_expected := v_register.opening_amount + v_movements_total;

  update public.cash_registers
  set status = 'closed',
    closed_by = v_user_id,
    closed_at = now(),
    expected_amount = v_expected,
    actual_amount = p_actual_amount,
    difference = p_actual_amount - v_expected
  where id = p_cash_register_id;
end;
$$;

create or replace function public.add_manual_cash_movement(
  p_cash_register_id uuid,
  p_movement_type text, -- 'manual_in' | 'manual_out'
  p_category text,
  p_amount numeric,
  p_description text default null
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
  v_register record;
  v_movement_id uuid;
  v_signed_amount numeric;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para registrar movimientos de caja';
  end if;

  if p_movement_type not in ('manual_in', 'manual_out') then
    raise exception 'Tipo de movimiento inválido';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;

  select * into v_register from public.cash_registers where id = p_cash_register_id;

  if v_register.id is null or v_register.status <> 'open' then
    raise exception 'La caja no está abierta';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> v_register.branch_id then
    raise exception 'No puede registrar movimientos en otra sucursal';
  end if;

  v_signed_amount := case when p_movement_type = 'manual_in' then p_amount else -p_amount end;

  insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, created_by, description)
  values (p_cash_register_id, v_register.branch_id, p_movement_type, p_category, v_signed_amount, v_user_id, p_description)
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

-- =========================================================
-- AUDIT TRIGGERS for sensitive field changes
-- =========================================================
create or replace function public.audit_product_variant_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.cost is distinct from new.cost) or (old.price is distinct from new.price) then
    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (
      auth.uid(), 'product_variant.price_change', 'product_variants', new.id,
      jsonb_build_object('cost', old.cost, 'price', old.price),
      jsonb_build_object('cost', new.cost, 'price', new.price)
    );
  end if;
  return new;
end;
$$;

create trigger audit_product_variant_price_change
  after update on public.product_variants
  for each row execute function public.audit_product_variant_changes();

create or replace function public.audit_user_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.role is distinct from new.role) or (old.branch_id is distinct from new.branch_id) then
    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (
      auth.uid(), 'user.role_change', 'users', new.id,
      jsonb_build_object('role', old.role, 'branch_id', old.branch_id),
      jsonb_build_object('role', new.role, 'branch_id', new.branch_id)
    );
  end if;
  return new;
end;
$$;

create trigger audit_user_role_change
  after update on public.users
  for each row execute function public.audit_user_role_changes();

-- =========================================================
-- GRANTS
-- =========================================================
grant execute on function public.create_sale(uuid, uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;
grant execute on function public.exchange_sale_item(uuid, uuid, integer, text, jsonb) to authenticated;
grant execute on function public.create_transfer(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.receive_transfer(uuid) to authenticated;
grant execute on function public.convert_quotation_to_sale(uuid, jsonb) to authenticated;
grant execute on function public.open_cash_register(uuid, numeric) to authenticated;
grant execute on function public.close_cash_register(uuid, numeric) to authenticated;
grant execute on function public.add_manual_cash_movement(uuid, text, text, numeric, text) to authenticated;
