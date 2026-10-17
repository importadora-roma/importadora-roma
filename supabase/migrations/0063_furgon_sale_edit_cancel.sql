-- The Furgón tab had no way to fix a mis-entered sale: no anular
-- (cancelar), no cambiar producto, no devolver. The only place those
-- exist is the Historial de Ventas screen (SalesHistoryPage) — but its
-- branch picker comes from useEffectiveBranch, which deliberately filters
-- out the Furgón branch (it's not a normal pickable branch), so a Furgón
-- sale could never be reached from there either. Same root cause as
-- migrations 0061/0062: cancel_sale/exchange_sale_item/return_sale_item
-- all require the caller's own branch to match the sale's branch unless
-- admin, with no Furgón exception.
--
-- Also: every Furgón sale has is_terreno = true, and create_sale already
-- skips the cash-register requirement entirely for those (a van has no
-- physical till) — but exchange_sale_item and return_sale_item never got
-- that same exemption, so collecting a cash difference on a cambio, or
-- refunding efectivo on a devolución, would raise "No hay una caja
-- abierta en esta sucursal" for ANY is_terreno sale (Furgón included),
-- even though the original sale never touched a register either. Fixed
-- to skip the register requirement/credit for is_terreno sales, matching
-- create_sale's and cancel_sale's existing convention.

drop function if exists public.cancel_sale(uuid, text);

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

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch and v_sale.branch_id <> public.furgon_branch_id() then
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

grant execute on function public.cancel_sale(uuid, text) to authenticated;

drop function if exists public.exchange_sale_item(uuid, uuid, integer, text, jsonb);

create or replace function public.exchange_sale_item(
  p_sale_item_id uuid,
  p_new_variant_id uuid,
  p_new_quantity integer,
  p_reason text,
  p_additional_payments jsonb default null
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

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch and v_sale.branch_id <> public.furgon_branch_id() then
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

  v_new_line_total := v_new_variant.price * p_new_quantity;
  v_difference := v_new_line_total - v_old_item.line_total;

  if v_difference < 0 then
    raise exception 'El producto de reemplazo no puede ser de menor valor que el original';
  end if;

  -- restore stock for the old item
  insert into public.inventory (variant_id, branch_id, quantity)
  values (v_old_item.variant_id, v_sale.branch_id, v_old_item.quantity)
  on conflict (variant_id, branch_id) do update
  set quantity = public.inventory.quantity + v_old_item.quantity, updated_at = now();

  insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
  values (v_old_item.variant_id, v_sale.branch_id, 'sale_cancel', v_old_item.quantity, 'sale_item', p_sale_item_id, v_user_id, p_reason);

  update public.sale_items
  set status = 'returned', return_reason = p_reason, returned_by = v_user_id, returned_at = now()
  where id = p_sale_item_id;

  -- create the replacement item, then deduct its stock
  insert into public.sale_items (sale_id, variant_id, quantity, original_price, sold_price, cost, line_total, status)
  values (v_sale.id, v_new_variant.id, p_new_quantity, v_new_variant.price, v_new_variant.price, v_new_variant.cost, v_new_line_total, 'active')
  returning id into v_new_item_id;

  insert into public.inventory (variant_id, branch_id, quantity)
  values (v_new_variant.id, v_sale.branch_id, -p_new_quantity)
  on conflict (variant_id, branch_id) do update
  set quantity = public.inventory.quantity - p_new_quantity, updated_at = now();

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

    if v_cash_total > 0 and not coalesce(v_sale.is_terreno, false) then
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

grant execute on function public.exchange_sale_item(uuid, uuid, integer, text, jsonb) to authenticated;

drop function if exists public.return_sale_item(uuid, integer, text, text);

create or replace function public.return_sale_item(
  p_sale_item_id uuid,
  p_quantity integer,
  p_reason text,
  p_refund_method text default 'efectivo' -- 'efectivo' | 'tarjeta' | 'transferencia' | 'ninguno'
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
  v_item record;
  v_sale record;
  v_refund_amount numeric;
  v_cash_register_id uuid;
  v_kept_item_id uuid;
  v_payment_amount numeric;
  v_remaining_refund numeric;
  v_pay record;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para procesar devoluciones';
  end if;

  if p_refund_method not in ('efectivo', 'tarjeta', 'transferencia', 'ninguno') then
    raise exception 'Método de devolución inválido';
  end if;

  select * into v_item from public.sale_items where id = p_sale_item_id and status = 'active' for update;

  if v_item.id is null then
    raise exception 'Línea de venta no encontrada o ya procesada';
  end if;

  select * into v_sale from public.sales where id = v_item.sale_id for update;

  if v_sale.status <> 'completed' then
    raise exception 'La venta no está en un estado que permita devoluciones';
  end if;

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch and v_sale.branch_id <> public.furgon_branch_id() then
    raise exception 'No puede procesar devoluciones de otra sucursal';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > v_item.quantity then
    raise exception 'Cantidad a devolver inválida';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Debe indicar un motivo';
  end if;

  v_refund_amount := round(v_item.sold_price * p_quantity);

  if p_refund_method <> 'ninguno' and v_refund_amount > 0 then
    select coalesce(sum(amount), 0) into v_payment_amount
    from public.sale_payments
    where sale_id = v_item.sale_id and payment_method = p_refund_method;

    if v_payment_amount < v_refund_amount then
      raise exception 'El monto a devolver (%) supera lo pagado con % en esta venta (%)',
        v_refund_amount, p_refund_method, v_payment_amount;
    end if;
  end if;

  insert into public.inventory (variant_id, branch_id, quantity)
  values (v_item.variant_id, v_sale.branch_id, p_quantity)
  on conflict (variant_id, branch_id) do update
  set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

  insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
  values (v_item.variant_id, v_sale.branch_id, 'sale_cancel', p_quantity, 'sale_item', p_sale_item_id, v_user_id, p_reason);

  if p_refund_method = 'efectivo' and v_refund_amount > 0 and not coalesce(v_sale.is_terreno, false) then
    select id into v_cash_register_id from public.cash_registers where branch_id = v_sale.branch_id and status = 'open';

    if v_cash_register_id is null then
      raise exception 'No hay una caja abierta en esta sucursal';
    end if;

    insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, created_by, description)
    values (v_cash_register_id, v_sale.branch_id, 'sale_cancel_refund', 'devolucion', -v_refund_amount, 'sale_item', p_sale_item_id, v_user_id, p_reason);
  end if;

  if p_quantity = v_item.quantity then
    update public.sale_items
    set status = 'returned', return_reason = p_reason, returned_by = v_user_id, returned_at = now()
    where id = p_sale_item_id;
  else
    -- partial return: the original row becomes the returned portion, a new
    -- active row carries the quantity the customer kept — same split
    -- convention exchange_sale_item already uses.
    update public.sale_items
    set status = 'returned', return_reason = p_reason, returned_by = v_user_id, returned_at = now(),
        quantity = p_quantity, line_total = round(v_item.sold_price * p_quantity)
    where id = p_sale_item_id;

    insert into public.sale_items (sale_id, variant_id, quantity, original_price, sold_price, cost, line_total, status)
    values (
      v_item.sale_id, v_item.variant_id, v_item.quantity - p_quantity, v_item.original_price, v_item.sold_price, v_item.cost,
      round(v_item.sold_price * (v_item.quantity - p_quantity)), 'active'
    )
    returning id into v_kept_item_id;
  end if;

  if p_refund_method <> 'ninguno' and v_refund_amount > 0 then
    -- Walk every sale_payments row for this method (oldest first) and take
    -- the refund out of them in order, instead of assuming there's only one.
    v_remaining_refund := v_refund_amount;

    for v_pay in
      select * from public.sale_payments
      where sale_id = v_item.sale_id and payment_method = p_refund_method
      order by created_at
      for update
    loop
      exit when v_remaining_refund <= 0;
      if v_pay.amount <= v_remaining_refund then
        delete from public.sale_payments where id = v_pay.id;
        v_remaining_refund := v_remaining_refund - v_pay.amount;
      else
        update public.sale_payments set amount = amount - v_remaining_refund where id = v_pay.id;
        v_remaining_refund := 0;
      end if;
    end loop;

    update public.sales
    set subtotal = subtotal - v_refund_amount, total = total - v_refund_amount
    where id = v_item.sale_id;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'sale_item.return', 'sale_items', p_sale_item_id,
    jsonb_build_object('quantity', v_item.quantity),
    jsonb_build_object('quantity_returned', p_quantity, 'refund_amount', v_refund_amount, 'refund_method', p_refund_method, 'reason', p_reason)
  );

  return coalesce(v_kept_item_id, p_sale_item_id);
end;
$$;

grant execute on function public.return_sale_item(uuid, integer, text, text) to authenticated;
