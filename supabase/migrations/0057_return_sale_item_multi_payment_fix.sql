-- return_sale_item assumed at most one sale_payments row per payment_method
-- on a sale. PaymentSplit lets a cashier add several rows of the same
-- method (e.g. two separate "Efectivo" lines on one sale), and when that
-- happens: the eligibility check's bare `select ... into` silently picked
-- just one of the matching rows (ignoring the rest) instead of their sum,
-- and the DELETE/UPDATE that follows matched ALL rows for that method --
-- so a return could wipe out or double-subtract payment amounts that were
-- never actually refunded, leaving sale_payments (and the method totals
-- reports sum from it) out of sync with sales.total and with what was
-- really handed back at the register.
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

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch then
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

  if p_refund_method = 'efectivo' and v_refund_amount > 0 then
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
