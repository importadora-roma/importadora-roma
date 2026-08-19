-- Manual inventory adjustment (initial stock load, physical count corrections).
-- Always goes through this RPC so every change leaves a movement record.
create or replace function public.adjust_inventory(
  p_variant_id uuid,
  p_branch_id uuid,
  p_new_quantity integer,
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
  v_current integer;
  v_delta integer;
  v_movement_type text;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para ajustar inventario';
  end if;

  if v_user_role <> 'admin' and v_user_branch <> p_branch_id then
    raise exception 'Solo puede ajustar inventario de su propia sucursal';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'La cantidad no puede ser negativa';
  end if;

  select quantity into v_current from public.inventory where variant_id = p_variant_id and branch_id = p_branch_id for update;

  if v_current is null then
    v_current := 0;
    insert into public.inventory (variant_id, branch_id, quantity) values (p_variant_id, p_branch_id, p_new_quantity);
    v_movement_type := 'initial';
  else
    update public.inventory set quantity = p_new_quantity, updated_at = now()
    where variant_id = p_variant_id and branch_id = p_branch_id;
    v_movement_type := 'adjustment';
  end if;

  v_delta := p_new_quantity - v_current;

  if v_delta <> 0 then
    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, created_by, notes)
    values (p_variant_id, p_branch_id, v_movement_type, v_delta, 'manual', v_user_id, p_reason);
  end if;
end;
$$;

grant execute on function public.adjust_inventory(uuid, uuid, integer, text) to authenticated;
