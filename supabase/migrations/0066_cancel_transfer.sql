-- Traslados could never be undone — only deleting the row would "fix" a
-- wrong one, but that would leave the stock it already moved (origin
-- debited, and destination credited too once received) silently wrong.
-- Same anular pattern cancel_sale already uses: reverse whatever stock
-- movement actually happened, mark the record cancelled, keep it visible
-- for audit instead of deleting it.

alter table public.transfers add column if not exists cancel_reason text;
alter table public.transfers add column if not exists cancelled_by uuid references public.users (id);
alter table public.transfers add column if not exists cancelled_at timestamptz;

-- inventory_movements.movement_type only allowed a fixed set of values and
-- 'transfer_cancel' (used below) wasn't one of them — cancel_transfer would
-- have failed at call time with a check-constraint violation.
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('sale', 'sale_cancel', 'purchase', 'transfer_out', 'transfer_in', 'transfer_cancel', 'adjustment', 'initial'));

create or replace function public.cancel_transfer(p_transfer_id uuid, p_reason text)
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
    raise exception 'No tiene permisos para anular traslados';
  end if;

  select * into v_transfer from public.transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'Traslado no encontrado';
  end if;

  if v_transfer.status = 'cancelado' then
    raise exception 'El traslado ya está anulado';
  end if;

  if v_user_role <> 'admin'
     and v_user_branch <> v_transfer.origin_branch_id
     and v_user_branch <> v_transfer.destination_branch_id then
    raise exception 'Solo la sucursal de origen o destino puede anular este traslado';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Debe indicar un motivo';
  end if;

  for v_item in select * from public.transfer_items where transfer_id = p_transfer_id
  loop
    -- create_transfer/furgon_load_stock always debit the origin at
    -- creation, whatever the current status — always reverse that.
    insert into public.inventory (variant_id, branch_id, quantity)
    values (v_item.variant_id, v_transfer.origin_branch_id, v_item.quantity)
    on conflict (variant_id, branch_id) do update
    set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
    values (v_item.variant_id, v_transfer.origin_branch_id, 'transfer_cancel', v_item.quantity, 'transfer', p_transfer_id, v_user_id, p_reason);

    -- The destination was only credited once actually received (or
    -- immediately for a Furgón load/unload, which is created 'recibido').
    if v_transfer.status = 'recibido' then
      insert into public.inventory (variant_id, branch_id, quantity)
      values (v_item.variant_id, v_transfer.destination_branch_id, -v_item.quantity)
      on conflict (variant_id, branch_id) do update
      set quantity = public.inventory.quantity - v_item.quantity, updated_at = now();

      insert into public.inventory_movements (variant_id, branch_id, movement_type, quantity, reference_type, reference_id, created_by, notes)
      values (v_item.variant_id, v_transfer.destination_branch_id, 'transfer_cancel', -v_item.quantity, 'transfer', p_transfer_id, v_user_id, p_reason);
    end if;
  end loop;

  update public.transfers
  set status = 'cancelado', cancel_reason = p_reason, cancelled_by = v_user_id, cancelled_at = now()
  where id = p_transfer_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (v_user_id, 'transfer.cancel', 'transfers', p_transfer_id, to_jsonb(v_transfer), jsonb_build_object('status', 'cancelado', 'reason', p_reason));
end;
$$;

grant execute on function public.cancel_transfer(uuid, text) to authenticated;
