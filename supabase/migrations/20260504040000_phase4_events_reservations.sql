-- Phase 4: events + reservations
-- Tablas: events, reservations
-- RPCs: create_reservation, cancel_reservation, check_in_reservation,
--       finish_past_events (cron-only)
-- Concurrencia: pg_advisory_xact_lock por evento en RPCs que tocan cupo.

-- ──────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'event_status') then
    create type public.event_status as enum ('draft', 'published', 'finished', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'reservation_status') then
    create type public.reservation_status as enum (
      'confirmed', 'waitlist', 'cancelled', 'checked_in', 'no_show'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. events
-- ──────────────────────────────────────────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int check (capacity is null or capacity > 0),
  waitlist_enabled boolean not null default true,
  status public.event_status not null default 'draft',
  cover_image_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index events_tenant_starts_idx on public.events(tenant_id, starts_at desc);
create index events_tenant_status_idx on public.events(tenant_id, status, starts_at);
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 3. reservations
-- ──────────────────────────────────────────────────────────
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  guests_count int not null default 1 check (guests_count between 1 and 99),
  status public.reservation_status not null default 'confirmed',
  waitlist_position int check (waitlist_position is null or waitlist_position > 0),
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index reservations_event_customer_uidx
  on public.reservations(event_id, customer_id)
  where status <> 'cancelled';
create index reservations_event_status_idx
  on public.reservations(event_id, status);
create index reservations_event_waitlist_idx
  on public.reservations(event_id, waitlist_position)
  where status = 'waitlist';
create index reservations_tenant_idx on public.reservations(tenant_id);
create trigger reservations_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 4. Helper: event_lock_key (estable por event_id)
-- ──────────────────────────────────────────────────────────
create or replace function public.event_lock_key(p_event_id uuid)
returns bigint language sql immutable as $$
  select ('x' || substr(md5('event:' || p_event_id::text), 1, 16))::bit(64)::bigint
$$;

-- ──────────────────────────────────────────────────────────
-- 5. RPC create_reservation
-- ──────────────────────────────────────────────────────────
create or replace function public.create_reservation(
  p_event_id uuid,
  p_customer_id uuid,
  p_guests int default 1
) returns table(reservation_id uuid, status public.reservation_status, waitlist_position int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_role public.tenant_role;
  v_confirmed_seats int;
  v_max_wait int;
  v_status public.reservation_status;
  v_pos int;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  -- Lock por evento ANTES de mirar/contar cupos.
  perform pg_advisory_xact_lock(public.event_lock_key(p_event_id));

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'event_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_event.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  -- Cliente debe ser del mismo tenant y no estar archivado.
  if not exists (
    select 1 from public.customers
    where id = p_customer_id and tenant_id = v_event.tenant_id and deleted_at is null
  ) then raise exception 'customer_invalid' using errcode = 'P0001'; end if;

  if v_event.status not in ('published') then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;

  if p_guests is null or p_guests < 1 or p_guests > 99 then
    raise exception 'invalid_guests' using errcode = 'P0001';
  end if;

  -- guests > capacity es siempre rechazo (no entra ni en waitlist con esa cantidad).
  if v_event.capacity is not null and p_guests > v_event.capacity then
    raise exception 'guests_exceed_capacity' using errcode = 'P0001';
  end if;

  -- Cupo: contar seats confirmed + checked_in (ya entró pero ocupó cupo).
  select coalesce(sum(guests_count), 0) into v_confirmed_seats
    from public.reservations
    where event_id = p_event_id and status in ('confirmed', 'checked_in');

  if v_event.capacity is null
     or (v_confirmed_seats + p_guests) <= v_event.capacity then
    v_status := 'confirmed';
    v_pos := null;
  elsif v_event.waitlist_enabled then
    v_status := 'waitlist';
    select coalesce(max(waitlist_position), 0) + 1 into v_pos
      from public.reservations
      where event_id = p_event_id and status = 'waitlist';
  else
    raise exception 'capacity_reached' using errcode = 'P0001';
  end if;

  insert into public.reservations (
    tenant_id, event_id, customer_id, guests_count, status, waitlist_position
  ) values (
    v_event.tenant_id, p_event_id, p_customer_id, p_guests, v_status, v_pos
  ) returning id into v_id;

  return query select v_id, v_status, v_pos;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 6. RPC cancel_reservation
-- ──────────────────────────────────────────────────────────
create or replace function public.cancel_reservation(p_reservation_id uuid)
returns table(promoted_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_res public.reservations;
  v_event public.events;
  v_promote_id uuid := null;
  v_promote_seats int;
  v_confirmed_seats int;
  rec record;
  i int := 1;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if v_res.status = 'cancelled' then
    return query select null::uuid;
    return;
  end if;

  -- Lock event scope para que no se cuelen reservas concurrentes mientras promovemos.
  perform pg_advisory_xact_lock(public.event_lock_key(v_res.event_id));

  -- Re-leer reserva con lock para evitar UPDATE concurrente raro.
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if v_res.status = 'cancelled' then
    return query select null::uuid;
    return;
  end if;

  select * into v_event from public.events where id = v_res.event_id;

  update public.reservations
    set status = 'cancelled', waitlist_position = null
    where id = v_res.id;

  -- Si era confirmed y hay capacity, intentar promover de la waitlist (en orden).
  if v_res.status in ('confirmed') and v_event.capacity is not null then
    select coalesce(sum(guests_count), 0) into v_confirmed_seats
      from public.reservations
      where event_id = v_res.event_id and status in ('confirmed', 'checked_in');

    -- Tomamos al primero cuya cantidad de comensales entre en lo que se liberó.
    for rec in
      select id, guests_count from public.reservations
        where event_id = v_res.event_id and status = 'waitlist'
        order by waitlist_position asc
        for update skip locked
    loop
      if v_confirmed_seats + rec.guests_count <= v_event.capacity then
        update public.reservations
          set status = 'confirmed', waitlist_position = null
          where id = rec.id;
        v_promote_id := rec.id;
        v_promote_seats := rec.guests_count;
        exit;
      end if;
    end loop;
  end if;

  -- Reordenar posiciones de waitlist (compactar 1..N).
  for rec in
    select id from public.reservations
      where event_id = v_res.event_id and status = 'waitlist'
      order by waitlist_position asc
  loop
    update public.reservations set waitlist_position = i where id = rec.id;
    i := i + 1;
  end loop;

  return query select v_promote_id;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 7. RPC check_in_reservation
-- ──────────────────────────────────────────────────────────
create or replace function public.check_in_reservation(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.reservations;
  v_role public.tenant_role;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if v_res.status <> 'confirmed' then
    raise exception 'not_confirmed' using errcode = 'P0001';
  end if;

  update public.reservations
    set status = 'checked_in', checked_in_at = now(), checked_in_by = v_uid
    where id = p_reservation_id;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 8. RPC cancel_event (owner)
--    Marca el evento como cancelled y todas las reservas no terminales.
-- ──────────────────────────────────────────────────────────
create or replace function public.cancel_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_role public.tenant_role;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'event_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_event.tenant_id);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(public.event_lock_key(p_event_id));

  update public.events set status = 'cancelled' where id = p_event_id;
  update public.reservations
    set status = 'cancelled', waitlist_position = null
    where event_id = p_event_id and status in ('confirmed', 'waitlist');
end; $$;

-- ──────────────────────────────────────────────────────────
-- 9. RPC finish_past_events (cron-only — service_role)
-- ──────────────────────────────────────────────────────────
create or replace function public.finish_past_events()
returns table(finished_events int, no_show_reservations int)
language plpgsql security definer set search_path = '' as $$
declare v_events int; v_reservations int;
begin
  with finished as (
    update public.events
      set status = 'finished'
      where status = 'published' and ends_at < now()
      returning id
  )
  select count(*) into v_events from finished;

  with marked as (
    update public.reservations
      set status = 'no_show'
      where status = 'confirmed'
        and event_id in (
          select id from public.events where status = 'finished' and ends_at < now()
        )
      returning id
  )
  select count(*) into v_reservations from marked;

  return query select v_events::int, v_reservations::int;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 10. RLS
-- ──────────────────────────────────────────────────────────

-- 10.1 events
alter table public.events enable row level security;
create policy "ev_select_member" on public.events for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "ev_owner_insert" on public.events for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "ev_owner_update" on public.events for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "ev_owner_delete" on public.events for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 10.2 reservations: select members, mutaciones via RPC.
alter table public.reservations enable row level security;
create policy "res_select_member" on public.reservations for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- INSERT/UPDATE/DELETE solo via RPCs SECURITY DEFINER.

-- ──────────────────────────────────────────────────────────
-- 11. GRANTs
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.events to authenticated;
grant select on public.reservations to authenticated;

revoke all on function
  public.create_reservation(uuid, uuid, int),
  public.cancel_reservation(uuid),
  public.check_in_reservation(uuid),
  public.cancel_event(uuid),
  public.finish_past_events()
  from public;

grant execute on function
  public.create_reservation(uuid, uuid, int),
  public.cancel_reservation(uuid),
  public.check_in_reservation(uuid),
  public.cancel_event(uuid)
  to authenticated;

-- finish_past_events solo para service_role (cron)
grant execute on function public.finish_past_events() to service_role;
