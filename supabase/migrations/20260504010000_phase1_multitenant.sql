-- Phase 1: multi-tenant + auth + invitations
-- Tablas: tenants, memberships, invitations, audit_log, user_active_tenant
-- Hook: custom_access_token_hook para inyectar active_tenant_id en JWT
-- RLS: lock-down basado en memberships + helpers SECURITY DEFINER

create extension if not exists citext;

-- ──────────────────────────────────────────────────────────
-- 1. Trigger reusable de updated_at
-- ──────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

-- ──────────────────────────────────────────────────────────
-- 2. Enums
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tenant_role') then
    create type public.tenant_role as enum ('owner', 'cashier', 'waiter');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 3. Tablas
-- ──────────────────────────────────────────────────────────

-- 3.1 tenants
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$' and slug not in (
    'login', 'auth', 'accept-invite', 'onboarding', 'api', 'capture',
    'admin', '_next', 'static', 'public', 'assets'
  )),
  timezone text not null default 'America/Argentina/Cordoba',
  currency text not null default 'ARS',
  logo_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();

-- 3.2 memberships
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);
create index memberships_tenant_idx on public.memberships(tenant_id);

-- 3.3 invitations
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email citext not null,
  role public.tenant_role not null,
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_pending_unique
  on public.invitations(tenant_id, email)
  where accepted_at is null;
create index invitations_token_idx on public.invitations(token);
create index invitations_email_idx on public.invitations(email) where accepted_at is null;

-- 3.4 audit_log
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_idx on public.audit_log(tenant_id, created_at desc);

-- 3.5 user_active_tenant (helper para JWT claim)
create table public.user_active_tenant (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────
-- 4. SECURITY DEFINER helpers para RLS performante
-- ──────────────────────────────────────────────────────────

create or replace function public.user_tenant_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select tenant_id from public.memberships where user_id = (select auth.uid())
$$;

create or replace function public.user_role_in_tenant(p_tenant uuid)
returns public.tenant_role language sql stable security definer set search_path = ''
as $$
  select role from public.memberships
  where user_id = (select auth.uid()) and tenant_id = p_tenant
$$;

create or replace function public.active_tenant_id() returns uuid
language sql stable as $$
  select nullif(
    (auth.jwt() -> 'app_metadata' ->> 'active_tenant_id'), ''
  )::uuid
$$;

revoke all on function public.user_tenant_ids() from public;
revoke all on function public.user_role_in_tenant(uuid) from public;
revoke all on function public.active_tenant_id() from public;
grant execute on function public.user_tenant_ids(),
  public.user_role_in_tenant(uuid),
  public.active_tenant_id() to authenticated;

-- ──────────────────────────────────────────────────────────
-- 5. RLS
-- ──────────────────────────────────────────────────────────

-- 5.1 tenants
alter table public.tenants enable row level security;
create policy "tenants_select_member" on public.tenants for select to authenticated
  using (id in (select public.user_tenant_ids()));
create policy "tenants_update_owner" on public.tenants for update to authenticated
  using (public.user_role_in_tenant(id) = 'owner')
  with check (public.user_role_in_tenant(id) = 'owner');
-- INSERT solo via create_tenant_with_owner() SECURITY DEFINER. Sin policy.
-- DELETE: nadie en authenticated. Solo service_role.

-- 5.2 memberships
alter table public.memberships enable row level security;
create policy "memberships_select_same_tenant" on public.memberships
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "memberships_owner_insert" on public.memberships for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "memberships_owner_update" on public.memberships for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "memberships_owner_delete" on public.memberships for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 5.3 invitations
alter table public.invitations enable row level security;
create policy "invitations_owner_select" on public.invitations for select to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "invitations_owner_insert" on public.invitations for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "invitations_owner_update" on public.invitations for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "invitations_owner_delete" on public.invitations for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 5.4 audit_log
alter table public.audit_log enable row level security;
create policy "audit_log_owner_select" on public.audit_log for select to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');
-- INSERT solo service_role. Sin policy.

-- 5.5 user_active_tenant
alter table public.user_active_tenant enable row level security;
create policy "user_active_tenant_self_select" on public.user_active_tenant
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_active_tenant_self_modify" on public.user_active_tenant
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ──────────────────────────────────────────────────────────
-- 6. RPC functions de borde (server actions las llaman)
-- ──────────────────────────────────────────────────────────

-- 6.1 create_tenant_with_owner: atómico, bypassea RLS para el primer owner
create or replace function public.create_tenant_with_owner(
  p_name text, p_slug text
) returns public.tenants
language plpgsql security definer set search_path = '' as $$
declare new_tenant public.tenants;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;
  if length(trim(p_name)) = 0 then raise exception 'name_required'; end if;

  insert into public.tenants (name, slug)
  values (trim(p_name), lower(trim(p_slug)))
  returning * into new_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (new_tenant.id, (select auth.uid()), 'owner');

  insert into public.user_active_tenant (user_id, tenant_id)
  values ((select auth.uid()), new_tenant.id)
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();

  return new_tenant;
end; $$;

-- 6.2 accept_invitation: consume token, valida email match, crea membership
create or replace function public.accept_invitation(p_token uuid)
returns public.memberships
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invitations;
  user_email text;
  new_member public.memberships;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  select email into user_email from auth.users where id = (select auth.uid());

  select * into inv from public.invitations
  where token = p_token and accepted_at is null and expires_at > now()
  for update;

  if inv.id is null then raise exception 'invalid_or_expired_token'; end if;
  if lower(inv.email::text) <> lower(user_email) then
    raise exception 'email_mismatch';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (inv.tenant_id, (select auth.uid()), inv.role)
  on conflict (tenant_id, user_id) do update set role = excluded.role
  returning * into new_member;

  update public.invitations set accepted_at = now() where id = inv.id;

  insert into public.user_active_tenant (user_id, tenant_id)
  values ((select auth.uid()), inv.tenant_id)
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();

  return new_member;
end; $$;

-- 6.3 set_active_tenant: validando membership
create or replace function public.set_active_tenant(p_tenant uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated'; end if;

  if not exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and tenant_id = p_tenant
  ) then raise exception 'not_a_member'; end if;

  insert into public.user_active_tenant (user_id, tenant_id)
  values ((select auth.uid()), p_tenant)
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();
end; $$;

-- 6.4 check_slug_available: público para autocompletar form
create or replace function public.check_slug_available(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.tenants where slug = lower(trim(p_slug)));
$$;

-- 6.5 get_invitation_preview: público, expone solo email + tenant name
create or replace function public.get_invitation_preview(p_token uuid)
returns table (email text, role public.tenant_role, tenant_name text, expired boolean)
language sql stable security definer set search_path = '' as $$
  select
    inv.email::text,
    inv.role,
    t.name,
    (inv.expires_at <= now() or inv.accepted_at is not null) as expired
  from public.invitations inv
  join public.tenants t on t.id = inv.tenant_id
  where inv.token = p_token
$$;

revoke all on function public.create_tenant_with_owner(text, text) from public;
revoke all on function public.accept_invitation(uuid) from public;
revoke all on function public.set_active_tenant(uuid) from public;
revoke all on function public.check_slug_available(text) from public;
revoke all on function public.get_invitation_preview(uuid) from public;

grant execute on function public.create_tenant_with_owner(text, text),
  public.accept_invitation(uuid),
  public.set_active_tenant(uuid),
  public.check_slug_available(text) to authenticated;
-- get_invitation_preview también para anon (login con email prefill)
grant execute on function public.get_invitation_preview(uuid) to authenticated, anon;

-- ──────────────────────────────────────────────────────────
-- 7. Custom Access Token Hook
-- ──────────────────────────────────────────────────────────

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb;
  app_meta jsonb;
  active_tid uuid;
  user_uuid uuid := (event ->> 'user_id')::uuid;
begin
  select tenant_id into active_tid
  from public.user_active_tenant
  where user_id = user_uuid;

  if active_tid is null then
    select tenant_id into active_tid
    from public.memberships where user_id = user_uuid
    order by created_at limit 1;
  end if;

  claims := event -> 'claims';
  app_meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);

  if active_tid is not null then
    app_meta := jsonb_set(app_meta, '{active_tenant_id}', to_jsonb(active_tid::text));
  end if;

  claims := jsonb_set(claims, '{app_metadata}', app_meta);
  event := jsonb_set(event, '{claims}', claims);
  return event;
end; $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

grant select on public.user_active_tenant to supabase_auth_admin;
grant select on public.memberships to supabase_auth_admin;

create policy "auth_admin_reads_active_tenant" on public.user_active_tenant
  as permissive for select to supabase_auth_admin using (true);
create policy "auth_admin_reads_memberships" on public.memberships
  as permissive for select to supabase_auth_admin using (true);

-- ──────────────────────────────────────────────────────────
-- 8. Data API GRANTs (CLAUDE.md sec. 5)
-- ──────────────────────────────────────────────────────────

grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.user_active_tenant to authenticated;
