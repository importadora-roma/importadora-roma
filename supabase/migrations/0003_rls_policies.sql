-- Row Level Security: branch-scoped access, role-based writes.
-- Roles: admin (full access), supervisor (own branch write + all-branch read for reports),
-- vendedor (own branch, sales/quotations only).

alter table public.branches enable row level security;
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.cash_registers enable row level security;
alter table public.cash_movements enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.audit_logs enable row level security;

-- =========================================================
-- BRANCHES — everyone authenticated can read; only admin writes
-- =========================================================
create policy branches_select on public.branches
  for select to authenticated using (true);

create policy branches_write on public.branches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- USERS — admin: all; supervisor: own branch; user: self
-- =========================================================
create policy users_select on public.users
  for select to authenticated using (
    public.is_admin()
    or id = auth.uid()
    or (public.current_user_role() = 'supervisor' and branch_id = public.current_user_branch())
  );

create policy users_update_self on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy users_write_admin on public.users
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- CUSTOMERS — shared across branches; any authenticated user can
-- read/create/update; soft-delete restricted to supervisor/admin
-- =========================================================
create policy customers_select on public.customers
  for select to authenticated using (true);

create policy customers_insert on public.customers
  for insert to authenticated with check (true);

create policy customers_update on public.customers
  for update to authenticated using (true) with check (
    deleted_at is null or public.is_supervisor_or_admin()
  );

-- =========================================================
-- PRODUCTS / VARIANTS — everyone reads; supervisor/admin manage
-- =========================================================
create policy products_select on public.products
  for select to authenticated using (true);

create policy products_write on public.products
  for all to authenticated using (public.is_supervisor_or_admin()) with check (public.is_supervisor_or_admin());

create policy product_variants_select on public.product_variants
  for select to authenticated using (true);

create policy product_variants_write on public.product_variants
  for all to authenticated using (public.is_supervisor_or_admin()) with check (public.is_supervisor_or_admin());

-- =========================================================
-- INVENTORY — everyone reads (stock check during sale); direct
-- writes restricted to supervisor/admin (normal flow mutates
-- stock via security-definer RPCs, not direct client writes)
-- =========================================================
create policy inventory_select on public.inventory
  for select to authenticated using (true);

create policy inventory_write on public.inventory
  for all to authenticated using (public.is_supervisor_or_admin()) with check (public.is_supervisor_or_admin());

-- =========================================================
-- INVENTORY MOVEMENTS (Kardex) — everyone reads; direct manual
-- inserts restricted to supervisor/admin (system flows insert via
-- security-definer RPCs which bypass RLS)
-- =========================================================
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated using (true);

create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated with check (public.is_supervisor_or_admin());

-- =========================================================
-- SALES — branch-scoped for supervisor/vendedor, all for admin
-- =========================================================
create policy sales_select on public.sales
  for select to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy sales_insert on public.sales
  for insert to authenticated with check (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy sales_update on public.sales
  for update to authenticated using (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );

create policy sale_items_select on public.sale_items
  for select to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and (public.is_admin() or s.branch_id = public.current_user_branch())
    )
  );

create policy sale_items_insert on public.sale_items
  for insert to authenticated with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and (public.is_admin() or s.branch_id = public.current_user_branch())
    )
  );

create policy sale_items_update on public.sale_items
  for update to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and (public.is_admin() or (public.is_supervisor_or_admin() and s.branch_id = public.current_user_branch()))
    )
  );

create policy sale_payments_select on public.sale_payments
  for select to authenticated using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and (public.is_admin() or s.branch_id = public.current_user_branch())
    )
  );

create policy sale_payments_insert on public.sale_payments
  for insert to authenticated with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and (public.is_admin() or s.branch_id = public.current_user_branch())
    )
  );

-- =========================================================
-- CASH REGISTERS / MOVEMENTS — supervisor/admin manage own branch,
-- vendedor can read own branch (to see the day's cash context)
-- =========================================================
create policy cash_registers_select on public.cash_registers
  for select to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy cash_registers_write on public.cash_registers
  for all to authenticated using (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  ) with check (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );

create policy cash_movements_select on public.cash_movements
  for select to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy cash_movements_write on public.cash_movements
  for all to authenticated using (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  ) with check (
    public.is_admin() or (public.is_supervisor_or_admin() and branch_id = public.current_user_branch())
  );

-- =========================================================
-- TRANSFERS — visible/manageable by origin or destination branch
-- =========================================================
create policy transfers_select on public.transfers
  for select to authenticated using (
    public.is_admin()
    or origin_branch_id = public.current_user_branch()
    or destination_branch_id = public.current_user_branch()
  );

create policy transfers_insert on public.transfers
  for insert to authenticated with check (
    public.is_admin() or (public.is_supervisor_or_admin() and origin_branch_id = public.current_user_branch())
  );

create policy transfers_update on public.transfers
  for update to authenticated using (
    public.is_admin()
    or (public.is_supervisor_or_admin() and (
      origin_branch_id = public.current_user_branch()
      or destination_branch_id = public.current_user_branch()
    ))
  );

create policy transfer_items_select on public.transfer_items
  for select to authenticated using (
    exists (
      select 1 from public.transfers t
      where t.id = transfer_id
        and (
          public.is_admin()
          or t.origin_branch_id = public.current_user_branch()
          or t.destination_branch_id = public.current_user_branch()
        )
    )
  );

create policy transfer_items_insert on public.transfer_items
  for insert to authenticated with check (
    exists (
      select 1 from public.transfers t
      where t.id = transfer_id
        and (public.is_admin() or (public.is_supervisor_or_admin() and t.origin_branch_id = public.current_user_branch()))
    )
  );

-- =========================================================
-- QUOTATIONS — same branch-scoping as sales
-- =========================================================
create policy quotations_select on public.quotations
  for select to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy quotations_insert on public.quotations
  for insert to authenticated with check (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy quotations_update on public.quotations
  for update to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

create policy quotation_items_select on public.quotation_items
  for select to authenticated using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_id
        and (public.is_admin() or q.branch_id = public.current_user_branch())
    )
  );

create policy quotation_items_insert on public.quotation_items
  for insert to authenticated with check (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_id
        and (public.is_admin() or q.branch_id = public.current_user_branch())
    )
  );

-- =========================================================
-- AUDIT LOGS — admin only; inserted via security-definer RPCs
-- =========================================================
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.is_admin());
