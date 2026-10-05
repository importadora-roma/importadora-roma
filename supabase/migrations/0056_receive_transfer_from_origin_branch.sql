-- receive_transfer required the logged-in user's own branch to match the
-- transfer's destination, so confirming an arrival meant switching to the
-- receiving store's account first (or being admin, which already bypassed
-- this). In practice the sending branch is often the one who hears "ya
-- llegó" by phone and should be able to mark it received without switching
-- accounts. Allow either side of the transfer, not just the destination.
create or replace function public.receive_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_transfer record;
  v_item record;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para recibir traslados';
  end if;

  select * into v_transfer from public.transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'Traslado no encontrado';
  end if;

  if v_transfer.status <> 'en_transito' then
    raise exception 'Este traslado ya fue procesado';
  end if;

  if v_user_role <> 'admin'
     and v_user_branch <> v_transfer.destination_branch_id
     and v_user_branch <> v_transfer.origin_branch_id then
    raise exception 'Solo la sucursal de origen o destino puede recibir este traslado';
  end if;

  for v_item in select * from public.transfer_items where transfer_id = p_transfer_id
  loop
    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_item.variant_id, v_transfer.destination_branch_id, v_item.quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (v_item.variant_id, v_transfer.destination_branch_id, 'transfer_in', v_item.quantity, 'transfer', p_transfer_id, v_user_id);
  end loop;

  update public.transfers
  set status = 'recibido', received_by = v_user_id, received_at = now()
  where id = p_transfer_id;
end;
$$;

grant execute on function public.receive_transfer(uuid) to authenticated;
