-- Historically most product_variants had cost = 0 (fixed earlier via
-- calidad_cost_defaults), so old sale_items snapshotted cost = 0 too,
-- making every past sale look like 100% margin in Rentabilidad/Reportes.
-- This lets an admin backfill those zeroed-out lines using each variant's
-- CURRENT cost, scoped to a branch + date range — it only ever touches
-- rows that are still 0 (never overwrites a manually-corrected line, and
-- is safe to re-run).
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
      and s.created_at >= p_from::timestamptz
      and s.created_at < (p_to::date + 1)::timestamptz
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
