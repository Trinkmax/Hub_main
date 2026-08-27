-- ============================================================
-- Perf: auth fast-path — roles en el JWT + un solo RPC de acceso al tenant
-- ============================================================
-- Contexto (auditoría 27/08/2026, logs de Supabase): cada navegación pagaba ~7
-- round-trips HTTP SECUENCIALES a Supabase antes de renderizar nada (getUser en
-- el proxy, membership, getUser otra vez en el layout, membership+tenant,
-- is_platform_admin, memberships del topbar, getUser del topbar). Desde Vercel el
-- p50 de cada hop es 100–200 ms y la cola llegó a 60–157 s → "tarda minutos".
--
-- Esta migración habilita el camino corto:
--   1. El hook de access token inyecta `app_metadata.tenants` =
--      [{id, slug, role}] → el proxy decide el ruteo por rol leyendo el JWT
--      (verificado localmente con getClaims + JWKS ES256), sin tocar la DB.
--   2. `get_tenant_access(slug)` devuelve en UN solo round-trip todo lo que el
--      layout + shell necesitan: tenant, rol, memberships del usuario y si es
--      superadmin. SECURITY INVOKER: corre bajo RLS como el usuario.
--   3. Índices para las 21 FKs sin cubrir que reportó el advisor (aditivo).
--   4. Higiene de pg_cron: purga diaria de cron.job_run_details (75 MB / 106k
--      filas) y el dispatcher sólo llama a Vercel cuando hay trabajo vencido.
--
-- LEY multi-tenant: sin tablas nuevas. El JWT es SOLO ruteo; las páginas y
-- Server Actions siguen validando contra la DB (get_tenant_access bajo RLS).
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Hook de access token: tenants + roles en el JWT
-- ──────────────────────────────────────────────────────────

-- El hook corre como supabase_auth_admin; el SECURITY DEFINER ya lo hace pasar,
-- pero espejamos el grant/policy que ya tiene memberships (belt and braces).
grant select on public.tenants to supabase_auth_admin;
drop policy if exists auth_admin_reads_tenants on public.tenants;
create policy auth_admin_reads_tenants on public.tenants
  as permissive for select to supabase_auth_admin using (true);

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  app_meta jsonb;
  active_tid uuid;
  user_uuid uuid := (event ->> 'user_id')::uuid;
  tenants_json jsonb;
begin
  select tenant_id into active_tid
  from public.user_active_tenant
  where user_id = user_uuid;

  if active_tid is null then
    select tenant_id into active_tid
    from public.memberships where user_id = user_uuid
    order by created_at limit 1;
  end if;

  -- Memberships del usuario, en orden de alta. Es chico (1–3 bares por persona)
  -- y le permite al proxy rutear por rol sin ningún hop a la DB.
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', t.id, 'slug', t.slug, 'role', m.role)
      order by m.created_at
    ),
    '[]'::jsonb
  )
  into tenants_json
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = user_uuid;

  claims := event -> 'claims';
  app_meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);

  if active_tid is not null then
    app_meta := jsonb_set(app_meta, '{active_tenant_id}', to_jsonb(active_tid::text));
  end if;
  app_meta := jsonb_set(app_meta, '{tenants}', tenants_json);

  claims := jsonb_set(claims, '{app_metadata}', app_meta);
  event := jsonb_set(event, '{claims}', claims);
  return event;
end; $$;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook: inyecta app_metadata.active_tenant_id y app_metadata.tenants=[{id,slug,role}] en el JWT. Solo ruteo — la autorización real sigue en RLS.';

-- ──────────────────────────────────────────────────────────
-- 2. get_tenant_access(slug): un solo round-trip para layout + shell
-- ──────────────────────────────────────────────────────────

create or replace function public.get_tenant_access(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'tenant', to_jsonb(t),
    'role', m.role,
    'is_platform_admin', public.is_platform_admin(),
    'memberships', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', m2.role,
            'tenant', jsonb_build_object(
              'id', t2.id, 'name', t2.name, 'slug', t2.slug, 'logo_url', t2.logo_url
            )
          )
          order by m2.created_at
        ),
        '[]'::jsonb
      )
      from public.memberships m2
      join public.tenants t2 on t2.id = m2.tenant_id
      where m2.user_id = (select auth.uid())
    )
  )
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and t.slug = p_slug
  limit 1
$$;

comment on function public.get_tenant_access(text) is
  'Tenant + rol + memberships + is_platform_admin del usuario para un slug, en un solo round-trip. NULL si no es miembro. SECURITY INVOKER (RLS del usuario).';

revoke all on function public.get_tenant_access(text) from public, anon;
grant execute on function public.get_tenant_access(text) to authenticated;

-- ──────────────────────────────────────────────────────────
-- 3. FKs sin índice (advisor unindexed_foreign_keys, 21 casos)
-- ──────────────────────────────────────────────────────────

create index if not exists idx_customers_current_tier_id
  on public.customers(current_tier_id);
create index if not exists idx_reward_redemptions_delivered_by
  on public.reward_redemptions(delivered_by);
create index if not exists idx_flow_executions_current_node_id
  on public.flow_executions(current_node_id);
create index if not exists idx_tier_benefit_grants_redemption_id
  on public.tier_benefit_grants(redemption_id);
create index if not exists idx_tier_benefit_grants_reward_id
  on public.tier_benefit_grants(reward_id);
create index if not exists idx_tier_benefit_grants_tier_benefit_id
  on public.tier_benefit_grants(tier_benefit_id);
create index if not exists idx_tier_benefit_grants_tier_id
  on public.tier_benefit_grants(tier_id);
create index if not exists idx_reviews_visit_id
  on public.reviews(visit_id);
create index if not exists idx_conversation_tag_assignments_assigned_by
  on public.conversation_tag_assignments(assigned_by);
create index if not exists idx_quick_messages_created_by
  on public.quick_messages(created_by);
create index if not exists idx_flow_edges_target_node_id
  on public.flow_edges(target_node_id);
create index if not exists idx_platform_meta_config_updated_by
  on public.platform_meta_config(updated_by);
create index if not exists idx_tier_benefits_partner_id
  on public.tier_benefits(partner_id);
create index if not exists idx_tier_benefits_reward_id
  on public.tier_benefits(reward_id);
create index if not exists idx_punch_card_stamps_created_by
  on public.punch_card_stamps(created_by);
create index if not exists idx_punch_card_stamps_template_id
  on public.punch_card_stamps(template_id);
create index if not exists idx_punch_card_stamps_visit_id
  on public.punch_card_stamps(visit_id);
create index if not exists idx_customer_password_resets_tenant_id
  on public.customer_password_resets(tenant_id);
create index if not exists idx_flow_execution_events_customer_id
  on public.flow_execution_events(customer_id);
create index if not exists idx_flow_execution_events_flow_id
  on public.flow_execution_events(flow_id);
create index if not exists idx_flow_execution_events_node_id
  on public.flow_execution_events(node_id);

-- ──────────────────────────────────────────────────────────
-- 4. Higiene de pg_cron
-- ──────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 4a. cron.job_run_details crece sin límite (106k filas / 75 MB al 27/08).
--     Supabase recomienda purgarla; 7 días alcanzan para debuggear.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-cron-history') then
    perform cron.unschedule('purge-cron-history');
  end if;
end $$;

select cron.schedule(
  'purge-cron-history',
  '0 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

-- 4b. hub-dispatch: mismo endpoint y mismos secretos de Vault, pero la llamada
--     HTTP a Vercel sólo sale cuando hay trabajo vencido o toca una tarea gated
--     (espeja lib/cron/schedule.ts: time-triggers cada 15', templates cada 30',
--     refresh de tokens 04:20 UTC). Antes eran 1.440 invocaciones/día + ~4.300
--     requests a Supabase/día para, casi siempre, no hacer nada. `postgres` tiene
--     bypassrls, así que los exists() ven todas las filas.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'hub-dispatch') then
    perform cron.unschedule('hub-dispatch');
  end if;
end $$;

select cron.schedule(
  'hub-dispatch',
  '* * * * *',
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
  ) as request_id
  where exists (
      select 1 from public.broadcasts
      where status = 'scheduled' and scheduled_at <= now()
    )
    or exists (
      select 1 from public.job_queue
      where status = 'pending' and run_at <= now()
    )
    or exists (
      select 1 from public.job_queue
      where status = 'processing' and locked_at < now() - interval '5 minutes'
    )
    or exists (
      select 1 from public.flow_executions
      where status = 'running' and next_run_at <= now()
    )
    or extract(minute from now())::int % 15 = 0
    or (extract(hour from now())::int = 4 and extract(minute from now())::int = 20);
  $$
);
