-- Fase 5 — Segmentación de Personas: cómo entró cada cliente al CRM.
--   reservation = lo trajo una reserva de mesa.
--   walkin      = vino en persona (QR del club, caja, etc.).
--   import      = carga masiva.
-- El nav 'Personas' filtra: Reservas → reservation; Walk-in → el resto.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'customer_acquisition_channel') then
    create type public.customer_acquisition_channel as enum ('reservation', 'walkin', 'import');
  end if;
end $$;

alter table public.customers
  add column if not exists acquisition_channel public.customer_acquisition_channel not null default 'walkin';

create index if not exists customers_acquisition_idx
  on public.customers(tenant_id, acquisition_channel);

-- Backfill (idempotente): reserva si tiene una salon_reservation linkeada; import si vino
-- de import; walkin para el resto (default).
update public.customers c
set acquisition_channel = case
  when exists (select 1 from public.salon_reservations sr where sr.customer_id = c.id) then 'reservation'
  when c.source = 'import' then 'import'
  else 'walkin'
end::public.customer_acquisition_channel;
