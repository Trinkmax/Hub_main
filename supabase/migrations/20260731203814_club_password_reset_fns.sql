-- (Split del club_auth original: se aplicó en 4 pasos por el timeout del MCP.)

-- ── 5) Pedido de recuperación ───────────────────────────────────────────
-- Devuelve el código EN CLARO para que la Server Action lo mande por WhatsApp.
-- Nunca vuelve al browser: la action responde siempre el mismo mensaje genérico.
create or replace function public.club_request_reset(
  p_link_slug text,
  p_phone text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_capture_links;
  v_customer public.customers;
  v_code text;
  v_bytes bytea;
  v_recent int;
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
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- "No contactar" también aplica acá: no se le manda nada.
  if coalesce(v_customer.is_blocked, false) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  -- Máximo 3 pedidos por hora por socio.
  select count(*) into v_recent from public.customer_password_resets
   where customer_id = v_customer.id and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Los códigos anteriores dejan de servir.
  update public.customer_password_resets
  set consumed_at = coalesce(consumed_at, now())
  where customer_id = v_customer.id and consumed_at is null;

  -- Código de 6 dígitos con entropía criptográfica (no random(), que es
  -- predecible). El sesgo del módulo es despreciable para un código de 10
  -- minutos con 5 intentos.
  v_bytes := extensions.gen_random_bytes(3);
  v_code := lpad((
    (get_byte(v_bytes, 0)::int * 65536 + get_byte(v_bytes, 1)::int * 256 + get_byte(v_bytes, 2)::int)
    % 1000000
  )::text, 6, '0');

  insert into public.customer_password_resets (
    tenant_id, customer_id, code_hash, expires_at, request_ip
  ) values (
    v_customer.tenant_id, v_customer.id,
    extensions.crypt(v_code, extensions.gen_salt('bf', 8)),
    now() + interval '10 minutes',
    p_ip
  );

  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'tenant_id', v_customer.tenant_id,
    'customer_id', v_customer.id,
    'phone', v_customer.phone,
    'first_name', v_customer.first_name
  );
end $$;


-- club_request_reset devuelve el código EN CLARO: NUNCA para anon. La llama la
-- Server Action con service_role y ella lo manda por WhatsApp.
revoke execute on function public.club_request_reset(text, text, text) from public, anon, authenticated;
