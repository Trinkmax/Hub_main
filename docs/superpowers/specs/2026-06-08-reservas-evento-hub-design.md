# Diseño — Asociar reservas de mesa a eventos del calendario («Evento HUB»)

- **Fecha:** 2026-06-08
- **Branch:** `fix/carta-navegabilidad` (esta feature puede ir en su propia branch `feat/reservas-evento-hub`)
- **Estado:** Aprobado para escribir plan de implementación.
- **Autor:** Agustín + Claude (brainstorming)

---

## 1. Contexto y objetivo

Hoy, en el formulario de reserva de salón (`salon_reservations`), el **Tipo de servicio** incluye la opción **«Evento HUB»** (`meal_type = 'hub_event'`), pero seleccionarla no dispara ningún comportamiento especial: es solo una etiqueta.

Queremos que, al elegir **«Evento HUB»**, el staff pueda **asociar la reserva a uno de los eventos publicados del calendario** (`/eventos`, los eventos masivos de HUB: trivias, peñas, shows) mediante un desplegable. La reserva asociada debe:

1. **Contar contra el cupo del evento** y, si el evento está lleno, **entrar a la lista de espera** (waitlist), reusando el motor de cupos existente.
2. **Reflejarse en el calendario `/eventos`** (ocupación por evento + detalle al entrar al evento).

> ⚠️ Hay **dos sistemas de eventos** en la app y NO se unifican en esta feature:
> - **`events`** (legacy, `/eventos`): eventos masivos con anotados (`event_attendees`), cupo y waitlist. **Es el target de esta feature.**
> - **`scheduled_events`** (`/eventos/programados`): formatos de salón (Sushi Libre, etc.) ligados a la zona `event_floating` y a `salon_reservations.scheduled_event_id`. **Queda intacto.**

---

## 2. Decisiones tomadas (con el usuario)

| # | Decisión | Elección |
|---|----------|----------|
| 1 | ¿Qué calendario? | **Eventos principal** (`/eventos`, tabla `events`). |
| 2 | ¿Qué pasa con la capacidad? | **Contar contra capacidad + waitlist** (integración completa). |
| 3 | ¿Cómo integrar? | **Reusar el motor**: la reserva genera un anotado espejo en `event_attendees`. |
| 4 | ¿Cliente obligatorio? | **No**: se permite invitado sin cliente CRM (`event_attendees.customer_id` pasa a nullable). |

**Decisiones unilaterales aprobadas (vetables):**

- (D5) En el form, **elegir un evento fija `reservation_date`** a la fecha del evento y default-ea la hora al inicio del evento (editable).
- (D6) **La reserva guarda solo el link** (`hub_event_id`); el **estado de asistencia (confirmed/waitlist/posición) vive en el espejo** `event_attendees`. No hay write-back de estado a la reserva → mínima sincronización.
- (D7) Los estados operativos del salón (`arrived/seated/closed/no_show`) **no** tocan el espejo en v1. Solo **alta, edición (relink/comensales/tipo) y cancelación** sincronizan.
- (D8) En el calendario, las reservas se muestran como **ocupación en el pill del evento** + en el **detalle del evento**, no como ítems sueltos en la grilla.

---

## 3. Modelo de datos (1 migración nueva)

Slug sugerido: `hub_event_reservations_link`. Crear con `npx supabase migration new hub_event_reservations_link` (o `npm run db:diff`).

```sql
-- 1) Link canónico en la reserva.
alter table public.salon_reservations
  add column hub_event_id uuid references public.events(id) on delete set null;

create index salon_reservations_hub_event_idx
  on public.salon_reservations(hub_event_id)
  where hub_event_id is not null;

-- 2) event_attendees: soportar anotados "invitado" originados en reservas de mesa.
alter table public.event_attendees
  alter column customer_id drop not null;          -- invitado sin ficha CRM

alter table public.event_attendees
  add column salon_reservation_id uuid
    references public.salon_reservations(id) on delete cascade;

-- Una reserva ↔ a lo sumo un anotado vivo.
create unique index event_attendees_salon_reservation_uidx
  on public.event_attendees(salon_reservation_id)
  where salon_reservation_id is not null and status <> 'cancelled';

-- (El índice único viejo (event_id, customer_id) where status<>'cancelled'
--  sigue válido: con customer_id NULL los invitados conviven — NULLs distintos.)
```

**Notas:**
- No se agrega CHECK de "si `meal_type='hub_event'` ⇒ `hub_event_id not null`" a nivel DB (podría romper filas existentes con `hub_event='hub_event'` sin evento). Se valida en **zod/form** (§8), igual que el patrón de `requested_template_id`.
- No hay tablas nuevas → **no se necesitan GRANTs nuevos de tabla** (CLAUDE.md §5). Las columnas heredan los grants/RLS existentes.
- `event_attendees.customer_id` mantiene su FK `on delete restrict`; solo se libera el `NOT NULL`.

---

## 4. RPCs nuevos (`SECURITY DEFINER`, mismo patrón de locks que el motor actual)

Reusan `public.event_lock_key(uuid)`, `public.user_role_in_tenant(uuid)` y la semántica de `create_event_attendance` / `cancel_event_attendance`.

### 4.1 `link_salon_reservation_to_event(p_reservation_id uuid, p_event_id uuid)`
`returns table(attendee_id uuid, status public.reservation_status, waitlist_position int)`

Pseudo-cuerpo:
1. `auth.uid()` no nulo, si no → `unauthenticated`.
2. `pg_advisory_xact_lock(event_lock_key(p_event_id))`.
3. Leer `events` → si no existe `event_not_found`. `role := user_role_in_tenant(event.tenant_id)`; si null → `forbidden`.
4. Leer `salon_reservations r`; si no existe → `reservation_not_found`; si `r.tenant_id <> event.tenant_id` → `tenant_mismatch`.
5. Si `event.status <> 'published'` → `event_not_open`.
6. `v_guests := r.estimated_guests`; validar `1..99`; si `event.capacity not null and v_guests > capacity` → `guests_exceed_capacity`.
7. Contar confirmados: `sum(guests_count) from event_attendees where event_id=p_event_id and status in ('confirmed','checked_in')`.
   - **Excluir el propio espejo** si ya existía (para re-eval por cambio de comensales).
8. Asignar: capacity null o `confirmados+v_guests <= capacity` → `confirmed`; sino si `waitlist_enabled` → `waitlist` + `max(pos)+1`; sino → `capacity_reached`.
9. Escribir el espejo en `event_attendees` (estamos bajo el lock del evento, sin carrera): buscar espejo **activo** de la reserva → si existe, `UPDATE (event_id, guests_count, status, waitlist_position, customer_id)`; si no, `INSERT` con `customer_id = r.customer_id` (puede ser NULL) y `salon_reservation_id = r.id`. (Evitar `ON CONFLICT` por tratarse de un índice único parcial.)
10. `update salon_reservations set hub_event_id = p_event_id where id = r.id`.
11. `return (attendee_id, status, waitlist_position)`.

> El action layer garantiza que un **relink a otro evento** llame primero a `unlink` (§4.2) para liberar/promover el evento viejo bajo su lock. Esta RPC asume que no hay espejo activo a un evento distinto.

### 4.2 `unlink_salon_reservation_from_event(p_reservation_id uuid)`
`returns table(promoted_id uuid)`

1. Buscar espejo activo `m` (`salon_reservation_id = p_reservation_id and status <> 'cancelled'`). Si no hay → limpiar `hub_event_id` y `return null`.
2. `pg_advisory_xact_lock(event_lock_key(m.event_id))`; re-leer `m for update`.
3. `update event_attendees set status='cancelled', waitlist_position=null where id=m.id`.
4. Si `m.status era 'confirmed'` y `event.capacity not null` → **promover waitlist** (mismo loop que `cancel_event_attendance`) y compactar posiciones.
5. `update salon_reservations set hub_event_id = null where id = p_reservation_id`.
6. `return promoted_id`.

### 4.3 Grants
```sql
revoke all on function
  public.link_salon_reservation_to_event(uuid, uuid),
  public.unlink_salon_reservation_from_event(uuid)
  from public;
grant execute on function
  public.link_salon_reservation_to_event(uuid, uuid),
  public.unlink_salon_reservation_from_event(uuid)
  to authenticated;
```

> La promoción de waitlist al cancelar un **anotado directo** ya funciona para los espejos sin cambios (son filas `event_attendees`; `cancel_event_attendance` promueve por `waitlist_position` sin mirar `salon_reservation_id`). No hace falta tocar `cancel_event_attendance`.

---

## 5. Sincronización (server actions de salón, `lib/salon/actions.ts`)

Punto de verdad de los puntos de sync (solo estos tres):

**`createSalonReservation`** — tras insertar la reserva, si `meal_type='hub_event'` y `hub_event_id`:
- `rpc('link_salon_reservation_to_event', { p_reservation_id, p_event_id })`.
- Propagar el `status`/`waitlist_position` al `ActionState` para el toast (espejo del patrón de `lib/events/reservations.ts::createReservation`).

**`updateSalonReservation`** — tabla de decisión (estado actual vs. deseado):

| Actual | Deseado | Acción |
|--------|---------|--------|
| sin link | `hub_event` + evento | `link` |
| link a evento X | `hub_event` + mismo X, cambió `estimated_guests` | `link` (re-eval in-place) |
| link a evento X | `hub_event` + evento Y (≠X) | `unlink` luego `link(Y)` |
| link a evento X | no-`hub_event` o sin evento | `unlink` |

Orden: primero el `UPDATE` de `salon_reservations` (incluye `meal_type, hub_event_id, estimated_guests`), después `link`/`unlink` (releen la fila ya actualizada).

**`cancelSalonReservation`** — tras `status='cancelled'`, si la reserva tenía `hub_event_id` → `unlink` (libera cupo + promueve).

**Backstop DB:** `event_attendees.salon_reservation_id ... on delete cascade` cubre hard-deletes (las reservas usan soft-cancel, así que es defensa en profundidad).

Auditoría: loguear `salon_reservation.linked_to_event` / `salon_reservation.unlinked_from_event` (CLAUDE.md §4.8).

Mapeo de errores: extender `humanizeSalonError` con `event_not_open`, `event_not_found`, `tenant_mismatch`, `guests_exceed_capacity`, `capacity_reached`.

---

## 6. Fuente de verdad del estado

- La **reserva** guarda solo `hub_event_id` (el link).
- El **espejo `event_attendees`** guarda el estado de asistencia (`confirmed/waitlist/checked_in/no_show/cancelled` + `waitlist_position`).
- Cuando una cancelación de un anotado directo **promueve** un espejo de waitlist→confirmed, NO hace falta write-back: cualquier UI que muestre el estado de la reserva respecto al evento **lo lee del espejo** (join `event_attendees on salon_reservation_id`).

---

## 7. Formulario de reserva (`reservation-form.tsx`)

- Nueva prop `hubEvents: HubEventOption[]` (eventos publicados próximos del tenant). Tipo:
  ```ts
  type HubEventOption = {
    id: string
    name: string
    starts_at: string        // ISO
    capacity: number | null
    confirmed_seats: number
    waitlist_enabled: boolean
  }
  ```
- Nuevo **bloque condicional** `«Evento del calendario»` (icon `Sparkles`), visible cuando `values.meal_type === 'hub_event'` (mismo patrón `AnimatePresence` que el bloque `event_floating`).
- `Select` con cada evento: `Nombre · {fecha dd/MM} {HH:mm} · {lugares}` donde `lugares = capacity - confirmed_seats` (o "Sin cupo — lista de espera" si `≤0` y `waitlist_enabled`, o "Lleno" deshabilitado si `!waitlist_enabled`).
- **Al elegir un evento:** `form.setValue('hub_event_id', id)`, `form.setValue('reservation_date', eventDateLocal)` y `reservation_time_local` ← inicio del evento (editable).
- Si no hay eventos publicados: hint con link a `/${tenantSlug}/eventos/nuevo` (solo owner crea; mostrar texto neutro si no).
- Independiente de la zona `event_floating` (sistemas distintos; se pueden combinar, no se prohíbe). Nota UX: aclarar en el copy que «Evento HUB» refiere al evento del calendario, no a la capacidad de salón.

> El `ReservationForm` del manager (`/reservas/nuevo` y `/reservas/[id]`) es la **única** superficie de alta/edición de reservas. `/salon/reservas-operativo` es operativo (timeline/cards) y no crea reservas, así que no requiere cambios.

Carga de datos:
- `reservas/nuevo/page.tsx`: agregar `listLinkableHubEvents({ tenantId })` al `Promise.all` y pasar `hubEvents`.
- `reservas/[id]/page.tsx` (edit): idem + pasar `initialValues.hub_event_id`.
- Como elegir evento fija la fecha (no al revés), **no** hace falta re-fetch por cambio de fecha (a diferencia de `scheduled_events`). Se cargan una vez.

---

## 8. Validación (zod, `lib/salon/schemas.ts`)

- Agregar `hub_event_id: z.string().uuid().optional().nullable()` a `createSalonReservationSchema` y `updateSalonReservationSchema`.
- `superRefine`: si `meal_type === 'hub_event'` y `!hub_event_id` → issue en `hub_event_id`: _"Elegí el evento del calendario al que se asocia."_

---

## 9. Calendario `/eventos` + detalle del evento

**`listEvents` (lib/events/queries.ts):** ya computa `confirmed_seats / capacity / waitlist_count` desde `event_attendees` → **incluye los espejos sin cambios de query.**

**`CalendarMonth` (`_components/calendar-month.tsx`):** cambio presentacional — el pill de cada evento muestra ocupación. Ej.: `21:00 Trivia · 18/30` y, si hay, `+N espera`. Los campos `confirmed_seats/capacity/waitlist_count` ya llegan en `EventListEntry` y hoy no se usan. Mantener accesibilidad (badge con `title`/aria) y el layout mobile (agenda vertical) + desktop (grilla 7-col).

**Detalle `/eventos/[id]`:** `listReservations` (lib/events/queries.ts) ya lista anotados (son `event_attendees`). Extender:
- `select` también `salon_reservation:salon_reservations(guest_name)`.
- Usar `guest_name` como nombre cuando `customer` es null.
- Etiquetar el origen ("Reserva de mesa" vs "Anotado") para que el owner distinga.

---

## 10. Query nueva (`lib/events/queries.ts`)

`listLinkableHubEvents({ tenantId }): Promise<HubEventOption[]>` — eventos `status='published'`, `ends_at >= now()`, orden `starts_at asc`, con `confirmed_seats` agregados desde `event_attendees` (mismo patrón N+1 controlado que `listEvents`). Devuelve la forma `HubEventOption`.

---

## 11. RLS / permisos / GRANTs

- Sin tablas nuevas → RLS existente cubre las columnas nuevas.
- Los RPCs son `SECURITY DEFINER` con chequeo de `user_role_in_tenant(tenant) is not null` (cualquier miembro) — igual que el motor actual. La autorización fina de "quién puede crear reservas" ya la hace el action (`STAFF = owner/cashier/waiter`); el form `/reservas/nuevo` es owner/cashier.
- Verificar aislamiento cross-tenant en el RPC (paso 4: `r.tenant_id == event.tenant_id`).

---

## 12. Tipos

- Regenerar `types/database.ts` (vía MCP `generate_typescript_types`, re-anexando el bloque de alias — ver memoria `supabase-types-regen-via-mcp`).
- Actualizar tipos manuales en `lib/salon/types.ts`: agregar `hub_event_id: string | null` a `SalonReservationRow`.
- Tipos del espejo (`event_attendees`): `customer_id` nullable + `salon_reservation_id`.

Aplicación de la migración: flujo local (`npm run db:reset`) si hay Docker; si no, vía MCP `apply_migration` al proyecto remoto `ogplsevtrclzxvyejlns` (ver memoria `supabase-prod-migrations-via-mcp`).

---

## 13. Tests

**Unit (Vitest):**
- `createSalonReservationSchema` / `updateSalonReservationSchema`: `meal_type='hub_event'` sin `hub_event_id` falla; con uuid válido pasa.
- (si se extrae lógica TS) mapeo de errores `humanizeSalonError`.

**RLS / integración (`tests/rls`, contra Supabase local):**
- Linkear una reserva crea el espejo `confirmed` cuando hay cupo.
- Over-capacity → espejo `waitlist` con `waitlist_position` correcto.
- Cancelar la reserva libera cupo y **promueve** el primer waitlist que entra.
- Relink a otro evento mueve el cupo (libera viejo, ocupa nuevo).
- Aislamiento: no se puede linkear a un evento de **otro tenant** (`tenant_mismatch`/`forbidden`).
- Invitado sin `customer_id` se acepta en el espejo.

---

## 14. Casos borde

- Evento no publicado / cancelado / finalizado → no linkeable (RPC rechaza; el form filtra a `published + futuros`).
- `estimated_guests > capacity` → rechazo (`guests_exceed_capacity`); el form lo avisa antes.
- Cambio de `estimated_guests` en reserva linkeada → re-eval (puede pasar de confirmed a waitlist o viceversa).
- Evento borrado (owner delete) → cascade borra el espejo y `hub_event_id` queda null (degradación aceptable; el flujo normal es **cancelar** el evento, que cancela espejos vía `cancel_event`).
- Combinar `meal_type='hub_event'` con zona `event_floating` está permitido (dos sistemas distintos); el copy lo aclara.

---

## 15. Fuera de alcance (YAGNI)

- No se unifican los dos sistemas de eventos; `scheduled_events` / `/eventos/programados` quedan intactos.
- Sin notificación (WhatsApp/IG) al promover de waitlist.
- Los estados operativos del salón no hacen check-in del anotado en v1.
- Las reservas no se dibujan como ítems sueltos en la grilla del calendario (se ven como ocupación + en el detalle del evento).

---

## 16. Archivos a tocar (estimado)

**DB:**
- `supabase/migrations/<ts>_hub_event_reservations_link.sql` (nuevo) — columnas, índices, 2 RPCs, grants.

**Backend / lib:**
- `lib/salon/schemas.ts` — `hub_event_id` + superRefine.
- `lib/salon/actions.ts` — sync en create/update/cancel + audit + humanize.
- `lib/salon/types.ts` — `hub_event_id` en `SalonReservationRow`.
- `lib/events/queries.ts` — `listLinkableHubEvents` + extender `listReservations` (guest_name).
- `types/database.ts` — regenerado.

**UI:**
- `app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx` — bloque condicional + prop `hubEvents`.
- `app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx` — cargar/pasar `hubEvents`.
- `app/(manager)/[tenantSlug]/reservas/[id]/page.tsx` — idem + initial `hub_event_id`.
- `app/(manager)/[tenantSlug]/eventos/_components/calendar-month.tsx` — ocupación en el pill.
- `app/(manager)/[tenantSlug]/eventos/[id]/page.tsx` (+ componente de lista de anotados) — mostrar reservas de mesa.

**Tests:**
- `tests/lib/salon-schemas.test.ts` (o donde estén los del schema).
- `tests/rls/hub-event-link.test.ts` (nuevo).

---

## 17. Smoke manual (happy path — para el PR, DoD §7)

1. Crear/publicar un evento en `/eventos` con `capacity=10`, waitlist on.
2. En `/reservas/nuevo`, Tipo de servicio → **Evento HUB**. Aparece «Evento del calendario». Elegir el evento → la fecha de la reserva salta a la del evento. Cargar nombre + 6 personas → guardar. Toast: **confirmada**.
3. Crear otra reserva «Evento HUB» al mismo evento con 6 personas → toast: **lista de espera (puesto 1)** (6+6 > 10).
4. En `/eventos`, el pill muestra `… · 6/10` y `+6 espera`. Entrar al evento: se ven las 2 reservas de mesa por `guest_name`, una confirmada y otra en espera.
5. Cancelar la primera reserva (libera 6) → la segunda **se promueve** a confirmada (verificable al recargar el detalle/calendario).
6. Cross-tenant: con otro tenant, el evento del primero no aparece en el desplegable.

Screenshots/clip del paso 2–5 en el PR.
