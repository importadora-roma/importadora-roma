-- clear_branch_inventory: zeroes every non-zero stock quantity for one
-- branch in a single transaction, logging a normal 'adjustment' inventory
-- movement per item (same movement_type adjust_inventory already uses) so
-- the Kardex keeps a full audit trail of what was cleared and why.
-- Admin-only (stricter than the per-item adjust_inventory, which also
-- allows supervisor) given the blast radius of a bulk operation.
create or replace function public.clear_branch_inventory(
  p_branch_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_row record;
  v_count integer := 0;
begin
  select role into v_user_role from public.users where id = v_user_id;

  if v_user_role <> 'admin' then
    raise exception 'Solo un administrador puede vaciar el inventario de una sucursal';
  end if;

  if p_branch_id is null then
    raise exception 'Debe indicar la sucursal';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Debe indicar un motivo';
  end if;

  for v_row in
    select variant_id, quantity from public.inventory where branch_id = p_branch_id and quantity <> 0 for update
  loop
    update public.inventory set quantity = 0, updated_at = now()
    where variant_id = v_row.variant_id and branch_id = p_branch_id;

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, created_by, notes)
    values (v_row.variant_id, p_branch_id, 'adjustment', -v_row.quantity, 'manual', v_user_id, p_reason);

    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_user_id, 'inventory.clear_branch', 'inventory', p_branch_id,
    null, jsonb_build_object('branch_id', p_branch_id, 'items_cleared', v_count, 'reason', p_reason)
  );

  return jsonb_build_object('itemsCleared', v_count);
end;
$$;

grant execute on function public.clear_branch_inventory(uuid, text) to authenticated;
