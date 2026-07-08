-- ============================================================
-- pg_cron: refresco periódico de las materialized views de stats
-- ============================================================
-- Reintroduce en el repo el scheduling de `refresh-mv-stats`. El job corría en
-- prod (cada 10 min, `select public.refresh_stats();`) pero su migración
-- original (20260520203834_enable_pg_cron_and_schedule_refresh_stats) se perdió
-- del repo → un `db:reset` limpio recreaba la función `refresh_stats()` pero
-- NUNCA la agendaba, dejando las MVs de stats sin refrescar en entornos nuevos.
--
-- Espeja el patrón de los demás crons de mantenimiento (loyalty_cron_schedule,
-- cron_dispatch_schedule): pg_cron llama la función SQL directo; corre como
-- postgres → puede ejecutar las SECURITY DEFINER internas. `public.refresh_stats()`
-- refresca las materialized views de estadísticas del dashboard.
--
-- Cadencia */10 (cada 10 min), idéntica a la de prod. Idempotente: si el job ya
-- existe (prod), se reagenda; en un entorno nuevo, se crea.
--
-- LEY multi-tenant: sin tablas/RLS/GRANT nuevos; sólo scheduling.
-- No modifica el schema public → no requiere regenerar types/database.ts.
-- ============================================================

create extension if not exists pg_cron;

-- Reagendar idempotente: si el job ya existe, lo borramos antes de recrear.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-mv-stats') then
    perform cron.unschedule('refresh-mv-stats');
  end if;
end $$;

select cron.schedule(
  'refresh-mv-stats',
  '*/10 * * * *', -- cada 10 minutos
  $$ select public.refresh_stats(); $$
);
