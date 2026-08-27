-- A gasto paid out of the till has to reduce what's actually sitting in
-- the cash register, or "esperado ahora" in Caja drifts from reality —
-- previously expenses and cash_movements were completely disconnected.
-- paid_from_cash records the intent (and survives even when there's no
-- open register to move against); the movement itself is best-effort —
-- if the branch's register happens to be closed, the expense still gets
-- recorded, it just can't touch a register that doesn't exist right now.
alter table public.expenses add column paid_from_cash boolean not null default false;

create or replace function public.create_expense(
  p_branch_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_expense_date date,
  p_notes text default null,
  p_paid_from_cash boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_expense_id uuid;
  v_register_id uuid;
begin
  if not (public.is_admin() or (public.is_supervisor_or_admin() and p_branch_id = public.current_user_branch())) then
    raise exception 'No tiene permisos para registrar gastos en esta sucursal';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  insert into public.expenses (branch_id, category, description, amount, expense_date, notes, paid_from_cash, created_by)
  values (p_branch_id, p_category, p_description, p_amount, p_expense_date, p_notes, p_paid_from_cash, v_user_id)
  returning id into v_expense_id;

  if p_paid_from_cash then
    select id into v_register_id from public.cash_registers
    where branch_id = p_branch_id and status = 'open'
    limit 1;

    if v_register_id is not null then
      insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, description, created_by)
      values (v_register_id, p_branch_id, 'manual_out', 'Gasto: ' || p_category, -p_amount, 'expense', v_expense_id, p_description, v_user_id);
    end if;
  end if;

  return jsonb_build_object('id', v_expense_id, 'registerAdjusted', v_register_id is not null);
end;
$$;

grant execute on function public.create_expense(uuid, text, text, numeric, date, text, boolean) to authenticated;

-- Mirrors create_expense: if the gasto being deleted had a linked
-- cash_movements withdrawal AND that register is still open, reverse it
-- with a new offsetting entry (ledger-style, never mutates the original
-- row) so "esperado ahora" goes back to what it should be. A register
-- closed since then is left untouched — that day's ledger is locked.
create or replace function public.delete_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_expense record;
  v_movement record;
begin
  select * into v_expense from public.expenses where id = p_expense_id;

  if v_expense.id is null then
    raise exception 'Gasto no encontrado';
  end if;

  if not (public.is_admin() or (public.is_supervisor_or_admin() and v_expense.branch_id = public.current_user_branch())) then
    raise exception 'No tiene permisos para eliminar este gasto';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Debe indicar un motivo';
  end if;

  update public.expenses
  set deleted_at = now(), deleted_by = v_user_id, delete_reason = p_reason
  where id = p_expense_id;

  select cm.* into v_movement
  from public.cash_movements cm
  join public.cash_registers cr on cr.id = cm.cash_register_id
  where cm.reference_type = 'expense' and cm.reference_id = p_expense_id and cr.status = 'open'
  limit 1;

  if v_movement.id is not null then
    insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, reference_type, reference_id, description, created_by)
    values (
      v_movement.cash_register_id, v_movement.branch_id, 'manual_in', 'Reverso: ' || v_movement.category,
      -v_movement.amount, 'expense', p_expense_id, 'Gasto eliminado — ' || p_reason, v_user_id
    );
  end if;
end;
$$;

grant execute on function public.delete_expense(uuid, text) to authenticated;
