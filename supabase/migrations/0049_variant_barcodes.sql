-- A fardo can carry more than one barcode (the supplier's SARDES code and the codes already in use at Tucapel).
-- product_variants.sku stays the primary barcode; extra ones live here. Scans and imports accept either.
create table if not exists public.variant_barcodes (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  code text not null,
  code_normalized text generated always as (upper(regexp_replace(code, '[[:space:]-]', '', 'g'))) stored,
  created_at timestamptz not null default now()
);
create unique index if not exists variant_barcodes_code_uidx on public.variant_barcodes (code_normalized);
create index if not exists variant_barcodes_variant_idx on public.variant_barcodes (variant_id);
alter table public.variant_barcodes enable row level security;
create policy variant_barcodes_select on public.variant_barcodes for select to authenticated using (true);
create policy variant_barcodes_write on public.variant_barcodes for all to authenticated
  using (public.is_supervisor_or_admin()) with check (public.is_supervisor_or_admin());

create or replace function public.variant_for_code(p_code_normalized text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from (
    select pv.id, 0 as pri from public.product_variants pv
    where pv.sku is not null and pv.deleted_at is null and pv.active
      and upper(regexp_replace(pv.sku, '[[:space:]-]', '', 'g')) = p_code_normalized
    union all
    select vb.variant_id, 1 from public.variant_barcodes vb
    join public.product_variants pv on pv.id = vb.variant_id and pv.deleted_at is null and pv.active
    where vb.code_normalized = p_code_normalized
  ) x order by pri limit 1
$$;
grant execute on function public.variant_for_code(text) to authenticated;

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
  v_item_id uuid;
  v_matched_variant_id uuid;
  v_inserted integer := 0;
  v_merged integer := 0;
  v_auto_mapped integer := 0;
  v_auto_mapped_names integer := 0;
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
    v_item_id := null;
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

        v_item_id := v_existing.id;
        v_merged := v_merged + 1;
      else
        insert into public.container_items (container_id, code, product_name, calidad, expected_qty, unit, notes, cost_usd_per_kilo, source, created_by)
        values (p_container_id, v_code, v_product_name, v_calidad, v_qty, v_unit, v_notes, v_cost_usd, 'import', v_user_id)
        returning id into v_item_id;

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

      -- auto-map to inventory: this exact barcode was already taught onto
      -- a real product (see resolve_unknown_code below), so this
      -- container's line item is linked to it immediately — no manual
      -- VariantMappingModal step needed for it at push time.
      if v_item_id is not null then
        v_matched_variant_id := public.variant_for_code(v_code_normalized);

        if v_matched_variant_id is not null then
          update public.container_items
          set variant_id = v_matched_variant_id, mapped_at = now(), mapped_by = v_user_id
          where id = v_item_id and variant_id is null;

          v_auto_mapped := v_auto_mapped + 1;
        end if;
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

  -- Packing lists usually have no barcodes. Link each code-less line to its
  -- catalog variant by product name + calidad when that resolves to exactly one
  -- variant with a barcode, and bring the barcode onto the line. Ambiguous
  -- lines (e.g. both a saco and a fardo exist) stay unmapped: the first scan
  -- of one of their barcodes claims them (see record_scan).
  with cand as (
    select ci.id as item_id, pv.id as variant_id, pv.sku,
           count(*) over (partition by ci.id) as n_for_item,
           count(*) over (partition by pv.id) as n_for_variant
    from public.container_items ci
    join public.products p on p.deleted_at is null and public.norm_product_name(p.name) = public.norm_product_name(ci.product_name)
    join public.product_variants pv on pv.product_id = p.id and pv.deleted_at is null and pv.active and pv.sku is not null
      and lower(pv.calidad) = lower(coalesce(ci.calidad, ''))
    where ci.container_id = p_container_id and ci.deleted_at is null
      and ci.code is null and ci.variant_id is null and ci.source = 'import'
  )
  update public.container_items ci
  set variant_id = cand.variant_id, code = cand.sku, mapped_at = now(), mapped_by = v_user_id
  from cand
  where ci.id = cand.item_id and cand.n_for_item = 1 and cand.n_for_variant = 1
    and not exists (
      select 1 from public.container_items o
      where o.container_id = p_container_id and o.deleted_at is null and o.id <> ci.id
        and (o.variant_id = cand.variant_id or o.code_normalized = upper(regexp_replace(cand.sku, '[[:space:]-]', '', 'g')))
    );
  get diagnostics v_auto_mapped_names = row_count;
  v_auto_mapped := v_auto_mapped + v_auto_mapped_names;

  if v_container.status = 'draft' then
    update public.containers set status = 'importing' where id = p_container_id;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'autoMapped', v_auto_mapped);
end;
$$;

create or replace function public.record_scan(
  p_container_id uuid,
  p_client_event_id uuid,
  p_code_raw text,
  p_method text,
  p_delta integer default 1,
  p_confidence numeric default null,
  p_corrected boolean default false,
  p_photo_path text default null,
  p_device_info jsonb default null,
  p_client_scanned_at timestamptz default null,
  p_confirm_over boolean default false
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
  v_code_normalized text;
  v_item record;
  v_event_id uuid;
  v_existing record;
  v_settings record;
  v_scanned_after integer;
  v_match_status text;
  v_matched_variant_id uuid;
  v_variant_calidad text;
  v_variant_product_id uuid;
  v_variant_product_name text;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role is null then
    raise exception 'Usuario no autorizado';
  end if;

  select * into v_container from public.containers where id = p_container_id;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede escanear en otra sucursal';
  end if;

  if v_container.status <> 'counting' then
    raise exception 'El contenedor no está en estado de conteo';
  end if;

  if p_method not in ('barcode', 'manual', 'ocr', 'usb_scanner') then
    raise exception 'Método de escaneo inválido';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad escaneada debe ser distinta de cero';
  end if;

  -- idempotency: a replayed client_event_id (offline sync retry) returns
  -- the original result instead of reprocessing
  select * into v_existing from public.container_scan_events where client_event_id = p_client_event_id;

  if v_existing.id is not null then
    select coalesce(sum(se.delta), 0) into v_scanned_after
    from public.container_scan_events se
    where se.container_item_id = v_existing.container_item_id;

    return jsonb_build_object(
      'event_id', v_existing.id,
      'match_status', v_existing.match_status,
      'container_item_id', v_existing.container_item_id,
      'code_normalized', v_existing.code_normalized,
      'scanned_qty_for_item', v_scanned_after,
      'expected_qty_for_item', (select expected_qty from public.container_items where id = v_existing.container_item_id),
      'already_recorded', true
    );
  end if;

  v_code_normalized := upper(regexp_replace(p_code_raw, '[[:space:]-]', '', 'g'));

  select * into v_item
  from public.container_items
  where container_id = p_container_id and code_normalized = v_code_normalized and deleted_at is null
  for update;

  if v_item.id is null then
    select pv.id, pv.calidad, pv.product_id into v_matched_variant_id, v_variant_calidad, v_variant_product_id
    from public.product_variants pv
    where pv.id = public.variant_for_code(v_code_normalized);

    if v_matched_variant_id is not null then
      select name into v_variant_product_name from public.products where id = v_variant_product_id;

      -- 1) a packing-list line already linked to this variant
      select * into v_item
      from public.container_items
      where container_id = p_container_id and variant_id = v_matched_variant_id and deleted_at is null
      order by line_no limit 1
      for update;

      -- 2) an unlinked, code-less packing-list line for the same product +
      --    calidad: this first scan tells us which variant (saco/fardo) it is
      if v_item.id is null then
        select * into v_item
        from public.container_items
        where container_id = p_container_id and deleted_at is null and code is null and variant_id is null
          and source = 'import'
          and public.norm_product_name(product_name) = public.norm_product_name(v_variant_product_name)
          and lower(coalesce(calidad, '')) = lower(coalesce(v_variant_calidad, ''))
        order by line_no limit 1
        for update;

        if v_item.id is not null then
          update public.container_items
          set variant_id = v_matched_variant_id, code = p_code_raw, mapped_at = now(), mapped_by = v_user_id
          where id = v_item.id
          returning * into v_item;
        end if;
      end if;

      -- 3) not on the packing list at all: add it as an extra
      if v_item.id is null then
      insert into public.container_items (container_id, code, product_name, calidad, expected_qty, source, variant_id, mapped_at, mapped_by, created_by)
      values (
        p_container_id, p_code_raw, coalesce(v_variant_product_name, '—'), v_variant_calidad,
        p_delta, 'added_during_count', v_matched_variant_id, now(), v_user_id, v_user_id
      )
      returning * into v_item;
      end if;
    end if;
  end if;

  select * into v_settings from public.container_settings where branch_id = v_container.branch_id;
  if v_settings.id is null then
    select * into v_settings from public.container_settings where branch_id is null;
  end if;

  if v_item.id is null then
    v_match_status := 'unknown';
  else
    select coalesce(sum(delta), 0) into v_scanned_after from public.container_scan_events where container_item_id = v_item.id;
    v_scanned_after := v_scanned_after + p_delta;

    if v_scanned_after > v_item.expected_qty then
      if coalesce(v_settings.block_over_scan, true) and not p_confirm_over then
        raise exception 'over_expected_confirmation_required';
      end if;
      v_match_status := 'over';
    else
      v_match_status := 'matched';
    end if;
  end if;

  insert into public.container_scan_events (
    container_id, container_item_id, code_raw, code_normalized, event_type, delta,
    method, confidence, corrected, photo_path, device_info, match_status,
    client_event_id, client_scanned_at, created_by
  ) values (
    p_container_id, v_item.id, p_code_raw, v_code_normalized, 'scan', p_delta,
    p_method, p_confidence, p_corrected, p_photo_path, p_device_info, v_match_status,
    p_client_event_id, p_client_scanned_at, v_user_id
  )
  on conflict (client_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- lost the race to a concurrent identical sync; re-fetch and return that result
    select * into v_existing from public.container_scan_events where client_event_id = p_client_event_id;
    select coalesce(sum(se.delta), 0) into v_scanned_after
    from public.container_scan_events se where se.container_item_id = v_existing.container_item_id;

    return jsonb_build_object(
      'event_id', v_existing.id,
      'match_status', v_existing.match_status,
      'container_item_id', v_existing.container_item_id,
      'code_normalized', v_existing.code_normalized,
      'scanned_qty_for_item', v_scanned_after,
      'expected_qty_for_item', (select expected_qty from public.container_items where id = v_existing.container_item_id),
      'already_recorded', true
    );
  end if;

  if v_item.id is null then
    insert into public.container_unknown_codes (container_id, code_normalized, first_raw_code, first_seen_scan_event_id)
    values (p_container_id, v_code_normalized, p_code_raw, v_event_id)
    on conflict (container_id, code_normalized) do update
    set scan_count = public.container_unknown_codes.scan_count + 1;
  end if;

  return jsonb_build_object(
    'event_id', v_event_id,
    'match_status', v_match_status,
    'container_item_id', v_item.id,
    'code_normalized', v_code_normalized,
    'scanned_qty_for_item', v_scanned_after,
    'expected_qty_for_item', v_item.expected_qty,
    'already_recorded', false
  );
end;
$$;

grant execute on function public.import_container_items(uuid, jsonb) to authenticated;
grant execute on function public.record_scan(uuid, uuid, text, text, integer, numeric, boolean, text, jsonb, timestamptz, boolean) to authenticated;
