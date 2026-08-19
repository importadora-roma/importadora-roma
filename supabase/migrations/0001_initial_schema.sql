-- Importadora Roma ERP — Initial schema
-- Branches, users, customers, products/variants, inventory, sales, cash, transfers, quotations, audit

create extension if not exists "pgcrypto";

-- =========================================================
-- BRANCHES
-- =========================================================
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- USERS (profile linked 1:1 to auth.users)
-- =========================================================
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null check (role in ('admin', 'supervisor', 'vendedor')),
  branch_id uuid references public.branches (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_branch_id_idx on public.users (branch_id);

-- =========================================================
-- CUSTOMERS
-- =========================================================
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rut text,
  phone text,
  email text,
  address text,
  notes text,
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_rut_unique_idx on public.customers (rut) where rut is not null and deleted_at is null;
create index customers_name_idx on public.customers (name);

-- =========================================================
-- PRODUCTS
-- =========================================================
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on public.products (category);

-- =========================================================
-- PRODUCT VARIANTS (calidad x kilo = distinct stock item)
-- =========================================================
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  calidad text not null,
  kilo numeric(10, 2) not null check (kilo > 0),
  sku text,
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, calidad, kilo)
);

create unique index product_variants_sku_unique_idx on public.product_variants (sku) where sku is not null;
create index product_variants_product_id_idx on public.product_variants (product_id);

-- =========================================================
-- INVENTORY (variant x branch)
-- =========================================================
create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id),
  branch_id uuid not null references public.branches (id),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (variant_id, branch_id)
);

create index inventory_branch_id_idx on public.inventory (branch_id);

-- =========================================================
-- INVENTORY MOVEMENTS (Kardex)
-- =========================================================
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id),
  branch_id uuid not null references public.branches (id),
  movement_type text not null check (
    movement_type in (
      'sale', 'sale_cancel', 'purchase', 'transfer_out', 'transfer_in', 'adjustment', 'initial'
    )
  ),
  quantity integer not null,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index inventory_movements_variant_branch_idx on public.inventory_movements (variant_id, branch_id);
create index inventory_movements_reference_idx on public.inventory_movements (reference_type, reference_id);
create index inventory_movements_created_at_idx on public.inventory_movements (created_at);

-- =========================================================
-- SALES
-- =========================================================
create sequence public.sales_number_seq;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text unique,
  branch_id uuid not null references public.branches (id),
  customer_id uuid references public.customers (id),
  user_id uuid not null references public.users (id),
  status text not null default 'completed' check (status in ('completed', 'cancelled')),
  subtotal numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  cancel_reason text,
  cancelled_by uuid references public.users (id),
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sales_branch_id_idx on public.sales (branch_id);
create index sales_customer_id_idx on public.sales (customer_id);
create index sales_created_at_idx on public.sales (created_at);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  quantity integer not null check (quantity > 0),
  original_price numeric(12, 2) not null,
  sold_price numeric(12, 2) not null,
  cost numeric(12, 2) not null,
  line_total numeric(12, 2) not null,
  status text not null default 'active' check (status in ('active', 'returned', 'cancelled')),
  return_reason text,
  returned_by uuid references public.users (id),
  returned_at timestamptz,
  created_at timestamptz not null default now()
);

create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index sale_items_variant_id_idx on public.sale_items (variant_id);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  payment_method text not null check (payment_method in ('efectivo', 'tarjeta', 'transferencia')),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index sale_payments_sale_id_idx on public.sale_payments (sale_id);

-- =========================================================
-- CASH REGISTERS (daily open/close per branch)
-- =========================================================
create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  opened_by uuid not null references public.users (id),
  opened_at timestamptz not null default now(),
  opening_amount numeric(12, 2) not null default 0,
  closed_by uuid references public.users (id),
  closed_at timestamptz,
  expected_amount numeric(12, 2),
  actual_amount numeric(12, 2),
  difference numeric(12, 2),
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  created_at timestamptz not null default now()
);

create unique index cash_registers_one_open_per_branch_idx on public.cash_registers (branch_id) where status = 'open';
create index cash_registers_branch_id_idx on public.cash_registers (branch_id);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers (id),
  branch_id uuid not null references public.branches (id),
  movement_type text not null check (
    movement_type in ('sale_payment', 'sale_cancel_refund', 'manual_in', 'manual_out')
  ),
  category text,
  amount numeric(12, 2) not null,
  reference_type text,
  reference_id uuid,
  description text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index cash_movements_register_id_idx on public.cash_movements (cash_register_id);
create index cash_movements_reference_idx on public.cash_movements (reference_type, reference_id);

-- =========================================================
-- TRANSFERS
-- =========================================================
create sequence public.transfers_number_seq;

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text unique,
  origin_branch_id uuid not null references public.branches (id),
  destination_branch_id uuid not null references public.branches (id) check (destination_branch_id <> origin_branch_id),
  status text not null default 'en_transito' check (status in ('en_transito', 'recibido', 'cancelado')),
  sent_by uuid not null references public.users (id),
  sent_at timestamptz not null default now(),
  received_by uuid references public.users (id),
  received_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transfers_origin_branch_idx on public.transfers (origin_branch_id);
create index transfers_destination_branch_idx on public.transfers (destination_branch_id);

create table public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  quantity integer not null check (quantity > 0)
);

create index transfer_items_transfer_id_idx on public.transfer_items (transfer_id);

-- =========================================================
-- QUOTATIONS
-- =========================================================
create sequence public.quotations_number_seq;

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text unique,
  branch_id uuid not null references public.branches (id),
  customer_id uuid references public.customers (id),
  user_id uuid not null references public.users (id),
  status text not null default 'pending' check (status in ('pending', 'converted', 'expired', 'cancelled')),
  subtotal numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  valid_until date,
  converted_sale_id uuid references public.sales (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quotations_branch_id_idx on public.quotations (branch_id);
create index quotations_customer_id_idx on public.quotations (customer_id);

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null,
  line_total numeric(12, 2) not null
);

create index quotation_items_quotation_id_idx on public.quotation_items (quotation_id);

-- =========================================================
-- AUDIT LOGS
-- =========================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id),
  action text not null,
  table_name text,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_table_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at);
