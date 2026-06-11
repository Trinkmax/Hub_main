-- Fix bug 42702 (ambiguous column) en funciones cuyo RETURNS TABLE declara columnas
-- `status` / `waitlist_position` que colisionan con columnas de `event_attendees`.
-- Con plpgsql.variable_conflict = 'error' (default en Supabase) estas funciones erroran
-- SIEMPRE al ejecutarse. La directiva `#variable_conflict use_column` resuelve los nombres
-- ambiguos hacia la COLUMNA (que es lo que las queries quieren).
--
-- Afecta:
--   • public.create_event_attendance         (motor de anotados — bug PREEXISTENTE, roto en prod)
--   • public.link_salon_reservation_to_event   (feature reservas↔eventos)
--   • public.unlink_salon_reservation_from_event (idem; no tenía el conflicto, se agrega por consistencia)
-- Solo `create or replace` (misma firma) → conserva grants, no requiere regen de tipos.

-- ──────────────────────────────────────────────────────────
-- 1) Motor existente: create_event_attendance (bug preexistente)
-- ──────────────────────────────────────────────────────────
create or replace function public.create_event_attendance(
  p_event_id uuid,
  p_customer_id uuid,
  p_guests int default 1
) returns table(reservation_id uuid, status public.reservation_status, waitlist_position int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_role public.tenant_role;
  v_confirmed_seats int;
  v_status public.reservation_status;
  v_pos int;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  perform pg_advisory_xact_lock(public.event_lock_key(p_event_id));

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'event_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_event.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

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

  if v_event.capacity is not null and p_guests > v_event.capacity then
    raise exception 'guests_exceed_capacity' using errcode = 'P0001';
  end if;

  select coalesce(sum(guests_count), 0) into v_confirmed_seats
    from public.event_attendees
    where event_id = p_event_id and status in ('confirmed', 'checked_in');

  if v_event.capacity is null
     or (v_confirmed_seats + p_guests) <= v_event.capacity then
    v_status := 'confirmed';
    v_pos := null;
  elsif v_event.waitlist_enabled then
    v_status := 'waitlist';
    select coalesce(max(waitlist_position), 0) + 1 into v_pos
      from public.event_attendees
      where event_id = p_event_id and status = 'waitlist';
  else
    raise exception 'capacity_reached' using errcode = 'P0001';
  end if;

  insert into public.event_attendees (
    tenant_id, event_id, customer_id, guests_count, status, waitlist_position
  ) values (
    v_event.tenant_id, p_event_id, p_customer_id, p_guests, v_status, v_pos
  ) returning id into v_id;

  return query select v_id, v_status, v_pos;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 2) link_salon_reservation_to_event (feature reservas↔eventos)
-- ──────────────────────────────────────────────────────────
create or replace function public.link_salon_reservation_to_event(
  p_reservation_id uuid,
  p_event_id uuid
) returns table(attendee_id uuid, status public.reservation_status, waitlist_position int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_res public.salon_reservations;
  v_role public.tenant_role;
  v_guests int;
  v_confirmed_seats int;
  v_status public.reservation_status;
  v_pos int;
  v_existing public.event_attendees;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  perform pg_advisory_xact_lock(public.event_lock_key(p_event_id));

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'event_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_event.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select * into v_res from public.salon_reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;
  if v_res.tenant_id <> v_event.tenant_id then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;

  v_guests := v_res.estimated_guests;
  if v_guests is null or v_guests < 1 or v_guests > 99 then
    raise exception 'invalid_guests' using errcode = 'P0001';
  end if;
  if v_event.capacity is not null and v_guests > v_event.capacity then
    raise exception 'guests_exceed_capacity' using errcode = 'P0001';
  end if;

  select * into v_existing
    from public.event_attendees
    where salon_reservation_id = p_reservation_id and status <> 'cancelled'
    limit 1;

  if v_existing.id is not null and v_existing.event_id <> p_event_id then
    raise exception 'relink_requires_unlink' using errcode = 'P0001';
  end if;

  select coalesce(sum(guests_count), 0) into v_confirmed_seats
    from public.event_attendees
    where event_id = p_event_id
      and status in ('confirmed', 'checked_in')
      and (v_existing.id is null or id <> v_existing.id);

  if v_event.capacity is null
     or (v_confirmed_seats + v_guests) <= v_event.capacity then
    v_status := 'confirmed';
    v_pos := null;
  elsif v_event.waitlist_enabled then
    v_status := 'waitlist';
    select coalesce(max(waitlist_position), 0) + 1 into v_pos
      from public.event_attendees
      where event_id = p_event_id and status = 'waitlist'
        and (v_existing.id is null or id <> v_existing.id);
  else
    raise exception 'capacity_reached' using errcode = 'P0001';
  end if;

  if v_existing.id is null then
    insert into public.event_attendees (
      tenant_id, event_id, customer_id, salon_reservation_id,
      guests_count, status, waitlist_position
    ) values (
      v_event.tenant_id, p_event_id, null, p_reservation_id,
      v_guests, v_status, v_pos
    ) returning id into v_id;
  else
    update public.event_attendees set
      guests_count = v_guests,
      status = v_status,
      waitlist_position = v_pos
    where id = v_existing.id
    returning id into v_id;
  end if;

  update public.salon_reservations set hub_event_id = p_event_id where id = p_reservation_id;

  return query select v_id, v_status, v_pos;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 3) unlink_salon_reservation_from_event (consistencia; no tenía el conflicto)
-- ──────────────────────────────────────────────────────────
create or replace function public.unlink_salon_reservation_from_event(
  p_reservation_id uuid
) returns table(promoted_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_res public.salon_reservations;
  v_role public.tenant_role;
  v_m public.event_attendees;
  v_event public.events;
  v_confirmed_seats int;
  v_promote_id uuid := null;
  rec record;
  i int := 1;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.salon_reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select * into v_m
    from public.event_attendees
    where salon_reservation_id = p_reservation_id and status <> 'cancelled'
    limit 1;

  if v_m.id is null then
    update public.salon_reservations set hub_event_id = null where id = p_reservation_id;
    return query select null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(public.event_lock_key(v_m.event_id));
  select * into v_m from public.event_attendees where id = v_m.id for update;

  if v_m.status = 'cancelled' then
    update public.salon_reservations set hub_event_id = null where id = p_reservation_id;
    return query select null::uuid;
    return;
  end if;

  select * into v_event from public.events where id = v_m.event_id;

  update public.event_attendees
    set status = 'cancelled', waitlist_position = null
    where id = v_m.id;

  if v_m.status in ('confirmed') and v_event.capacity is not null then
    select coalesce(sum(guests_count), 0) into v_confirmed_seats
      from public.event_attendees
      where event_id = v_m.event_id and status in ('confirmed', 'checked_in');

    for rec in
      select id, guests_count from public.event_attendees
        where event_id = v_m.event_id and status = 'waitlist'
        order by waitlist_position asc
        for update skip locked
    loop
      if v_confirmed_seats + rec.guests_count <= v_event.capacity then
        update public.event_attendees
          set status = 'confirmed', waitlist_position = null
          where id = rec.id;
        v_promote_id := rec.id;
        exit;
      end if;
    end loop;
  end if;

  for rec in
    select id from public.event_attendees
      where event_id = v_m.event_id and status = 'waitlist'
      order by waitlist_position asc
  loop
    update public.event_attendees set waitlist_position = i where id = rec.id;
    i := i + 1;
  end loop;

  update public.salon_reservations set hub_event_id = null where id = p_reservation_id;

  return query select v_promote_id;
end; $$;
