-- Fase 2 — Club de beneficios: NIVELES por puntos acumulados de por vida.
--
-- loyalty_tiers (por tenant) + customers.lifetime_points_earned (acumulador que NO baja)
-- + customers.current_tier_id (cache recomputado). El trigger points_tx_apply ahora también
-- acumula lifetime (solo deltas positivos) y recomputa el nivel. Anchor de paridad con
-- lib/points/tiers.ts (resolveTier).

-- ──────────────────────────────────────────────────────────
-- 1. Enum cadencia del beneficio recurrente
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tier_benefit_cadence') then
    create type public.tier_benefit_cadence as enum ('none', 'birthday', 'monthly');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. loyalty_tiers
-- ──────────────────────────────────────────────────────────
create table public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  badge_icon text,
  min_lifetime_points int not null check (min_lifetime_points >= 0),
  sort int not null default 0,
  benefit_cadence public.tier_benefit_cadence not null default 'none',
  benefit_reward_id uuid references public.rewards(id) on delete set null,
  perks text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, min_lifetime_points)
);
create index loyalty_tiers_tenant_threshold_idx
  on public.loyalty_tiers(tenant_id, min_lifetime_points);
create trigger loyalty_tiers_updated_at before update on public.loyalty_tiers
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 3. customers: acumulador de lifetime + nivel actual
-- ──────────────────────────────────────────────────────────
alter table public.customers
  add column if not exists lifetime_points_earned int not null default 0,
  add column if not exists current_tier_id uuid references public.loyalty_tiers(id) on delete set null;
create index if not exists customers_current_tier_idx
  on public.customers(tenant_id, current_tier_id);

-- ──────────────────────────────────────────────────────────
-- 4. set_customer_tier — recomputa el nivel (espejo de resolveTier en TS)
-- ──────────────────────────────────────────────────────────
create or replace function public.set_customer_tier(p_customer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_lifetime int;
  v_tier_id uuid;
begin
  select tenant_id, lifetime_points_earned into v_tenant, v_lifetime
    from public.customers where id = p_customer_id;
  if v_tenant is null then return null; end if;

  select id into v_tier_id
    from public.loyalty_tiers
    where tenant_id = v_tenant and active = true
      and min_lifetime_points <= v_lifetime
    order by min_lifetime_points desc, sort desc
    limit 1;

  update public.customers
    set current_tier_id = v_tier_id
    where id = p_customer_id and current_tier_id is distinct from v_tier_id;

  return v_tier_id;
end; $$;
revoke all on function public.set_customer_tier(uuid) from public;
-- helper interno: lo invoca el trigger y los RPCs; no se expone a authenticated.

-- ──────────────────────────────────────────────────────────
-- 5. points_tx_apply — ahora también acumula lifetime + recomputa nivel.
--    Lifetime acumula SOLO el componente positivo (las redenciones no bajan el nivel).
-- ──────────────────────────────────────────────────────────
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
    if v_lifetime_delta > 0 then perform public.set_customer_tier(new.customer_id); end if;
    return new;

  elsif tg_op = 'DELETE' then
    v_lifetime_delta := greatest(old.delta, 0);
    update public.customers
      set points_balance = points_balance - old.delta,
          lifetime_points_earned = greatest(0, lifetime_points_earned - v_lifetime_delta)
      where id = old.customer_id;
    if v_lifetime_delta > 0 then perform public.set_customer_tier(old.customer_id); end if;
    return old;

  elsif tg_op = 'UPDATE' then
    update public.customers
      set points_balance = points_balance - old.delta + new.delta,
          lifetime_points_earned = greatest(
            0,
            lifetime_points_earned - greatest(old.delta, 0) + greatest(new.delta, 0)
          )
      where id = new.customer_id;
    perform public.set_customer_tier(new.customer_id);
    return new;
  end if;
  return null;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 6. Backfill (absoluto = idempotente ante db:reset; corre DESPUÉS del trigger).
--    El trigger solo dispara en inserts nuevos; estos UPDATE setean el valor final.
-- ──────────────────────────────────────────────────────────
update public.customers c
set lifetime_points_earned = coalesce(agg.lifetime, 0)
from (
  select customer_id, sum(greatest(delta, 0))::int as lifetime
  from public.points_transactions
  group by customer_id
) agg
where agg.customer_id = c.id;

update public.customers c
set current_tier_id = (
  select lt.id from public.loyalty_tiers lt
  where lt.tenant_id = c.tenant_id and lt.active = true
    and lt.min_lifetime_points <= c.lifetime_points_earned
  order by lt.min_lifetime_points desc, lt.sort desc
  limit 1
);

-- ──────────────────────────────────────────────────────────
-- 7. RLS + GRANTs (owner-write / tenant-read)
-- ──────────────────────────────────────────────────────────
alter table public.loyalty_tiers enable row level security;
create policy "lt_select_member" on public.loyalty_tiers for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "lt_owner_insert" on public.loyalty_tiers for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "lt_owner_update" on public.loyalty_tiers for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "lt_owner_delete" on public.loyalty_tiers for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.loyalty_tiers to authenticated;
