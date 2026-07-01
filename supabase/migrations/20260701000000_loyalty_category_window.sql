-- ============================================================
-- Sistema de Puntos HUB — "Puntos de Categoría" (ventana móvil configurable)
-- ============================================================
-- Cambia el DRIVER del nivel: de `lifetime_points_earned` (nunca baja) a
-- `category_points` = suma móvil de los últimos N meses de puntos GANADOS
-- (default 4). El nivel PUEDE BAJAR cuando puntos viejos vencen.
--
-- Dos monedas separadas (spec del dueño):
--   • points_balance   → Puntos Canjeables (sube al ganar, baja al canjear).
--   • category_points  → Puntos de Categoría (define el nivel; ventana móvil).
--
-- lifetime_points_earned se CONSERVA (segmentación de audiencias / stats).
--
-- Paridad TS: lib/points/tiers.ts (resolveTier) + lib/points/category.ts
-- (computeCategoryPoints / computeExpiry). Baja inmediata: el trigger recomputa
-- al ganar; el cron diario (refresh_all_category_points) hace vencer lo viejo.
--
-- LEY multi-tenant: sin tablas nuevas acá; RLS de loyalty_tiers ya existe.
-- Regenerar types/database.ts tras esta migración.
-- ============================================================

-- ── 1) tenants: ventana configurable por bar ────────────────────────────
alter table public.tenants
  add column if not exists category_window_months int not null default 4
    check (category_window_months between 1 and 24);

-- ── 2) customers: cache de la suma móvil (driver del nivel) ──────────────
alter table public.customers
  add column if not exists category_points int not null default 0;
create index if not exists customers_category_points_idx
  on public.customers(tenant_id, category_points);

-- ── 3) loyalty_tiers: umbral por categoría (rename semántico) ────────────
-- El índice y el unique (tenant_id, <col>) siguen a la columna por attnum;
-- sus nombres quedan igual (cosmético).
alter table public.loyalty_tiers
  rename column min_lifetime_points to min_category_points;

-- ── 4) recompute_customer_loyalty: category_points + nivel (espejo TS) ───
-- Suma móvil de deltas POSITIVOS dentro de la ventana del tenant, y elige el
-- nivel de mayor umbral <= category_points. Reemplaza a set_customer_tier.
create or replace function public.recompute_customer_loyalty(p_customer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_window int;
  v_category int;
  v_tier_id uuid;
begin
  select c.tenant_id, coalesce(t.category_window_months, 4)
    into v_tenant, v_window
    from public.customers c
    join public.tenants t on t.id = c.tenant_id
    where c.id = p_customer_id;
  if v_tenant is null then return; end if;

  select coalesce(sum(greatest(delta, 0)), 0)::int
    into v_category
    from public.points_transactions
    where customer_id = p_customer_id
      and created_at >= now() - make_interval(months => v_window);

  select id into v_tier_id
    from public.loyalty_tiers
    where tenant_id = v_tenant and active = true
      and min_category_points <= v_category
    order by min_category_points desc, sort desc
    limit 1;

  update public.customers
    set category_points = v_category,
        current_tier_id = v_tier_id
    where id = p_customer_id
      and (category_points is distinct from v_category
           or current_tier_id is distinct from v_tier_id);
end; $$;
revoke execute on function public.recompute_customer_loyalty(uuid) from anon, authenticated;

-- ── 5) points_tx_apply: balance + lifetime, y recomputa categoría/nivel ──
create or replace function public.points_tx_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_lifetime_delta int := 0;
begin
  if tg_op = 'INSERT' then
    v_lifetime_delta := greatest(new.delta, 0);
    update public.customers
      set points_balance = points_balance + new.delta,
          lifetime_points_earned = lifetime_points_earned + v_lifetime_delta
      where id = new.customer_id;
    perform public.recompute_customer_loyalty(new.customer_id);
    return new;

  elsif tg_op = 'DELETE' then
    v_lifetime_delta := greatest(old.delta, 0);
    update public.customers
      set points_balance = points_balance - old.delta,
          lifetime_points_earned = greatest(0, lifetime_points_earned - v_lifetime_delta)
      where id = old.customer_id;
    perform public.recompute_customer_loyalty(old.customer_id);
    return old;

  elsif tg_op = 'UPDATE' then
    update public.customers
      set points_balance = points_balance - old.delta + new.delta,
          lifetime_points_earned = greatest(
            0,
            lifetime_points_earned - greatest(old.delta, 0) + greatest(new.delta, 0)
          )
      where id = new.customer_id;
    perform public.recompute_customer_loyalty(new.customer_id);
    return new;
  end if;
  return null;
end; $$;

-- set_customer_tier queda obsoleto (lo reemplaza recompute_customer_loyalty).
drop function if exists public.set_customer_tier(uuid);

-- ── 6) Backfill (absoluto = idempotente ante db:reset) ───────────────────
-- category_points por ventana per-tenant.
with agg as (
  select cu.id as customer_id,
         coalesce(sum(greatest(pt.delta, 0)) filter (
           where pt.created_at >= now() - make_interval(months => t.category_window_months)
         ), 0)::int as cat
  from public.customers cu
  join public.tenants t on t.id = cu.tenant_id
  left join public.points_transactions pt on pt.customer_id = cu.id
  group by cu.id
)
update public.customers c
set category_points = agg.cat
from agg
where agg.customer_id = c.id and c.category_points is distinct from agg.cat;

-- nivel a partir de category_points.
update public.customers c
set current_tier_id = (
  select lt.id from public.loyalty_tiers lt
  where lt.tenant_id = c.tenant_id and lt.active = true
    and lt.min_category_points <= c.category_points
  order by lt.min_category_points desc, lt.sort desc
  limit 1
);

-- ── 7) refresh_all_category_points: recompute masivo (cron diario) ───────
-- Hace vencer los puntos viejos (nada más lo dispara: el vencimiento es temporal).
create or replace function public.refresh_all_category_points()
returns table(updated_count int)
language plpgsql security definer set search_path = '' as $$
declare v_count int := 0;
begin
  with agg as (
    select cu.id as customer_id,
           coalesce(sum(greatest(pt.delta, 0)) filter (
             where pt.created_at >= now() - make_interval(months => t.category_window_months)
           ), 0)::int as cat
    from public.customers cu
    join public.tenants t on t.id = cu.tenant_id
    left join public.points_transactions pt on pt.customer_id = cu.id
    where cu.deleted_at is null
    group by cu.id
  ),
  resolved as (
    select agg.customer_id, agg.cat, lt.id as tier_id
    from agg
    join public.customers c on c.id = agg.customer_id
    left join lateral (
      select id from public.loyalty_tiers lt
      where lt.tenant_id = c.tenant_id and lt.active = true
        and lt.min_category_points <= agg.cat
      order by lt.min_category_points desc, lt.sort desc
      limit 1
    ) lt on true
  ),
  upd as (
    update public.customers c
      set category_points = r.cat, current_tier_id = r.tier_id
    from resolved r
    where c.id = r.customer_id
      and (c.category_points is distinct from r.cat
           or c.current_tier_id is distinct from r.tier_id)
    returning 1
  )
  select count(*)::int into v_count from upd;
  return query select v_count;
end; $$;
revoke execute on function public.refresh_all_category_points() from anon, authenticated;

-- ── 8) redeem_reward: gating por nivel usa category_points (nivel actual) ─
-- Si el cliente bajó de nivel, ya no accede a la recompensa exclusiva (coherente
-- con "nivel actual"). El gasto sigue validando contra points_balance.
create or replace function public.redeem_reward(
  p_customer_id uuid,
  p_reward_id uuid
) returns table(redemption_id uuid, balance_after int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_tenant_id uuid;
  v_reward public.rewards;
  v_balance int;
  v_redemption_id uuid;
  v_new_stock int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select tenant_id into v_tenant_id
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_tenant_id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into v_reward from public.rewards
    where id = p_reward_id and tenant_id = v_tenant_id
    for update;
  if v_reward.id is null then
    raise exception 'reward_not_found' using errcode = 'P0001';
  end if;
  if not v_reward.active then
    raise exception 'reward_inactive' using errcode = 'P0001';
  end if;
  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'out_of_stock' using errcode = 'P0001';
  end if;

  -- Gating por nivel: usa category_points (nivel actual), no lifetime.
  if v_reward.min_tier_id is not null then
    if not exists (
      select 1
      from public.loyalty_tiers lt
      join public.customers c on c.id = p_customer_id
      where lt.id = v_reward.min_tier_id
        and c.category_points >= lt.min_category_points
    ) then
      raise exception 'tier_locked' using errcode = 'P0001';
    end if;
  end if;

  select points_balance into v_balance from public.customers
    where id = p_customer_id for update;
  if v_balance < v_reward.cost_points then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;

  insert into public.reward_redemptions (
    tenant_id, customer_id, reward_id, points_spent, redeemed_by
  ) values (
    v_tenant_id, p_customer_id, p_reward_id, v_reward.cost_points, v_uid
  ) returning id into v_redemption_id;

  insert into public.points_transactions (
    tenant_id, customer_id, redemption_id, delta, reason, payload
  ) values (
    v_tenant_id, p_customer_id, v_redemption_id, -v_reward.cost_points,
    'reward_redeem', jsonb_build_object('reward_id', p_reward_id, 'reward_name', v_reward.name)
  );

  if v_reward.stock is not null then
    update public.rewards set stock = stock - 1 where id = p_reward_id
      returning stock into v_new_stock;
  end if;

  return query select v_redemption_id, v_balance - v_reward.cost_points;
end; $$;
revoke all on function public.redeem_reward(uuid, uuid) from public;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;

-- ── 9) get_loyalty_state: category_points + progreso + próximo vencimiento ─
create or replace function public.get_loyalty_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_customer_id uuid;
  v_customer public.customers;
  v_window int;
  v_cards jsonb;
  v_exp_points int := 0;
  v_exp_first timestamptz;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select ts.id, ts.tenant_id, sg.customer_id
    into v_session_id, v_tenant_id, v_customer_id
    from public.session_guests sg
    join public.table_sessions ts on ts.id = sg.session_id
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token
      and sg.browser_token = p_browser_token
    order by ts.opened_at desc
    limit 1;
  if v_customer_id is null then
    return jsonb_build_object('registered', false);
  end if;

  select * into v_customer from public.customers where id = v_customer_id;
  select coalesce(category_window_months, 4) into v_window
    from public.tenants where id = v_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'card_id', cpc.id,
    'template_id', cpc.template_id,
    'template_name', t.name,
    'description', t.description,
    'image_url', t.image_url,
    'current_stamps', cpc.current_stamps,
    'threshold', cpc.threshold_snapshot,
    'reward_name', r.name
  )), '[]'::jsonb) into v_cards
  from public.customer_punch_cards cpc
  join public.punch_card_templates t on t.id = cpc.template_id
  join public.rewards r on r.id = t.reward_id
  where cpc.customer_id = v_customer_id
    and cpc.tenant_id = v_tenant_id
    and cpc.completed_at is null
    and cpc.expired_at is null;

  -- Puntos que vencen en los próximos 30 días (salen de la ventana).
  select coalesce(sum(greatest(delta, 0)), 0)::int, min(created_at)
    into v_exp_points, v_exp_first
    from public.points_transactions
    where customer_id = v_customer_id and delta > 0
      and created_at >= now() - make_interval(months => v_window)
      and created_at < now() - make_interval(months => v_window) + interval '30 days';

  return jsonb_build_object(
    'registered', true,
    'customer_id', v_customer_id,
    'first_name', v_customer.first_name,
    'points_balance', v_customer.points_balance,
    'category_points', v_customer.category_points,
    'lifetime_points_earned', v_customer.lifetime_points_earned,
    'active_cards', v_cards,
    'current_tier', (
      select jsonb_build_object('id', lt.id, 'name', lt.name, 'color', lt.color,
                                'badge_icon', lt.badge_icon, 'perks', lt.perks)
      from public.loyalty_tiers lt where lt.id = v_customer.current_tier_id
    ),
    'next_tier', (
      select jsonb_build_object('id', lt.id, 'name', lt.name,
                                'min_category_points', lt.min_category_points,
                                'points_to_next', lt.min_category_points - v_customer.category_points)
      from public.loyalty_tiers lt
      where lt.tenant_id = v_tenant_id and lt.active = true
        and lt.min_category_points > v_customer.category_points
      order by lt.min_category_points asc limit 1
    ),
    'expiring', case when v_exp_points > 0 then jsonb_build_object(
      'points', v_exp_points,
      'expires_at', (v_exp_first + make_interval(months => v_window))
    ) else null end
  );
end $$;
revoke all on function public.get_loyalty_state(text, text) from public;
grant execute on function public.get_loyalty_state(text, text) to anon, authenticated;
