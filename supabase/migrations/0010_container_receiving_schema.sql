-- Contenedores module — schema, indexes, RLS, storage bucket.
-- A container (shipment) arrives with a supplier's expected fardo list
-- (container_items). Warehouse staff scan/photograph each physical fardo's
-- code as it's unloaded (container_scan_events, append-only ledger, mirrors
-- audit_logs' write-only-via-RPC pattern) and the system reconciles expected
-- vs received in real time. product_codes is a deliberately separate,
-- cross-container "suggestion only" master — never authoritative for any
-- one container's own list (container_items is the source of truth there).

-- =========================================================
-- CONTAINERS
-- =========================================================
create sequence public.containers_number_seq;

create table public.containers (
  id uuid primary key default gen_random_uuid(),
  internal_number text unique,
  code text not null,
  branch_id uuid not null references public.branches (id),
  supplier text,
  arrival_date date,
  status text not null default 'draft' check (status in ('draft', 'importing', 'counting', 'completed')),
  notes text,
  created_by uuid references public.users (id),
  completed_at timestamptz,
  completed_by uuid references public.users (id),
  reopened_at timestamptz,
  reopened_by uuid references public.users (id),
  reopen_count integer not null default 0,
  pushed_to_inventory_at timestamptz,
  pushed_to_inventory_by uuid references public.users (id),
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index containers_branch_id_idx on public.containers (branch_id);
create index containers_status_idx on public.containers (status);
create unique index containers_branch_code_unique_idx on public.containers (branch_id, code) where deleted_at is null;

create trigger set_updated_at before update on public.containers
  for each row execute function public.set_updated_at();

create or replace function public.set_container_number()
returns trigger
language plpgsql
as $$
begin
  if new.internal_number is null then
    new.internal_number := 'CNT-' || lpad(nextval('public.containers_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger set_container_number before insert on public.containers
  for each row execute function public.set_container_number();

-- =========================================================
-- CONTAINER ITEMS — this container's own expected shipping list.
-- Source of truth for THIS container only (spec: never the master DB).
-- =========================================================
create table public.container_items (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers (id),
  code text not null,
  code_normalized text generated always as (upper(regexp_replace(code, '[[:space:]-]', '', 'g'))) stored,
  product_name text not null,
  calidad text,
  expected_qty integer not null check (expected_qty >= 0),
  unit text not null default 'unidades',
  notes text,
  source text not null default 'import' check (source in ('import', 'manual', 'added_during_count')),
  variant_id uuid references public.product_variants (id),
  mapped_at timestamptz,
  mapped_by uuid references public.users (id),
  created_by uuid references public.users (id),
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index container_items_container_id_idx on public.container_items (container_id);
create unique index container_items_code_unique_idx on public.container_items (container_id, code_normalized) where deleted_at is null;

create trigger set_updated_at before update on public.container_items
  for each row execute function public.set_updated_at();

-- =========================================================
-- PRODUCT CODES — cross-container master, suggestion-only, deliberately
-- separate from container_items. Index on code_normalized is NOT unique:
-- the same code can legitimately have mapped to different products across
-- different shipments over time; the app always resolves a suggestion via
-- "most seen / most recent" and requires user confirmation, never silently
-- auto-fills.
-- =========================================================
create table public.product_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  code_normalized text generated always as (upper(regexp_replace(code, '[[:space:]-]', '', 'g'))) stored,
  product_name text not null,
  calidad text,
  default_unit text,
  supplier text,
  last_seen_container_id uuid references public.containers (id),
  times_seen integer not null default 1,
  active boolean not null default true,
  created_by uuid references public.users (id),
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_codes_code_normalized_idx on public.product_codes (code_normalized);

create trigger set_updated_at before update on public.product_codes
  for each row execute function public.set_updated_at();

-- =========================================================
-- CONTAINER SCAN EVENTS — append-only ledger (this module's analogue of
-- audit_logs/kardex). Never updated or deleted by the client; an undo is a
-- new negating row. client_event_id is the offline-sync idempotency key:
-- record_scan/undo_scan use "on conflict (client_event_id) do nothing" so a
-- scan replayed by the offline queue can never double-count.
-- =========================================================
create table public.container_scan_events (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers (id),
  container_item_id uuid references public.container_items (id),
  code_raw text not null,
  code_normalized text not null,
  event_type text not null check (event_type in ('scan', 'undo')),
  delta integer not null,
  undoes_event_id uuid references public.container_scan_events (id),
  method text not null check (method in ('barcode', 'manual', 'ocr', 'usb_scanner')),
  confidence numeric(5, 2),
  corrected boolean not null default false,
  photo_path text,
  device_info jsonb,
  match_status text not null check (match_status in ('matched', 'unknown', 'over')),
  client_event_id uuid not null,
  client_scanned_at timestamptz,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create unique index container_scan_events_client_event_id_idx on public.container_scan_events (client_event_id);
create index container_scan_events_container_id_idx on public.container_scan_events (container_id);
create index container_scan_events_container_item_id_idx on public.container_scan_events (container_item_id);
create index container_scan_events_created_at_idx on public.container_scan_events (created_at);

-- =========================================================
-- CONTAINER UNKNOWN CODES — resolution tracking, separate from the raw
-- ledger (a code can be scanned many times before someone resolves it).
-- =========================================================
create table public.container_unknown_codes (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers (id),
  code_normalized text not null,
  first_raw_code text not null,
  first_seen_scan_event_id uuid references public.container_scan_events (id),
  scan_count integer not null default 1,
  status text not null default 'pending' check (
    status in ('pending', 'added_to_list', 'manually_matched', 'ignored', 'review_later')
  ),
  resolved_container_item_id uuid references public.container_items (id),
  resolution_notes text,
  resolved_by uuid references public.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index container_unknown_codes_unique_idx on public.container_unknown_codes (container_id, code_normalized);

create trigger set_updated_at before update on public.container_unknown_codes
  for each row execute function public.set_updated_at();

-- =========================================================
-- CONTAINER SETTINGS — DB-backed so an admin's configuration applies to
-- every operator's device. Global singleton row for v1 (branch_id null);
-- schema allows a future per-branch override, unused for now.
-- =========================================================
create table public.container_settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches (id),
  ocr_confidence_threshold numeric(5, 2) not null default 70 check (ocr_confidence_threshold between 0 and 100),
  duplicate_scan_window_ms integer not null default 500 check (duplicate_scan_window_ms > 0),
  photo_archive_enabled boolean not null default false,
  default_language text not null default 'es' check (default_language in ('es', 'tr')),
  block_over_scan boolean not null default true,
  updated_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index container_settings_global_idx on public.container_settings ((1)) where branch_id is null;
create unique index container_settings_branch_idx on public.container_settings (branch_id) where branch_id is not null;

create trigger set_updated_at before update on public.container_settings
  for each row execute function public.set_updated_at();

insert into public.container_settings (branch_id) values (null);

-- =========================================================
-- STORAGE — private bucket for label photos, only used when
-- container_settings.photo_archive_enabled is on. Client compresses/resizes
-- before upload to control storage cost.
-- =========================================================
insert into storage.buckets (id, name, public)
values ('container-photos', 'container-photos', false)
on conflict (id) do nothing;

create policy container_photos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'container-photos');

create policy container_photos_select on storage.objects
  for select to authenticated using (bucket_id = 'container-photos');

create policy container_photos_delete on storage.objects
  for delete to authenticated using (bucket_id = 'container-photos' and public.is_admin());

-- =========================================================
-- RLS
-- =========================================================
alter table public.containers enable row level security;
alter table public.container_items enable row level security;
alter table public.product_codes enable row level security;
alter table public.container_scan_events enable row level security;
alter table public.container_unknown_codes enable row level security;
alter table public.container_settings enable row level security;

-- CONTAINERS — branch-scoped like sales/transfers. Status transitions are
-- only ever written through set_container_status (RPC, bypasses RLS) by
-- client convention — mirrors how sales.status/cancel_sale works today.
create policy containers_select on public.containers
  for select to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy containers_insert on public.containers
  for insert to authenticated with check (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );

create policy containers_update on public.containers
  for update to authenticated using (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );

-- CONTAINER ITEMS — read branch-scoped via the parent container; direct
-- writes (minor corrections) restricted to admin/supervisor and only while
-- the container isn't completed. Bulk import/resolve go through RPCs.
create policy container_items_select on public.container_items
  for select to authenticated using (
    exists (
      select 1 from public.containers c
      where c.id = container_id
        and (public.is_admin() or c.branch_id = public.current_user_branch())
    )
  );

create policy container_items_write on public.container_items
  for all to authenticated using (
    exists (
      select 1 from public.containers c
      where c.id = container_id
        and c.status <> 'completed'
        and (public.is_admin() or (public.is_supervisor_or_admin() and c.branch_id = public.current_user_branch()))
    )
  ) with check (
    exists (
      select 1 from public.containers c
      where c.id = container_id
        and c.status <> 'completed'
        and (public.is_admin() or (public.is_supervisor_or_admin() and c.branch_id = public.current_user_branch()))
    )
  );

-- PRODUCT CODES — everyone reads (suggestions while scanning); admin/supervisor manage
create policy product_codes_select on public.product_codes
  for select to authenticated using (true);

create policy product_codes_write on public.product_codes
  for all to authenticated using (public.is_supervisor_or_admin()) with check (public.is_supervisor_or_admin());

-- CONTAINER SCAN EVENTS — read branch-scoped; NO insert/update policy at
-- all, written only via record_scan/undo_scan (security definer), same
-- deny-by-default-from-client pattern as audit_logs.
create policy container_scan_events_select on public.container_scan_events
  for select to authenticated using (
    exists (
      select 1 from public.containers c
      where c.id = container_id
        and (public.is_admin() or c.branch_id = public.current_user_branch())
    )
  );

-- CONTAINER UNKNOWN CODES — read branch-scoped; no direct insert/update
-- policy, written only via record_scan/resolve_unknown_code.
create policy container_unknown_codes_select on public.container_unknown_codes
  for select to authenticated using (
    exists (
      select 1 from public.containers c
      where c.id = container_id
        and (public.is_admin() or c.branch_id = public.current_user_branch())
    )
  );

-- CONTAINER SETTINGS — everyone reads; admin-only writes
create policy container_settings_select on public.container_settings
  for select to authenticated using (true);

create policy container_settings_write on public.container_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
