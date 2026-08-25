-- Facturas module — a pending-invoice pool linked to sales, with automatic
-- net/IVA(19%)/gross calculation so staff have the exact figures ready to
-- type into SII's own invoice-issuing page. This module does NOT emit real
-- electronic invoices (DTE) — that requires a digital certificate and CAF
-- folio authorization from SII, normally done through a certified provider.
-- This is deliberately just record-keeping + a calculator.

alter table public.sales add column requires_invoice boolean not null default false;

create sequence public.invoices_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  internal_number text unique,
  sale_id uuid not null unique references public.sales (id),
  branch_id uuid not null references public.branches (id),
  status text not null default 'pending' check (status in ('pending', 'issued', 'cancelled')),
  sii_folio text,
  notes text,
  issued_at timestamptz,
  issued_by uuid references public.users (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id),
  cancel_reason text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoices_branch_id_idx on public.invoices (branch_id);
create index invoices_status_idx on public.invoices (status);

create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.internal_number is null then
    new.internal_number := 'FAC-' || lpad(nextval('public.invoices_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger set_invoice_number before insert on public.invoices
  for each row execute function public.set_invoice_number();

-- =========================================================
-- RLS — same branch-scoped read as sales; writes only via RPC below (no
-- insert/update policy) since every write must keep sales.requires_invoice
-- in sync with the invoices row.
-- =========================================================
alter table public.invoices enable row level security;

create policy invoices_select on public.invoices
  for select to authenticated using (
    public.is_admin() or branch_id = public.current_user_branch()
  );

-- =========================================================
-- invoice_queue — net/IVA/gross computed live from sales.total (never
-- snapshotted, so it can't drift stale if a sale is later modified via an
-- exchange). security_invoker means this view respects the querying
-- user's RLS on invoices/sales/customers, not the view owner's.
-- =========================================================
create view public.invoice_queue
with (security_invoker = true) as
select
  i.id as invoice_id,
  i.internal_number,
  i.sale_id,
  i.branch_id,
  i.status,
  i.sii_folio,
  i.notes,
  i.issued_at,
  i.cancelled_at,
  i.cancel_reason,
  i.created_at,
  s.sale_number,
  s.total as gross_total,
  round(s.total / 1.19)::numeric(12, 2) as net_total,
  (s.total - round(s.total / 1.19))::numeric(12, 2) as iva_total,
  s.customer_id,
  c.name as customer_name,
  c.rut as customer_rut
from public.invoices i
join public.sales s on s.id = i.sale_id
left join public.customers c on c.id = s.customer_id;

grant select on public.invoice_queue to authenticated;

-- =========================================================
-- set_sale_requires_invoice — toggled from the sale itself (any role that
-- can see the sale). Creates the pending invoices row the first time it's
-- flagged true; reactivates a previously-cancelled one; un-flagging
-- cancels a still-pending row (never touches an already-issued invoice).
-- =========================================================
create or replace function public.set_sale_requires_invoice(
  p_sale_id uuid,
  p_requires boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_sale record;
  v_invoice_id uuid;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role is null then
    raise exception 'Usuario no autorizado';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;

  if v_sale.id is null then
    raise exception 'Venta no encontrada';
  end if;

  if v_user_role <> 'admin' and v_sale.branch_id <> v_user_branch then
    raise exception 'No puede modificar ventas de otra sucursal';
  end if;

  update public.sales set requires_invoice = p_requires where id = p_sale_id;

  if p_requires then
    select id into v_invoice_id from public.invoices where sale_id = p_sale_id;

    if v_invoice_id is null then
      insert into public.invoices (sale_id, branch_id, created_by)
      values (p_sale_id, v_sale.branch_id, v_user_id)
      returning id into v_invoice_id;
    else
      update public.invoices
      set status = 'pending', cancelled_at = null, cancelled_by = null, cancel_reason = null
      where id = v_invoice_id and status = 'cancelled';
    end if;
  else
    update public.invoices
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user_id, cancel_reason = 'Desmarcado desde la venta'
    where sale_id = p_sale_id and status = 'pending'
    returning id into v_invoice_id;
  end if;

  return v_invoice_id;
end;
$$;

-- =========================================================
-- issue_invoice — record-keeping only: marks that the admin/supervisor
-- already went and issued the real invoice in SII, optionally storing the
-- real SII folio number for cross-reference.
-- =========================================================
create or replace function public.issue_invoice(
  p_invoice_id uuid,
  p_sii_folio text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_invoice record;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para marcar facturas como emitidas';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;

  if v_invoice.id is null then
    raise exception 'Factura no encontrada';
  end if;

  if v_user_role <> 'admin' and v_invoice.branch_id <> v_user_branch then
    raise exception 'No puede modificar facturas de otra sucursal';
  end if;

  if v_invoice.status <> 'pending' then
    raise exception 'Esta factura ya fue procesada';
  end if;

  update public.invoices
  set status = 'issued', issued_at = now(), issued_by = v_user_id, sii_folio = nullif(trim(p_sii_folio), '')
  where id = p_invoice_id;
end;
$$;

-- =========================================================
-- cancel_invoice — soft cancel (pending or issued), un-flags the sale so
-- it can be re-marked "requiere factura" later if it was a mistake.
-- =========================================================
create or replace function public.cancel_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_branch uuid;
  v_invoice record;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para cancelar facturas';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;

  if v_invoice.id is null then
    raise exception 'Factura no encontrada';
  end if;

  if v_user_role <> 'admin' and v_invoice.branch_id <> v_user_branch then
    raise exception 'No puede cancelar facturas de otra sucursal';
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'Esta factura ya está cancelada';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Debe indicar un motivo';
  end if;

  update public.invoices
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user_id, cancel_reason = p_reason
  where id = p_invoice_id;

  update public.sales set requires_invoice = false where id = v_invoice.sale_id;
end;
$$;

grant execute on function public.set_sale_requires_invoice(uuid, boolean) to authenticated;
grant execute on function public.issue_invoice(uuid, text) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
