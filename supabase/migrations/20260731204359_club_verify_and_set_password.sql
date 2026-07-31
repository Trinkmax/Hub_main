-- (Split del club_auth original: se aplicó en 4 pasos por el timeout del MCP.)

-- ── 6) Verificación del código → ticket de un solo uso ──────────────────
create or replace function public.club_verify_reset_code(
  p_link_slug text,
  p_phone text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_capture_links;
  v_customer public.customers;
  v_row public.customer_password_resets;
  v_ticket text;
begin
  select * into v_link from public.customer_capture_links
    where slug = p_link_slug and active = true;
  if v_link.id is null then
    raise exception 'invalid_or_inactive_link' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers
    where tenant_id = v_link.tenant_id
      and phone = trim(coalesce(p_phone, ''))
      and deleted_at is null;
  if v_customer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  select * into v_row from public.customer_password_resets
   where customer_id = v_customer.id and consumed_at is null
   order by created_at desc limit 1
   for update;

  if v_row.id is null or v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_row.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if extensions.crypt(coalesce(p_code, ''), v_row.code_hash) <> v_row.code_hash then
    update public.customer_password_resets set attempts = attempts + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  v_ticket := public.generate_qr_token();
  update public.customer_password_resets
  set reset_ticket = v_ticket, ticket_expires_at = now() + interval '10 minutes'
  where id = v_row.id;

  return jsonb_build_object('ok', true, 'reset_ticket', v_ticket);
end $$;

-- ── 7) Nueva contraseña con el ticket ───────────────────────────────────
create or replace function public.club_set_password_with_ticket(
  p_reset_ticket text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.customer_password_resets;
  v_customer public.customers;
begin
  if p_password is null or length(p_password) < 6 then
    raise exception 'weak_password' using errcode = 'P0001';
  end if;

  select * into v_row from public.customer_password_resets
   where reset_ticket = p_reset_ticket and consumed_at is null
   for update;
  if v_row.id is null or v_row.ticket_expires_at is null or v_row.ticket_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_customer from public.customers where id = v_row.customer_id and deleted_at is null;
  if v_customer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  insert into public.customer_credentials (customer_id, tenant_id, password_hash)
  values (v_customer.id, v_customer.tenant_id, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  on conflict (customer_id) do update
    set password_hash = excluded.password_hash,
        password_set_at = now(),
        failed_attempts = 0,
        locked_until = null;

  update public.customer_password_resets
  set consumed_at = now(), reset_ticket = null
  where customer_id = v_customer.id and consumed_at is null;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_customer.tenant_id,
    'customer_id', v_customer.id,
    'qr_token', v_customer.qr_token,
    'first_name', v_customer.first_name
  );
end $$;


revoke execute on function public.club_verify_reset_code(text, text, text) from public;
grant execute on function public.club_verify_reset_code(text, text, text) to anon, authenticated;
revoke execute on function public.club_set_password_with_ticket(text, text) from public;
grant execute on function public.club_set_password_with_ticket(text, text) to anon, authenticated;
