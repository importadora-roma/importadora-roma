-- Alerts: low-stock threshold + credit due dates, feeding the notification
-- bell in AppLayout. alert_settings mirrors the container_settings pattern
-- (global singleton row, admin-only write) — no per-branch override in v1.

create table public.alert_settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches (id),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  credit_default_term_days integer not null default 30 check (credit_default_term_days > 0),
  updated_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index alert_settings_global_idx on public.alert_settings ((1)) where branch_id is null;
create unique index alert_settings_branch_idx on public.alert_settings (branch_id) where branch_id is not null;

create trigger set_updated_at before update on public.alert_settings
  for each row execute function public.set_updated_at();

insert into public.alert_settings (branch_id) values (null);

alter table public.alert_settings enable row level security;

create policy alert_settings_select on public.alert_settings
  for select to authenticated using (true);

create policy alert_settings_write on public.alert_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Credit sales get an optional due date, set from NewSalePage when a
-- 'credito' payment line is used. Nullable: pre-existing credit sales and
-- non-credit sales simply have no due date and never appear as overdue.
alter table public.sales add column due_date date;
