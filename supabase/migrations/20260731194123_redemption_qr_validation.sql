-- ============================================================
-- Canje iniciado por el cliente + QR de validación para el mozo
-- ============================================================
-- ITEM 11 — "que cuando quieran canjear un beneficio o un canje diga 'canjeá
--   este beneficio' y genere el QR listo para que pueda validar el mozo".
--
-- Hoy la card del catálogo es un <article> inerte que dice "Mostrá tu QR en la
-- caja": el único canje real lo inicia el STAFF desde el manager y nace ya
-- 'delivered'. Y los beneficios que sí nacen 'pending' (regalo de bienvenida,
-- beneficios de nivel del cron) no tienen NINGÚN camino de código que los pase
-- a entregado: quedan pendientes para siempre. Esta migración arregla las dos
-- cosas con una sola máquina de estados.
--
-- FLUJO: cliente toca "Canjear" en su billetera → se crea/marca un canje
-- `pending` con un token corto y vencimiento → la billetera muestra el QR
-- (/v/<token>) → el mozo lo escanea desde /salon/validar → se descuentan los
-- puntos y se marca entregado. Un solo QR activo por cliente a la vez.
--
-- DECISIÓN: los puntos se descuentan al VALIDAR, no al generar el QR. Así no
-- hace falta ningún cron de devolución y el cliente nunca "pierde" puntos por
-- un QR que no llegó a usar. El precio es que sólo puede haber un canje activo
-- a la vez (si no, con 100 pts podría generar tres QR de 100 pts).
-- ============================================================

-- ── 1) Columnas del canje ───────────────────────────────────────────────
alter table public.reward_redemptions
  add column if not exists redeem_token text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid references auth.users(id) on delete set null,
  add column if not exists source text not null default 'staff';

alter table public.reward_redemptions
  drop constraint if exists reward_redemptions_source_check;
alter table public.reward_redemptions
  add constraint reward_redemptions_source_check
  check (source in ('staff', 'customer', 'grant'));

comment on column public.reward_redemptions.source is
  'staff = lo canjeó el cajero desde el manager · customer = lo pidió el cliente desde su billetera · grant = regalo automático (bienvenida, nivel, punch card)';

-- Todo lo que ya existía y nació pendiente es un regalo automático.
update public.reward_redemptions
set source = 'grant'
where status = 'pending' and source = 'staff' and points_spent = 0;

-- Lo ya entregado por el flujo viejo: sellar delivered_at para que el historial
-- del cliente no muestre "sin fecha de entrega".
update public.reward_redemptions
set delivered_at = coalesce(delivered_at, redeemed_at)
where status = 'delivered' and delivered_at is null;

create unique index if not exists reward_redemptions_redeem_token_uidx
  on public.reward_redemptions (redeem_token)
  where redeem_token is not null;

create index if not exists reward_redemptions_pending_idx
  on public.reward_redemptions (tenant_id, customer_id, status)
  where status = 'pending';

-- ── 2) Cliente pide canjear una recompensa del catálogo ─────────────────
-- Capability-based: el único input externo es el qr_token del cliente (misma
-- doctrina que get_session_state / register_customer_for_session). No hay
-- auth.uid() acá: el cliente del club no es usuario de auth.users.
create or replace function public.request_reward_redemption(
  p_qr_token text,
  p_reward_id uuid,
  p_ttl_minutes int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_reward public.rewards;
  v_tier_min int;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  select * into v_customer from public.customers
   where qr_token = p_qr_token and deleted_at is null
   for update;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  select * into v_reward from public.rewards
   where id = p_reward_id and tenant_id = v_customer.tenant_id and active = true;
  if v_reward.id is null then
    raise exception 'reward_not_found' using errcode = 'P0001';
  end if;

  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'reward_out_of_stock' using errcode = 'P0001';
  end if;

  if coalesce(v_customer.points_balance, 0) < v_reward.cost_points then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  -- Nivel mínimo: se mide contra los puntos de categoría (ventana móvil), igual
  -- que redeem_reward.
  if v_reward.min_tier_id is not null then
    select min_category_points into v_tier_min
      from public.loyalty_tiers where id = v_reward.min_tier_id;
    if coalesce(v_customer.category_points, 0) < coalesce(v_tier_min, 0) then
      raise exception 'tier_locked' using errcode = 'P0001';
    end if;
  end if;

  -- Un solo QR activo por cliente.
  if exists (
    select 1 from public.reward_redemptions
    where customer_id = v_customer.id
      and status = 'pending'
      and redeem_token is not null
      and token_expires_at > now()
  ) then
    raise exception 'redemption_already_pending' using errcode = 'P0001';
  end if;

  v_token := public.generate_qr_token();
  v_expires := now() + make_interval(mins => greatest(5, least(coalesce(p_ttl_minutes, 30), 240)));

  insert into public.reward_redemptions (
    tenant_id, customer_id, reward_id, points_spent, redeemed_by, status,
    source, redeem_token, token_expires_at, notes
  ) values (
    v_customer.tenant_id, v_customer.id, v_reward.id, v_reward.cost_points, null, 'pending',
    'customer', v_token, v_expires, 'Pedido desde la billetera del socio'
  ) returning id into v_id;

  return jsonb_build_object(
    'redemption_id', v_id,
    'redeem_token', v_token,
    'expires_at', v_expires,
    'reward_name', v_reward.name,
    'cost_points', v_reward.cost_points
  );
end $$;

-- ── 3) Cliente activa el QR de un beneficio que YA tenía pendiente ───────
-- Regalo de bienvenida, beneficio de nivel del cron, premio de punch card:
-- nacen 'pending' sin token. Acá el cliente les pone token para mostrarlos.
create or replace function public.claim_pending_redemption(
  p_qr_token text,
  p_redemption_id uuid,
  p_ttl_minutes int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_row public.reward_redemptions;
  v_token text;
  v_expires timestamptz;
  v_reward_name text;
begin
  select * into v_customer from public.customers
   where qr_token = p_qr_token and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  select * into v_row from public.reward_redemptions
   where id = p_redemption_id
     and customer_id = v_customer.id
     and tenant_id = v_customer.tenant_id
     and status = 'pending'
   for update;
  if v_row.id is null then
    raise exception 'redemption_not_found' using errcode = 'P0001';
  end if;

  -- Si ya tiene un token vigente, se devuelve el mismo (idempotente: volver a
  -- tocar el botón no rota el QR que el mozo está por escanear).
  if v_row.redeem_token is not null and v_row.token_expires_at > now() then
    select name into v_reward_name from public.rewards where id = v_row.reward_id;
    return jsonb_build_object(
      'redemption_id', v_row.id,
      'redeem_token', v_row.redeem_token,
      'expires_at', v_row.token_expires_at,
      'reward_name', v_reward_name,
      'cost_points', v_row.points_spent
    );
  end if;

  if exists (
    select 1 from public.reward_redemptions
    where customer_id = v_customer.id
      and id <> v_row.id
      and status = 'pending'
      and redeem_token is not null
      and token_expires_at > now()
  ) then
    raise exception 'redemption_already_pending' using errcode = 'P0001';
  end if;

  v_token := public.generate_qr_token();
  v_expires := now() + make_interval(mins => greatest(5, least(coalesce(p_ttl_minutes, 30), 240)));

  update public.reward_redemptions
  set redeem_token = v_token, token_expires_at = v_expires
  where id = v_row.id;

  select name into v_reward_name from public.rewards where id = v_row.reward_id;

  return jsonb_build_object(
    'redemption_id', v_row.id,
    'redeem_token', v_token,
    'expires_at', v_expires,
    'reward_name', v_reward_name,
    'cost_points', v_row.points_spent
  );
end $$;

-- ── 4) Cliente cancela su canje pendiente ───────────────────────────────
-- Sólo los que pidió él (source='customer'). Un regalo automático no se
-- cancela: se le apaga el token y vuelve a la lista de "para retirar".
create or replace function public.cancel_reward_redemption(p_qr_token text, p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_row public.reward_redemptions;
begin
  select * into v_customer from public.customers
   where qr_token = p_qr_token and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  select * into v_row from public.reward_redemptions
   where id = p_redemption_id and customer_id = v_customer.id and status = 'pending'
   for update;
  if v_row.id is null then
    raise exception 'redemption_not_found' using errcode = 'P0001';
  end if;

  if v_row.source = 'customer' then
    update public.reward_redemptions
    set status = 'cancelled', redeem_token = null, token_expires_at = null
    where id = v_row.id;
  else
    update public.reward_redemptions
    set redeem_token = null, token_expires_at = null
    where id = v_row.id;
  end if;
end $$;

-- ── 5) Lectura del canje por el staff (pantalla de confirmación) ─────────
create or replace function public.get_redemption_by_token(p_redeem_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.reward_redemptions;
  v_role public.tenant_role;
  v_customer public.customers;
  v_reward public.rewards;
  v_delivered_by text;
begin
  select * into v_row from public.reward_redemptions where redeem_token = p_redeem_token;
  if v_row.id is null then
    raise exception 'redemption_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_row.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers where id = v_row.customer_id;
  select * into v_reward from public.rewards where id = v_row.reward_id;

  if v_row.delivered_by is not null then
    select coalesce(raw_user_meta_data ->> 'full_name', email)
      into v_delivered_by from auth.users where id = v_row.delivered_by;
  end if;

  return jsonb_build_object(
    'redemption_id', v_row.id,
    'status', v_row.status,
    'source', v_row.source,
    'points_spent', v_row.points_spent,
    'expired', (v_row.token_expires_at is not null and v_row.token_expires_at <= now()),
    'delivered_at', v_row.delivered_at,
    'delivered_by_name', v_delivered_by,
    'customer_name', trim(coalesce(v_customer.first_name, '') || ' ' || coalesce(v_customer.last_name, '')),
    'customer_points_balance', v_customer.points_balance,
    'reward_name', v_reward.name,
    'reward_image_url', v_reward.image_url,
    'notes', v_row.notes
  );
end $$;

-- ── 6) El mozo entrega: descuenta puntos y sella ────────────────────────
create or replace function public.deliver_reward_redemption(p_redeem_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.reward_redemptions;
  v_role public.tenant_role;
  v_customer public.customers;
  v_reward public.rewards;
begin
  select * into v_row from public.reward_redemptions
   where redeem_token = p_redeem_token
   for update;
  if v_row.id is null then
    raise exception 'redemption_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_row.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_row.status = 'delivered' then
    raise exception 'redemption_already_delivered' using errcode = 'P0001';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'redemption_cancelled' using errcode = 'P0001';
  end if;
  if v_row.token_expires_at is not null and v_row.token_expires_at <= now() then
    raise exception 'redemption_expired' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers where id = v_row.customer_id for update;

  -- Los puntos se descuentan recién acá. Se revalida el saldo por si el cliente
  -- gastó entre que generó el QR y que el mozo lo escaneó.
  if v_row.points_spent > 0 then
    if coalesce(v_customer.points_balance, 0) < v_row.points_spent then
      raise exception 'insufficient_points' using errcode = 'P0001';
    end if;
    insert into public.points_transactions (tenant_id, customer_id, delta, reason, payload)
    values (
      v_row.tenant_id, v_row.customer_id, -v_row.points_spent, 'reward_redeem',
      jsonb_build_object('redemption_id', v_row.id, 'reward_id', v_row.reward_id, 'source', v_row.source)
    );
  end if;

  -- Stock: se revalida y descuenta al entregar (no se reserva al generar el QR,
  -- para no necesitar un proceso de devolución de reservas vencidas).
  if v_row.reward_id is not null then
    select * into v_reward from public.rewards where id = v_row.reward_id for update;
    if v_reward.id is not null and v_reward.stock is not null then
      if v_reward.stock <= 0 then
        raise exception 'reward_out_of_stock' using errcode = 'P0001';
      end if;
      update public.rewards set stock = stock - 1 where id = v_reward.id;
    end if;
  end if;

  update public.reward_redemptions
  set status = 'delivered',
      delivered_at = now(),
      delivered_by = (select auth.uid()),
      redeemed_by = coalesce(redeemed_by, (select auth.uid())),
      redeemed_at = coalesce(redeemed_at, now()),
      redeem_token = null,
      token_expires_at = null
  where id = v_row.id;

  return jsonb_build_object(
    'redemption_id', v_row.id,
    'customer_name', trim(coalesce(v_customer.first_name, '') || ' ' || coalesce(v_customer.last_name, '')),
    'reward_name', (select name from public.rewards where id = v_row.reward_id),
    'points_spent', v_row.points_spent
  );
end $$;

-- ── 7) Permisos ─────────────────────────────────────────────────────────
-- Las tres primeras son del cliente anónimo (capability = qr_token).
revoke execute on function public.request_reward_redemption(text, uuid, int) from public;
revoke execute on function public.claim_pending_redemption(text, uuid, int) from public;
revoke execute on function public.cancel_reward_redemption(text, uuid) from public;
grant execute on function public.request_reward_redemption(text, uuid, int) to anon, authenticated;
grant execute on function public.claim_pending_redemption(text, uuid, int) to anon, authenticated;
grant execute on function public.cancel_reward_redemption(text, uuid) to anon, authenticated;

-- Las dos del staff exigen membresía; nunca anon.
revoke execute on function public.get_redemption_by_token(text) from public, anon;
revoke execute on function public.deliver_reward_redemption(text) from public, anon;
grant execute on function public.get_redemption_by_token(text) to authenticated;
grant execute on function public.deliver_reward_redemption(text) to authenticated;
