-- ============================================================
-- Cupos por servicio (almuerzo / merienda / cena)
-- ============================================================
-- POR QUÉ: el jueves 10/09 el calendario mostraba "171 de 130" en rojo sin
-- sobrecupo real: 19 al mediodía, 33 en la merienda y 119 en la cena, todo
-- sumado contra PA + PB. El dueño pidió cupo POR SERVICIO, configurable por
-- día de la semana, con aviso opcional (almuerzo lun-vie: aviso en 50,
-- "conviene abrir la terraza") y cupo especial por fecha (terraza abierta,
-- feriados).
--
-- CLAVES: enum meal_type con CHECK a los tres servicios. breakfast cuenta
-- como almuerzo y hub_event como cena en el cálculo, pero ninguno de los dos
-- se configura como servicio propio.
--
-- SEMÁNTICA (la aplica lib/salon/segments.ts, NO esta migración):
--   * sin fila (servicio, día) → cupo general = PA + PB de
--     tenants.settings.salon_capacities; si da 0 → "sin tope".
--   * capacity = 0 → servicio CERRADO ese día.
--   * warn_at NULL → sin aviso propio (queda el ámbar al 90 %).
--   * el cupo especial por fecha gana sobre el semanal y NO hereda warn_at.
--
-- SIN RPC: el cálculo vive en TS puro y lo usan el mes, el día, el form, el
-- operativo y el salón. No duplicarlo en SQL.
--
-- NO VA EN tenants.settings: esa columna la escriben tres actions con
-- read-modify-write sin lock (setZoneCapacityDefaults, capture-prompt,
-- markOnboardingCompleted) y el último que guarda pisa a los otros.
--
-- QUIÉN: SELECT para todo miembro del bar (la anfitriona y los mozos leen el
-- cupo en el form y en el salón). INSERT/UPDATE/DELETE solo owner, igual que
-- salon_zone_capacity_overrides. Van como policies separadas por comando (y
-- no un FOR ALL) para que el SELECT no quede con dos policies permisivas
-- superpuestas.
--
-- LOS VALORES DEL HUB NO VAN ACÁ (CLAUDE.md §12: nada de slugs ni ids). Para
-- local van en supabase/seed.sql; en producción se cargan desde Configuración
-- → Capacidad o con el bloque documentado en el PR.
-- ============================================================

-- 1) Ajustes por servicio: hora sugerida al reservar + nota del aviso
create table if not exists public.salon_segment_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  segment public.meal_type not null,
  default_time time not null,
  warn_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sss_segment_valid check (segment in ('lunch', 'tea_time', 'dinner')),
  constraint sss_warn_note_len check (warn_note is null or char_length(warn_note) between 1 and 80),
  constraint sss_one_per_segment unique (tenant_id, segment)
);
comment on table public.salon_segment_settings is
  'Por servicio (lunch/tea_time/dinner): hora que precarga el alta de reserva y nota que acompaña al aviso de cupo. Sin fila = 13:00 / 15:30 / 21:00 y sin nota.';

-- 2) Cupo por servicio × día de la semana (ISO: 1 = lunes … 7 = domingo)
create table if not exists public.salon_segment_capacities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  segment public.meal_type not null,
  iso_dow smallint not null,
  capacity integer not null,
  warn_at integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ssc_segment_valid check (segment in ('lunch', 'tea_time', 'dinner')),
  constraint ssc_iso_dow_valid check (iso_dow between 1 and 7),
  constraint ssc_capacity_range check (capacity between 0 and 999),
  constraint ssc_warn_at_range check (warn_at is null or (warn_at between 1 and 999 and warn_at <= capacity)),
  constraint ssc_one_per_day unique (tenant_id, segment, iso_dow)
);
comment on table public.salon_segment_capacities is
  'Cupo de personas por servicio y día de la semana. Sin fila = cupo general (PA+PB). capacity 0 = cerrado. warn_at = aviso ámbar (opcional).';
comment on column public.salon_segment_capacities.iso_dow is 'ISO 8601: 1 = lunes … 7 = domingo.';

-- 3) Cupo especial por fecha ("hoy abrimos la terraza", feriados)
create table if not exists public.salon_segment_capacity_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  segment public.meal_type not null,
  override_date date not null,
  capacity integer not null,
  warn_at integer,
  reason text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ssco_segment_valid check (segment in ('lunch', 'tea_time', 'dinner')),
  constraint ssco_capacity_range check (capacity between 0 and 999),
  constraint ssco_warn_at_range check (warn_at is null or (warn_at between 1 and 999 and warn_at <= capacity)),
  constraint ssco_reason_len check (reason is null or char_length(reason) between 1 and 120),
  constraint ssco_one_per_day unique (tenant_id, override_date, segment)
);
comment on table public.salon_segment_capacity_overrides is
  'Cupo especial de un servicio en una fecha. Gana sobre el semanal y NO hereda su warn_at.';
-- Los UNIQUE (tenant_id, …) ya dan el índice por tenant (y por tenant+fecha en overrides).

-- updated_at
drop trigger if exists salon_segment_settings_updated_at on public.salon_segment_settings;
create trigger salon_segment_settings_updated_at before update on public.salon_segment_settings
  for each row execute function public.set_updated_at();
drop trigger if exists salon_segment_capacities_updated_at on public.salon_segment_capacities;
create trigger salon_segment_capacities_updated_at before update on public.salon_segment_capacities
  for each row execute function public.set_updated_at();
drop trigger if exists salon_segment_capacity_overrides_updated_at on public.salon_segment_capacity_overrides;
create trigger salon_segment_capacity_overrides_updated_at before update on public.salon_segment_capacity_overrides
  for each row execute function public.set_updated_at();

-- RLS
alter table public.salon_segment_settings enable row level security;
alter table public.salon_segment_capacities enable row level security;
alter table public.salon_segment_capacity_overrides enable row level security;

-- salon_segment_settings
drop policy if exists "sss_select_member" on public.salon_segment_settings;
create policy "sss_select_member" on public.salon_segment_settings for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
drop policy if exists "sss_owner_insert" on public.salon_segment_settings;
create policy "sss_owner_insert" on public.salon_segment_settings for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "sss_owner_update" on public.salon_segment_settings;
create policy "sss_owner_update" on public.salon_segment_settings for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "sss_owner_delete" on public.salon_segment_settings;
create policy "sss_owner_delete" on public.salon_segment_settings for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- salon_segment_capacities
drop policy if exists "ssc_select_member" on public.salon_segment_capacities;
create policy "ssc_select_member" on public.salon_segment_capacities for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
drop policy if exists "ssc_owner_insert" on public.salon_segment_capacities;
create policy "ssc_owner_insert" on public.salon_segment_capacities for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "ssc_owner_update" on public.salon_segment_capacities;
create policy "ssc_owner_update" on public.salon_segment_capacities for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "ssc_owner_delete" on public.salon_segment_capacities;
create policy "ssc_owner_delete" on public.salon_segment_capacities for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- salon_segment_capacity_overrides
drop policy if exists "ssco_select_member" on public.salon_segment_capacity_overrides;
create policy "ssco_select_member" on public.salon_segment_capacity_overrides for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
drop policy if exists "ssco_owner_insert" on public.salon_segment_capacity_overrides;
create policy "ssco_owner_insert" on public.salon_segment_capacity_overrides for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "ssco_owner_update" on public.salon_segment_capacity_overrides;
create policy "ssco_owner_update" on public.salon_segment_capacity_overrides for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "ssco_owner_delete" on public.salon_segment_capacity_overrides;
create policy "ssco_owner_delete" on public.salon_segment_capacity_overrides for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- Data API GRANT (CLAUDE.md §5) + revoke de los default privileges que el
-- proyecto le da a anon en cada tabla nueva de public.
grant select, insert, update, delete on public.salon_segment_settings to authenticated;
grant select, insert, update, delete on public.salon_segment_capacities to authenticated;
grant select, insert, update, delete on public.salon_segment_capacity_overrides to authenticated;
revoke all on public.salon_segment_settings from anon;
revoke all on public.salon_segment_capacities from anon;
revoke all on public.salon_segment_capacity_overrides from anon;

notify pgrst, 'reload schema';
