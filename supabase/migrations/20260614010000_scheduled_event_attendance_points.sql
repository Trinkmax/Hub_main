-- Puntos por asistencia a un evento del calendario (reemplaza el sistema viejo
-- de events.attendance_points, retirado con la tabla events).

alter table public.scheduled_events
  add column if not exists attendance_points int not null default 0
  check (attendance_points >= 0);

-- Otorga puntos al cliente cuando su reserva asociada a un scheduled_event llega
-- a "asistió" (seated/closed) por primera vez. Idempotente por reserva. El
-- trigger points_tx_apply_trg actualiza saldo/lifetime/nivel al insertar el tx.
-- La fuente de puntos: el override por evento (attendance_points > 0) o, si es 0,
-- el default del tenant (tenants.default_event_attendance_points).
create or replace function public.award_scheduled_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points int;
begin
  if new.status in ('seated', 'closed')
     and (old.status is null or old.status not in ('seated', 'closed'))
     and new.scheduled_event_id is not null
     and new.customer_id is not null then

    select coalesce(nullif(se.attendance_points, 0), t.default_event_attendance_points, 0)
      into v_points
    from public.scheduled_events se
    join public.tenants t on t.id = se.tenant_id
    where se.id = new.scheduled_event_id;

    if coalesce(v_points, 0) > 0
       and not exists (
         select 1 from public.points_transactions pt
         where pt.tenant_id = new.tenant_id
           and pt.customer_id = new.customer_id
           and pt.reason = 'event_attendance'
           and pt.payload ->> 'salon_reservation_id' = new.id::text
       ) then
      insert into public.points_transactions (tenant_id, customer_id, delta, reason, payload)
      values (
        new.tenant_id, new.customer_id, v_points, 'event_attendance',
        jsonb_build_object(
          'salon_reservation_id', new.id,
          'scheduled_event_id', new.scheduled_event_id
        )
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_award_scheduled_event_attendance on public.salon_reservations;
create trigger trg_award_scheduled_event_attendance
  after update of status on public.salon_reservations
  for each row execute function public.award_scheduled_event_attendance();
