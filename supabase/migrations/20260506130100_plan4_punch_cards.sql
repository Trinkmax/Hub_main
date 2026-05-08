-- Plan 4: punch_card_templates + customer_punch_cards
-- Sistema de tarjetas perforadas paralelo a points_balance.

-- ──────────────────────────────────────────────────────────
-- 1. Enum
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'punch_trigger_type') then
    create type public.punch_trigger_type as enum ('item', 'category', 'tag');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. punch_card_templates
-- ──────────────────────────────────────────────────────────
create table public.punch_card_templates (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null check (length(trim(name)) between 1 and 80),
  description          text,
  image_url            text,
  trigger_type         public.punch_trigger_type not null,
  trigger_ref_id       uuid not null,
  threshold            int not null check (threshold > 0),
  reward_id            uuid not null references public.rewards(id) on delete restrict,
  expires_after_days   int check (expires_after_days is null or expires_after_days > 0),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index punch_card_templates_tenant_idx
  on public.punch_card_templates(tenant_id, active);
create index punch_card_templates_trigger_idx
  on public.punch_card_templates(tenant_id, trigger_type, trigger_ref_id);

create trigger punch_card_templates_updated_at before update on public.punch_card_templates
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 3. customer_punch_cards
-- ──────────────────────────────────────────────────────────
create table public.customer_punch_cards (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  customer_id              uuid not null references public.customers(id) on delete cascade,
  template_id              uuid not null references public.punch_card_templates(id) on delete restrict,
  current_stamps           int not null default 0 check (current_stamps >= 0),
  threshold_snapshot       int not null check (threshold_snapshot > 0),
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  expired_at               timestamptz,
  reward_redemption_id     uuid references public.reward_redemptions(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  check (current_stamps <= threshold_snapshot)
);

create unique index customer_punch_cards_active_uidx
  on public.customer_punch_cards(customer_id, template_id)
  where completed_at is null and expired_at is null;
create index customer_punch_cards_customer_idx
  on public.customer_punch_cards(customer_id);
create index customer_punch_cards_template_idx
  on public.customer_punch_cards(template_id);

create trigger customer_punch_cards_updated_at before update on public.customer_punch_cards
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────
alter table public.punch_card_templates enable row level security;
create policy "pct_select_member" on public.punch_card_templates
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "pct_owner_insert" on public.punch_card_templates
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "pct_owner_update" on public.punch_card_templates
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "pct_owner_delete" on public.punch_card_templates
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

alter table public.customer_punch_cards enable row level security;
create policy "cpc_select_member" on public.customer_punch_cards
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- Sin write policies para authenticated. Solo via RPC SECURITY DEFINER.

grant select, insert, update, delete on public.punch_card_templates to authenticated;
grant select on public.customer_punch_cards to authenticated;
