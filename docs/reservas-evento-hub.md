# Reservas «Evento HUB» ↔ Eventos del calendario

Permite asociar una **reserva de mesa** (`salon_reservations`) a un **evento publicado del calendario** (`/eventos`). La reserva cuenta contra el cupo del evento (con lista de espera) y se refleja en el calendario y el detalle del evento.

> Diseño completo: [`docs/superpowers/specs/2026-06-08-reservas-evento-hub-design.md`](./superpowers/specs/2026-06-08-reservas-evento-hub-design.md)
> Plan de implementación: [`docs/superpowers/plans/2026-06-08-reservas-evento-hub.md`](./superpowers/plans/2026-06-08-reservas-evento-hub.md)

## Cómo se usa

1. En `/{slug}/reservas/nuevo` (o editando una reserva), elegí **Tipo de servicio → «Evento HUB»**.
2. Aparece el bloque **«Evento del calendario»** con los eventos publicados próximos (nombre · fecha · hora · lugares restantes). Elegir uno:
   - asocia la reserva al evento,
   - **fija la fecha/hora de la reserva** a las del evento (editable).
3. Al guardar, la reserva entra como **confirmada** o, si el evento está lleno, en **lista de espera** (el toast lo indica).
4. En `/{slug}/eventos`, cada evento muestra su **ocupación** (`confirmados/capacidad` y `+N` en espera). Entrando al evento, las reservas de mesa aparecen por nombre con el tag **«Mesa»** (en Reservas o Waitlist).

## Modelo (resumen)

- `salon_reservations.hub_event_id` → link canónico al evento (`on delete set null`).
- El cupo/waitlist se maneja reusando el motor de **anotados** (`event_attendees`): cada reserva asociada genera un **espejo** (`salon_reservation_id` seteado, `customer_id = NULL` → "invitado"). El espejo es la **fuente de verdad del estado** (confirmed/waitlist); la reserva sólo guarda el link.
- RPCs `SECURITY DEFINER` (con lock por evento): `link_salon_reservation_to_event(reservation, event)` y `unlink_salon_reservation_from_event(reservation)`. Reusan la lógica de cupo, waitlist y promoción del motor existente.
- Sincronización en las server actions de salón: **alta** (linkea + toast), **edición** (relink = unlink+link / quitar = unlink / cambio de comensales = re-eval), **cancelación** (unlink → libera cupo + promueve).

## Migraciones

- `supabase/migrations/20260608120000_hub_event_reservations_link.sql` — columnas, índices, RPCs, grants.
- `supabase/migrations/20260608130000_hub_event_link_hardening.sql` — hardening (espejo siempre invitado; re-check `cancelled` en unlink).

## Tests

- Unit: `tests/lib/salon-reservation-schema.test.ts` (zod: `hub_event_id` requerido para `meal_type=hub_event`).
- Integración (RLS, corre en CI): `tests/rls/hub-event-link.test.ts` (link confirmado/waitlist, unlink + promoción, cupo excedido, aislamiento cross-tenant, invitado sin cliente).

## Fuera de alcance (v1)

- No se unifican los dos sistemas de eventos (`scheduled_events` / `/eventos/programados` quedan intactos).
- Las acciones operativas del lado del evento (cancelar/check-in un anotado) no escriben de vuelta en `salon_reservations` (p. ej. cancelar el espejo desde el detalle del evento deja `hub_event_id` colgado; no rompe el re-link).
- Sin notificación de promoción de waitlist.
