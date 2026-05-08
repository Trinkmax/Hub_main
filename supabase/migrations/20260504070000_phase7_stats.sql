-- Phase 7: estadísticas
-- Materialized views: mv_customer_stats, mv_tenant_daily_metrics, mv_visit_heatmap
-- Vistas seguras (RLS-aware) para que el cliente lea: v_customer_stats,
-- v_tenant_daily_metrics, v_visit_heatmap, v_churn_risk
-- RPC: refresh_stats() — refresca las MVs CONCURRENTLY

-- ──────────────────────────────────────────────────────────
-- 1. mv_customer_stats
-- ──────────────────────────────────────────────────────────
-- Una fila por customer con agregados desde visits + visit_items.
-- favorite_item / favorite_category: el más consumido por quantity (tie-break: nombre asc).
create materialized view public.mv_customer_stats as
with visit_aggs as (
  select
    c.id as customer_id,
    c.tenant_id,
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
  group by c.id, c.tenant_id
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

-- Unique index obligatorio para REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index mv_customer_stats_pk on public.mv_customer_stats(customer_id);
create index mv_customer_stats_tenant_spent_idx
  on public.mv_customer_stats(tenant_id, total_spent_cents desc);
create index mv_customer_stats_tenant_last_visit_idx
  on public.mv_customer_stats(tenant_id, last_visit_at desc nulls last);

-- ──────────────────────────────────────────────────────────
-- 2. mv_tenant_daily_metrics
-- ──────────────────────────────────────────────────────────
-- Día calculado en TZ del tenant (no UTC) — un bar AR no quiere que las
-- 23:30 ART caigan en el día siguiente.
create materialized view public.mv_tenant_daily_metrics as
with visits_by_day as (
  select
    v.tenant_id,
    (v.visited_at at time zone t.timezone)::date as day,
    count(*)::int as visits,
    sum(v.total_amount_cents)::bigint as revenue_cents,
    count(distinct v.customer_id)::int as customers_active
  from public.visits v
  join public.tenants t on t.id = v.tenant_id
  group by v.tenant_id, day
),
new_by_day as (
  select
    c.tenant_id,
    (c.created_at at time zone t.timezone)::date as day,
    count(*)::int as customers_new
  from public.customers c
  join public.tenants t on t.id = c.tenant_id
  where c.deleted_at is null
  group by c.tenant_id, day
)
select
  coalesce(v.tenant_id, n.tenant_id) as tenant_id,
  coalesce(v.day, n.day) as day,
  coalesce(v.visits, 0) as visits,
  coalesce(v.revenue_cents, 0)::bigint as revenue_cents,
  coalesce(v.customers_active, 0) as customers_active,
  coalesce(n.customers_new, 0) as customers_new,
  now() as refreshed_at
from visits_by_day v
full outer join new_by_day n
  on v.tenant_id = n.tenant_id and v.day = n.day
with no data;

create unique index mv_tenant_daily_metrics_pk
  on public.mv_tenant_daily_metrics(tenant_id, day);
create index mv_tenant_daily_metrics_tenant_idx
  on public.mv_tenant_daily_metrics(tenant_id, day desc);

-- ──────────────────────────────────────────────────────────
-- 3. mv_visit_heatmap
-- ──────────────────────────────────────────────────────────
create materialized view public.mv_visit_heatmap as
select
  v.tenant_id,
  extract(dow from v.visited_at at time zone t.timezone)::int as dow,
  extract(hour from v.visited_at at time zone t.timezone)::int as hour,
  count(*)::int as visit_count
from public.visits v
join public.tenants t on t.id = v.tenant_id
group by v.tenant_id, dow, hour
with no data;

create unique index mv_visit_heatmap_pk
  on public.mv_visit_heatmap(tenant_id, dow, hour);

-- ──────────────────────────────────────────────────────────
-- 4. Vistas RLS-aware (la UI consulta estas, no las MVs)
-- ──────────────────────────────────────────────────────────
-- Usamos security_invoker = on (Postgres 15+) para que las RLS de
-- memberships apliquen en cascada cuando la vista filtra por tenant.
-- security_barrier = on para evitar leak de filas via predicados push-down.

create or replace view public.v_customer_stats
with (security_invoker = on, security_barrier = on) as
select * from public.mv_customer_stats
where tenant_id in (
  select tenant_id from public.memberships where user_id = auth.uid()
);

create or replace view public.v_tenant_daily_metrics
with (security_invoker = on, security_barrier = on) as
select * from public.mv_tenant_daily_metrics
where tenant_id in (
  select tenant_id from public.memberships where user_id = auth.uid()
);

create or replace view public.v_visit_heatmap
with (security_invoker = on, security_barrier = on) as
select * from public.mv_visit_heatmap
where tenant_id in (
  select tenant_id from public.memberships where user_id = auth.uid()
);

-- Churn risk: cliente que era frecuente y no volvió hace mucho.
create or replace view public.v_churn_risk
with (security_invoker = on, security_barrier = on) as
select
  cs.tenant_id,
  cs.customer_id,
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
-- 5. Refresh function
-- ──────────────────────────────────────────────────────────
-- CONCURRENTLY mantiene la MV consultable durante el refresh. Requiere unique
-- index (ya creados). En primera corrida (sin datos) hay que correr non-concurrent
-- una vez para popular; después siempre concurrent.
create or replace function public.refresh_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si la MV nunca fue populada (no data), un refresh concurrent falla.
  -- Detectamos eso vía pg_class.relispopulated y caemos a refresh normal.
  if not (
    select c.relispopulated from pg_class c
    where c.relname = 'mv_customer_stats' and c.relkind = 'm'
  ) then
    refresh materialized view public.mv_customer_stats;
  else
    refresh materialized view concurrently public.mv_customer_stats;
  end if;

  if not (
    select c.relispopulated from pg_class c
    where c.relname = 'mv_tenant_daily_metrics' and c.relkind = 'm'
  ) then
    refresh materialized view public.mv_tenant_daily_metrics;
  else
    refresh materialized view concurrently public.mv_tenant_daily_metrics;
  end if;

  if not (
    select c.relispopulated from pg_class c
    where c.relname = 'mv_visit_heatmap' and c.relkind = 'm'
  ) then
    refresh materialized view public.mv_visit_heatmap;
  else
    refresh materialized view concurrently public.mv_visit_heatmap;
  end if;
end;
$$;
revoke execute on function public.refresh_stats() from public, anon, authenticated;
grant execute on function public.refresh_stats() to service_role;

-- Primera ejecución para popular las MVs (no-concurrent, requerido).
select public.refresh_stats();

-- ──────────────────────────────────────────────────────────
-- 6. Permisos
-- ──────────────────────────────────────────────────────────
-- MVs: solo service_role (no exponemos directo).
revoke all on public.mv_customer_stats from public, anon, authenticated;
revoke all on public.mv_tenant_daily_metrics from public, anon, authenticated;
revoke all on public.mv_visit_heatmap from public, anon, authenticated;
grant select on public.mv_customer_stats to service_role;
grant select on public.mv_tenant_daily_metrics to service_role;
grant select on public.mv_visit_heatmap to service_role;

-- Vistas seguras: cliente las consume. RLS pasa a través vía security_invoker.
grant select on public.v_customer_stats to authenticated;
grant select on public.v_tenant_daily_metrics to authenticated;
grant select on public.v_visit_heatmap to authenticated;
grant select on public.v_churn_risk to authenticated;
