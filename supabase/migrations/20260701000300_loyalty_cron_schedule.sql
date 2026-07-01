-- ============================================================
-- pg_cron: mantenimiento diario del sistema de puntos
-- ============================================================
-- Espeja el patrón de `refresh-mv-stats` (pg_cron llama la RPC directo por SQL;
-- pg_cron corre como postgres → puede ejecutar las SECURITY DEFINER internas).
--
--   refresh-category-points → hace vencer los puntos viejos (recompute masivo).
--                             Nada más lo dispara: el vencimiento es temporal.
--   grant-tier-benefits     → emite los ítems gratis del mes (corre DESPUÉS del
--                             recompute, así los niveles ya están al día).
--
-- Horarios en UTC (la DB corre en UTC). Córdoba = UTC-3 →
--   08:30 UTC ≈ 05:30 AR  ·  09:00 UTC ≈ 06:00 AR  (antes de abrir).
--
-- LEY multi-tenant: sin tablas/RLS nuevas; sólo scheduling. Idempotente.
-- No modifica el schema public → no requiere regenerar types/database.ts.
-- ============================================================

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-category-points') then
    perform cron.unschedule('refresh-category-points');
  end if;
  if exists (select 1 from cron.job where jobname = 'grant-tier-benefits') then
    perform cron.unschedule('grant-tier-benefits');
  end if;
end $$;

select cron.schedule(
  'refresh-category-points',
  '30 8 * * *',
  $$ select public.refresh_all_category_points(); $$
);

select cron.schedule(
  'grant-tier-benefits',
  '0 9 * * *',
  $$ select public.grant_tier_benefits(); $$
);
