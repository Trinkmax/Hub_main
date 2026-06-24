-- ============================================================
-- Dispatcher de trabajo de fondo de mensajería vía pg_cron + pg_net
-- ============================================================
-- pg_cron pega cada minuto a /api/cron/dispatch (Next.js) con
-- `Authorization: Bearer ${CRON_SECRET}`. El dispatcher corre TODO el trabajo
-- de fondo de mensajería vencido (promover difusiones, drenar job_queue, tickear
-- flows, y tareas gated: time-triggers/sync-templates/refresh-tokens).
--
-- Reemplaza el scheduling individual de los crons de mensajería; en Vercel Hobby
-- no se pueden agendar varios crons sub-diarios. Los 2 crons DIARIOS de vercel.json
-- (auto-abandon-stale, expire-punch-cards) y el pg_cron existente refresh-mv-stats
-- (cada 10 min) NO se tocan.
--
-- URL y secreto se leen de Supabase Vault — NO se hardcodean acá.
-- Patrón verificado contra docs Supabase (Database → Cron + pg_net + Vault, 2026).
--
-- SETUP MANUAL ÚNICO (correr UNA vez con valores reales, vía MCP execute_sql,
-- ANTES de que el job empiece a correr; NO se commitea con valores):
--   select vault.create_secret('https://<app-de-produccion>', 'app_url');
--   select vault.create_secret('<CRON_SECRET real, igual al env de Vercel>', 'cron_secret');
-- (Si ya existen: select vault.update_secret('<id>', '<nuevo_valor>'); )
--
-- LEY multi-tenant: sin tablas/RLS/GRANT nuevos (solo scheduling). Idempotente.
-- No modifica el schema public → no requiere regenerar types/database.ts.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reagendar idempotente: si el job ya existe, lo borramos antes de recrear.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'hub-dispatch') then
    perform cron.unschedule('hub-dispatch');
  end if;
end $$;

select cron.schedule(
  'hub-dispatch',
  '* * * * *', -- cada minuto
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url')
           || '/api/cron/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);
