-- Instagram de quien reserva (11/10/2026).
--
-- Con el WhatsApp de reservas bloqueado por Meta, las reservas se están
-- cerrando por Instagram y muchas veces sin teléfono. La reserva guarda el
-- usuario de Instagram como contacto: sin arroba y en minúsculas, igual que lo
-- normaliza `lib/salon/instagram.ts`.
--
-- Columna nueva y opcional en una tabla que ya tiene RLS y GRANTs: no hace
-- falta nada más. Los RPC que devuelven `salon_reservations` la traen solos.

alter table public.salon_reservations
  add column if not exists guest_instagram text;

alter table public.salon_reservations
  drop constraint if exists salon_reservations_guest_instagram_chk;

alter table public.salon_reservations
  add constraint salon_reservations_guest_instagram_chk
  check (guest_instagram is null or guest_instagram ~ '^[a-z0-9._]{1,30}$');

comment on column public.salon_reservations.guest_instagram is
  'Usuario de Instagram de quien reserva, sin arroba y en minúsculas. Opcional.';
