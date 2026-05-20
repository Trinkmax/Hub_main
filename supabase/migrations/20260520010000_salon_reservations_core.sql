-- ============================================================
-- Reservas de salón + Gestores + Eventos programados + Comisiones
-- ============================================================
-- Multi-tenant. Toda mutación va por RLS o por RPC SECURITY DEFINER.
-- Ver §2 del plan en /tmp/plan_full.md (BACKLOG-feature-reservas).

-- Extensión para exclusion constraint sobre rangos enteros (rate tiers no overlap).
create extension if not exists btree_gist;

-- ──────────────────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'reservation_kind') then
    create type public.reservation_kind as enum ('normal', 'birthday', 'special');
  end if;

  if not exists (select 1 from pg_type where typname = 'meal_type') then
    create type public.meal_type as enum ('breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event');
  end if;

  if not exists (select 1 from pg_type where typname = 'reservation_origin') then
    create type public.reservation_origin as enum (
      'whatsapp', 'instagram', 'messenger', 'in_person', 'partner_referral'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'salon_zone') then
    create type public.salon_zone as enum (
      'planta_alta', 'planta_baja', 'event_floating'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'salon_reservation_status') then
    create type public.salon_reservation_status as enum (
      'pending', 'arrived', 'seated', 'closed', 'no_show', 'cancelled'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- reservation_managers — staff con flag opcional commission_eligible
-- ──────────────────────────────────────────────────────────
create table public.reservation_managers (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,
  display_name          text not null check (length(trim(display_name)) between 1 and 80),
  phone                 text,
  email                 citext,
  commission_eligible   boolean not null default false,
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, display_name)
);
create index reservation_managers_tenant_active_idx
  on public.reservation_managers(tenant_id, active);
create index reservation_managers_tenant_commission_idx
  on public.reservation_managers(tenant_id, commission_eligible) where active;
create trigger reservation_managers_updated_at before update on public.reservation_managers
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- scheduled_event_templates — plantillas reusables (Sushi Libre, Pizza Libre…)
-- ──────────────────────────────────────────────────────────
create table public.scheduled_event_templates (
  id                              uuid primary key default gen_random_uuid(),
  tenant_id                       uuid not null references public.tenants(id) on delete cascade,
  name                            text not null check (length(trim(name)) between 1 and 80),
  slug                            text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  consume_special_reservations    boolean not null default true,
  default_capacity                int check (default_capacity is null or default_capacity > 0),
  default_meal_type               public.meal_type not null default 'dinner',
  color_hex                       text not null default '#7c3aed'
                                    check (color_hex ~ '^#[0-9a-fA-F]{6}$'),
  active                          boolean not null default true,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index scheduled_event_templates_tenant_active_idx
  on public.scheduled_event_templates(tenant_id, active);
create trigger scheduled_event_templates_updated_at before update on public.scheduled_event_templates
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- scheduled_events — instancia calendizada (un día puntual)
-- ──────────────────────────────────────────────────────────
create table public.scheduled_events (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  template_id         uuid not null references public.scheduled_event_templates(id) on delete restrict,
  name_override       text,
  event_date          date not null,
  starts_at_local     time not null,
  ends_at_local       time,
  capacity            int not null check (capacity > 0),
  meal_type           public.meal_type not null,
  full_bonus_active   boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, template_id, event_date)
);
create index scheduled_events_tenant_date_idx
  on public.scheduled_events(tenant_id, event_date desc);
create index scheduled_events_template_date_idx
  on public.scheduled_events(template_id, event_date desc);
create trigger scheduled_events_updated_at before update on public.scheduled_events
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- salon_zone_capacity_overrides — override puntual por fecha+zona
-- ──────────────────────────────────────────────────────────
-- El default vive en tenants.settings->>'salon_capacities' (jsonb).
create table public.salon_zone_capacity_overrides (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  zone                public.salon_zone not null,
  override_date       date not null,
  capacity            int not null check (capacity >= 0),
  reason              text,
  created_at          timestamptz not null default now(),
  unique (tenant_id, zone, override_date)
);
create index salon_zone_capacity_overrides_tenant_date_idx
  on public.salon_zone_capacity_overrides(tenant_id, override_date desc);

-- ──────────────────────────────────────────────────────────
-- salon_reservations — la tabla del Google Form
-- ──────────────────────────────────────────────────────────
create table public.salon_reservations (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,

  -- Identidad del cliente: link a customers o snapshot (lo que tenga el gestor en ese momento).
  customer_id                 uuid references public.customers(id) on delete set null,
  guest_name                  text not null check (length(trim(guest_name)) between 1 and 120),
  guest_phone                 text,
  guest_email                 citext,

  -- Negocio
  kind                        public.reservation_kind not null default 'normal',
  meal_type                   public.meal_type not null,
  reservation_date            date not null,
  reservation_time_local      time not null,
  zone                        public.salon_zone not null,
  scheduled_event_id          uuid references public.scheduled_events(id) on delete set null,

  estimated_guests            int not null check (estimated_guests between 1 and 99),
  actual_guests               int check (actual_guests is null or actual_guests between 1 and 99),

  cake_count                  int not null default 0 check (cake_count between 0 and 2),
  champagne_count             int not null default 0 check (champagne_count between 0 and 2),

  deposit_cents               bigint not null default 0 check (deposit_cents >= 0),
  origin                      public.reservation_origin not null default 'whatsapp',

  primary_manager_id          uuid not null references public.reservation_managers(id) on delete restrict,
  assistant_manager_id        uuid references public.reservation_managers(id) on delete set null,

  comments                    text,
  status                      public.salon_reservation_status not null default 'pending',

  -- Timestamps operativos del panel:
  arrived_at                  timestamptz,
  seated_at                   timestamptz,
  closed_at                   timestamptz,
  cancelled_at                timestamptz,
  cancelled_reason            text,

  arrived_by                  uuid references auth.users(id) on delete set null,
  seated_by                   uuid references auth.users(id) on delete set null,
  closed_by                   uuid references auth.users(id) on delete set null,
  created_by                  uuid references auth.users(id) on delete set null,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- Constraints semánticos
  constraint salon_reservations_event_floating_requires_event
    check ((zone <> 'event_floating') or (scheduled_event_id is not null)),
  constraint salon_reservations_assistant_not_primary
    check (assistant_manager_id is null or assistant_manager_id <> primary_manager_id)
);
create index salon_reservations_tenant_date_idx
  on public.salon_reservations(tenant_id, reservation_date desc, reservation_time_local);
create index salon_reservations_tenant_zone_date_idx
  on public.salon_reservations(tenant_id, zone, reservation_date);
create index salon_reservations_scheduled_event_idx
  on public.salon_reservations(scheduled_event_id)
  where scheduled_event_id is not null;
create index salon_reservations_tenant_status_today_idx
  on public.salon_reservations(tenant_id, status, reservation_date)
  where status in ('pending', 'arrived', 'seated');
create index salon_reservations_primary_mgr_date_idx
  on public.salon_reservations(primary_manager_id, reservation_date desc);
create index salon_reservations_assistant_mgr_date_idx
  on public.salon_reservations(assistant_manager_id, reservation_date desc)
  where assistant_manager_id is not null;
create index salon_reservations_customer_idx
  on public.salon_reservations(customer_id) where customer_id is not null;
create trigger salon_reservations_updated_at before update on public.salon_reservations
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- commission_rate_tiers — tarifas configurables por tenant
-- ──────────────────────────────────────────────────────────
create table public.commission_rate_tiers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  meal_type           public.meal_type not null,
  min_guests          int not null check (min_guests >= 1),
  max_guests          int check (max_guests is null or max_guests >= min_guests),
  rate_per_guest_cents bigint not null check (rate_per_guest_cents >= 0),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- No-overlap por (tenant, meal_type) entre tiers activos.
alter table public.commission_rate_tiers
  add constraint commission_rate_tiers_no_overlap
  exclude using gist (
    tenant_id with =,
    meal_type with =,
    int4range(min_guests, coalesce(max_guests + 1, 2147483647), '[)') with &&
  ) where (active);
create index commission_rate_tiers_lookup_idx
  on public.commission_rate_tiers(tenant_id, meal_type, min_guests);
create trigger commission_rate_tiers_updated_at before update on public.commission_rate_tiers
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- commission_bonus_rules — bonus por capacity llena (configurable)
-- ──────────────────────────────────────────────────────────
create table public.commission_bonus_rules (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  scope                       text not null check (scope in ('scheduled_event_full')),
  bonus_per_guest_cents       bigint not null check (bonus_per_guest_cents >= 0),
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, scope)
);
create trigger commission_bonus_rules_updated_at before update on public.commission_bonus_rules
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- commission_ledger — snapshot de comisión por reserva × gestor
-- ──────────────────────────────────────────────────────────
-- Una reserva 'closed' (o con servicio efectivo) produce 1..2 entries:
--   - 1 si solo primario es eligible (o solo asistente)
--   - 2 si ambos son eligibles (split 50/50)
--   - 0 si ninguno es eligible
-- Entries con paid_at != null son inmutables (no se borran al recalcular).
create table public.commission_ledger (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  reservation_id              uuid not null references public.salon_reservations(id) on delete cascade,
  manager_id                  uuid not null references public.reservation_managers(id) on delete restrict,
  meal_type                   public.meal_type not null,
  guests_billed               int not null check (guests_billed > 0),
  base_rate_per_guest_cents   bigint not null check (base_rate_per_guest_cents >= 0),
  base_total_cents            bigint not null check (base_total_cents >= 0),
  bonus_per_guest_cents       bigint not null default 0 check (bonus_per_guest_cents >= 0),
  bonus_total_cents           bigint not null default 0 check (bonus_total_cents >= 0),
  split_factor_numerator      int not null default 1 check (split_factor_numerator > 0),
  split_factor_denominator    int not null default 1 check (split_factor_denominator > 0),
  payable_cents               bigint not null check (payable_cents >= 0),
  calculation_version         int not null default 1,
  calculated_at               timestamptz not null default now(),
  paid_at                     timestamptz,
  paid_payout_id              uuid,
  unique (reservation_id, manager_id)
);
create index commission_ledger_tenant_mgr_idx
  on public.commission_ledger(tenant_id, manager_id, calculated_at desc);
create index commission_ledger_tenant_unpaid_idx
  on public.commission_ledger(tenant_id, manager_id) where paid_at is null;
create index commission_ledger_reservation_idx
  on public.commission_ledger(reservation_id);

-- ──────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────
alter table public.reservation_managers           enable row level security;
alter table public.scheduled_event_templates      enable row level security;
alter table public.scheduled_events               enable row level security;
alter table public.salon_zone_capacity_overrides  enable row level security;
alter table public.salon_reservations             enable row level security;
alter table public.commission_rate_tiers          enable row level security;
alter table public.commission_bonus_rules         enable row level security;
alter table public.commission_ledger              enable row level security;

-- reservation_managers: solo owner edita; cashier/waiter ven.
create policy "rm_select_member" on public.reservation_managers for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "rm_owner_write" on public.reservation_managers for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- scheduled_event_templates: solo owner edita.
create policy "set_select_member" on public.scheduled_event_templates for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "set_owner_write" on public.scheduled_event_templates for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- scheduled_events: owner+cashier escriben (calendario operativo).
create policy "sev_select_member" on public.scheduled_events for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "sev_staff_write" on public.scheduled_events for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner','cashier'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','cashier'));

-- salon_zone_capacity_overrides: solo owner.
create policy "szc_select_member" on public.salon_zone_capacity_overrides for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "szc_owner_write" on public.salon_zone_capacity_overrides for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- salon_reservations: SELECT a todos; INSERT/UPDATE a owner+cashier directo;
-- waiter solo a través de RPCs SECURITY DEFINER (transition_reservation_status).
create policy "sr_select_member" on public.salon_reservations for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "sr_staff_write" on public.salon_reservations for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner','cashier'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','cashier'));

-- commission_rate_tiers / bonus_rules: solo owner edita; cashier ve.
create policy "crt_select_member" on public.commission_rate_tiers for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "crt_owner_write" on public.commission_rate_tiers for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "cbr_select_member" on public.commission_bonus_rules for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "cbr_owner_write" on public.commission_bonus_rules for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- commission_ledger: SELECT solo owner (info de plata). INSERT/UPDATE solo via
-- RPC SECURITY DEFINER (recalc_reservation_commission) o service_role (cron).
create policy "cl_owner_select" on public.commission_ledger for select to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- GRANTs Data API (CLAUDE.md §5 — cambio 30/05/2026)
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.reservation_managers          to authenticated;
grant select, insert, update, delete on public.scheduled_event_templates     to authenticated;
grant select, insert, update, delete on public.scheduled_events              to authenticated;
grant select, insert, update, delete on public.salon_zone_capacity_overrides to authenticated;
grant select, insert, update, delete on public.salon_reservations            to authenticated;
grant select, insert, update, delete on public.commission_rate_tiers         to authenticated;
grant select, insert, update, delete on public.commission_bonus_rules        to authenticated;
grant select on public.commission_ledger to authenticated;
