-- (Split del club_auth original: se aplicó en 4 pasos por el timeout del MCP.)

-- ── 4) Login ────────────────────────────────────────────────────────────
create or replace function public.club_login(
  p_link_slug text,
  p_phone text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_capture_links;
  v_customer public.customers;
  v_cred public.customer_credentials;
  v_phone text := trim(coalesce(p_phone, ''));
begin
  select * into v_link from public.customer_capture_links
    where slug = p_link_slug and active = true;
  if v_link.id is null then
    raise exception 'invalid_or_inactive_link' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers
    where tenant_id = v_link.tenant_id and phone = v_phone and deleted_at is null;

  -- Respuesta uniforme: no se distingue "no existe" de "contraseña incorrecta"
  -- (evita enumerar socios por el teléfono).
  if v_customer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  select * into v_cred from public.customer_credentials
   where customer_id = v_customer.id for update;

  if v_cred.customer_id is null then
    -- Socio viejo sin contraseña: no se le da el token, se lo manda a crearla
    -- por el flujo de recuperación (así se prueba que tiene el teléfono).
    return jsonb_build_object('ok', false, 'reason', 'no_password');
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if extensions.crypt(coalesce(p_password, ''), v_cred.password_hash) <> v_cred.password_hash then
    update public.customer_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
    where customer_id = v_customer.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  update public.customer_credentials
  set failed_attempts = 0, locked_until = null
  where customer_id = v_customer.id;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_customer.tenant_id,
    'customer_id', v_customer.id,
    'qr_token', v_customer.qr_token,
    'first_name', v_customer.first_name
  );
end $$;

-- ── 8) ¿Este socio ya tiene contraseña? (para ramificar la UI) ──────────
create or replace function public.club_has_password(p_link_slug text, p_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_capture_links;
begin
  select * into v_link from public.customer_capture_links
    where slug = p_link_slug and active = true;
  if v_link.id is null then
    return false;
  end if;
  return exists (
    select 1
      from public.customers c
      join public.customer_credentials cc on cc.customer_id = c.id
     where c.tenant_id = v_link.tenant_id
       and c.phone = trim(coalesce(p_phone, ''))
       and c.deleted_at is null
  );
end $$;


revoke execute on function public.club_login(text, text, text) from public;
grant execute on function public.club_login(text, text, text) to anon, authenticated;
revoke execute on function public.club_has_password(text, text) from public;
grant execute on function public.club_has_password(text, text) to anon, authenticated;
