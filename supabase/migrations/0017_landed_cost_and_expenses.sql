-- Landed-cost costing for container fardos (packing-list USD/kilo -> CLP
-- unit cost, so profit-margin reports reflect real cost instead of a
-- manually-typed guess) + branch expenses/salaries for net-profit reporting.

alter table public.container_items add column cost_usd_per_kilo numeric(10, 2);

alter table public.container_settings
  add column usd_clp_rate numeric(10, 2) not null default 950,
  add column operational_markup_pct numeric(5, 2) not null default 10,
  add column cost_rounding integer not null default 500 check (cost_rounding > 0);

-- =========================================================
-- import_container_items — now also captures cost_usd_per_kilo per row
-- (varies by fardo/quality per the supplier packing list). Carried
-- through to push_container_to_inventory's landed-cost calculation.
-- =========================================================
create or replace function public.import_container_items(
  p_container_id uuid,
  p_items jsonb -- [{code, product_name, calidad, expected_qty, unit, notes, cost_usd_per_kilo}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_container record;
  v_item jsonb;
  v_code text;
  v_code_normalized text;
  v_product_name text;
  v_calidad text;
  v_qty integer;
  v_unit text;
  v_notes text;
  v_cost_usd numeric;
  v_existing record;
  v_pc record;
  v_inserted integer := 0;
  v_merged integer := 0;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para importar listas de contenedor';
  end if;

  select * into v_container from public.containers where id = p_container_id for update;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede importar en contenedores de otra sucursal';
  end if;

  if v_container.status not in ('draft', 'importing') then
    raise exception 'No se puede importar una lista en el estado actual del contenedor';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La lista importada no tiene productos';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_code := nullif(trim(coalesce(v_item ->> 'code', '')), '');
    v_product_name := trim(v_item ->> 'product_name');
    v_calidad := nullif(trim(v_item ->> 'calidad'), '');
    v_qty := (v_item ->> 'expected_qty')::integer;
    v_unit := coalesce(nullif(trim(v_item ->> 'unit'), ''), 'unidades');
    v_notes := v_item ->> 'notes';
    v_cost_usd := nullif(v_item ->> 'cost_usd_per_kilo', '')::numeric;

    if v_product_name is null or v_product_name = '' then
      raise exception 'Producto vacío en la lista';
    end if;

    if v_qty is null or v_qty < 0 then
      raise exception 'Cantidad inválida para el producto %', v_product_name;
    end if;

    if v_code is not null then
      v_code_normalized := upper(regexp_replace(v_code, '[[:space:]-]', '', 'g'));

      select * into v_existing
      from public.container_items
      where container_id = p_container_id and code_normalized = v_code_normalized and deleted_at is null
      for update;

      if v_existing.id is not null then
        if lower(v_existing.product_name) <> lower(v_product_name)
          or coalesce(lower(v_existing.calidad), '') <> coalesce(lower(v_calidad), '') then
          raise exception 'El código % ya está asignado a otro producto/calidad en este contenedor', v_code;
        end if;

        update public.container_items
        set expected_qty = expected_qty + v_qty,
            cost_usd_per_kilo = coalesce(v_cost_usd, cost_usd_per_kilo)
        where id = v_existing.id;

        v_merged := v_merged + 1;
      else
        insert into public.container_items (container_id, code, product_name, calidad, expected_qty, unit, notes, cost_usd_per_kilo, source, created_by)
        values (p_container_id, v_code, v_product_name, v_calidad, v_qty, v_unit, v_notes, v_cost_usd, 'import', v_user_id);

        v_inserted := v_inserted + 1;
      end if;

      select * into v_pc
      from public.product_codes
      where code_normalized = v_code_normalized
        and lower(product_name) = lower(v_product_name)
        and coalesce(lower(calidad), '') = coalesce(lower(v_calidad), '')
      limit 1;

      if v_pc.id is not null then
        update public.product_codes
        set times_seen = times_seen + 1, last_seen_container_id = p_container_id, supplier = coalesce(v_container.supplier, supplier)
        where id = v_pc.id;
      else
        insert into public.product_codes (code, product_name, calidad, default_unit, supplier, last_seen_container_id, created_by)
        values (v_code, v_product_name, v_calidad, v_unit, v_container.supplier, p_container_id, v_user_id);
      end if;
    else
      -- no code: merge by (product_name, calidad) among other code-less
      -- rows already in this container, since there's nothing else to key on
      select * into v_existing
      from public.container_items
      where container_id = p_container_id and code is null and deleted_at is null
        and lower(product_name) = lower(v_product_name)
        and coalesce(lower(calidad), '') = coalesce(lower(v_calidad), '')
      for update;

      if v_existing.id is not null then
        update public.container_items
        set expected_qty = expected_qty + v_qty,
            cost_usd_per_kilo = coalesce(v_cost_usd, cost_usd_per_kilo)
        where id = v_existing.id;

        v_merged := v_merged + 1;
      else
        insert into public.container_items (container_id, code, product_name, calidad, expected_qty, unit, notes, cost_usd_per_kilo, source, created_by)
        values (p_container_id, null, v_product_name, v_calidad, v_qty, v_unit, v_notes, v_cost_usd, 'import', v_user_id);

        v_inserted := v_inserted + 1;
      end if;
    end if;
  end loop;

  if v_container.status = 'draft' then
    update public.containers set status = 'importing' where id = p_container_id;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged);
end;
$$;

-- =========================================================
-- push_container_to_inventory — now also computes each mapped item's
-- landed unit cost (cost_usd_per_kilo x variant.kilo x usd_clp_rate x
-- (1 + operational_markup_pct/100), rounded to the nearest cost_rounding)
-- and writes it onto product_variants.cost, so margin reports downstream
-- (sale_items.cost is snapshotted from this at sale time) reflect the
-- real landed cost instead of whatever was last typed by hand.
-- =========================================================
create or replace function public.push_container_to_inventory(
  p_container_id uuid,
  p_variant_mappings jsonb default null -- [{container_item_id, variant_id}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_container record;
  v_mapping jsonb;
  v_item record;
  v_variant_kilo numeric;
  v_landed_cost numeric;
  v_net_qty integer;
  v_pushed integer := 0;
  v_skipped integer := 0;
  v_costed integer := 0;
  v_usd_clp_rate numeric;
  v_markup_pct numeric;
  v_rounding integer;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para trasladar a inventario';
  end if;

  select * into v_container from public.containers where id = p_container_id for update;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede procesar contenedores de otra sucursal';
  end if;

  if v_container.status <> 'completed' then
    raise exception 'El contenedor debe estar completado antes de enviarlo a inventario';
  end if;

  if v_container.pushed_to_inventory_at is not null then
    raise exception 'Este contenedor ya fue enviado a inventario';
  end if;

  select coalesce(usd_clp_rate, 950), coalesce(operational_markup_pct, 10), coalesce(cost_rounding, 500)
  into v_usd_clp_rate, v_markup_pct, v_rounding
  from public.container_settings
  where branch_id is null;

  if p_variant_mappings is not null then
    for v_mapping in select * from jsonb_array_elements(p_variant_mappings)
    loop
      update public.container_items
      set variant_id = (v_mapping ->> 'variant_id')::uuid, mapped_at = now(), mapped_by = v_user_id
      where id = (v_mapping ->> 'container_item_id')::uuid and container_id = p_container_id;
    end loop;
  end if;

  for v_item in
    select * from public.container_items
    where container_id = p_container_id and deleted_at is null
  loop
    if v_item.variant_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_item.cost_usd_per_kilo is not null then
      select kilo into v_variant_kilo from public.product_variants where id = v_item.variant_id;

      if v_variant_kilo is not null and v_variant_kilo > 0 then
        v_landed_cost := v_item.cost_usd_per_kilo * v_variant_kilo * v_usd_clp_rate * (1 + v_markup_pct / 100);
        v_landed_cost := round(v_landed_cost / v_rounding) * v_rounding;

        update public.product_variants set cost = v_landed_cost where id = v_item.variant_id;
        v_costed := v_costed + 1;
      end if;
    end if;

    select coalesce(sum(delta), 0) into v_net_qty
    from public.container_scan_events
    where container_item_id = v_item.id;

    if v_net_qty <= 0 then
      continue;
    end if;

    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_item.variant_id, v_container.branch_id, v_net_qty)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
    values (v_item.variant_id, v_container.branch_id, 'purchase', v_net_qty, 'container', p_container_id, v_user_id, 'Contenedor ' || v_container.internal_number);

    v_pushed := v_pushed + 1;
  end loop;

  update public.containers
  set pushed_to_inventory_at = now(), pushed_to_inventory_by = v_user_id
  where id = p_container_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'container.push_to_inventory', 'containers', p_container_id,
    null, jsonb_build_object('itemsPushed', v_pushed, 'itemsSkippedUnmapped', v_skipped, 'itemsCosted', v_costed)
  );

  return jsonb_build_object('itemsPushed', v_pushed, 'itemsSkippedUnmapped', v_skipped, 'itemsCosted', v_costed);
end;
$$;

-- =========================================================
-- expenses: manual gastos/sueldos entry per branch, feeding the net-profit
-- report. Plain RLS-guarded table (single-table CRUD, no RPC needed) —
-- same convention as products/customers.
-- =========================================================
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  category text not null check (category in ('sueldo', 'arriendo', 'servicios', 'otro')),
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  notes text,
  created_by uuid references public.users (id),
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_branch_date_idx on public.expenses (branch_id, expense_date);

create trigger set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select to authenticated using (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );

create policy expenses_write on public.expenses
  for all to authenticated using (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  ) with check (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );
