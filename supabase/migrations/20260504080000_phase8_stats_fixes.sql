-- Phase 8: fixes de stats (security_invoker + columnas legibles en MV)
--
-- Problema 1: las views v_* tenían `security_invoker = on`. Eso hace que la
-- consulta interna a la MV se ejecute con el rol del invoker (authenticated),
-- que NO tiene SELECT sobre la MV → 403. La isolación por tenant ya la
-- garantiza el WHERE de la propia view via auth.uid() / memberships, así que
-- es seguro mover la ejecución interna al rol owner (security_invoker = off,
-- comportamiento por defecto de PostgreSQL).
--
-- Problema 2: el frontend hacía embed `customer:customers!inner(...)` para
-- traer first_name/last_name. PostgREST no resuelve relationships sobre MVs
-- sin FK declarada. Solución: incluir first_name, last_name y phone en la MV
-- y leerlos directo desde la view.

-- ──────────────────────────────────────────────────────────
-- 1. Recrear mv_customer_stats con columnas legibles
-- ──────────────────────────────────────────────────────────
-- Las views dependen de la MV: hay que dropear con cascade y recrear.
drop materialized view if exists public.mv_customer_stats cascade;

create materialized view public.mv_customer_stats as
with visit_aggs as (
  select
    c.id as customer_id,
    c.tenant_id,
    c.first_name,
    c.last_name,
    c.phone,
    count(v.id)::int as total_visits,
    coalesce(sum(v.total_amount_cents), 0)::bigint as total_spent_cents,
    case when count(v.id) > 0
      then floor(coalesce(sum(v.total_amount_cents), 0)::numeric / count(v.id))::bigint
      else 0::bigint
    end as avg_ticket_cents,
    min(v.visited_at) as first_visit_at,
    max(v.visited_at) as last_visit_at,
    case
      when count(v.id) >= 2
        then round(
          (extract(epoch from (max(v.visited_at) - min(v.visited_at))) / 86400)::numeric
          / nullif(count(v.id) - 1, 0),
          2
        )
      else null
    end as visit_frequency_days,
    case
      when max(v.visited_at) is not null
        then floor(extract(epoch from (now() - max(v.visited_at))) / 86400)::int
      else null
    end as days_since_last_visit
  from public.customers c
  left join public.visits v on v.customer_id = c.id
  where c.deleted_at is null
  group by c.id, c.tenant_id, c.first_name, c.last_name, c.phone
),
item_ranking as (
  select distinct on (v.customer_id)
    v.customer_id,
    mi.id as favorite_item_id,
    mi.name as favorite_item_name,
    mi.category_id as favorite_category_id
  from public.visits v
  join public.visit_items vi on vi.visit_id = v.id
  join public.menu_items mi on mi.id = vi.menu_item_id
  group by v.customer_id, mi.id, mi.name, mi.category_id
  order by v.customer_id, sum(vi.quantity) desc, mi.name asc
),
category_ranking as (
  select distinct on (v.customer_id)
    v.customer_id,
    mi.category_id as favorite_category_id,
    mc.name as favorite_category_name
  from public.visits v
  join public.visit_items vi on vi.visit_id = v.id
  join public.menu_items mi on mi.id = vi.menu_item_id
  join public.menu_categories mc on mc.id = mi.category_id
  group by v.customer_id, mi.category_id, mc.name
  order by v.customer_id, sum(vi.quantity) desc, mc.name asc
)
select
  va.customer_id,
  va.tenant_id,
  va.first_name,
  va.last_name,
  va.phone,
  va.total_visits,
  va.total_spent_cents,
  va.avg_ticket_cents,
  va.first_visit_at,
  va.last_visit_at,
  va.days_since_last_visit,
  va.visit_frequency_days,
  ir.favorite_item_id,
  ir.favorite_item_name,
  cr.favorite_category_id,
  cr.favorite_category_name,
  now() as refreshed_at
from visit_aggs va
left join item_ranking ir on ir.customer_id = va.customer_id
left join category_ranking cr on cr.customer_id = va.customer_id
with no data;

create unique index mv_customer_stats_pk on public.mv_customer_stats(customer_id);
create index mv_customer_stats_tenant_spent_idx
  on public.mv_customer_stats(tenant_id, total_spent_cents desc);
create index mv_customer_stats_tenant_last_visit_idx
  on public.mv_customer_stats(tenant_id, last_visit_at desc nulls last);

-- ──────────────────────────────────────────────────────────
-- 2. Recrear v_customer_stats y v_churn_risk con security_invoker = off
-- ──────────────────────────────────────────────────────────
create or replace view public.v_customer_stats
with (security_invoker = off, security_barrier = on) as
select * from public.mv_customer_stats
where tenant_id in (
  select tenant_id from public.memberships where user_id = auth.uid()
);

create or replace view public.v_churn_risk
with (security_invoker = off, security_barrier = on) as
select
  cs.tenant_id,
  cs.customer_id,
  cs.first_name,
  cs.last_name,
  cs.phone,
  cs.total_visits,
  cs.visit_frequency_days,
  cs.days_since_last_visit,
  cs.last_visit_at,
  cs.total_spent_cents,
  cs.favorite_item_name
from public.mv_customer_stats cs
where cs.tenant_id in (
    select tenant_id from public.memberships where user_id = auth.uid()
  )
  and cs.total_visits >= 3
  and cs.visit_frequency_days is not null
  and cs.visit_frequency_days < 30
  and cs.days_since_last_visit > cs.visit_frequency_days * 2;

-- ──────────────────────────────────────────────────────────
-- 3. Cambiar security_invoker en las otras dos views (no dependen de la MV
--    recreada, pero compartían el mismo problema de permisos)
-- ──────────────────────────────────────────────────────────
alter view public.v_tenant_daily_metrics set (security_invoker = off);
alter view public.v_visit_heatmap set (security_invoker = off);

-- ──────────────────────────────────────────────────────────
-- 4. Permisos
-- ──────────────────────────────────────────────────────────
revoke all on public.mv_customer_stats from public, anon, authenticated;
grant select on public.mv_customer_stats to service_role;

grant select on public.v_customer_stats to authenticated;
grant select on public.v_churn_risk to authenticated;
-- v_tenant_daily_metrics y v_visit_heatmap ya tienen el grant de la fase 7.

-- ──────────────────────────────────────────────────────────
-- 5. Refresh para popular la MV (recreada → vacía)
-- ──────────────────────────────────────────────────────────
select public.refresh_stats();
