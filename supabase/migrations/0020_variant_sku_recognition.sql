-- Closes the gap between the Contenedores code-learning mechanism
-- (product_codes, container_items.code) and the real inventory catalog
-- (product_variants.sku, already used for barcode-label printing/POS scan).
-- Today, resolving an unknown code or importing a packing list never
-- actually links back to a real product_variants row — every container
-- requires re-mapping via VariantMappingModal from scratch, even for a
-- fardo code the admin already taught the system in a previous container.
--
-- From now on, product_variants.sku is the durable, cross-container
-- barcode -> product link:
--   1. import_container_items: a code matching a known sku auto-fills
--      container_items.variant_id right at import.
--   2. resolve_unknown_code: 'manual_match' can now target either an
--      existing item in *this* container (p_matched_item_id, unchanged)
--      or a variant from the whole catalog (p_variant_id, new) — the
--      latter also teaches product_variants.sku so future containers
--      recognize it automatically via #1 and #3.
--   3. record_scan: a scanned code that doesn't match anything expected
--      in this container, but does match a known sku, is auto-added as
--      an 'added_during_count' item instead of landing in "unknown".

-- =========================================================
-- import_container_items — auto-maps variant_id from product_variants.sku
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
  v_item_id uuid;
  v_matched_variant_id uuid;
  v_inserted integer := 0;
  v_merged integer := 0;
  v_auto_mapped integer := 0;
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
        select id into v_matched_variant_id
        from public.product_variants
        where sku is not null
          and upper(regexp_replace(sku, '[[:space:]-]', '', 'g')) = v_code_normalized
          and deleted_at is null and active
        limit 1;

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

  if v_container.status = 'draft' then
    update public.containers set status = 'importing' where id = p_container_id;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'autoMapped', v_auto_mapped);
end;
$$;

-- =========================================================
-- resolve_unknown_code — manual_match now also accepts p_variant_id to
-- link straight to a product in the whole inventory catalog (not just an
-- item already in this container's own shipping list), teaching
-- product_variants.sku so every future container recognizes the code
-- automatically via import_container_items/record_scan. The new
-- parameter changes the signature, so the old 8-arg overload is dropped
-- first instead of being left behind unused.
-- =========================================================
drop function if exists public.resolve_unknown_code(uuid, text, text, text, text, integer, uuid, text);

create or replace function public.resolve_unknown_code(
  p_container_id uuid,
  p_code_normalized text,
  p_action text, -- 'add_to_list' | 'manual_match' | 'ignore' | 'review_later'
  p_product_name text default null,
  p_calidad text default null,
  p_expected_qty integer default null,
  p_matched_item_id uuid default null,
  p_variant_id uuid default null,
  p_notes text default null
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
  v_unknown record;
  v_matched_item record;
  v_variant record;
  v_product_name text;
  v_item_id uuid;
  v_raw_code text;
  v_learned boolean := false;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para resolver códigos desconocidos';
  end if;

  select * into v_container from public.containers where id = p_container_id;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede resolver códigos de otra sucursal';
  end if;

  select * into v_unknown from public.container_unknown_codes
  where container_id = p_container_id and code_normalized = p_code_normalized
  for update;

  if v_unknown.id is null then
    raise exception 'Código desconocido no encontrado';
  end if;

  v_raw_code := v_unknown.first_raw_code;

  if p_action = 'add_to_list' then
    if p_product_name is null or trim(p_product_name) = '' or p_expected_qty is null then
      raise exception 'Debe indicar producto y cantidad esperada';
    end if;

    insert into public.container_items (container_id, code, product_name, calidad, expected_qty, source, created_by)
    values (p_container_id, v_raw_code, p_product_name, p_calidad, p_expected_qty, 'added_during_count', v_user_id)
    returning id into v_item_id;

    update public.container_scan_events
    set container_item_id = v_item_id, match_status = 'matched'
    where container_id = p_container_id and code_normalized = p_code_normalized and container_item_id is null;

    insert into public.product_codes (code, product_name, calidad, last_seen_container_id, created_by)
    values (v_raw_code, p_product_name, p_calidad, p_container_id, v_user_id);

    update public.container_unknown_codes
    set status = 'added_to_list', resolved_container_item_id = v_item_id, resolved_by = v_user_id, resolved_at = now(), resolution_notes = p_notes
    where id = v_unknown.id;

  elsif p_action = 'manual_match' then
    if p_matched_item_id is null and p_variant_id is null then
      raise exception 'Debe indicar el ítem o producto a asociar';
    end if;

    if p_variant_id is not null then
      -- link straight to the catalog: create a new line for this
      -- container (it wasn't on the packing list) and teach the barcode
      -- onto the real product so it's recognized from now on.
      select pv.id, pv.calidad, pv.product_id, pv.sku into v_variant
      from public.product_variants pv
      where pv.id = p_variant_id and pv.deleted_at is null;

      if v_variant.id is null then
        raise exception 'Producto no encontrado';
      end if;

      select name into v_product_name from public.products where id = v_variant.product_id;

      insert into public.container_items (container_id, code, product_name, calidad, expected_qty, source, variant_id, mapped_at, mapped_by, created_by)
      values (
        p_container_id, v_raw_code, coalesce(v_product_name, '—'), v_variant.calidad,
        greatest(v_unknown.scan_count, 1), 'added_during_count', p_variant_id, now(), v_user_id, v_user_id
      )
      returning id into v_item_id;

      if v_variant.sku is null or upper(regexp_replace(v_variant.sku, '[[:space:]-]', '', 'g')) <> p_code_normalized then
        update public.product_variants set sku = v_raw_code where id = p_variant_id;
        v_learned := true;
      end if;

      insert into public.product_codes (code, product_name, calidad, last_seen_container_id, created_by)
      values (v_raw_code, coalesce(v_product_name, '—'), v_variant.calidad, p_container_id, v_user_id);

      update public.container_scan_events
      set container_item_id = v_item_id, match_status = 'matched'
      where container_id = p_container_id and code_normalized = p_code_normalized and container_item_id is null;

      update public.container_unknown_codes
      set status = 'manually_matched', resolved_container_item_id = v_item_id, resolved_by = v_user_id, resolved_at = now(), resolution_notes = p_notes
      where id = v_unknown.id;
    else
      select * into v_matched_item
      from public.container_items
      where id = p_matched_item_id and container_id = p_container_id and deleted_at is null
      for update;

      if v_matched_item.id is null then
        raise exception 'Ítem no encontrado en este contenedor';
      end if;

      if v_matched_item.code is null then
        if exists (
          select 1 from public.container_items
          where container_id = p_container_id and code_normalized = p_code_normalized
            and id <> v_matched_item.id and deleted_at is null
        ) then
          raise exception 'Este código ya está asignado a otro producto en este contenedor';
        end if;

        update public.container_items set code = v_raw_code where id = v_matched_item.id;
        v_learned := true;

        insert into public.product_codes (code, product_name, calidad, last_seen_container_id, created_by)
        values (v_raw_code, v_matched_item.product_name, v_matched_item.calidad, p_container_id, v_user_id);
      end if;

      -- also teach the catalog if this item is already mapped to a real
      -- variant, so future containers recognize the code automatically.
      if v_matched_item.variant_id is not null then
        update public.product_variants
        set sku = v_raw_code
        where id = v_matched_item.variant_id
          and (sku is null or upper(regexp_replace(sku, '[[:space:]-]', '', 'g')) <> p_code_normalized);
      end if;

      update public.container_scan_events
      set container_item_id = p_matched_item_id, match_status = 'matched'
      where container_id = p_container_id and code_normalized = p_code_normalized and container_item_id is null;

      update public.container_unknown_codes
      set status = 'manually_matched', resolved_container_item_id = p_matched_item_id, resolved_by = v_user_id, resolved_at = now(), resolution_notes = p_notes
      where id = v_unknown.id;

      v_item_id := p_matched_item_id;
    end if;

  elsif p_action = 'ignore' then
    update public.container_unknown_codes
    set status = 'ignored', resolved_by = v_user_id, resolved_at = now(), resolution_notes = p_notes
    where id = v_unknown.id;

  elsif p_action = 'review_later' then
    update public.container_unknown_codes
    set status = 'review_later', resolution_notes = p_notes
    where id = v_unknown.id;

  else
    raise exception 'Acción inválida: %', p_action;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'container.unknown_code.' || p_action, 'container_unknown_codes', v_unknown.id,
    jsonb_build_object('status', v_unknown.status),
    jsonb_build_object('status', p_action, 'container_item_id', v_item_id, 'learned_code', v_learned)
  );

  return jsonb_build_object('itemId', v_item_id, 'learned', v_learned);
end;
$$;

grant execute on function public.resolve_unknown_code(uuid, text, text, text, text, integer, uuid, uuid, text) to authenticated;

-- =========================================================
-- record_scan — a code that doesn't match anything expected in *this*
-- container, but matches a known product_variants.sku, is auto-added as
-- an 'added_during_count' item and matched immediately instead of
-- landing in "unknown" — the fardo shows up on-list with expected_qty
-- set to whatever was just scanned (adjustable later like any item).
-- =========================================================
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
    where pv.sku is not null
      and upper(regexp_replace(pv.sku, '[[:space:]-]', '', 'g')) = v_code_normalized
      and pv.deleted_at is null and pv.active
    limit 1;

    if v_matched_variant_id is not null then
      select name into v_variant_product_name from public.products where id = v_variant_product_id;

      insert into public.container_items (container_id, code, product_name, calidad, expected_qty, source, variant_id, mapped_at, mapped_by, created_by)
      values (
        p_container_id, p_code_raw, coalesce(v_variant_product_name, '—'), v_variant_calidad,
        p_delta, 'added_during_count', v_matched_variant_id, now(), v_user_id, v_user_id
      )
      returning * into v_item;
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

grant execute on function public.record_scan(uuid, uuid, text, text, integer, numeric, boolean, text, jsonb, timestamptz, boolean) to authenticated;
