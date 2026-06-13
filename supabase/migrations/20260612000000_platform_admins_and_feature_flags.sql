-- Rediseño loyalty-first — Fase 1: superadmins de plataforma + feature flags por tenant.
--
-- platform_admins: allowlist de superadmins POR EMAIL (no por user_id; los admins
--   pueden todavía no haberse registrado, así que no hay auth.users.id al sembrar).
--   La identidad se resuelve contra el claim `email` del JWT (top-level en Supabase Auth).
-- tenants.feature_flags: "panel de visibilidad" por bar. Defaults viven en código
--   (lib/platform/features.ts); en DB solo se guardan overrides. Escritura SOLO por
--   superadmin (policy + trigger guard = defensa en profundidad).

create extension if not exists citext;

-- ──────────────────────────────────────────────────────────
-- 1. platform_admins
-- ──────────────────────────────────────────────────────────
create table public.platform_admins (
  id         uuid primary key default gen_random_uuid(),
  email      citext not null unique,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Allowlist de superadmins de HUB por email. La identidad es el claim email del JWT, no user_id (un admin puede no haberse registrado todavía).';

alter table public.platform_admins enable row level security;

-- ──────────────────────────────────────────────────────────
-- 2. is_platform_admin() — SECURITY DEFINER, lee el email del JWT
-- ──────────────────────────────────────────────────────────
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where lower(pa.email::text) = lower(nullif(auth.jwt() ->> 'email', ''))
  )
$$;

comment on function public.is_platform_admin() is
  'True cuando el email del JWT actual está en platform_admins. Usado por RLS y por los guards del server.';

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- Solo los superadmins pueden leer la allowlist. Sin insert/update/delete para
-- authenticated: alta de admins solo por service_role (seed / script admin),
-- así nadie puede "auto-promoverse" vía Data API.
create policy "platform_admins_select_admin"
  on public.platform_admins for select to authenticated
  using (public.is_platform_admin());

-- ──────────────────────────────────────────────────────────
-- 3. tenants.feature_flags + policies de superadmin + trigger guard
-- ──────────────────────────────────────────────────────────
alter table public.tenants
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

comment on column public.tenants.feature_flags is
  'Feature flags por tenant (panel de visibilidad). Defaults en código (lib/platform/features.ts); solo overrides en DB. Escribible solo por superadmins.';

-- Un superadmin puede leer y actualizar CUALQUIER tenant (cross-tenant by design,
-- necesario para el panel /admin). Aditivo a tenants_select_member / tenants_update_owner.
create policy "tenants_select_platform_admin"
  on public.tenants for select to authenticated
  using (public.is_platform_admin());

create policy "tenants_update_platform_admin"
  on public.tenants for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Aunque un owner pueda UPDATE tenants (name/logo/settings), NO puede tocar
-- feature_flags: el trigger bloquea cualquier cambio de esa columna si quien
-- escribe no es superadmin. Cierra el hueco de PostgREST directo.
create or replace function public.guard_feature_flags_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.feature_flags is distinct from old.feature_flags
     and not public.is_platform_admin() then
    raise exception 'feature_flags solo puede modificarlo un superadmin de plataforma';
  end if;
  return new;
end;
$$;

create trigger trg_guard_feature_flags
  before update on public.tenants
  for each row execute function public.guard_feature_flags_write();

-- ──────────────────────────────────────────────────────────
-- 4. Data API GRANTs (CLAUDE.md sec. 5)
-- ──────────────────────────────────────────────────────────
grant select on public.platform_admins to authenticated;
-- tenants ya tiene grants desde phase1; feature_flags hereda el grant de tabla.

-- ──────────────────────────────────────────────────────────
-- 5. Seed de superadmins (idempotente)
-- ──────────────────────────────────────────────────────────
insert into public.platform_admins (email, note) values
  ('admin@hub.com',            'seed superadmin'),
  ('tolosaagustin4@gmail.com', 'seed superadmin')
on conflict (email) do nothing;
