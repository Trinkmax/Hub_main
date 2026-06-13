-- Fase 2 — Puntos por ASISTENCIA a eventos.
-- Al hacer check-in de un asistente con customer_id, se otorgan puntos
-- (events.attendance_points, o el default del tenant). Idempotente por asistente.

alter table public.events
  add column if not exists attendance_points int not null default 0
    check (attendance_points >= 0);
alter table public.tenants
  add column if not exists default_event_attendance_points int not null default 0
    check (default_event_attendance_points >= 0);

create or replace function public.check_in_event_attendance(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.event_attendees;
  v_role public.tenant_role;
  v_event public.events;
  v_points int;
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

  -- Puntos por asistencia (sólo si hay customer_id; los mirrors de reserva de salón vienen null).
  -- El guard status<>'confirmed' de arriba ya garantiza un único check-in por asistente;
  -- el NOT EXISTS es defensa adicional.
  if v_res.customer_id is not null then
    select * into v_event from public.events where id = v_res.event_id;
    v_points := v_event.attendance_points;
    if coalesce(v_points, 0) = 0 then
      select default_event_attendance_points into v_points
        from public.tenants where id = v_res.tenant_id;
    end if;

    if coalesce(v_points, 0) > 0 and not exists (
      select 1 from public.points_transactions
      where reason = 'event_attendance'
        and (payload ->> 'attendee_id')::uuid = v_res.id
    ) then
      insert into public.points_transactions (tenant_id, customer_id, delta, reason, payload)
      values (
        v_res.tenant_id, v_res.customer_id, v_points, 'event_attendance',
        jsonb_build_object('attendee_id', v_res.id, 'event_id', v_res.event_id)
      );
    end if;
  end if;
end; $$;

revoke all on function public.check_in_event_attendance(uuid) from public;
grant execute on function public.check_in_event_attendance(uuid) to authenticated;
