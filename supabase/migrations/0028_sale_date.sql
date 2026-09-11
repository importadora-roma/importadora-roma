-- sales.created_at was the only date a sale carried — both the audit
-- insertion timestamp AND the sole date every report filters/groups by,
-- so a sale missed on a past day (never entered) had no way to be
-- recorded as having actually happened then. sale_date mirrors the
-- expense_date pattern already used by expenses: a separate business
-- date, defaulting to today, only admin/supervisor may set it to a
-- different day.

alter table public.sales add column sale_date date;
update public.sales set sale_date = created_at::date;
alter table public.sales alter column sale_date set default current_date;
alter table public.sales alter column sale_date set not null;
create index sales_branch_date_idx on public.sales (branch_id, sale_date);

-- Adding p_sale_date changes the argument list, so the old 5-arg
-- overload must be dropped first or both would coexist.
drop function if exists public.create_sale(uuid, uuid, jsonb, jsonb, text);

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

  v_sale_date := coalesce(p_sale_date, current_date);

  if v_sale_date > current_date then
    raise exception 'La fecha de venta no puede ser futura';
  end if;

  if v_sale_date <> current_date and v_user_role not in ('admin', 'supervisor') then
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

  -- Only same-day sales touch the till: crediting today's open register
  -- for a backdated sale would misstate today's cash count with money
  -- that isn't physically arriving today. The sale itself (and its
  -- sale_payments row) is still recorded either way.
  if v_cash_total > 0 and v_sale_date = current_date then
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

-- Keep the cost-backfill tool scoped by the same business date sales are
-- now reported by, so a backdated sale's zeroed-out cost lines are still
-- picked up when backfilling "September", not "whenever it was typed in".
create or replace function public.backfill_sale_item_costs(
  p_branch_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_count integer := 0;
begin
  select role into v_user_role from public.users where id = v_user_id;

  if v_user_role <> 'admin' then
    raise exception 'Solo un administrador puede recalcular costos';
  end if;

  with updated as (
    update public.sale_items si
    set cost = pv.cost
    from public.sales s, public.product_variants pv
    where si.sale_id = s.id
      and si.variant_id = pv.id
      and si.status = 'active'
      and si.cost = 0
      and pv.cost > 0
      and s.status = 'completed'
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and s.sale_date >= p_from
      and s.sale_date <= p_to
    returning si.id
  )
  select count(*) into v_count from updated;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'sale_items.backfill_cost', 'sale_items', p_branch_id,
    null, jsonb_build_object('branch_id', p_branch_id, 'from', p_from, 'to', p_to, 'items_updated', v_count)
  );

  return jsonb_build_object('itemsUpdated', v_count);
end;
$$;

grant execute on function public.backfill_sale_item_costs(uuid, date, date) to authenticated;
