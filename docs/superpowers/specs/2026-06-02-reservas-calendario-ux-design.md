# Diseño — Mejoras UX de Reservas & Calendario de salón

> Fecha: 2026-06-02
> Estado: aprobado (brainstorming) — pendiente de plan de implementación
> Ámbito: workspace `(manager)` — secciones Reservas y Eventos programados (calendario de salón).

---

## 1. Contexto y objetivo

El módulo de reservas de salón (`salon_reservations` + `scheduled_events` +
`scheduled_event_templates`) ya está en producción. Este trabajo es una tanda
de mejoras de **experiencia de usuario** sobre flujos existentes, sin cambiar el
modelo de comisiones ni la máquina de estados. Cinco cambios:

1. Crear un "formato" nuevo desde el select de la reserva (cumpleaños/especial).
2. "Ver" una reserva abre un **popup** de gestión rápida en vez de navegar.
3. Navegación **día a día** con flechas en el listado de reservas.
4. En el calendario de salón: **popup del día** con el listado (incluye reservas
   normales) + contador de **tope** (ej. `48/60`).
5. Selector de **torta y champagne** más intuitivo en reservas de cumpleaños.

### Glosario

- **Formato** = `scheduled_event_templates` (plantilla reutilizable: Sushi Libre,
  Pizza Libre, Ramen…). Una reserva de cumpleaños/especial puede "pedir" un
  formato vía `requested_template_id`, que crea/usa un `scheduled_event` ad-hoc.
- **Cubiertos** = comensales (`estimated_guests`, o `actual_guests` si la reserva
  está `closed`).
- **Tope del salón** = capacidad combinada de las zonas físicas
  `planta_alta + planta_baja`, con override por fecha en
  `salon_zone_capacity_overrides`, default en `tenants.settings->'salon_capacities'`.

---

## 2. Decisiones tomadas (Q&A de brainstorming)

| Tema | Decisión |
|---|---|
| Crear formato inline | **Cualquier staff** (owner/cashier). Campos mínimos. Action nuevo solo-insert; edición sigue owner-only. |
| Popup "Ver" | **Vista rápida + gestión**. Se mantiene `/reservas/[id]` para edición a fondo (botón "Editar" en el popup). |
| Navegación por fecha | **Vista por día** con `‹ fecha ›` + "Hoy", default hoy. Rango from/to queda como filtro avanzado. |
| Contador de tope | **Cubiertos del día** / tope total del salón (PA + PB). Reusa `evaluate_day_capacity`. |
| Calendario | **`/eventos/programados`** (calendario de salón). Contador en celda + popup con listado al hacer clic. |
| Torta/champagne | **Toggle Sí/No + stepper de cantidad** (progressive disclosure). |

---

## 3. Infraestructura compartida

Base reutilizada por las features 2 y 4.

### 3.1 `<ReservationStatusControls>` (componente nuevo)

Extraer del actual `app/(manager)/[tenantSlug]/reservas/_components/reservation-detail-sidebar.tsx`
el bloque operativo de gestión del comensal:

- Botones de transición: **Llegó** → **Sentar** → **Cerrar mesa** (con dialog de
  `actual_guests`), **No vino**.
- Reversiones: Revertir a Pendiente / Revertir a Llegó / Reabrir mesa.
- Editor inline de **comensales reales**.
- **Cancelar** reserva (AlertDialog con motivo).

Props: `{ tenantSlug, reservation: ReservationWithJoins, onChanged?: () => void }`.
Reusa las server actions existentes en `lib/salon/actions.ts`
(`markArrived`, `markSeated`, `markClosed`, `markNoShow`, `revertStatus`,
`updateActualGuests`, `cancelSalonReservation`). `reservation-detail-sidebar.tsx`
pasa a consumir este componente (sin cambiar su comportamiento actual).

### 3.2 Client actions de lectura (`lib/salon/client-actions.ts`)

- `fetchSalonReservation(slug, id)` → `ReservationWithJoins` (lazy-load del popup).
- `fetchReservationsForDate(slug, date)` → reusa `listTimelineForDate` (ya existe).
- (Ya existen `fetchDayCapacity`, `fetchScheduledEventsForDate`.)

Todas validan `requireTenantAccess` + rol staff, como las existentes.

---

## 4. Feature 1 — Crear "formato" desde el select

**Archivos:** `reservation-form.tsx`, `lib/salon/actions.ts`, `lib/salon/schemas.ts`,
nueva migración RLS.

### UX
- El `<Select>` de `requested_template_id` (visible para `kind ∈ {birthday, special}`)
  pasa a **combobox** con una opción fija al final: **"➕ Crear formato nuevo"**.
- Al elegirla → **mini-dialog** (`<QuickTemplateDialog>`):
  - **Nombre** (requerido).
  - **Cupo** (opcional, número > 0).
  - **Comida** (`meal_type`, prefill del valor actual de la reserva).
  - **Color** (auto desde una paleta; opcionalmente editable).
  - `slug` se deriva del nombre y se de-duplica server-side.
- Al confirmar: se crea, se **agrega a la lista local** de `templates` y se
  **autoselecciona** en el form. Sin recargar la página.

### Server
- **Nuevo action `quickCreateScheduledTemplate(slug, input)`**, rol **STAFF**:
  - Schema nuevo `quickTemplateSchema` (name, default_capacity?, default_meal_type, color_hex?).
  - Genera `slug` único (slugify + sufijo `-2`, `-3`… si colisiona dentro del tenant).
  - Inserta `scheduled_event_templates` con `active=true`,
    `consume_special_reservations=false` (default).
  - Escribe `audit_log`. Devuelve la fila creada.
- `upsertScheduledTemplate` (owner-only) **no se toca** — sigue manejando
  edición/desactivación.

### Datos / RLS
- Migración: **política RLS de INSERT para staff** en `scheduled_event_templates`
  (hoy el insert es owner-only). UPDATE/DELETE siguen owner-only. El GRANT a
  `authenticated` ya existe.

### Estado del form
- `templates` deja de ser solo prop: se inicializa en `useState(propsTemplates)`
  para poder hacer append del formato recién creado.

---

## 5. Feature 2 — "Ver" abre popup de gestión rápida

**Archivos:** `reservations-table.tsx`, nuevo `<ReservationQuickDialog>`,
`reservation-detail-sidebar.tsx` (refactor a 3.1).

### UX
- En la tabla, **"Ver" deja de ser `<Link>`**: abre `<ReservationQuickDialog>`
  (estado local en la tabla; soporta deep-link opcional `?r=<id>`).
- Contenido del dialog:
  - Header: nombre del comensal + `StatusPill`.
  - Datos clave: fecha/hora, zona, comida, tipo (kind), comensales est./real,
    gestor (y asistente), comentarios, torta/champ.
  - **`<ReservationStatusControls>`** (3.1) para Llegó/Sentar/Cerrar/cancelar/etc.
  - Footer: botón **"Editar"** → `/reservas/[id]` (página completa, **se mantiene**).
- **Lazy-fetch** con `fetchSalonReservation` al abrir; tras cada transición,
  `router.refresh()` para reconciliar la fila del listado.

---

## 6. Feature 3 — Navegación por día en el listado

**Archivos:** `reservas/page.tsx`, nuevo `<DayNavigator>`, `reservations-filters.tsx`.

### UX
- Nuevo searchParam **`day`** (YYYY-MM-DD). **Default = hoy** (`America/Argentina/Cordoba`).
  Con `day` activo, la query usa `dateFrom = dateTo = day`.
- **`<DayNavigator>`** sobre el listado: `‹  Jueves 12/06 ▾  ›` (flechas + date
  picker) + botón **"Hoy"**. Cambia `day` y refresca.
- Arriba, contador contextual **Cubiertos: X/Y** del día (reusa `fetchDayCapacity`).
- El **filtro de rango** (from/to) queda en el sheet "Más" como modo avanzado:
  si hay rango activo, se muestra el rango y se oculta el stepper con un link
  "volver a vista por día" (que limpia from/to y vuelve a `day`).

### Server
- `page.tsx` resuelve `day` → `dateFrom/dateTo`; mantiene compat con `from/to`
  explícitos (modo rango tiene prioridad si está presente).

---

## 7. Feature 4 — Calendario de salón: popup del día + reservas normales + tope

**Archivos:** `eventos/programados/_components/scheduled-events-month.tsx`,
`eventos/programados/page.tsx`, nuevo `<DayReservationsDialog>`,
`lib/salon/queries.ts` (+ client action).

### UX
- **Celda del día:** además de los formatos draggables actuales, un **badge de
  capacidad `48/60`** = cubiertos en zonas (PA+PB) / tope total del salón.
  Color verde / ámbar (≥90%) / rojo (overbooking), reusando la lógica de
  `capacity-header`.
- **Click en la celda** (no sobre un evento ni el `+`) → **`<DayReservationsDialog>`**:
  - Encabezado: fecha + **Cubiertos X/Y** grande + desglose **PA x/y · PB x/y**
    y mini-contador por evento del día.
  - **Listado de todas las reservas del día** (normales + especiales + por
    evento), cada fila con `StatusPill` + datos; click en una fila → gestión
    rápida (mismo `<ReservationStatusControls>`), o link a "Ver/Editar".
  - Botón **"Nueva reserva"** con la fecha prefijada (`/reservas/nuevo?date=…`).
- Las **reservas normales** (zona PA/PB, `kind=normal`) — que hoy no aparecen en
  este calendario — quedan visibles vía este listado y cuentan en el badge.

### Datos
- **Nueva query `getMonthCapacity(tenantId, ym)`** → mapa `día → {used, total}`,
  resuelta con 2–3 queries agregadas:
  1. Suma de comensales por `(reservation_date, zone)` sobre `salon_reservations`
     del mes, excluyendo `cancelled/no_show`, zona ≠ `event_floating`
     (`used` por zona); usa `actual_guests` si `status=closed`, si no `estimated_guests`.
  2. Overrides del mes desde `salon_zone_capacity_overrides`.
  3. Caps default desde `tenants.settings->'salon_capacities'`.
  - `total` por día = `cap(PA) + cap(PB)` (con override aplicado).
- *Descartado:* loop de `evaluate_day_capacity` por día (~31 RPC/mes) o un RPC SQL
  `evaluate_month_capacity` (más trabajo, beneficio marginal).
- El popup reusa `fetchDayCapacity` (per-bucket exacto) + `fetchReservationsForDate`.

---

## 8. Feature 5 — Torta y champagne más claro

**Archivos:** `reservation-form.tsx` (reemplaza `CountControl`).

- Nuevo `<BringsItemControl>`: toggle **¿Traen torta? Sí / No**; al elegir "Sí"
  aparece un **stepper de cantidad (1–2)** con el ícono. Igual para champagne.
- Mapea al rango existente del schema `0–2` (No = 0; Sí mínimo 1).
- Animación de entrada/salida del stepper consistente con el `AnimatePresence`
  ya usado en la sección de cumpleaños.

---

## 9. Migraciones

- **1 migración nueva**: política RLS `INSERT` para staff en
  `scheduled_event_templates` (no toca UPDATE/DELETE/SELECT existentes).
- Sin columnas nuevas → previsiblemente **sin** regenerar `types/database.ts`.
  Si la migración cambiara algo del schema relevante, correr `npm run db:types`.

---

## 10. Testing

### Unit (Vitest)
- `quickCreateScheduledTemplate`: dedupe de slug (colisión → `-2`, `-3`).
- `quickTemplateSchema`: validación de bordes.
- `getMonthCapacity`: agregación correcta de cubiertos por día/zona, aplicación
  de overrides, exclusión de `cancelled/no_show`, uso de `actual_guests` en `closed`.

### RLS
- Staff (cashier) **puede** insertar un `scheduled_event_templates`.
- Staff **no puede** UPDATE/DELETE un template existente (sigue owner-only).
- Otro tenant no ve los templates creados.

### Smoke manual (a documentar en el PR)
1. En `/reservas/nuevo`, `kind=Cumpleaños`: crear un formato nuevo desde el select
   → queda seleccionado; verificarlo luego en el catálogo.
2. En el listado, "Ver" abre popup; hacer Llegó → Sentar → Cerrar (con comensales
   reales); la fila se actualiza; "Editar" abre la página completa.
3. En el listado, usar `‹ ›` y "Hoy"; ver el contador de cubiertos del día.
4. En `/eventos/programados`, ver el badge `X/Y` en las celdas; clic en un día
   abre el popup con reservas normales + especiales y desgloses; "Nueva reserva"
   prefija la fecha.
5. En cumpleaños, el control de torta/champagne: Sí/No + cantidad.
6. Login con otro tenant → no ve formatos/reservas ajenas.

---

## 11. Fuera de alcance

- Cambios al motor de comisiones o a la máquina de estados.
- Drag & drop de reservas (no de formatos) en el calendario.
- Edición de la reserva dentro del popup (queda en `/reservas/[id]`).
- Hard-capacity lock / bloqueo de overbooking.
