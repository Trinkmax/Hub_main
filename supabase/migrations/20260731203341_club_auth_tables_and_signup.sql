-- ============================================================
-- Cuenta del socio: contraseña, login y recuperación por WhatsApp
-- ============================================================
-- ITEM 1 — "que en la carta, cuando ponen la billetera, puedan tener dos
--   opciones: unirse al club o loguearse quienes ya tienen usuario".
-- ITEM 2 — "que los usuarios puedan poner su contraseña y que si la olvidan
--   les mande un WhatsApp con un código para recuperarla".
--
-- AGUJERO QUE ESTO CIERRA (no es cosmético): hoy `submit_capture` hace UPSERT
-- por (tenant_id, phone) y DEVUELVE el qr_token del cliente exista o no. O sea:
-- cualquiera que sepa el teléfono de un socio tipea nombre/email/fecha
-- inventados en el form de alta y se lleva la cookie con el qr_token ajeno —
-- que es exactamente la credencial que el staff escanea para acreditar y
-- canjear puntos. El alta venía funcionando como un login sin autenticación.
--
-- DECISIÓN DEL DUEÑO: la contraseña es OBLIGATORIA en el alta ("en el alta
-- tenés que crearte la cuenta"), la sesión queda guardada (cookie de 180 días,
-- como hoy) y hay botón de cerrar sesión.
--
-- El hash vive en tabla LATERAL, no en `customers`: el rol `anon` tiene SELECT
-- sobre customers y no queremos ni la posibilidad de exponerlo.
-- ============================================================

-- ── 1) Credenciales ─────────────────────────────────────────────────────
create table if not exists public.customer_credentials (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  password_hash text not null,
  password_set_at timestamptz not null default now(),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_credentials_tenant_idx
  on public.customer_credentials (tenant_id);

drop trigger if exists customer_credentials_updated_at on public.customer_credentials;
create trigger customer_credentials_updated_at before update on public.customer_credentials
  for each row execute function public.set_updated_at();

alter table public.customer_credentials enable row level security;
-- SIN policies y SIN grants a propósito: la tabla se toca únicamente desde las
-- funciones SECURITY DEFINER de abajo. Es la excepción justificada a la regla
-- de GRANT de CLAUDE.md §5 — acá el objetivo es que NO sea visible por Data API.

-- ── 2) Códigos de recuperación ──────────────────────────────────────────
create table if not exists public.customer_password_resets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  code_hash text not null,
  reset_ticket text,
  ticket_expires_at timestamptz,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  request_ip text,
  created_at timestamptz not null default now()
);
create index if not exists customer_password_resets_customer_idx
  on public.customer_password_resets (customer_id, created_at desc);
create unique index if not exists customer_password_resets_ticket_uidx
  on public.customer_password_resets (reset_ticket)
  where reset_ticket is not null;

alter table public.customer_password_resets enable row level security;
-- Idem: sin policies ni grants. Sólo SECURITY DEFINER / service_role.

-- ── 3) Alta con contraseña ──────────────────────────────────────────────
-- Reemplaza a submit_capture agregando p_password. Si el teléfono ya es socio
-- Y tiene contraseña, NO devuelve el qr_token: devuelve needs_login para que la
-- carta lo mande a la pantalla de entrar. Sin eso, el login sería decorativo.
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
  v_was_new boolean := false;
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

  -- Ya es socio y tiene contraseña → que entre por el login.
  if v_existing.id is not null
     and exists (select 1 from public.customer_credentials cc where cc.customer_id = v_existing.id)
  then
    return jsonb_build_object(
      'needs_login', true,
      'tenant_id', v_link.tenant_id,
      'customer_id', null,
      'qr_token', null,
      'was_new', false
    );
  end if;

  if v_existing.id is null then
    insert into public.customers (
      tenant_id, phone, first_name, last_name, email, birthdate, source,
      opt_in_marketing, opt_in_at, opt_in_ip
    ) values (
      v_link.tenant_id, v_phone, v_first, v_last, v_email, p_birthdate, 'qr',
      p_opt_in,
      case when p_opt_in then now() else null end,
      case when p_opt_in then p_ip else null end
    ) returning id, qr_token into v_customer_id, v_qr_token;
    v_was_new := true;
  else
    update public.customers set
      first_name = case when coalesce(first_name, '') = '' then v_first else first_name end,
      last_name = case when coalesce(last_name, '') = '' then v_last else last_name end,
      email = coalesce(email, v_email),
      birthdate = coalesce(birthdate, p_birthdate),
      opt_in_marketing = opt_in_marketing or p_opt_in,
      opt_in_at = case when not opt_in_marketing and p_opt_in then now() else opt_in_at end,
      opt_in_ip = case when not opt_in_marketing and p_opt_in then p_ip else opt_in_ip end
    where id = v_existing.id
    returning id, qr_token into v_customer_id, v_qr_token;
  end if;

  if v_password is not null then
    insert into public.customer_credentials (customer_id, tenant_id, password_hash)
    values (v_customer_id, v_link.tenant_id, extensions.crypt(v_password, extensions.gen_salt('bf', 10)))
    on conflict (customer_id) do nothing;
  end if;

  if v_was_new then
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
    'was_new', v_was_new,
    'needs_login', false,
    'welcome_reward_name', v_welcome_reward_name,
    'welcome_reward_image_url', v_welcome_reward_image_url,
    'welcome_bonus_points', v_welcome_bonus_points
  );
end $$;

-- ── Permisos de submit_capture ──────────────────────────────────────────
revoke execute on function public.submit_capture(text, text, text, text, boolean, text, text, text, date, text) from public;
grant execute on function public.submit_capture(text, text, text, text, boolean, text, text, text, date, text) to anon, authenticated;

comment on table public.customer_credentials is
  'ITEM 1/2: contraseña del socio del club. Tabla lateral (no columna en customers) porque anon tiene SELECT sobre customers.';
