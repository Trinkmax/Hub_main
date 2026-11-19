-- Arreglo urgente de la tanda 2 (sucursales_agenda, 20261118170540).
--
-- La clave compuesta salon_reservations (scheduled_event_id, branch_id) → scheduled_events (id, branch_id) creó una
-- SEGUNDA relación entre reservas y eventos. PostgREST no sabe cuál usar al embeber `scheduled_events(...)` sin
-- nombrarla y contesta PGRST201: se caían Reservas, el Operativo y la ficha de la reserva.
--
-- Se saca esa clave. Que una reserva de un evento quede en la sucursal de su evento lo sigue haciendo el disparador
-- salon_reservations_branch (al crearla y al cambiarle el evento). Los datos no cambian.

set local lock_timeout = '5s';

alter table public.salon_reservations drop constraint salon_reservations_event_branch_fk;

notify pgrst, 'reload schema';
