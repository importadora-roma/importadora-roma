-- Contenedores module — business-logic RPCs. Each function does its own
-- permission checks (branch scoping, role checks) since security definer
-- bypasses RLS, matching the pattern in 0004_business_logic.sql.

-- =========================================================
-- import_container_items — bulk upsert a container's expected list from the
-- Excel/CSV import preview. Two codes in the same container can never point
-- at different products (this is the "must not silently merge" guard from
-- the plan) — the client's preview grid should already catch this, but this
-- is the authoritative safety net.
-- =========================================================
create or replace function public.import_container_items(
  p_container_id uuid,
  p_items jsonb -- [{code, product_name, calidad, expected_qty, unit, notes}]
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
    v_code := trim(v_item ->> 'code');
    v_product_name := trim(v_item ->> 'product_name');
    v_calidad := nullif(trim(v_item ->> 'calidad'), '');
    v_qty := (v_item ->> 'expected_qty')::integer;
    v_unit := coalesce(nullif(trim(v_item ->> 'unit'), ''), 'unidades');
    v_notes := v_item ->> 'notes';

    if v_code is null or v_code = '' then
      raise exception 'Código vacío en la lista';
    end if;

    if v_product_name is null or v_product_name = '' then
      raise exception 'Producto vacío para el código %', v_code;
    end if;

    if v_qty is null or v_qty < 0 then
      raise exception 'Cantidad inválida para el código %', v_code;
    end if;

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
      set expected_qty = expected_qty + v_qty
      where id = v_existing.id;

      v_merged := v_merged + 1;
    else
      insert into public.container_items (container_id, code, product_name, calidad, expected_qty, unit, notes, source, created_by)
      values (p_container_id, v_code, v_product_name, v_calidad, v_qty, v_unit, v_notes, 'import', v_user_id);

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
  end loop;

  if v_container.status = 'draft' then
    update public.containers set status = 'importing' where id = p_container_id;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged);
end;
$$;

-- =========================================================
-- set_container_status — draft/importing -> counting -> completed, and
-- completed -> counting (reopen). Completion is blocked by default on any
-- expected/scanned mismatch or unresolved unknown code; override requires a
-- reason and is logged.
-- =========================================================
create or replace function public.set_container_status(
  p_container_id uuid,
  p_new_status text,
  p_override_mismatch boolean default false,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_container record;
  v_item_count integer;
  v_has_mismatch boolean;
  v_has_pending_unknown boolean;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para cambiar el estado del contenedor';
  end if;

  select * into v_container from public.containers where id = p_container_id for update;

  if v_container.id is null then
    raise exception 'Contenedor no encontrado';
  end if;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede modificar contenedores de otra sucursal';
  end if;

  if p_new_status not in ('importing', 'counting', 'completed') then
    raise exception 'Estado inválido';
  end if;

  if p_new_status = 'counting' and v_container.status in ('draft', 'importing') then
    select count(*) into v_item_count from public.container_items where container_id = p_container_id and deleted_at is null;

    if v_item_count = 0 then
      raise exception 'El contenedor no tiene productos importados';
    end if;

    update public.containers set status = 'counting' where id = p_container_id;

  elsif p_new_status = 'completed' and v_container.status = 'counting' then
    select exists (
      select 1 from public.container_items ci
      where ci.container_id = p_container_id and ci.deleted_at is null
        and ci.expected_qty <> coalesce((select sum(se.delta) from public.container_scan_events se where se.container_item_id = ci.id), 0)
    ) into v_has_mismatch;

    select exists (
      select 1 from public.container_unknown_codes
      where container_id = p_container_id and status in ('pending', 'review_later')
    ) into v_has_pending_unknown;

    if (v_has_mismatch or v_has_pending_unknown) and not p_override_mismatch then
      raise exception 'El contenedor tiene diferencias sin resolver. Use la confirmación de cierre con diferencias.';
    end if;

    if (v_has_mismatch or v_has_pending_unknown) and p_override_mismatch and (p_reason is null or trim(p_reason) = '') then
      raise exception 'Debe indicar un motivo para completar con diferencias';
    end if;

    update public.containers
    set status = 'completed', completed_at = now(), completed_by = v_user_id
    where id = p_container_id;

    if v_has_mismatch or v_has_pending_unknown then
      insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
      values (v_user_id, 'container.complete_override', 'containers', p_container_id, null, jsonb_build_object('reason', p_reason));
    end if;

  elsif p_new_status = 'counting' and v_container.status = 'completed' then
    update public.containers
    set status = 'counting', reopened_at = now(), reopened_by = v_user_id, reopen_count = reopen_count + 1,
      completed_at = null, completed_by = null
    where id = p_container_id;

  else
    raise exception 'Transición de estado inválida: % -> %', v_container.status, p_new_status;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'container.status_change', 'containers', p_container_id,
    jsonb_build_object('status', v_container.status), jsonb_build_object('status', p_new_status)
  );
end;
$$;

-- =========================================================
-- record_scan — the one RPC vendedor (operador) calls directly. Idempotent
-- via client_event_id (offline-queue replay safety). Over-expected scans
-- are rejected server-side by default (not just a client dialog) unless
-- p_confirm_over=true, enforcing the spec's default-blocking rule for real.
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

-- =========================================================
-- undo_scan — inserts a negating ledger row, never deletes. vendedor may
-- only undo their own single most-recent, not-yet-undone scan in that
-- container; admin/supervisor may undo any event from history.
-- =========================================================
create or replace function public.undo_scan(
  p_scan_event_id uuid,
  p_client_event_id uuid default null,
  p_reason text default null
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
  v_original record;
  v_container record;
  v_latest_own_event_id uuid;
  v_undo_event_id uuid;
  v_client_event_id uuid := coalesce(p_client_event_id, gen_random_uuid());
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role is null then
    raise exception 'Usuario no autorizado';
  end if;

  -- idempotency short-circuit: a replayed undo (offline sync retry) returns
  -- the original undo event instead of re-validating/re-inserting
  if p_client_event_id is not null then
    select id into v_undo_event_id from public.container_scan_events where client_event_id = p_client_event_id;
    if v_undo_event_id is not null then
      return v_undo_event_id;
    end if;
  end if;

  select * into v_original from public.container_scan_events where id = p_scan_event_id;

  if v_original.id is null then
    raise exception 'Evento de escaneo no encontrado';
  end if;

  if v_original.event_type <> 'scan' then
    raise exception 'Solo se puede deshacer un escaneo, no otra reversión';
  end if;

  if exists (select 1 from public.container_scan_events where undoes_event_id = v_original.id) then
    raise exception 'Este escaneo ya fue deshecho';
  end if;

  select * into v_container from public.containers where id = v_original.container_id;

  if v_user_role <> 'admin' and v_container.branch_id <> v_user_branch then
    raise exception 'No puede modificar escaneos de otra sucursal';
  end if;

  if v_user_role not in ('admin', 'supervisor') then
    select se.id into v_latest_own_event_id
    from public.container_scan_events se
    where se.container_id = v_original.container_id
      and se.event_type = 'scan'
      and se.created_by = v_user_id
      and not exists (select 1 from public.container_scan_events u where u.undoes_event_id = se.id)
    order by se.created_at desc
    limit 1;

    if v_latest_own_event_id is null or v_latest_own_event_id <> p_scan_event_id then
      raise exception 'Solo puede deshacer su propio último escaneo';
    end if;
  end if;

  insert into public.container_scan_events (
    container_id, container_item_id, code_raw, code_normalized, event_type, delta,
    undoes_event_id, method, match_status, client_event_id, created_by
  ) values (
    v_original.container_id, v_original.container_item_id, v_original.code_raw, v_original.code_normalized,
    'undo', -v_original.delta, v_original.id, v_original.method, v_original.match_status, v_client_event_id, v_user_id
  )
  on conflict (client_event_id) do nothing
  returning id into v_undo_event_id;

  if v_undo_event_id is null then
    select id into v_undo_event_id from public.container_scan_events where client_event_id = v_client_event_id;
    return v_undo_event_id;
  end if;

  if v_original.match_status = 'unknown' then
    update public.container_unknown_codes
    set scan_count = greatest(scan_count - 1, 0)
    where container_id = v_original.container_id and code_normalized = v_original.code_normalized;
  end if;

  return v_undo_event_id;
end;
$$;

-- =========================================================
-- resolve_unknown_code — admin/supervisor only. add_to_list/manual_match
-- retroactively reclassify every existing unknown scan event for that code
-- in this container (updates classification, never rewrites history).
-- =========================================================
create or replace function public.resolve_unknown_code(
  p_container_id uuid,
  p_code_normalized text,
  p_action text, -- 'add_to_list' | 'manual_match' | 'ignore' | 'review_later'
  p_product_name text default null,
  p_calidad text default null,
  p_expected_qty integer default null,
  p_matched_item_id uuid default null,
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
  v_item_id uuid;
  v_raw_code text;
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
    if p_matched_item_id is null then
      raise exception 'Debe indicar el ítem a asociar';
    end if;

    if not exists (select 1 from public.container_items where id = p_matched_item_id and container_id = p_container_id) then
      raise exception 'Ítem no encontrado en este contenedor';
    end if;

    update public.container_scan_events
    set container_item_id = p_matched_item_id, match_status = 'matched'
    where container_id = p_container_id and code_normalized = p_code_normalized and container_item_id is null;

    update public.container_unknown_codes
    set status = 'manually_matched', resolved_container_item_id = p_matched_item_id, resolved_by = v_user_id, resolved_at = now(), resolution_notes = p_notes
    where id = v_unknown.id;

    v_item_id := p_matched_item_id;

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
    jsonb_build_object('status', p_action, 'container_item_id', v_item_id)
  );

  return jsonb_build_object('unknown_code_id', v_unknown.id, 'container_item_id', v_item_id, 'action', p_action);
end;
$$;

-- =========================================================
-- push_container_to_inventory — manual, one-time, admin-triggered. Never
-- automatic on scan/completion, so it can never double-count against
-- ImportPage.tsx's existing manual "llegada de contenedor" stock-add flow.
-- pushed_to_inventory_at is a hard idempotency guard: structurally
-- impossible to run twice for the same container.
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
  v_net_qty integer;
  v_pushed integer := 0;
  v_skipped integer := 0;
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
    null, jsonb_build_object('itemsPushed', v_pushed, 'itemsSkippedUnmapped', v_skipped)
  );

  return jsonb_build_object('itemsPushed', v_pushed, 'itemsSkippedUnmapped', v_skipped);
end;
$$;

-- =========================================================
-- GRANTS
-- =========================================================
grant execute on function public.import_container_items(uuid, jsonb) to authenticated;
grant execute on function public.set_container_status(uuid, text, boolean, text) to authenticated;
grant execute on function public.record_scan(uuid, uuid, text, text, integer, numeric, boolean, text, jsonb, timestamptz, boolean) to authenticated;
grant execute on function public.undo_scan(uuid, uuid, text) to authenticated;
grant execute on function public.resolve_unknown_code(uuid, text, text, text, text, integer, uuid, text) to authenticated;
grant execute on function public.push_container_to_inventory(uuid, jsonb) to authenticated;
