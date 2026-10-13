-- Furgón redesign: instead of borrowing whatever branch happens to be
-- selected in the topbar as "the van's stock" (confusing — that's a real
-- store's full inventory, not what's actually loaded on the van), give the
-- van its own dedicated branch row. Loading/unloading it becomes an
-- ordinary transfer (same tables Transferencias already uses, so it's
-- auditable and the existing "Guía de traslado" PDF works for it
-- unmodified), and the Furgón tab's own inventory query is now just that
-- one branch's stock — nothing else to filter out.
alter table public.branches add column if not exists is_furgon boolean not null default false;

-- At most one branch can be marked as the Furgón.
create unique index if not exists branches_single_furgon
  on public.branches ((is_furgon))
  where is_furgon;

insert into public.branches (name, branch_type, is_furgon)
select 'Furgón', 'tienda', true
where not exists (select 1 from public.branches where is_furgon);

-- A van has no physical till of its own the way a store does — the cash a
-- field sale collects sits with whoever made the sale until it's handed
-- over, it was never really "in" whichever store's drawer create_sale
-- happened to attribute it to. Terreno sales now skip the cash-register
-- requirement entirely instead of needing one open (which the dedicated
-- Furgón branch, having no register, would otherwise always fail): the
-- payment is still recorded on the sale and counted in every report, it
-- just never touches cash_movements.
--
-- Also adds driver_name: a van has one person out selling, who usually
-- isn't a system user (no login needed for a single informal role) — so
-- instead of picking an existing vendedor, the office just types a name
-- for the record, while the sale itself is still attributed to whichever
-- admin/supervisor is entering it (p_user_id still defaults to the caller).
alter table public.sales add column if not exists driver_name text;

drop function if exists public.create_sale(uuid, uuid, jsonb, jsonb, text, date, uuid, boolean);

create or replace function public.create_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null,
  p_sale_date date default null,
  p_user_id uuid default null,
  p_is_terreno boolean default false,
  p_driver_name text default null
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

  insert into public.sales (branch_id, customer_id, user_id, notes, sale_date, is_terreno, driver_name)
  values (p_branch_id, p_customer_id, v_effective_user_id, p_notes, v_sale_date, coalesce(p_is_terreno, false), p_driver_name)
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

  if v_cash_total > 0 and v_sale_date = v_today and not coalesce(p_is_terreno, false) then
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

grant execute on function public.create_sale(uuid, uuid, jsonb, jsonb, text, date, uuid, boolean, text) to authenticated;

-- =========================================================
-- FURGÓN LOAD / UNLOAD — same mechanics as create_transfer +
-- receive_transfer, collapsed into one call and auto-received, since
-- requiring someone to separately "receive" into the van (a branch no one
-- is ever actually standing in) serves no purpose transfers' two-step
-- flow exists for between two real stores.
-- =========================================================
create or replace function public.furgon_load_stock(
  p_origin_branch_id uuid,
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
    raise exception 'No tiene permisos para cargar el furgón';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> p_origin_branch_id then
    raise exception 'Solo puede cargar el furgón con stock de su propia sucursal';
  end if;

  select id into v_furgon_branch_id from public.branches where is_furgon limit 1;
  if v_furgon_branch_id is null then
    raise exception 'No existe la sucursal del furgón';
  end if;

  if p_origin_branch_id = v_furgon_branch_id then
    raise exception 'La sucursal de origen no puede ser el furgón';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Debe indicar al menos un producto';
  end if;

  insert into public.transfers (origin_branch_id, destination_branch_id, sent_by, received_by, received_at, status, notes)
  values (p_origin_branch_id, v_furgon_branch_id, v_user_id, v_user_id, now(), 'recibido', p_notes)
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

    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_variant_id, v_furgon_branch_id, v_quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_variant_id, v_furgon_branch_id, 'transfer_in', v_quantity, 'transfer', v_transfer_id, v_user_id);

    insert into public.transfer_items (transfer_id, variant_id, quantity, unit_price)
    values (v_transfer_id, v_variant_id, v_quantity, v_unit_price);
  end loop;

  return v_transfer_id;
end;
$$;

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

grant execute on function public.furgon_load_stock(uuid, jsonb, text) to authenticated;
grant execute on function public.furgon_unload_stock(uuid, jsonb, text) to authenticated;
