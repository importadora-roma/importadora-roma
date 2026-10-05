-- Agregar gasto is about to get a date field so admin/supervisor can log a
-- past expense, mirroring the sale_date backdating feature (0028/0031).
-- create_expense already accepted p_expense_date but never used it for
-- anything besides the stored row: a "pagado en efectivo" backdated gasto
-- would still debit whatever register happens to be open *today*, wrongly
-- pulling down today's expected cash for money that was actually spent on
-- an earlier day. Only same-Chile-day expenses touch the till now, same
-- rule create_sale already applies to sale payments.

alter table public.expenses alter column expense_date set default ((now() at time zone 'America/Santiago')::date);

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
  v_today date := (now() at time zone 'America/Santiago')::date;
  v_expense_date date := coalesce(p_expense_date, v_today);
begin
  if not (public.is_admin() or (public.is_supervisor_or_admin() and p_branch_id = public.current_user_branch())) then
    raise exception 'No tiene permisos para registrar gastos en esta sucursal';
  end if;

  if v_expense_date > v_today then
    raise exception 'La fecha del gasto no puede ser futura';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a 0';
  end if;

  insert into public.expenses (branch_id, category, description, amount, expense_date, notes, paid_from_cash, created_by)
  values (p_branch_id, p_category, p_description, p_amount, v_expense_date, p_notes, p_paid_from_cash, v_user_id)
  returning id into v_expense_id;

  if p_paid_from_cash and v_expense_date = v_today then
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
