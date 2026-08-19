-- Physical counts are sometimes off, so a sale must never be blocked by a
-- stale/incorrect stock number. Stock can go negative; it just gets flagged
-- for a manual recount later (visible as a negative value in Inventario).

alter table public.inventory drop constraint if exists inventory_quantity_check;

-- =========================================================
-- create_sale: no more "insufficient stock" exception. Uses an upsert so a
-- variant with no inventory row yet still gets one (starting negative).
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

    v_line_total := (v_item ->> 'sold_price')::numeric * v_quantity;

    insert into public.sale_items (sale_id, variant_id, quantity, original_price, sold_price, cost, line_total)
    values (v_sale_id, v_variant.id, v_quantity, v_variant.price, (v_item ->> 'sold_price')::numeric, v_variant.cost, v_line_total);

    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_variant.id, p_branch_id, -v_quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity - v_quantity, updated_at = now();

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

-- =========================================================
-- exchange_sale_item: same relaxation for the replacement variant's stock.
-- =========================================================
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
