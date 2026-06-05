-- ============================================================
-- Floor plan editor — Migración A (DDL)
-- ============================================================
-- Editor visual de plano de mesas para el dueño (manager).
-- Dos tablas nuevas:
--   - floor_plan_areas:    áreas/pisos configurables por tenant.
--   - floor_plan_elements: mesas + decoración posicionadas en el canvas.
-- physical_tables queda INTACTO (no se le agregan columnas).
--
-- Idempotente bajo Supabase MCP apply_migration (sin Docker local):
--   * enums con guarda do $$ if not exists (pg_type) ... end $$
--   * create table / index if not exists
--   * create or replace function para el trigger de integridad
--   * drop trigger if exists antes de cada create trigger (Postgres no
--     soporta create trigger if not exists en esta versión)
--   * seed con on conflict (tenant_id, lower(trim(name))) do nothing
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Enums (guardados)
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'floor_element_kind') then
    create type public.floor_element_kind  as enum ('table', 'wall', 'pillar', 'island', 'bar');
  end if;
  if not exists (select 1 from pg_type where typname = 'floor_element_shape') then
    create type public.floor_element_shape as enum ('rect', 'circle');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. floor_plan_areas — áreas/pisos configurables
-- ──────────────────────────────────────────────────────────
create table if not exists public.floor_plan_areas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 40),
  position      int  not null default 0,
  width         int  not null default 1200 check (width  between 200 and 6000),
  height        int  not null default 800  check (height between 200 and 6000),
  number_start  int  not null default 1 check (number_start between 0 and 100000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- unicidad por tenant (backing del on conflict del seed; evita áreas duplicadas)
create unique index if not exists floor_plan_areas_tenant_name_uidx
  on public.floor_plan_areas (tenant_id, lower(trim(name)));
create index if not exists floor_plan_areas_tenant_pos_idx
  on public.floor_plan_areas (tenant_id, position);

-- ──────────────────────────────────────────────────────────
-- 3. floor_plan_elements — todo lo que vive en el canvas
-- ──────────────────────────────────────────────────────────
create table if not exists public.floor_plan_elements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  area_id           uuid not null references public.floor_plan_areas(id) on delete cascade,
  kind              public.floor_element_kind  not null,
  shape             public.floor_element_shape not null default 'rect',
  physical_table_id uuid references public.physical_tables(id) on delete cascade, -- solo kind='table'
  x                 int  not null default 0   check (x between -10000 and 10000),
  y                 int  not null default 0   check (y between -10000 and 10000),
  width             int  not null default 80  check (width  between 8 and 6000),
  height            int  not null default 80  check (height between 8 and 6000),
  rotation          int  not null default 0,   -- reservado v2; siempre 0 en v1
  z_index           int  not null default 0,
  label             text check (label is null or length(label) <= 40),
  color             text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),  -- 6 dígitos
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fpe_table_has_pt check (
    (kind = 'table' and physical_table_id is not null) or
    (kind <> 'table' and physical_table_id is null)
  )
);

-- 1 mesa ⇒ a lo sumo 1 elemento (backing del anti-join de la bandeja)
create unique index if not exists floor_plan_elements_pt_uidx
  on public.floor_plan_elements (physical_table_id)
  where physical_table_id is not null;
create index if not exists floor_plan_elements_area_idx
  on public.floor_plan_elements (area_id);
create index if not exists floor_plan_elements_tenant_idx
  on public.floor_plan_elements (tenant_id);

-- ──────────────────────────────────────────────────────────
-- 4. Trigger de integridad (BEFORE INSERT/UPDATE)
-- ──────────────────────────────────────────────────────────
-- Valida tenant_id consistente entre elemento, área y (si mesa) physical_table,
-- y que la mesa referenciada esté activa. RLS solo verifica que el caller sea
-- owner de element.tenant_id; este trigger cierra cross-tenant y mesa-inactiva.
-- security definer + search_path = '' (LEY §6.1); identificadores schema-qualified.
create or replace function public.fp_elements_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_area_tenant uuid;
  v_pt_tenant   uuid;
  v_pt_active   boolean;
begin
  select tenant_id into v_area_tenant
    from public.floor_plan_areas where id = new.area_id;
  if v_area_tenant is null or v_area_tenant <> new.tenant_id then
    raise exception 'fp_tenant_mismatch_area' using errcode = '42501';
  end if;

  if new.kind = 'table' then
    select tenant_id, active into v_pt_tenant, v_pt_active
      from public.physical_tables where id = new.physical_table_id;
    if v_pt_tenant is null or v_pt_tenant <> new.tenant_id then
      raise exception 'fp_tenant_mismatch_table' using errcode = '42501';
    end if;
    if v_pt_active is not true then
      raise exception 'fp_table_inactive' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists fp_elements_integrity_biu on public.floor_plan_elements;
create trigger fp_elements_integrity_biu
  before insert or update on public.floor_plan_elements
  for each row execute function public.fp_elements_integrity();

-- Trigger functions are not callable via REST API; revoke anon execute
-- to avoid the anon_security_definer advisory (same as RPC pattern).
revoke execute on function public.fp_elements_integrity() from anon;
revoke execute on function public.fp_elements_integrity() from public;

-- updated_at en ambas tablas (función public.set_updated_at() existente)
drop trigger if exists floor_plan_areas_updated_at on public.floor_plan_areas;
create trigger floor_plan_areas_updated_at
  before update on public.floor_plan_areas
  for each row execute function public.set_updated_at();

drop trigger if exists floor_plan_elements_updated_at on public.floor_plan_elements;
create trigger floor_plan_elements_updated_at
  before update on public.floor_plan_elements
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 5. RLS + GRANTs
-- ──────────────────────────────────────────────────────────
alter table public.floor_plan_areas    enable row level security;
alter table public.floor_plan_elements enable row level security;

-- SELECT: cualquier miembro del tenant (la vista operativa de entrega 2 lo
-- consume; en v1 el editor es owner-only por guarda de ruta/acción).
drop policy if exists "fpa_select_member" on public.floor_plan_areas;
create policy "fpa_select_member" on public.floor_plan_areas
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

drop policy if exists "fpe_select_member" on public.floor_plan_elements;
create policy "fpe_select_member" on public.floor_plan_elements
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE: solo owner (idéntico a pt_owner_*).
drop policy if exists "fpa_owner_insert" on public.floor_plan_areas;
create policy "fpa_owner_insert" on public.floor_plan_areas
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpa_owner_update" on public.floor_plan_areas;
create policy "fpa_owner_update" on public.floor_plan_areas
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpa_owner_delete" on public.floor_plan_areas;
create policy "fpa_owner_delete" on public.floor_plan_areas
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpe_owner_insert" on public.floor_plan_elements;
create policy "fpe_owner_insert" on public.floor_plan_elements
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpe_owner_update" on public.floor_plan_elements;
create policy "fpe_owner_update" on public.floor_plan_elements
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpe_owner_delete" on public.floor_plan_elements;
create policy "fpe_owner_delete" on public.floor_plan_elements
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- LEY §5: sin GRANT, las tablas son invisibles para supabase-js. RLS sigue
-- siendo la única defensa de filas. Sin grant a anon (el editor es owner-only).
grant select, insert, update, delete on public.floor_plan_areas    to authenticated;
grant select, insert, update, delete on public.floor_plan_elements to authenticated;

-- ──────────────────────────────────────────────────────────
-- 6. Seed HUB (idempotente, solo-HUB — conveniencia demo)
-- ──────────────────────────────────────────────────────────
-- Todo tenant nuevo no-HUB arranca SIN áreas → empty-state + CTA crear primera.
do $seed$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'hub';
  if v_tenant is not null then
    insert into public.floor_plan_areas (tenant_id, name, position, number_start)
    values
      (v_tenant, 'Planta Baja', 0, 1),
      (v_tenant, 'Planta Alta', 1, 101)
    on conflict (tenant_id, lower(trim(name))) do nothing;
  end if;
end $seed$;
