-- ============================================================
-- FIX de seguridad: el alta seguía entregando la cuenta de socios sin contraseña
-- ============================================================
-- Corrige 20260731203341_club_auth_tables_and_signup.
--
-- (1) `submit_capture` sólo cortaba cuando el socio existente YA tenía
--     contraseña. La rama "existe pero todavía no tiene credenciales" seguía
--     devolviendo su `qr_token` — y encima le fijaba la contraseña que hubiera
--     escrito quien completó el formulario. O sea: el agujero que los items 1 y
--     2 vinieron a cerrar seguía abierto para TODOS los socios actuales de HUB
--     (los 11 están sin credenciales). Sabiendo un teléfono, cualquiera se
--     quedaba con la billetera y con la cuenta.
--
--     Ahora el alta NUNCA entrega el token de un socio preexistente ni le fija
--     contraseña. Devuelve `needs_login` + `has_password` y la carta lo enruta:
--       · has_password = true  → "poné tu contraseña"
--       · has_password = false → código por WhatsApp, que es el único camino que
--         prueba que el teléfono es suyo.
--
-- (2) GRANTs de las tablas de credenciales. Los default privileges de Supabase
--     le dan SELECT/INSERT a `anon` y todo a `authenticated` sobre cualquier
--     tabla nueva de `public`, así que las dos tablas quedaron con esos permisos
--     a pesar del comentario que afirmaba lo contrario. Con RLS activa y cero
--     policies no se lee ninguna fila, pero una tabla de contraseñas no puede
--     depender sólo de eso: se revoca explícito.
-- ============================================================
revoke all on public.customer_credentials from anon, authenticated;
revoke all on public.customer_password_resets from anon, authenticated;

create or replace function public.submit_capture(
  p_link_slug text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_opt_in boolean,
  p_ip text,
  p_user_agent text,
  p_email text default null,
  p_birthdate date default null,
  p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.customer_capture_links;
  v_existing public.customers;
  v_customer_id uuid;
  v_qr_token text;
  v_phone text := trim(coalesce(p_phone, ''));
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_email text := nullif(trim(lower(coalesce(p_email, ''))), '');
  v_password text := nullif(p_password, '');
  v_cfg public.welcome_reward_configs;
  v_reward public.rewards;
  v_welcome_redemption_id uuid;
  v_welcome_reward_name text;
  v_welcome_reward_image_url text;
  v_welcome_bonus_points int := 0;
begin
  if length(v_phone) < 8 or length(v_phone) > 20 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(v_first) = 0 or length(v_last) = 0 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if v_password is not null and length(v_password) < 6 then
    raise exception 'weak_password' using errcode = 'P0001';
  end if;

  select * into v_link from public.customer_capture_links
    where slug = p_link_slug and active = true;
  if v_link.id is null then
    raise exception 'invalid_or_inactive_link' using errcode = 'P0001';
  end if;

  select * into v_existing from public.customers
    where tenant_id = v_link.tenant_id
      and phone = v_phone
      and deleted_at is null
    for update;

  -- El teléfono YA es socio (con o sin contraseña): el alta no entrega nada.
  if v_existing.id is not null then
    return jsonb_build_object(
      'needs_login', true,
      'has_password', exists (
        select 1 from public.customer_credentials cc where cc.customer_id = v_existing.id
      ),
      'tenant_id', v_link.tenant_id,
      'customer_id', null,
      'qr_token', null,
      'was_new', false
    );
  end if;

  insert into public.customers (
    tenant_id, phone, first_name, last_name, email, birthdate, source,
    opt_in_marketing, opt_in_at, opt_in_ip
  ) values (
    v_link.tenant_id, v_phone, v_first, v_last, v_email, p_birthdate, 'qr',
    p_opt_in,
    case when p_opt_in then now() else null end,
    case when p_opt_in then p_ip else null end
  ) returning id, qr_token into v_customer_id, v_qr_token;

  if v_password is not null then
    insert into public.customer_credentials (customer_id, tenant_id, password_hash)
    values (v_customer_id, v_link.tenant_id, extensions.crypt(v_password, extensions.gen_salt('bf', 10)))
    on conflict (customer_id) do nothing;
  end if;

  select * into v_cfg from public.welcome_reward_configs where tenant_id = v_link.tenant_id;

  if v_cfg.enabled and v_cfg.reward_id is not null then
    select * into v_reward from public.rewards
      where id = v_cfg.reward_id and tenant_id = v_link.tenant_id and active = true
      for update;
    if v_reward.id is not null and (v_reward.stock is null or v_reward.stock > 0) then
      insert into public.reward_redemptions (
        tenant_id, customer_id, reward_id, points_spent, redeemed_by, status, source, notes
      ) values (
        v_link.tenant_id, v_customer_id, v_reward.id, 0, null, 'pending', 'grant',
        'Regalo de bienvenida automático'
      ) returning id into v_welcome_redemption_id;
      if v_reward.stock is not null then
        update public.rewards set stock = stock - 1 where id = v_reward.id;
      end if;
      insert into public.welcome_reward_grants (
        tenant_id, customer_id, reward_id, redemption_id
      ) values (v_link.tenant_id, v_customer_id, v_reward.id, v_welcome_redemption_id)
      on conflict (customer_id) do nothing;
      v_welcome_reward_name := v_reward.name;
      v_welcome_reward_image_url := v_reward.image_url;
    end if;
  end if;

  if v_cfg.enabled and coalesce(v_cfg.bonus_points, 0) > 0 then
    if not exists (
      select 1 from public.points_transactions
      where customer_id = v_customer_id and reason = 'welcome_bonus'
    ) then
      insert into public.points_transactions (tenant_id, customer_id, delta, reason, payload)
      values (
        v_link.tenant_id, v_customer_id, v_cfg.bonus_points, 'welcome_bonus',
        jsonb_build_object('source', 'welcome_bonus')
      );
      v_welcome_bonus_points := v_cfg.bonus_points;
    end if;
  end if;

  insert into public.customer_capture_submissions (
    tenant_id, link_id, customer_id, phone, first_name, last_name,
    opt_in_marketing, ip, user_agent
  ) values (
    v_link.tenant_id, v_link.id, v_customer_id,
    v_phone, v_first, v_last,
    p_opt_in, p_ip, p_user_agent
  );

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'tenant_id', v_link.tenant_id,
    'qr_token', v_qr_token,
    'was_new', true,
    'needs_login', false,
    'has_password', v_password is not null,
    'welcome_reward_name', v_welcome_reward_name,
    'welcome_reward_image_url', v_welcome_reward_image_url,
    'welcome_bonus_points', v_welcome_bonus_points
  );
end $$;

revoke execute on function public.submit_capture(text, text, text, text, boolean, text, text, text, date, text) from public;
grant execute on function public.submit_capture(text, text, text, text, boolean, text, text, text, date, text) to anon, authenticated;
