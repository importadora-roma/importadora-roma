-- Helper functions, updated_at triggers, document numbering, new-user provisioning

-- =========================================================
-- Generic updated_at trigger
-- =========================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.branches
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sales
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.transfers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quotations
  for each row execute function public.set_updated_at();

-- =========================================================
-- Current-user helpers (security definer to avoid RLS recursion
-- when policies on other tables need to inspect public.users)
-- =========================================================
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.current_user_branch()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.is_supervisor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'supervisor'), false);
$$;

-- =========================================================
-- New auth user -> public.users profile provisioning
-- Role/branch default to 'vendedor'/null and must be set by an admin
-- afterward (via Configuración > Usuarios), since only an admin can
-- decide a new hire's role and branch.
-- =========================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    'vendedor'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- =========================================================
-- Document numbering (V-000001, T-000001, C-000001)
-- =========================================================
create or replace function public.set_sale_number()
returns trigger
language plpgsql
as $$
begin
  if new.sale_number is null then
    new.sale_number := 'V-' || lpad(nextval('public.sales_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger set_sale_number before insert on public.sales
  for each row execute function public.set_sale_number();

create or replace function public.set_transfer_number()
returns trigger
language plpgsql
as $$
begin
  if new.transfer_number is null then
    new.transfer_number := 'T-' || lpad(nextval('public.transfers_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger set_transfer_number before insert on public.transfers
  for each row execute function public.set_transfer_number();

create or replace function public.set_quotation_number()
returns trigger
language plpgsql
as $$
begin
  if new.quotation_number is null then
    new.quotation_number := 'C-' || lpad(nextval('public.quotations_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger set_quotation_number before insert on public.quotations
  for each row execute function public.set_quotation_number();
