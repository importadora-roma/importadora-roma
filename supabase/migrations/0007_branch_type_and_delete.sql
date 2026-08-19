-- Branch type distinguishes wholesale "importadora" branches (full sales,
-- cash, inventory) from "tienda" branches (retail stores that only receive
-- stock via transfer — their own point-of-sale is a separate system).
alter table public.branches add column if not exists branch_type text not null default 'importadora'
  check (branch_type in ('importadora', 'tienda'));

-- Soft delete, matching the pattern already used for products/customers.
alter table public.branches add column if not exists deleted_at timestamptz;
alter table public.branches add column if not exists deleted_by uuid references public.users (id);
alter table public.branches add column if not exists delete_reason text;
