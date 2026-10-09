-- Furgón (route sales): the field rep doesn't necessarily use the system
-- themselves -- an admin/supervisor often enters what they sold after the
-- fact. create_sale always attributed the sale to whoever is logged in
-- (auth.uid()), so entering it from the office would wrongly give the
-- admin's own account the commission credit instead of the rep's. Add an
-- optional p_user_id override: only admin/supervisor may use it (to
-- attribute someone else's sale), everyone else is still pinned to their
-- own id exactly as before. Nothing else changes -- cash_movements and
-- inventory_movements still record the actual logged-in user as the one
-- who performed the action, only sales.user_id (what commission reports
-- key on) can be overridden.
create or replace function public.create_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null,
  p_sale_date date default null,
  p_user_id uuid default null
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
  v_effective_user_id uuid;
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

  v_effective_user_id := v_user_id;
  if p_user_id is not null and p_user_id <> v_user_id then
    if v_user_role not in ('admin', 'supervisor') then
      raise exception 'No tiene permisos para registrar una venta a nombre de otro vendedor';
    end if;
    if not exists (select 1 from public.users where id = p_user_id) then
      raise exception 'Vendedor no encontrado';
    end if;
    v_effective_user_id := p_user_id;
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
  values (p_branch_id, p_customer_id, v_effective_user_id, p_notes, v_sale_date)
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

      insert into public.sale_items (sale_id, variant_id, custom_name, quantity, original_price, sold_price, cost, line_total, notes)
      values (
        v_sale_id, null, trim(v_item ->> 'custom_name'), v_quantity,
        (v_item ->> 'sold_price')::numeric, (v_item ->> 'sold_price')::numeric,
        coalesce((v_item ->> 'cost')::numeric, 0), v_line_total, nullif(v_item ->> 'notes', '')
      );
    else
      select id, cost, price into v_variant
      from public.product_variants
      where id = (v_item ->> 'variant_id')::uuid and active and deleted_at is null;

      if v_variant.id is null then
        raise exception 'Variante % no encontrada o inactiva', v_item ->> 'variant_id';
      end if;

      v_line_total := (v_item ->> 'sold_price')::numeric * v_quantity;

      insert into public.sale_items (sale_id, variant_id, quantity, original_price, sold_price, cost, line_total, notes)
      values (
        v_sale_id, v_variant.id, v_quantity, v_variant.price, (v_item ->> 'sold_price')::numeric, v_variant.cost, v_line_total,
        nullif(v_item ->> 'notes', '')
      );

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

grant execute on function public.create_sale(uuid, uuid, jsonb, jsonb, text, date, uuid) to authenticated;
