-- Counting a container no longer adds to inventory when it is completed.
-- Completing just closes the count; an admin/supervisor then reviews the
-- container on its own and explicitly approves it (approve_container_stock),
-- which is what actually pushes the scanned fardos into stock.

create or replace view public.container_summary
with (security_invoker = true) as
select
  c.id as container_id,
  coalesce(sum(ci.expected_qty), 0)::integer as expected_qty,
  coalesce((
    select sum(se.delta)
    from public.container_scan_events se
    join public.container_items ci2 on ci2.id = se.container_item_id
    where ci2.container_id = c.id
  ), 0)::integer as scanned_qty,
  count(ci.id) filter (where ci.deleted_at is null)::integer as items_total,
  count(ci.id) filter (where ci.deleted_at is null and ci.expected_qty = coalesce((
    select sum(se.delta) from public.container_scan_events se where se.container_item_id = ci.id
  ), 0))::integer as items_complete,
  (
    select count(*) from public.container_unknown_codes u
    where u.container_id = c.id and u.status in ('pending', 'review_later')
  )::integer as pending_unknown_count,
  -- scanned units of this container that are not in stock yet
  coalesce(sum(greatest(coalesce((
    select sum(se.delta) from public.container_scan_events se where se.container_item_id = ci.id
  ), 0), 0)) filter (where ci.deleted_at is null and ci.pushed_to_inventory_at is null), 0)::integer as pending_stock_qty
from public.containers c
left join public.container_items ci on ci.container_id = c.id and ci.deleted_at is null
where c.deleted_at is null
group by c.id;

grant select on public.container_summary to authenticated;

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

    -- Completing only closes the count. Stock is added later, explicitly, by
    -- approve_container_stock().

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

-- Explicit approval: pushes the counted fardos into the branch's inventory.
-- Same rules as push_container_to_inventory (which it wraps): admin/supervisor,
-- container must be completed, idempotent per item, unmapped items are skipped.
create or replace function public.approve_container_stock(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.push_container_to_inventory(p_container_id, null);

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'container.approve_stock', 'containers', p_container_id, null, v_result);

  return v_result;
end;
$$;

grant execute on function public.approve_container_stock(uuid) to authenticated;
