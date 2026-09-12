-- "What's new" changelog: every shipped update gets a row here so every
-- branch can see what changed and when, without needing to be told
-- individually. Entries are added by hand alongside each change (there is
-- no in-app "create update" form) — the author is always the same person,
-- so it's a fixed label in the UI, not a stored column.

create table public.app_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index app_updates_released_at_idx on public.app_updates (released_at desc);

alter table public.app_updates enable row level security;

create policy app_updates_select on public.app_updates
  for select to authenticated using (true);

create policy app_updates_write on public.app_updates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Dismissing a notice is per-user: hides it from that person's list without
-- affecting anyone else's.
create table public.user_update_dismissals (
  user_id uuid not null references public.users (id),
  update_id uuid not null references public.app_updates (id),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, update_id)
);

alter table public.user_update_dismissals enable row level security;

create policy user_update_dismissals_select on public.user_update_dismissals
  for select to authenticated using (user_id = auth.uid());

create policy user_update_dismissals_insert on public.user_update_dismissals
  for insert to authenticated with check (user_id = auth.uid());

create policy user_update_dismissals_delete on public.user_update_dismissals
  for delete to authenticated using (user_id = auth.uid());
