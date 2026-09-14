-- Free-form ("producto libre") sale items: a sale line for something that
-- isn't a catalogued fardo (e.g. a one-off item sold at its own price).
-- variant_id becomes optional; a free line carries custom_name instead and
-- never touches inventory.

alter table public.sale_items alter column variant_id drop not null;
alter table public.sale_items add column custom_name text;
alter table public.sale_items
  add constraint sale_items_variant_or_custom
  check ((variant_id is not null) <> (custom_name is not null));

-- Same as the 0031 version (Chile-timezone sale_date logic), with one
-- addition: an item can now carry custom_name instead of variant_id, in
-- which case it skips the product_variants lookup and the inventory/
-- inventory_movements inserts entirely.
create or replace function public.create_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null,
  p_sale_date date default null
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
  v_sale_date date;
  v_today date := (now() at time zone 'America/Santiago')::date;
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

  v_sale_date := coalesce(p_sale_date, v_today);

  if v_sale_date > v_today then
    raise exception 'La fecha de venta no puede ser futura';
  end if;

  if v_sale_date <> v_today and v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para registrar una venta con fecha retroactiva';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un producto';
  end if;

  if p_customer_id is null and exists (
    select 1 from jsonb_array_elements(p_payments) p where p ->> 'payment_method' = 'credito'
  ) then
    raise exception 'Debe seleccionar un cliente para una venta a crédito';
  end if;

  insert into public.sales (branch_id, customer_id, user_id, notes, sale_date)
  values (p_branch_id, p_customer_id, v_user_id, p_notes, v_sale_date)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad inválida';
    end if;

    if v_item ? 'custom_name' then
      if trim(v_item ->> 'custom_name') = '' then
        raise exception 'El producto libre debe tener un nombre';
      end if;

      v_line_total := (v_item ->> 'sold_price')::numeric * v_quantity;

      insert into public.sale_items (sale_id, variant_id, custom_name, quantity, original_price, sold_price, cost, line_total)
      values (
        v_sale_id, null, trim(v_item ->> 'custom_name'), v_quantity,
        (v_item ->> 'sold_price')::numeric, (v_item ->> 'sold_price')::numeric,
        coalesce((v_item ->> 'cost')::numeric, 0), v_line_total
      );
    else
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
    end if;

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

  if v_cash_total > 0 and v_sale_date = v_today then
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

grant execute on function public.create_sale(uuid, uuid, jsonb, jsonb, text, date) to authenticated;

-- return_sale_item: a free item has no variant/inventory to restock — skip
-- that step for it, everything else (refund, status) is unchanged.
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

  if v_item.variant_id is not null then
    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_item.variant_id, v_sale.branch_id, p_quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
    values (v_item.variant_id, v_sale.branch_id, 'sale_cancel', p_quantity, 'sale_item', p_sale_item_id, v_user_id, p_reason);
  end if;

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

    insert into public.sale_items (sale_id, variant_id, custom_name, quantity, original_price, sold_price, cost, line_total, status)
    values (
      v_item.sale_id, v_item.variant_id, v_item.custom_name, v_item.quantity - p_quantity, v_item.original_price, v_item.sold_price, v_item.cost,
      round(v_item.sold_price * (v_item.quantity - p_quantity)), 'active'
    )
    returning id into v_kept_item_id;
  end if;

  update public.sales
  set subtotal = subtotal - v_refund_amount, total = total - v_refund_amount
  where id = v_item.sale_id;

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
