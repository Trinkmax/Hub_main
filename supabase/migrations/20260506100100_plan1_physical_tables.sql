-- Plan 1: physical_tables — el inventario de mesas físicas con QR rotativo.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.physical_tables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  label       text not null check (length(trim(label)) between 1 and 40),
  capacity    int check (capacity is null or capacity > 0),
  qr_token    text not null default public.generate_qr_token(),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Único por tenant: el qr_token es el path público, no puede colisionar
-- entre tenants ni dentro del mismo tenant.
create unique index physical_tables_qr_token_uidx
  on public.physical_tables(qr_token);
create index physical_tables_tenant_active_idx
  on public.physical_tables(tenant_id, active);

create trigger physical_tables_updated_at before update on public.physical_tables
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.physical_tables enable row level security;

-- SELECT: cualquier miembro del tenant.
create policy "pt_select_member" on public.physical_tables
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE: solo owner.
create policy "pt_owner_insert" on public.physical_tables
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "pt_owner_update" on public.physical_tables
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "pt_owner_delete" on public.physical_tables
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.physical_tables to authenticated;
