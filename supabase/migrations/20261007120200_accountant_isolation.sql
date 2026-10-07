-- ============================================================
-- Sprint 1 «Administración» · fase 0 · migración #3
-- Aislamiento de la contadora en la base (spec §B.7, §B.5.2-B.5.3, §B.9)
-- ============================================================
-- OBJETIVO: con su JWT y la anon key, llamando a PostgREST o a las RPC
-- directo, la contadora (`accountant`, migración #2) no lee nada fuera de
-- Administración (salvo su membresía y la fila de su bar) y no escribe nada en
-- ningún lado. Se aplica ANTES de que pueda existir una contadora: en
-- producción el efecto es nulo hasta la fase 4 (nadie puede crearla sin un
-- administrador de Administración, y todavía no hay ninguno).
--
-- Qué hace, en orden:
--   0. Red: aborta si ya existe alguna membresía o invitación `accountant`.
--   1. `acc_access` (acceso a Administración POR PERSONA) con RLS encendida y
--      SIN políticas (cerrado: la política de lectura llega en la #6, junto con
--      los helpers de lectura); solo SELECT para authenticated y nada para anon.
--      Helpers que las guardias necesitan desde hoy:
--      `acc_accountant_tenant_ids()`, `acc_admin_tenant_ids()` y
--      `acc_member_is_protected()` (la usa la guardia TS de setMemberPassword).
--   2. Política RESTRICTIVE `<tabla>_no_accountant` en las 64 tablas con
--      `tenant_id` (las 70 del catálogo vivo menos memberships,
--      user_active_tenant, audit_log, customer_credentials,
--      customer_password_resets y job_queue). Incluye las que hoy ya son
--      solo-dueño: no cambian nada hoy y blindan contra que alguien relaje una
--      política mañana. Las 11 tablas hijas sin `tenant_id` quedan cubiertas
--      por transitividad (sus políticas consultan la madre, y la RLS de la
--      madre se aplica dentro de la subconsulta).
--   3. memberships: RESTRICTIVE que a la contadora le deja ver SOLO su fila
--      (get_tenant_access la necesita).
--   4. Las 4 vistas `v_*` (corren como su dueño: la RLS de memberships no las
--      alcanza) filtran `role <> 'accountant'`.
--   5. Gestores de reservas: la contadora no se da de alta, y pasar a/desde
--      contadora apaga/prende su gestor (nunca se borra: historia de comisiones).
--   6. Solo un administrador de Administración del bar crea una contadora
--      (membresía o invitación). Se chequea a QUIEN INSERTA (auth.uid()).
--   7. Sincronía con `acc_access` (sacar a alguien del equipo o bajarlo de dueño
--      le revoca el acceso) y gobierno (nadie sin acceso toca a quien lo tiene).
--   8. Detectores de huecos `acc_isolation_gaps()` y `acc_rpc_isolation_gaps()`
--      (solo service_role; los usa tests/rls/accountant-isolation.test.ts).
--
-- POR QUÉ RESTRICTIVE y no tocar `user_tenant_ids()`: excluir a la contadora
-- ahí cubriría solo 52 políticas, rompería tenants_select_member y
-- memberships_select_same_tenant (y con ellas get_tenant_access) y no cubriría
-- las 25 políticas con subconsulta inline. Las RESTRICTIVE son aditivas, no
-- tocan ninguna política existente y se revierten con `drop policy`. Para todo
-- el que no es contadora, `acc_accountant_tenant_ids()` devuelve vacío y
-- `tenant_id <> all ('{}')` es siempre verdadero: nadie de hoy ve una fila menos.
--
-- REGLA NUEVA (CLAUDE.md §4): toda tabla nueva con `tenant_id` fuera de `acc_*`
-- lleva su RESTRICTIVE `<tabla>_no_accountant`, y toda RPC SECURITY DEFINER que
-- mire membresía enumera roles. Los detectores lo hacen fallar en CI.
--
-- Se aparta a propósito del `grant select, insert, update, delete` de
-- CLAUDE.md §5: `acc_access` es de solo lectura por diseño (se escribe solo por
-- RPC definer, fase 1).
-- ============================================================

-- CREATE POLICY y CREATE OR REPLACE VIEW toman lock exclusivo de 64 tablas y 4
-- vistas hasta el COMMIT (unos cientos de ms). Si alguna está tomada por una
-- consulta larga (p. ej. el refresh de estadísticas del cron), mejor fallar
-- rápido y reintentar que encolar todo el tráfico del salón detrás de esta
-- migración.
set local lock_timeout = '5s';

-- ─── 0. Red: no puede haber contadoras todavía ──────────────────────────────
do $$
begin
  if exists (select 1 from public.memberships where role = 'accountant')
     or exists (select 1 from public.invitations where role = 'accountant') then
    raise exception 'accountant_isolation: ya existen membresías o invitaciones accountant';
  end if;
end $$;

-- ─── 1. acc_access + helpers ─────────────────────────────────────────────────
create table public.acc_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,            -- da y quita accesos, suma a la contadora
  source text not null default 'grant',               -- setup | grant | platform | claim
  granted_by uuid,                                    -- null = sistema / plataforma
  granted_by_name text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,                                    -- null con revoked_at = lo quitó un trigger sin usuario
  revoke_reason text,
  updated_at timestamptz not null default now(),
  constraint aax_id_tenant_uq unique (id, tenant_id),
  constraint aax_name_len check (char_length(btrim(display_name)) between 1 and 80),
  constraint aax_source check (source in ('setup', 'grant', 'platform', 'claim')),
  constraint aax_reason_len check (revoke_reason is null or char_length(revoke_reason) <= 200),
  constraint aax_revoke_coherent check (revoked_at is not null or (revoked_by is null and revoke_reason is null))
);
create unique index aax_one_active on public.acc_access (tenant_id, user_id) where revoked_at is null;
create index aax_user_active_idx on public.acc_access (user_id) where revoked_at is null;

comment on table public.acc_access is
  'Acceso a Administración por persona (dueño + fila vigente + flag accounting). is_admin = da y quita accesos y suma a la contadora. Nunca se borra: revocar marca revoked_at (historia). Se escribe solo por RPC definer.';

-- Cerrada hasta la #6: RLS encendida y sin políticas (nadie lee por PostgREST).
-- Sin INSERT/UPDATE/DELETE para authenticated aunque alguien agregue una
-- política por error; nada para anon (el default privileges del proyecto le da
-- SELECT e INSERT a cada tabla nueva).
alter table public.acc_access enable row level security;
revoke all on public.acc_access from anon, authenticated;
grant select on public.acc_access to authenticated;

-- Bares donde quien llama es la contadora. Base del aislamiento: NO depende del
-- flag `accounting`. DEFINER a propósito: lee memberships sin pasar por su RLS
-- (como invoker, la RESTRICTIVE de memberships que la usa entraría en
-- recursión). Set-returning: las políticas la evalúan una vez por consulta.
create function public.acc_accountant_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.memberships m
   where m.user_id = (select auth.uid()) and m.role = 'accountant'
$$;

-- Bares donde quien llama ADMINISTRA accesos (dueño + acceso vigente +
-- is_admin). Sin flag: las protecciones de gobierno siguen vigentes aunque el
-- módulo esté apagado.
create function public.acc_admin_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.tenant_id
    from public.acc_access a
    join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
   where a.user_id = (select auth.uid()) and a.revoked_at is null and a.is_admin
$$;

-- ¿El destino está protegido? (acceso vigente a Administración o contadora).
-- Lo usa la guardia TS de setMemberPassword con el cliente DEL USUARIO, antes de
-- tocar auth.admin: cambiarle la contraseña a alguien protegido es entrar como
-- esa persona. Cualquier dueño del bar puede preguntar; el resto, 'forbidden'.
-- Mismo criterio que el trigger de gobierno (sección 7).
create function public.acc_member_is_protected(p_tenant_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant_id is null or coalesce(public.user_role_in_tenant(p_tenant_id)::text, '') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return exists (select 1 from public.memberships m
                  where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.role = 'accountant')
      or exists (select 1 from public.acc_access a
                  where a.tenant_id = p_tenant_id and a.user_id = p_user_id and a.revoked_at is null);
end;
$$;

-- Solo devuelven datos de quien llama (auth.uid()): exponerlos no filtra nada.
revoke all on function public.acc_accountant_tenant_ids() from public, anon;
grant execute on function public.acc_accountant_tenant_ids() to authenticated;
revoke all on function public.acc_admin_tenant_ids() from public, anon;
grant execute on function public.acc_admin_tenant_ids() to authenticated;
revoke all on function public.acc_member_is_protected(uuid, uuid) from public, anon;
grant execute on function public.acc_member_is_protected(uuid, uuid) to authenticated;

comment on function public.acc_accountant_tenant_ids() is
  'Bares donde quien llama tiene rol accountant. Base de las RESTRICTIVE <tabla>_no_accountant. No depende del flag accounting.';
comment on function public.acc_admin_tenant_ids() is
  'Bares donde quien llama administra los accesos de Administración (dueño + acc_access vigente + is_admin). No depende del flag.';
comment on function public.acc_member_is_protected(uuid, uuid) is
  'true si el destino tiene acceso vigente a Administración o es contadora. Solo para dueños del bar (guardia TS de setMemberPassword).';

-- ─── 2. RESTRICTIVE en las 64 tablas con tenant_id ──────────────────────────
-- Lista armada del catálogo vivo del 06/10/2026 (84 tablas en public, 70 con
-- tenant_id, menos las 6 excepciones documentadas). Para todo el que no es
-- contadora la condición es siempre verdadera.
do $$
declare
  t text;
begin
  foreach t in array array[
    'audiences', 'birthday_marketing', 'broadcasts', 'cake_options', 'channels', 'commission_bonus_rules',
    'commission_ledger', 'commission_rate_tiers', 'conversation_tags', 'conversations', 'customer_capture_links',
    'customer_capture_submissions', 'customer_punch_cards', 'customer_tags', 'customers', 'floor_plan_areas',
    'floor_plan_elements', 'flow_execution_events', 'flow_executions', 'flows', 'invitations', 'item_tags',
    'landing_page_versions', 'landing_page_views', 'landing_pages', 'loyalty_tiers', 'marketing_routine_checks',
    'marketing_routines', 'marketing_tasks', 'menu_categories', 'menu_items', 'message_templates', 'messages',
    'partner_benefit_tiers', 'partner_benefits', 'partners', 'physical_tables', 'points_rules', 'points_transactions',
    'public_link_pages', 'public_links', 'punch_card_stamps', 'punch_card_template_tiers', 'punch_card_templates',
    'quick_messages', 'reservation_managers', 'reviews', 'reward_redemptions', 'rewards', 'salon_reservations',
    'salon_segment_capacities', 'salon_segment_capacity_overrides', 'salon_segment_settings',
    'salon_zone_capacity_overrides', 'scheduled_event_marketing', 'scheduled_event_templates', 'scheduled_events',
    'table_sessions', 'tickets', 'tier_benefit_grants', 'tier_benefits', 'visits', 'welcome_reward_configs',
    'welcome_reward_grants']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_no_accountant', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
         with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))',
      t || '_no_accountant', t);
  end loop;
end $$;

-- ─── 3. memberships: la contadora ve SOLO su propia fila ────────────────────
-- (get_tenant_access, invoker, la necesita para resolver su rol y su bar.)
drop policy if exists memberships_no_accountant on public.memberships;
create policy memberships_no_accountant on public.memberships
  as restrictive for all to authenticated
  using (user_id = (select auth.uid()) or tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

-- ─── 4. Las 4 vistas SECURITY DEFINER (security_invoker = off) ──────────────
-- Corren como su dueño: la RLS de memberships no las alcanza. Mismo SELECT y
-- mismas columnas en el mismo orden que pg_get_viewdef del 06/10, con el filtro
-- de rol. (Si el orden difiriera al aplicar, create or replace view falla sin
-- romper nada.) create or replace conserva dueño y grants.
create or replace view public.v_customer_stats with (security_barrier = true, security_invoker = false) as
select customer_id, tenant_id, first_name, last_name, phone, total_visits, total_spent_cents, avg_ticket_cents,
       first_visit_at, last_visit_at, days_since_last_visit, visit_frequency_days, favorite_item_id,
       favorite_item_name, favorite_category_id, favorite_category_name, refreshed_at
  from public.mv_customer_stats
 where tenant_id in (select memberships.tenant_id from public.memberships
                      where memberships.user_id = auth.uid() and memberships.role <> 'accountant'::public.tenant_role);

create or replace view public.v_churn_risk with (security_barrier = true, security_invoker = false) as
select tenant_id, customer_id, first_name, last_name, phone, total_visits, visit_frequency_days,
       days_since_last_visit, last_visit_at, total_spent_cents, favorite_item_name
  from public.mv_customer_stats cs
 where tenant_id in (select memberships.tenant_id from public.memberships
                      where memberships.user_id = auth.uid() and memberships.role <> 'accountant'::public.tenant_role)
   and total_visits >= 3 and visit_frequency_days is not null and visit_frequency_days < 30::numeric
   and days_since_last_visit::numeric > (visit_frequency_days * 2::numeric);

create or replace view public.v_tenant_daily_metrics with (security_barrier = true, security_invoker = false) as
select tenant_id, day, visits, revenue_cents, customers_active, customers_new, refreshed_at
  from public.mv_tenant_daily_metrics
 where tenant_id in (select memberships.tenant_id from public.memberships
                      where memberships.user_id = auth.uid() and memberships.role <> 'accountant'::public.tenant_role);

create or replace view public.v_visit_heatmap with (security_barrier = true, security_invoker = false) as
select tenant_id, dow, hour, visit_count
  from public.mv_visit_heatmap
 where tenant_id in (select memberships.tenant_id from public.memberships
                      where memberships.user_id = auth.uid() and memberships.role <> 'accountant'::public.tenant_role);

-- ─── 5. Gestores de reservas ─────────────────────────────────────────────────
-- La contadora no toma reservas: no se le crea gestor al entrar al equipo.
create or replace function public.tg_memberships_provision_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'accountant' then return null; end if;            -- la contadora no toma reservas
  perform public.provision_reservation_manager(new.tenant_id, new.user_id);
  return null;
end;
$$;
revoke all on function public.tg_memberships_provision_manager() from public, anon, authenticated;

-- Pasar a contadora apaga su gestor (nunca se borra: historia de comisiones);
-- volver a otro rol lo reprovisiona (provision_reservation_manager reactiva la
-- fila existente).
create function private.acc_tg_memberships_role_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'accountant' and old.role <> 'accountant' then
    update public.reservation_managers
       set active = false
     where tenant_id = new.tenant_id and user_id = new.user_id and active;
  elsif old.role = 'accountant' and new.role <> 'accountant' then
    perform public.provision_reservation_manager(new.tenant_id, new.user_id);
  end if;
  return null;
end;
$$;
create trigger memberships_role_changed
  after update of role on public.memberships
  for each row when (old.role is distinct from new.role)
  execute function private.acc_tg_memberships_role_changed();

-- ─── 6. Quién puede crear una contadora: solo un administrador del bar ──────
create function private.acc_tg_guard_accountant_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.role <> 'accountant' then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'accountant' then return new; end if;
  -- Servicio (createMemberWithPassword): manda la guardia TS, que exige admin.
  if v_uid is null then return new; end if;
  if new.tenant_id in (select public.acc_admin_tenant_ids()) then return new; end if;
  -- accept_invitation corre con el uid de la invitada (inserta la membresía
  -- ANTES de marcar la invitación aceptada): vale si existe la invitación de
  -- contadora vigente para su email (solo un admin pudo crearla).
  if v_uid = new.user_id and exists (
       select 1 from public.invitations i
        where i.tenant_id = new.tenant_id and i.role = 'accountant' and i.accepted_at is null and i.expires_at > now()
          and lower(i.email::text) = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    return new;
  end if;
  raise exception 'accountant_requires_acc_admin' using errcode = '42501';
end;
$$;
create trigger memberships_guard_accountant
  before insert or update of role on public.memberships
  for each row execute function private.acc_tg_guard_accountant_membership();

create function private.acc_tg_guard_accountant_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.role <> 'accountant' then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'accountant' then return new; end if;
  if v_uid is null then return new; end if;
  -- Se chequea a QUIEN INSERTA (auth.uid()), no invited_by: invited_by lo
  -- escribe el propio cliente.
  if new.tenant_id in (select public.acc_admin_tenant_ids()) then return new; end if;
  raise exception 'accountant_requires_acc_admin' using errcode = '42501';
end;
$$;
create trigger invitations_guard_accountant
  before insert or update of role on public.invitations
  for each row execute function private.acc_tg_guard_accountant_invitation();

-- ─── 7a. Sincronía con memberships (spec §B.5.2) ────────────────────────────
-- Si sacan a alguien del equipo o deja de ser dueño, pierde Administración
-- (queda la historia). Los helpers ya cruzan con memberships.role = 'owner':
-- aunque este trigger fallara, un ex dueño no lee ni escribe; esto deja la
-- tabla prolija y la pantalla de accesos honesta. Si vuelve a ser dueño, el
-- acceso NO revive: hay que darlo de nuevo.
create function private.acc_tg_memberships_access_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.acc_access
       set revoked_at = now(), revoked_by = (select auth.uid()),
           revoke_reason = 'Ya no es parte del equipo', updated_at = now()
     where tenant_id = old.tenant_id and user_id = old.user_id and revoked_at is null;
  elsif old.role = 'owner' and new.role <> 'owner' then
    update public.acc_access
       set revoked_at = now(), revoked_by = (select auth.uid()),
           revoke_reason = 'Dejó de ser dueño', updated_at = now()
     where tenant_id = old.tenant_id and user_id = old.user_id and revoked_at is null;
  end if;
  return null;
end;
$$;
create trigger memberships_acc_access_delete
  after delete on public.memberships
  for each row execute function private.acc_tg_memberships_access_sync();
create trigger memberships_acc_access_role
  after update of role on public.memberships
  for each row when (old.role is distinct from new.role)
  execute function private.acc_tg_memberships_access_sync();

-- ─── 7b. Gobierno: nadie sin acceso toca a quien lo tiene (spec §B.5.3) ─────
-- Con 18 dueños, uno de marketing podía, desde Equipo o por PostgREST, bajar de
-- rol o sacar a quien administra (y con eso revocarle Administración), o tocar
-- a la contadora. Solo un administrador del bar (o la propia persona) puede.
-- El cliente de servicio (auth.uid() nulo) pasa: lo cubre la guardia TS.
create function private.acc_tg_protect_accounting_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;                                            -- cascada del bar entero
  end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;                                            -- «update of role» sin cambio real
  end if;
  if v_uid is not null and v_uid <> old.user_id
     and (old.role = 'accountant'
          or exists (select 1 from public.acc_access a
                      where a.tenant_id = old.tenant_id and a.user_id = old.user_id and a.revoked_at is null))
     and old.tenant_id not in (select public.acc_admin_tenant_ids()) then
    raise exception 'protected_accounting_member' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger memberships_protect_accounting
  before update of role or delete on public.memberships
  for each row execute function private.acc_tg_protect_accounting_members();

-- ─── 8. Detectores de huecos (spec §B.9; deben devolver 0 filas) ────────────
-- Tablas con tenant_id sin su RESTRICTIVE.
create function public.acc_isolation_gaps()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
     and c.relname not like 'acc\_%' escape '\'
     and c.relname not in ('memberships', 'user_active_tenant', 'audit_log',
                           'customer_credentials', 'customer_password_resets', 'job_queue')
     and not exists (select 1 from pg_catalog.pg_policy p
                      where p.polrelid = c.oid and not p.polpermissive and p.polname = c.relname || '_no_accountant')
$$;

-- RPC SECURITY DEFINER ejecutables por authenticated que miran membresía sin
-- allowlist de roles. La lista blanca son helpers de sesión o de invitación que
-- no exponen datos de negocio.
create function public.acc_rpc_isolation_gaps()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.proname::text
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
     and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
     and p.prosrc ~* '(user_role_in_tenant|user_tenant_ids|memberships)'
     and p.prosrc !~ '''(owner|cashier|waiter|kitchen|editor|host|accountant)'''
     and p.proname not in ('_check_staff_role', 'accept_invitation', 'set_active_tenant', 'user_role_in_tenant',
                           'user_tenant_ids', 'is_platform_admin', 'get_invitation_preview')
$$;

revoke all on function public.acc_isolation_gaps() from public, anon, authenticated;
revoke all on function public.acc_rpc_isolation_gaps() from public, anon, authenticated;
grant execute on function public.acc_isolation_gaps() to service_role;
grant execute on function public.acc_rpc_isolation_gaps() to service_role;

-- ─── 9. Grants de las funciones internas y de trigger ───────────────────────
-- Los triggers no chequean EXECUTE al dispararse: nadie más las necesita.
revoke all on function private.acc_tg_memberships_role_changed() from public, anon, authenticated;
revoke all on function private.acc_tg_guard_accountant_membership() from public, anon, authenticated;
revoke all on function private.acc_tg_guard_accountant_invitation() from public, anon, authenticated;
revoke all on function private.acc_tg_memberships_access_sync() from public, anon, authenticated;
revoke all on function private.acc_tg_protect_accounting_members() from public, anon, authenticated;

notify pgrst, 'reload schema';
