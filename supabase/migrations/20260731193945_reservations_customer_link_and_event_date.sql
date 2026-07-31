-- ============================================================
-- Reservas: cliente vinculado + coherencia fecha ↔ evento
-- ============================================================
-- ITEM 13 — "las reservas no salen una vez registradas".
--   `/clientes?segment=reserva` filtra por customers.acquisition_channel =
--   'reservation', pero `createSalonReservation` sólo escribía ese canal en la
--   rama que CREA el cliente. Si la reserva reusaba un cliente que ya existía
--   (alta por QR del club, walk-in, import), el canal quedaba en su valor viejo
--   y el cliente nunca aparecía en la pestaña Reservas.
--   Acá: backfill idempotente + índice de apoyo. El fix del camino caliente va
--   en lib/salon/actions.ts (rama de auto-link).
--
-- ITEM 14 — "si reservás en una fecha que no es la del evento te deja igual".
--   No había NINGUNA validación (ni zod, ni action, ni DB) entre
--   salon_reservations.reservation_date y scheduled_events.event_date. Se podía
--   elegir un evento, cambiar la fecha, y guardar la reserva apuntando a un
--   evento de otro día. Acá va la garantía dura (trigger); la Server Action y
--   el form dan el mensaje lindo antes de llegar hasta acá.
-- ============================================================

-- ── 1) ITEM 13: índice + backfill ───────────────────────────────────────
-- El filtro "clientes con al menos una reserva" y el backfill hacen un EXISTS
-- por customer_id; hoy sólo existía el índice por (tenant_id, acquisition_channel).
create index if not exists salon_reservations_customer_idx
  on public.salon_reservations (tenant_id, customer_id)
  where customer_id is not null;

-- Backfill idempotente: todo cliente que tenga al menos una reserva pasa a
-- contarse como adquirido por reserva. Re-ejecutable sin efecto (el where lo
-- vuelve no-op cuando ya está aplicado).
update public.customers c
set acquisition_channel = 'reservation'
where c.acquisition_channel <> 'reservation'
  and exists (
    select 1 from public.salon_reservations sr
    where sr.customer_id = c.id and sr.tenant_id = c.tenant_id
  );

-- ── 2) ITEM 14: trigger de coherencia fecha ↔ evento ────────────────────
-- Un CHECK no sirve: hay que consultar otra tabla. El trigger corre sólo en
-- INSERT y en UPDATE de las dos columnas relevantes, para no reventar updates
-- inocentes (cambiar personas/hora desde el popup del día) si alguna fila
-- vieja quedara inconsistente.
create or replace function public.validate_reservation_event_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_date date;
  v_event_tenant uuid;
begin
  if new.scheduled_event_id is null then
    return new;
  end if;

  select se.event_date, se.tenant_id
    into v_event_date, v_event_tenant
    from public.scheduled_events se
   where se.id = new.scheduled_event_id;

  if v_event_date is null then
    raise exception 'reservation_event_not_found' using errcode = 'P0001';
  end if;

  -- Defensa multi-tenant: el evento tiene que ser del mismo bar.
  if v_event_tenant is distinct from new.tenant_id then
    raise exception 'reservation_event_tenant_mismatch' using errcode = 'P0001';
  end if;

  if v_event_date <> new.reservation_date then
    raise exception 'reservation_event_date_mismatch:%', to_char(v_event_date, 'DD/MM/YYYY')
      using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.validate_reservation_event_date() from public, anon, authenticated;

drop trigger if exists trg_validate_reservation_event_date on public.salon_reservations;
create trigger trg_validate_reservation_event_date
  before insert or update of reservation_date, scheduled_event_id
  on public.salon_reservations
  for each row execute function public.validate_reservation_event_date();

comment on function public.validate_reservation_event_date() is
  'ITEM 14: impide que una reserva quede atada a un evento programado de otra fecha (o de otro tenant). El mensaje lo humaniza lib/salon/humanize.ts.';
