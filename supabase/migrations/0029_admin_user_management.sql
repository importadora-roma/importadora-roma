-- Creating a login or resetting a password has always required going into
-- the Supabase project dashboard directly (UsersPage.tsx said so on
-- screen) — a dependency on credentials the company won't have once the
-- developer who set this up is gone, and with no in-app way to rotate a
-- branch's password if it needs to change. These two RPCs move both
-- actions into the app, admin-only, mirroring the exact
-- crypt()/gen_salt('bf') + empty-string-token shape the on_auth_user_created
-- trigger already expects (0002_functions_triggers.sql).

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text,
  p_branch_id uuid,
  p_commission_pct numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'No tiene permisos para crear usuarios';
  end if;

  if p_role not in ('admin', 'supervisor', 'vendedor') then
    raise exception 'Rol inválido: %', p_role;
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;

  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'Ya existe un usuario con ese correo';
  end if;

  v_new_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', p_email,
    crypt(p_password, gen_salt('bf')),
    now(), '', '', '', '', '', '', '',
    now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_full_name)
  );

  -- on_auth_user_created fires here and inserts the matching public.users
  -- row with role defaulted to 'vendedor' — overwrite it with what was asked.
  update public.users
  set role = p_role, branch_id = p_branch_id, full_name = p_full_name, commission_pct = p_commission_pct
  where id = v_new_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'user.create', 'users', v_new_id, jsonb_build_object('email', p_email, 'role', p_role, 'branch_id', p_branch_id));

  return v_new_id;
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text, uuid, numeric) to authenticated;

create or replace function public.admin_set_user_password(
  p_user_id uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No tiene permisos para cambiar contraseñas';
  end if;

  if p_new_password is null or length(p_new_password) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')), updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  -- Never log the password itself, only that a reset happened and by whom.
  insert into public.audit_logs (user_id, action, table_name, record_id)
  values (auth.uid(), 'user.password_reset', 'users', p_user_id);
end;
$$;

grant execute on function public.admin_set_user_password(uuid, text) to authenticated;
