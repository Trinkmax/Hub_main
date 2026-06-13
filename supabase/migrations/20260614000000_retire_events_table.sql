-- Retiro del sistema legacy de eventos (tablas events / event_attendees).
-- Los eventos viven ahora en el Calendario (scheduled_events): las reservas se
-- asocian vía scheduled_event_id, y audiencias + flows consultan scheduled_events
-- + salon_reservations. Esta migración elimina los objetos ya huérfanos tras
-- borrar la UI de "Shows y fiestas".

-- 1. Asociación redundante reserva→evento (hub_event); scheduled_event_id la cubre.
drop function if exists public.link_salon_reservation_to_event(uuid, uuid);
drop function if exists public.unlink_salon_reservation_from_event(uuid);
drop index if exists public.salon_reservations_hub_event_idx;
alter table public.salon_reservations drop column if exists hub_event_id;

-- 2. RPCs del viejo sistema de asistencia / check-in / cron.
drop function if exists public.create_event_attendance(uuid, uuid, integer);
drop function if exists public.cancel_event_attendance(uuid);
drop function if exists public.check_in_event_attendance(uuid);
drop function if exists public.cancel_event(uuid);
drop function if exists public.finish_past_events();
drop function if exists public.event_lock_key(uuid);

-- 3. Tablas (event_attendees primero: FK event_id → events).
drop table if exists public.event_attendees;
drop table if exists public.events;

-- 4. Enums que solo usaban esas tablas.
drop type if exists public.reservation_status;
drop type if exists public.event_status;

-- Nota: el valor 'hub_event' del enum meal_type se conserva (Postgres no permite
-- quitar valores de enum sin recrearlo); la UI ya no lo ofrece. La columna
-- tenants.default_event_attendance_points queda inerte (sin consumidores).
