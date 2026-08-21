-- Real-world correction: supplier shipping lists frequently have NO code
-- column at all — the fardo code only exists as a physical label/barcode
-- discovered while unloading. container_items.code must therefore be
-- optional at import time; the code gets "learned" onto the item the first
-- time an admin/supervisor manually matches an unknown scanned code to it
-- (see resolve_unknown_code below), so every subsequent scan of that same
-- code then matches automatically without needing to resolve it again.

alter table public.container_items alter column code drop not null;

-- =========================================================
-- import_container_items — code is now optional. When blank, rows are
-- de-duplicated by (product_name, calidad) among other code-less rows in
-- the same container instead of by code (there's no code to key on yet).
-- product_codes (the cross-container recognition master) is only updated
-- when a real code is present — a code-less row has nothing useful to
-- teach it.
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
    v_code := nullif(trim(coalesce(v_item ->> 'code', '')), '');
    v_product_name := trim(v_item ->> 'product_name');
    v_calidad := nullif(trim(v_item ->> 'calidad'), '');
    v_qty := (v_item ->> 'expected_qty')::integer;
    v_unit := coalesce(nullif(trim(v_item ->> 'unit'), ''), 'unidades');
    v_notes := v_item ->> 'notes';

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
        set expected_qty = expected_qty + v_qty
        where id = v_existing.id;

        v_merged := v_merged + 1;
      else
        insert into public.container_items (container_id, code, product_name, calidad, expected_qty, unit, notes, source, created_by)
        values (p_container_id, null, v_product_name, v_calidad, v_qty, v_unit, v_notes, 'import', v_user_id);

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
-- resolve_unknown_code — manual_match now "learns" the scanned code onto
-- the matched item when it doesn't have one yet, so every future scan of
-- that code matches automatically via the normal record_scan lookup
-- instead of landing in "unknown" again. If the item already has a
-- *different* code, this match is treated as a one-off reclassification
-- only (the existing code is never silently overwritten).
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
  v_matched_item record;
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
    if p_matched_item_id is null then
      raise exception 'Debe indicar el ítem a asociar';
    end if;

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
    jsonb_build_object('status', p_action, 'container_item_id', v_item_id, 'learned_code', v_learned)
  );

  return jsonb_build_object('unknown_code_id', v_unknown.id, 'container_item_id', v_item_id, 'action', p_action, 'learned_code', v_learned);
end;
$$;
