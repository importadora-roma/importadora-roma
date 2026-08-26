alter table public.users add column commission_pct numeric(5, 2) not null default 0 check (commission_pct >= 0 and commission_pct <= 100);
