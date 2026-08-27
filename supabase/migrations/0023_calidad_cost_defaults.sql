-- calidad_cost_defaults: a fixed default cost per calidad tier (Primera,
-- Segunda, Tercera, and the older A/B/E labels this business also uses),
-- so new products start with a sensible cost instead of $0 — still
-- editable per product afterward. Admin-maintainable, same pattern as
-- container_settings/alert_settings.
create table public.calidad_cost_defaults (
  calidad text primary key,
  default_cost numeric(12, 2) not null check (default_cost >= 0),
  updated_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.calidad_cost_defaults
  for each row execute function public.set_updated_at();

alter table public.calidad_cost_defaults enable row level security;

create policy calidad_cost_defaults_select on public.calidad_cost_defaults
  for select to authenticated using (true);

create policy calidad_cost_defaults_write on public.calidad_cost_defaults
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.calidad_cost_defaults (calidad, default_cost) values
  ('Primera', 83500),
  ('Segunda', 31500),
  ('Tercera', 30000),
  ('E', 83500),
  ('A', 31500),
  ('B', 30000);

-- apply the new defaults to existing A/B/E products right away, same as
-- Primera/Segunda/Tercera were already set to these exact figures.
update public.product_variants set cost = 83500 where calidad = 'E' and active and deleted_at is null;
update public.product_variants set cost = 31500 where calidad = 'A' and active and deleted_at is null;
update public.product_variants set cost = 30000 where calidad = 'B' and active and deleted_at is null;
