-- ============================================================
-- Migración: Extensiones de menú (featured) + Welcome reward
-- ============================================================
-- Agrega:
--   1) menu_items.featured (destacados del bar)
--   2) welcome_reward_configs (1 fila por tenant — config del incentivo)
--   3) welcome_reward_grants (ledger one-shot por customer)
-- Sigue patrones de RLS del CLAUDE.md (LEY multi-tenant §4):
--   - tenant_id en toda tabla de negocio
--   - RLS habilitada + policies usando user_tenant_ids() / user_role_in_tenant()
--   - GRANTs explícitos al final (cambio Data API 30/05/2026)

-- ──────────────────────────────────────────────────────────
-- 1. menu_items.featured + índice partial
-- ──────────────────────────────────────────────────────────
alter table public.menu_items
  add column if not exists featured boolean not null default false;

create index if not exists menu_items_featured_idx
  on public.menu_items(tenant_id, featured)
  where featured = true;

-- ──────────────────────────────────────────────────────────
-- 2. Relajar CHECK de reward_redemptions.points_spent
-- ──────────────────────────────────────────────────────────
-- El welcome reward inserta una redención con points_spent = 0 (es un regalo,
-- no un canje por puntos). El CHECK original exige > 0 y bloquearía el RPC.
-- Se reemplaza por >= 0 manteniendo no-negatividad.
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
    from pg_constraint
    where conrelid = 'public.reward_redemptions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%points_spent%>%0%'
      and pg_get_constraintdef(oid) not ilike '%>=%';
  if v_constraint is not null then
    execute format(
      'alter table public.reward_redemptions drop constraint %I',
      v_constraint
    );
  end if;
end $$;

alter table public.reward_redemptions
  drop constraint if exists reward_redemptions_points_spent_nonneg;

alter table public.reward_redemptions
  add constraint reward_redemptions_points_spent_nonneg
  check (points_spent >= 0);

-- ──────────────────────────────────────────────────────────
-- 3. welcome_reward_configs (1 fila por tenant)
-- ──────────────────────────────────────────────────────────
-- PK = tenant_id garantiza unicidad (1 config por tenant).
-- reward_id nullable + on delete set null: si el dueño borra la recompensa,
-- la config queda con enabled=true pero reward_id=null y el RPC simplemente
-- no entrega nada (sin romper el flujo de registro).
create table if not exists public.welcome_reward_configs (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  enabled     boolean not null default false,
  reward_id   uuid references public.rewards(id) on delete set null,
  headline    text not null default 'Regalo de bienvenida'
              check (length(trim(headline)) between 1 and 80),
  subtext     text not null default 'Registrate y llevátelo gratis'
              check (length(trim(subtext)) between 1 and 160),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- Trigger updated_at (idem patrón del resto del schema)
drop trigger if exists welcome_reward_configs_updated_at on public.welcome_reward_configs;
create trigger welcome_reward_configs_updated_at
  before update on public.welcome_reward_configs
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 4. welcome_reward_grants (ledger one-shot por customer)
-- ──────────────────────────────────────────────────────────
-- unique(customer_id) garantiza que un cliente recibe el welcome reward
-- exactamente una vez en su vida — aún si el dueño cambia la recompensa,
-- aún si el cliente vuelve a otra mesa, aún si re-registra el mismo phone.
-- reward_id y redemption_id: on delete restrict — preservar trazabilidad.
create table if not exists public.welcome_reward_grants (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,
  reward_id     uuid not null references public.rewards(id) on delete restrict,
  redemption_id uuid not null references public.reward_redemptions(id) on delete restrict,
  granted_at    timestamptz not null default now(),
  unique (customer_id)
);

create index if not exists welcome_reward_grants_tenant_idx
  on public.welcome_reward_grants(tenant_id, granted_at desc);
create index if not exists welcome_reward_grants_reward_idx
  on public.welcome_reward_grants(reward_id);
create index if not exists welcome_reward_grants_redemption_idx
  on public.welcome_reward_grants(redemption_id);

-- ──────────────────────────────────────────────────────────
-- 5. RLS — welcome_reward_configs
-- ──────────────────────────────────────────────────────────
-- SELECT: cualquier miembro del tenant (cashier/waiter pueden ver el header,
--   incluso si no lo editan, p. ej. para previews en el cliente).
-- INSERT/UPDATE/DELETE: solo owner del tenant.
alter table public.welcome_reward_configs enable row level security;

drop policy if exists "wrc_select_member" on public.welcome_reward_configs;
create policy "wrc_select_member" on public.welcome_reward_configs
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

drop policy if exists "wrc_owner_insert" on public.welcome_reward_configs;
create policy "wrc_owner_insert" on public.welcome_reward_configs
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "wrc_owner_update" on public.welcome_reward_configs;
create policy "wrc_owner_update" on public.welcome_reward_configs
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "wrc_owner_delete" on public.welcome_reward_configs;
create policy "wrc_owner_delete" on public.welcome_reward_configs
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- 6. RLS — welcome_reward_grants
-- ──────────────────────────────────────────────────────────
-- Read-only para authenticated (auditoría). Los inserts vienen exclusivamente
-- del RPC register_customer_for_session que corre como SECURITY DEFINER (bypass
-- de RLS). No se otorgan policies de INSERT/UPDATE/DELETE → deny por default.
alter table public.welcome_reward_grants enable row level security;

drop policy if exists "wrg_select_member" on public.welcome_reward_grants;
create policy "wrg_select_member" on public.welcome_reward_grants
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- ──────────────────────────────────────────────────────────
-- 7. GRANTs Data API (CLAUDE.md §5 — obligatorio post 30/05/2026)
-- ──────────────────────────────────────────────────────────
-- welcome_reward_configs: CRUD para authenticated (RLS filtra por owner).
-- welcome_reward_grants: solo SELECT para authenticated (inserts vía RPC).
grant select, insert, update, delete on public.welcome_reward_configs to authenticated;
grant select on public.welcome_reward_grants to authenticated;
