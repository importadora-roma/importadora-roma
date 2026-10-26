-- Approval-request system: the business owner wants certain supervisor-
-- initiated actions (changing a variant's sale price, deactivating/deleting
-- a product or variant, manual cash-register in/out movements) to require
-- admin sign-off instead of taking effect immediately. Admin's own actions
-- are never gated — only requests from non-admin users land here.
--
-- The gate itself lives in the application layer (ProductsPage.tsx,
-- CashPage.tsx check profile.role before deciding whether to apply the
-- change directly or create a request here instead). A DB trigger-based
-- hard block was considered but rejected: product_variants.active already
-- flips false->true via the existing barcode-merge auto-dedup flow
-- (0053/0054), which runs under a supervisor's own session — a blanket
-- trigger blocking non-admin deactivations would have broken that
-- unrelated, legitimate flow.

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('price_change', 'product_delete', 'cash_adjustment')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references public.users (id),
  branch_id uuid references public.branches (id),
  description text not null,
  payload jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index approval_requests_status_idx on public.approval_requests (status);
create index approval_requests_requested_by_idx on public.approval_requests (requested_by);

-- =========================================================
-- RLS — admin sees everything; a requester can see their own requests
-- (so they could eventually be shown "your request is pending"). All
-- writes go through the security-definer RPCs below, never direct table
-- access, so there is no insert/update policy.
-- =========================================================
alter table public.approval_requests enable row level security;

create policy approval_requests_select on public.approval_requests
  for select to authenticated using (
    public.is_admin() or requested_by = auth.uid()
  );

-- =========================================================
-- create_approval_request — called by the app instead of applying a
-- gated change directly, whenever the acting user isn't admin.
-- =========================================================
create or replace function public.create_approval_request(
  p_request_type text,
  p_description text,
  p_payload jsonb
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
  v_request_id uuid;
begin
  select role, branch_id into v_user_role, v_user_branch from public.users where id = v_user_id;

  if v_user_role is null then
    raise exception 'Usuario no autorizado';
  end if;

  if p_request_type not in ('price_change', 'product_delete', 'cash_adjustment') then
    raise exception 'Tipo de solicitud inválido';
  end if;

  if p_description is null or trim(p_description) = '' then
    raise exception 'Debe indicar una descripción';
  end if;

  insert into public.approval_requests (request_type, requested_by, branch_id, description, payload)
  values (p_request_type, v_user_id, v_user_branch, p_description, coalesce(p_payload, '{}'::jsonb))
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- =========================================================
-- approve_approval_request — admin only. Applies the gated change itself
-- (the request never did), then marks the request approved.
-- =========================================================
create or replace function public.approve_approval_request(
  p_request_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_request record;
  v_register record;
  v_signed_amount numeric;
begin
  select role into v_user_role from public.users where id = v_user_id;

  if v_user_role <> 'admin' then
    raise exception 'Solo un administrador puede aprobar solicitudes';
  end if;

  select * into v_request from public.approval_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Solicitud no encontrada';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Esta solicitud ya fue procesada';
  end if;

  if v_request.request_type = 'price_change' then
    update public.product_variants
    set price = (v_request.payload ->> 'new_price')::numeric
    where id = (v_request.payload ->> 'variant_id')::uuid;

  elsif v_request.request_type = 'product_delete' then
    if v_request.payload ->> 'target' = 'product' then
      update public.products
      set active = false, deleted_at = now(), deleted_by = v_user_id,
          delete_reason = coalesce(v_request.payload ->> 'reason', 'Aprobado por administrador')
      where id = (v_request.payload ->> 'target_id')::uuid;
    else
      update public.product_variants
      set active = false, deleted_at = now(), deleted_by = v_user_id,
          delete_reason = coalesce(v_request.payload ->> 'reason', 'Aprobado por administrador')
      where id = (v_request.payload ->> 'target_id')::uuid;
    end if;

  elsif v_request.request_type = 'cash_adjustment' then
    select * into v_register from public.cash_registers where id = (v_request.payload ->> 'cash_register_id')::uuid;

    if v_register.id is null or v_register.status <> 'open' then
      raise exception 'La caja ya no está abierta; no se puede aplicar el movimiento';
    end if;

    v_signed_amount := case
      when v_request.payload ->> 'movement_type' = 'manual_in' then (v_request.payload ->> 'amount')::numeric
      else -(v_request.payload ->> 'amount')::numeric
    end;

    insert into public.cash_movements (cash_register_id, branch_id, movement_type, category, amount, created_by, description)
    values (
      v_register.id, v_register.branch_id, v_request.payload ->> 'movement_type',
      v_request.payload ->> 'category', v_signed_amount, v_request.requested_by,
      v_request.payload ->> 'description'
    );
  end if;

  update public.approval_requests
  set status = 'approved', reviewed_by = v_user_id, reviewed_at = now(), review_note = p_note
  where id = p_request_id;
end;
$$;

-- =========================================================
-- reject_approval_request — admin only. No side effects: the gated
-- change was never applied in the first place.
-- =========================================================
create or replace function public.reject_approval_request(
  p_request_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_request record;
begin
  select role into v_user_role from public.users where id = v_user_id;

  if v_user_role <> 'admin' then
    raise exception 'Solo un administrador puede rechazar solicitudes';
  end if;

  select * into v_request from public.approval_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Solicitud no encontrada';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Esta solicitud ya fue procesada';
  end if;

  update public.approval_requests
  set status = 'rejected', reviewed_by = v_user_id, reviewed_at = now(), review_note = p_note
  where id = p_request_id;
end;
$$;

grant execute on function public.create_approval_request(text, text, jsonb) to authenticated;
grant execute on function public.approve_approval_request(uuid, text) to authenticated;
grant execute on function public.reject_approval_request(uuid, text) to authenticated;
