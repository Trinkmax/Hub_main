-- Plan 2: tickets y ticket_items.

-- ──────────────────────────────────────────────────────────
-- 1. tickets
-- ──────────────────────────────────────────────────────────
create table public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  session_id            uuid not null references public.table_sessions(id) on delete cascade,
  status                public.ticket_status not null default 'pending',
  created_by_guest_id   uuid references public.session_guests(id) on delete set null,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  submitted_at          timestamptz not null default now(),
  accepted_at           timestamptz,
  accepted_by_user_id   uuid references auth.users(id) on delete set null,
  prepared_at           timestamptz,
  served_at             timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  total_cents           bigint not null default 0 check (total_cents >= 0),
  idempotency_key       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (
    (created_by_guest_id is not null and created_by_user_id is null) or
    (created_by_guest_id is null and created_by_user_id is not null)
  )
);

create unique index tickets_idempotency_uidx
  on public.tickets(session_id, idempotency_key)
  where idempotency_key is not null;
create index tickets_session_idx
  on public.tickets(session_id, submitted_at desc);
create index tickets_tenant_pending_idx
  on public.tickets(tenant_id, status, submitted_at)
  where status in ('pending', 'accepted', 'preparing', 'ready');

create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 2. ticket_items
-- ──────────────────────────────────────────────────────────
create table public.ticket_items (
  id                      uuid primary key default gen_random_uuid(),
  ticket_id               uuid not null references public.tickets(id) on delete cascade,
  menu_item_id            uuid not null references public.menu_items(id) on delete restrict,
  quantity                int not null check (quantity > 0),
  unit_price_cents        bigint not null check (unit_price_cents >= 0),
  line_total_cents        bigint not null check (line_total_cents >= 0),
  assigned_to_guest_id    uuid references public.session_guests(id) on delete set null,
  notes                   text,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz not null default now()
);

create index ticket_items_ticket_idx on public.ticket_items(ticket_id);
create index ticket_items_assigned_idx
  on public.ticket_items(assigned_to_guest_id)
  where assigned_to_guest_id is not null;
create index ticket_items_menu_item_idx on public.ticket_items(menu_item_id);

-- ──────────────────────────────────────────────────────────
-- 3. Trigger: mantener total_cents en table_sessions y tickets
-- ──────────────────────────────────────────────────────────
create or replace function public.recalc_ticket_total()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_ticket_id uuid;
  v_session_id uuid;
  v_ticket_total bigint;
  v_session_total bigint;
begin
  v_ticket_id := coalesce(new.ticket_id, old.ticket_id);

  -- Recalcular total del ticket (suma de líneas no canceladas)
  select coalesce(sum(line_total_cents), 0) into v_ticket_total
    from public.ticket_items
    where ticket_id = v_ticket_id and cancelled_at is null;
  update public.tickets
    set total_cents = v_ticket_total, updated_at = now()
    where id = v_ticket_id
    returning session_id into v_session_id;

  -- Recalcular total de la sesión (suma de tickets no cancelados)
  if v_session_id is not null then
    select coalesce(sum(total_cents), 0) into v_session_total
      from public.tickets
      where session_id = v_session_id and status <> 'cancelled';
    update public.table_sessions
      set total_cents = v_session_total, updated_at = now()
      where id = v_session_id;
  end if;

  return coalesce(new, old);
end $$;

create trigger ticket_items_recalc_total
  after insert or update or delete on public.ticket_items
  for each row execute function public.recalc_ticket_total();

-- También recalcular cuando un ticket cambia de estado (cancelled afecta total sesión)
create or replace function public.recalc_session_on_ticket_status()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_session_total bigint;
begin
  if new.status is distinct from old.status and (
    new.status = 'cancelled' or old.status = 'cancelled'
  ) then
    select coalesce(sum(total_cents), 0) into v_session_total
      from public.tickets
      where session_id = new.session_id and status <> 'cancelled';
    update public.table_sessions
      set total_cents = v_session_total, updated_at = now()
      where id = new.session_id;
  end if;
  return new;
end $$;

create trigger tickets_recalc_session_total
  after update on public.tickets
  for each row execute function public.recalc_session_on_ticket_status();

-- ──────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────
alter table public.tickets enable row level security;
create policy "tk_select_member" on public.tickets
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- Sin policies de write para authenticated. Solo via RPC SECURITY DEFINER.

alter table public.ticket_items enable row level security;
create policy "ti_select_member" on public.ticket_items
  for select to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and t.tenant_id in (select public.user_tenant_ids())
    )
  );

-- ──────────────────────────────────────────────────────────
-- 5. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.tickets to authenticated;
grant select on public.ticket_items to authenticated;
