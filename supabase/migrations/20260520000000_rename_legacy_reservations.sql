-- ============================================================
-- Rename legacy `reservations` table → `event_attendees`
-- ============================================================
-- Contexto: la entidad de negocio "reserva" en HUB ahora es la del Google Form
-- (reserva de mesa con gestor + comisión). La tabla actual `public.reservations`
-- modela algo distinto: asistencia a eventos masivos (trivias, peñas) con
-- waitlist y check-in. Para liberar el nombre `reservations` para la nueva
-- entidad sin perder la funcionalidad existente, renombramos a `event_attendees`.
--
-- Atomicidad: este script renombra la tabla, sus índices, sus policies, y
-- recrea TODOS los RPCs cuyo cuerpo referenciaba `public.reservations` para
-- que apunten a `public.event_attendees`. Si esto falla a la mitad, la
-- transacción de Postgres revierte completo.

-- 1) Rename de la tabla.
alter table public.reservations rename to event_attendees;

-- 2) Rename de índices (PG mantiene los nombres viejos al renombrar tabla).
alter index public.reservations_event_customer_uidx rename to event_attendees_event_customer_uidx;
alter index public.reservations_event_status_idx     rename to event_attendees_event_status_idx;
alter index public.reservations_event_waitlist_idx   rename to event_attendees_event_waitlist_idx;
alter index public.reservations_tenant_idx           rename to event_attendees_tenant_idx;

-- 3) Rename del trigger (el nombre se queda con el viejo `reservations_*`).
alter trigger reservations_updated_at on public.event_attendees
  rename to event_attendees_updated_at;

-- 4) Rename de la policy SELECT.
alter policy "res_select_member" on public.event_attendees
  rename to "ea_select_member";

-- 5) Rename de los RPCs que tienen "reservation" en el nombre.
alter function public.create_reservation(uuid, uuid, int)
  rename to create_event_attendance;
alter function public.cancel_reservation(uuid)
  rename to cancel_event_attendance;
alter function public.check_in_reservation(uuid)
  rename to check_in_event_attendance;

-- ──────────────────────────────────────────────────────────
-- 6) Recrear los cuerpos de los RPCs que tocan la tabla.
--    Postgres no recompila bodies en rename de tabla, así que hay que reissue.
--    Mantenemos el mismo signature/permisos.
-- ──────────────────────────────────────────────────────────

-- 6.1 create_event_attendance
create or replace function public.create_event_attendance(
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

-- 6.2 cancel_event_attendance
create or replace function public.cancel_event_attendance(p_reservation_id uuid)
returns table(promoted_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_res public.event_attendees;
  v_event public.events;
  v_promote_id uuid := null;
  v_confirmed_seats int;
  rec record;
  i int := 1;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.event_attendees where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if v_res.status = 'cancelled' then
    return query select null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(public.event_lock_key(v_res.event_id));

  select * into v_res from public.event_attendees where id = p_reservation_id for update;
  if v_res.status = 'cancelled' then
    return query select null::uuid;
    return;
  end if;

  select * into v_event from public.events where id = v_res.event_id;

  update public.event_attendees
    set status = 'cancelled', waitlist_position = null
    where id = v_res.id;

  if v_res.status in ('confirmed') and v_event.capacity is not null then
    select coalesce(sum(guests_count), 0) into v_confirmed_seats
      from public.event_attendees
      where event_id = v_res.event_id and status in ('confirmed', 'checked_in');

    for rec in
      select id, guests_count from public.event_attendees
        where event_id = v_res.event_id and status = 'waitlist'
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
      where event_id = v_res.event_id and status = 'waitlist'
      order by waitlist_position asc
  loop
    update public.event_attendees set waitlist_position = i where id = rec.id;
    i := i + 1;
  end loop;

  return query select v_promote_id;
end; $$;

-- 6.3 check_in_event_attendance
create or replace function public.check_in_event_attendance(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.event_attendees;
  v_role public.tenant_role;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.event_attendees where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if v_res.status <> 'confirmed' then
    raise exception 'not_confirmed' using errcode = 'P0001';
  end if;

  update public.event_attendees
    set status = 'checked_in', checked_in_at = now(), checked_in_by = v_uid
    where id = p_reservation_id;
end; $$;

-- 6.4 cancel_event (mismo nombre, body actualizado)
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
  update public.event_attendees
    set status = 'cancelled', waitlist_position = null
    where event_id = p_event_id and status in ('confirmed', 'waitlist');
end; $$;

-- 6.5 finish_past_events (mismo nombre, body actualizado)
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
    update public.event_attendees
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
-- 7) Re-grants (los nuevos signatures necesitan execute).
--    El SELECT del table sigue intacto (no se pierde con rename).
-- ──────────────────────────────────────────────────────────
revoke all on function
  public.create_event_attendance(uuid, uuid, int),
  public.cancel_event_attendance(uuid),
  public.check_in_event_attendance(uuid)
  from public;

grant execute on function
  public.create_event_attendance(uuid, uuid, int),
  public.cancel_event_attendance(uuid),
  public.check_in_event_attendance(uuid)
  to authenticated;

-- Re-grant explícito del SELECT a authenticated (defensa en profundidad para
-- el nuevo régimen de Data API GRANTs del 30/05/2026 — ver CLAUDE.md §5).
grant select on public.event_attendees to authenticated;
