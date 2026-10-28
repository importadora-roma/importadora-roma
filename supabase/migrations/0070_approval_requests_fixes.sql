-- Two fixes found in a review of 0068/0069 (the approval-request system):
--
-- 1. create_approval_request only checked that the caller was a known user,
--    not that they held the admin/supervisor role the feature is meant to
--    gate — a 'vendedor' account could otherwise submit an arbitrary
--    request directly via the RPC, bypassing the UI entirely, for an admin
--    to unknowingly approve.
--
-- 2. approve_approval_request applied a price_change/product_delete update
--    without checking the target row was actually matched, then always
--    marked the request 'approved' regardless — so approving a request
--    whose target variant/product had meanwhile been deleted or merged
--    away (e.g. by the barcode auto-dedup flow) silently did nothing while
--    still reporting success.

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

  if v_user_role not in ('admin', 'supervisor') then
    raise exception 'No tiene permisos para crear solicitudes de aprobación';
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
  v_row_count integer;
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
    get diagnostics v_row_count = row_count;
    if v_row_count = 0 then
      raise exception 'La variante de esta solicitud ya no existe (fue eliminada o fusionada)';
    end if;

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
    get diagnostics v_row_count = row_count;
    if v_row_count = 0 then
      raise exception 'El producto/variante de esta solicitud ya no existe';
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
