-- Crédito: a sale can include a "credito" payment line for the amount the
-- customer hasn't paid yet. That amount is settled later via one or more
-- partial payments (different days, different amounts), tracked here.
-- Only 'credito' additions are needed on payment_method — the column has no
-- explicit check constraint of its own (payment_method text not null), so
-- nothing to alter there; sale_payments/create_sale already accept any text
-- and only cash_movements insertion is conditioned on 'efectivo'.

create table public.sale_credit_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('efectivo', 'tarjeta', 'transferencia')),
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index sale_credit_payments_sale_id_idx on public.sale_credit_payments (sale_id);

alter table public.sale_credit_payments enable row level security;

create policy sale_credit_payments_select on public.sale_credit_payments
  for select to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and (public.is_admin() or s.branch_id = public.current_user_branch())
    )
  );

-- =========================================================
-- create_sale: require a customer when any line is 'credito' (can't extend
-- credit to a walk-in with no one to collect from later).
-- =========================================================
create or replace function public.create_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
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

  if p_customer_id is null and exists (
    select 1 from jsonb_array_elements(p_payments) p where p ->> 'payment_method' = 'credito'
  ) then
    raise exception 'Debe seleccionar un cliente para una venta a crédito';
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
-- record_credit_payment: settle part (or all) of a sale's crédito balance.
-- =========================================================
create or replace function public.record_credit_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_payment_method text, -- 'efectivo' | 'tarjeta' | 'transferencia'
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
  v_sale record;
  v_credit_total numeric(12, 2);
  v_paid_so_far numeric(12, 2);
  v_remaining numeric(12, 2);
  v_cash_register_id uuid;
  v_payment_id uuid;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para registrar pagos de crédito';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;

  if v_sale.id is null then
    raise exception 'Venta no encontrada';
  end if;

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch then
    raise exception 'No puede registrar pagos de otra sucursal';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;

  if p_payment_method not in ('efectivo', 'tarjeta', 'transferencia') then
    raise exception 'Método de pago inválido';
  end if;

  select coalesce(sum(amount), 0) into v_credit_total
  from public.sale_payments
  where sale_id = p_sale_id and payment_method = 'credito';

  if v_credit_total = 0 then
    raise exception 'Esta venta no tiene saldo a crédito';
  end if;

  select coalesce(sum(amount), 0) into v_paid_so_far
  from public.sale_credit_payments
  where sale_id = p_sale_id;

  v_remaining := v_credit_total - v_paid_so_far;

  if p_amount > v_remaining then
    raise exception 'El monto (%) supera el saldo pendiente (%)', p_amount, v_remaining;
  end if;

  insert into public.sale_credit_payments (sale_id, amount, payment_method, notes, created_by)
  values (p_sale_id, p_amount, p_payment_method, p_notes, v_user_id)
  returning id into v_payment_id;

  if p_payment_method = 'efectivo' then
    select id into v_cash_register_id from public.cash_registers where branch_id = v_sale.branch_id and status = 'open';

    if v_cash_register_id is null then
      raise exception 'No hay una caja abierta en esta sucursal';
    end if;

    insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, created_by, description)
    values (v_cash_register_id, v_sale.branch_id, 'sale_payment', 'pago_credito', p_amount, 'sale_credit_payment', v_payment_id, v_user_id, p_notes);
  end if;

  return v_payment_id;
end;
$$;

grant execute on function public.record_credit_payment(uuid, numeric, text, text) to authenticated;
