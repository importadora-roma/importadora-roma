-- Extends the approval-request system (0068) to also gate two more
-- supervisor-initiated actions on an already-completed sale: exchanging a
-- sold item for a different product/variant ("cambio", which also changes
-- the recorded price), and returning a sold item ("devolución"). Cancelling
-- a whole sale and correcting a sale_item's cost were deliberately left
-- ungated — per the business owner, sale cancellation is too frequent an
-- operational fix to slow down with approval, and cost is an internal
-- bookkeeping field the customer never sees.
--
-- On approval, the request is applied by calling the *existing*
-- exchange_sale_item/return_sale_item RPCs from inside approve_approval_
-- request: both are security definer and re-check the caller's role
-- themselves, and since the caller at that point is the approving admin,
-- their own admin-bypass branch checks apply cleanly — no need to
-- duplicate their stock/cash logic here.

alter table public.approval_requests drop constraint approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check
  check (request_type in ('price_change', 'product_delete', 'cash_adjustment', 'sale_item_exchange', 'sale_item_return'));

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

  if p_request_type not in ('price_change', 'product_delete', 'cash_adjustment', 'sale_item_exchange', 'sale_item_return') then
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

  elsif v_request.request_type = 'sale_item_exchange' then
    perform public.exchange_sale_item(
      (v_request.payload ->> 'sale_item_id')::uuid,
      (v_request.payload ->> 'new_variant_id')::uuid,
      (v_request.payload ->> 'new_quantity')::integer,
      coalesce(v_request.payload ->> 'reason', 'Aprobado por administrador'),
      v_request.payload -> 'additional_payments'
    );

  elsif v_request.request_type = 'sale_item_return' then
    perform public.return_sale_item(
      (v_request.payload ->> 'sale_item_id')::uuid,
      (v_request.payload ->> 'quantity')::integer,
      coalesce(v_request.payload ->> 'reason', 'Aprobado por administrador'),
      coalesce(v_request.payload ->> 'refund_method', 'efectivo')
    );
  end if;

  update public.approval_requests
  set status = 'approved', reviewed_by = v_user_id, reviewed_at = now(), review_note = p_note
  where id = p_request_id;
end;
$$;
