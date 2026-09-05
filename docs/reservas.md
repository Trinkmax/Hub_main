# Reservas de salón + Comisiones — guía técnica

> Reemplaza el Google Form que llenaban Luz y Joaquin al conseguir reservas.
> Suma calendario de eventos programados, panel operativo en tiempo real,
> y motor de comisiones configurable por tenant.

---

## TL;DR

| Capa | Qué hay | Dónde |
|---|---|---|
| DB | 8 tablas nuevas + 5 RPCs + seeds HUB | `supabase/migrations/20260520*` |
| Server | Schemas zod, queries, Server Actions, motor TS de comisión | `lib/salon/*`, `lib/commissions/*` |
| UI manager | Lista, form, detalle, eventos programados, templates, config | `app/(manager)/[tenantSlug]/reservas/*`, `app/(manager)/[tenantSlug]/eventos/programados/*`, `app/(manager)/[tenantSlug]/configuracion/{comisiones,salon}/*` |
| UI salón | Panel operativo full-screen con Realtime | `app/(salon)/[tenantSlug]/salon/reservas-operativo/*` |
| Stats | Liquidación por gestor con drill-down | `app/(manager)/[tenantSlug]/estadisticas/comisiones/*` |
| Nav | Items "Operativo", "Reservas", "Comisiones" | `components/shell/nav-config.ts` |
| Tests | Motor TS (24 cases), schemas zod (24), RLS isolation | `tests/lib/commissions-engine.test.ts`, `tests/lib/salon-schemas.test.ts`, `tests/rls/salon-reservations.test.ts` |

---

## Modelo de datos

```
reservation_managers          ← quién puede figurar como gestor de una reserva
scheduled_event_templates     ← Sushi Libre, Pizza Libre, Ramen, etc.
scheduled_events              ← instancias calendizadas (fecha + cupo)
salon_zone_capacity_overrides ← override puntual por (zona, fecha)
salon_reservations            ← la reserva del Google Form
commission_rate_tiers         ← matriz (meal_type × rango personas → cents/persona)
commission_bonus_rules        ← bonus full event (configurable por tenant)
commission_ledger             ← snapshot por reserva × gestor
```

### Gestores — el equipo entra solo

`reservation_managers` arrancó como un ABM 100% manual (Configuración →
Comisiones → tab «Gestores»). Nadie lo mantenía: HUB terminó con **un solo
gestor activo** y el combo "Gestor principal" ofrecía un único nombre aunque
el bar tuviera diez cuentas cargando reservas.

Desde `20260806190000_reservation_managers_from_memberships`:

- Un trigger `after insert on memberships` llama a
  `provision_reservation_manager(tenant, user)` → **todo miembro del equipo
  tiene su gestor espejo**, con el nombre de su cuenta y `commission_eligible
  = false` (la plata la habilita el dueño a mano).
- Un trigger `after delete on memberships` lo pone `active = false`. Nunca se
  borra: `salon_reservations` y `commission_ledger` lo referencian con
  `on delete restrict` y hay que preservar el historial.
- Los gestores **sin cuenta** siguen existiendo (una recepcionista que no usa
  la app, un turno genérico): se cargan a mano en el ABM. Si más adelante esa
  persona recibe cuenta y el `display_name` coincide, la provisión **vincula
  la fila existente** en vez de duplicarla; si no coincide, el dueño la
  vincula desde la columna "Cuenta del equipo".

En el form, el combo agrupa en **Equipo** (con cuenta) y **Otros gestores**, y
marca "Vos" + "$$" (cobra comisión) — ver `lib/salon/managers.ts`. El default
es *el último gestor usado en ese dispositivo* y recién después "sos vos":
quien carga la reserva no siempre es quien la tomó, y un default silencioso
mueve la comisión de persona.

### Capacidad — dos dimensiones simultáneas

- **Por zona** (`Planta Alta`, `Planta Baja`): default vive en
  `tenants.settings->>'salon_capacities'`. Override por fecha en
  `salon_zone_capacity_overrides`.
- **Por evento programado** (`scheduled_events.capacity`): cada instancia
  tiene su cupo.

Una reserva consume del bucket según estas reglas (ver `evaluate_day_capacity`):

| `zone` | `kind` | template.consume_special_reservations | Bucket de zona | Bucket de evento |
|---|---|---|---|---|
| `planta_alta` | cualquier | — | `zone:planta_alta` | — |
| `planta_baja` | cualquier | — | `zone:planta_baja` | — |
| `event_floating` | cualquier | — | `zone:event_floating` | `event:<scheduled_event_id>` |
| `planta_alta`/`baja` | `special` | true | `zone:<zona>` | `event:<scheduled_event_id>` |
| `planta_alta`/`baja` | `special` | false | `zone:<zona>` | — |

Los dos ejes son **ortogonales**: la zona dice *dónde se sienta*, el evento dice
*a qué vino*. Una reserva cae en exactamente UN bucket de zona (por eso sumar
los tres `zone:*` da el total del día sin doble conteo) y, si está atada a un
evento, además suma a su `event:<uuid>`. Nunca sumes zonas + eventos.

**Cubiertos = todo el mundo.** Hasta 08/2026 el contador del día sumaba solo
`planta_alta + planta_baja`, así que un día con 30 a la carta + 12 de Sushi
Libre mostraba **30** — mientras la misma pantalla en modo "Este mes" mostraba
42. Hoy el criterio es uno solo en todas las superficies (`summarizeDayCovers`
en `lib/salon/covers.ts`, y `aggregateMonthCapacity` para el mes):

- **Cubiertos del día** = las tres zonas, contra el tope físico `cap(PA) +
  cap(PB)`. La gente del evento igual ocupa mesa; el semáforo ámbar/rojo usa el
  total. El bucket `zone:event_floating` viene con `capacity = 0` a propósito:
  no tiene tope propio, el que le aplica es el del salón.
- El chip de cada evento (`EventLoad`, ej. `4/110`) es **el cupo del evento**:
  toda reserva activa colgada de ese `scheduled_event`, igual que el número que
  muestra su detalle. Es otro control, no un segundo cubierto.

Los dos usan `actual_guests ?? estimated_guests`: el comensal real pesa apenas
la mesa lo carga, sin esperar al `closed`.

### Estado de la reserva — máquina

```
pending → arrived → seated → closed
              ↓
            no_show / cancelled  (terminales)
```

Cada transición legal está enumerada en `transition_reservation_status`.
Reversiones permitidas: `arrived → pending`, `seated → arrived`,
`closed → seated` (no expira por fecha — la valida el operador con AlertDialog).

---

## Comisiones — reglas HUB

Las tarifas viven en `commission_rate_tiers` (configurables por tenant).

**Desayuno / Almuerzo / Merienda** (cents):

| Personas | Por persona |
|---|---|
| 1–7 | $140 |
| 8–15 | $160 |
| 16–30 | $180 |
| 31+ | $220 |

**Cena**:

| Personas | Por persona |
|---|---|
| 1–7 | $90 |
| 8–15 | $120 |
| 16–30 | $130 |
| 31+ | $140 |

**Bonus full event**: +$200/persona si la suma de personas en el
`scheduled_event` alcanza o supera la capacidad. Configurable en
`commission_bonus_rules`.

**Split entre gestores**: si una reserva tiene `assistant_manager_id`
y ambos gestores son `commission_eligible=true`, se splittea 50/50 con
redondeo asimétrico (el primario se lleva el cent extra cuando es impar).
Si solo uno es eligible, recibe el 100%. Si ninguno, no se inserta entry.

**Auditabilidad**: `commission_ledger` guarda **snapshot** del rate
aplicado (no FK al tier), así un cambio de tarifa mid-mes no afecta
lo ya pagado. Entries con `paid_at != null` son inmutables.

**El sistema propone, los dueños aprueban** (migración `20260903130251`).
El flujo que definieron: los encargados cargan cuántos asistieron, los
dueños revisan el reporte de `/estadisticas/comisiones` y recién ahí marcan
pagado. Por eso la comisión SÍ se calcula sobre la asistencia
(`coalesce(actual_guests, estimated_guests)`): el número que sale del
sistema es una propuesta, no una liquidación — hay una persona revisando
antes de que sea plata.

Dos cosas se calculan sobre lo **reservado** a propósito, y no cambian con
la asistencia:

- **La tarifa.** `commission_rate_tiers` tiene escalones (cena: 1-7 $90,
  8-15 $120, 16-30 $130, 31+ $140). Con el escalón atado al número real,
  una cena de 16 a la que venían 15 caía de $130 a $120 el cubierto: esa
  única persona costaba $280 cuando el cubierto vale $130. Es una
  penalización por cruzar un borde, no cobrar por lo real.
- **El bonus de evento lleno.** "Lleno" es que se agotó el cupo, y el cupo
  se agota cuando se vende. Además vuelve determinístico un bonus que antes
  cambiaba según por dónde se hubiera cargado el número.

**Lo pagado es inmutable.** `commission_ledger` tiene UNIQUE
(reservation_id, manager_id) y el recálculo borra las impagas y reinserta;
si el gestor ya cobró esa reserva, el recálculo lo saltea. Antes chocaba
contra el índice y la operación fallaba entera — un camino que pasó de raro
a frecuente en cuanto los encargados empezaron a cargar asistencia de días
pasados. En un split 50/50 se evalúa por gestor: si el primario cobró y el
asistente no, el asistente se recalcula igual.

**Cuidado con el reporte**: hay reservas sin conteo, y esas se proponen
sobre el estimado. Las dos tablas de `/estadisticas/comisiones` lo marcan
("+N s/contar" en el resumen, "sin contar" en el detalle) para que nadie
apruebe plata sobre un número que nadie midió.

**Recálculo idempotente**: `recalc_reservation_commission` borra las entries
no pagadas de la reserva y reinserta según tarifas vigentes. Se dispara al
cambiar de estado la reserva, al editarla, al actualizar `actual_guests`, o
cuando el evento entero se llena (cascade sobre todas sus reservas).

---

## Realtime

Panel operativo (`/salon/reservas-operativo`) escucha cambios en:
- `salon_reservations` (filter `tenant_id`)
- `scheduled_events` (filter `tenant_id`)

Estrategia anti-flicker:
- `mergeRow` + filter por fecha en JS (Realtime no soporta `date=eq.x` cómodo).
- `useDebouncedRefresh(refresh, 600)` para coalescer ráfagas de cambios de capacidad.
- Safety-net `setInterval(refresh, 30s)` por si Realtime pierde un evento.
- Optimistic updates: las transiciones de estado se animan local antes de
  que llegue el confirm de Realtime; `mergeRow` deduplica por `id`.

---

## Aplicar la migración

```bash
# 1. Arrancar Supabase local (necesita Docker)
npm run db:start

# 2. Reset completo con todas las migraciones + seeds
npm run db:reset

# 3. Regenerar tipos TypeScript desde el schema actualizado
npm run db:types

# 4. Tests
npm test
```

Los seeds HUB se aplican automáticamente con `db:reset` siempre que el
tenant `hub` exista (lo crea `supabase/seed.sql`). Si no existe, los seeds
de reservas hacen no-op silencioso.

### Producción remota

```bash
# Para aplicar a un proyecto Supabase remoto (CUIDADO con rename de reservations):
npm run db:push

# Revisar el diff antes con:
npm run db:diff
```

> **IMPORTANTE — rename destructivo**: la migración
> `20260520000000_rename_legacy_reservations.sql` renombra la tabla
> `public.reservations` (sistema viejo de eventos masivos) a
> `public.event_attendees` para liberar el nombre `reservations` a la
> nueva entidad de negocio. En el commit se actualizan los 4 archivos
> dependientes: `lib/events/{reservations,queries}.ts`,
> `lib/flows/triggers.ts`, `tests/rls/events.test.ts`. Si tu deploy
> tiene workers o cron jobs externos que llaman `create_reservation`
> directo a Postgres, necesitan actualizarse a
> `create_event_attendance` etc.

---

## UX del form en < 30 segundos

1. Tap "Nueva reserva" desde sidebar (`Cmd/Ctrl + K` futuro).
2. Combobox cliente → autocomplete con phone (`searchCustomers` debounced 200ms).
3. Quick chip de fecha (Hoy / Mañana / Viernes / Sábado).
4. Segmented service + zone radio cards (tap-friendly grandes).
5. Stepper de personas con +/− (incremento rápido).
6. Capacity bar inline anima a medida que sumás (verde → amber → rojo overbooking).
7. Comisión estimada calculada client-side (motor TS, paridad con SQL).
8. `Cmd/Ctrl + Enter` para submit.

---

## Smoke manual (PR template)

Antes de mergear, verificar localmente:

- [ ] `npm test` verde (motor + schemas + RLS)
- [ ] `npm run typecheck` sin errores
- [ ] `npm run lint` verde
- [ ] Crear reserva desde `/reservas/nuevo` con cliente nuevo + horario + capacidad mostrada
- [ ] Cambiar a `kind=Cumpleaños` y validar que aparecen cake/champagne steppers
- [ ] Cambiar a `zone=Sujeta a evento` y validar que aparece selector de evento programado
- [ ] Crear evento programado en `/eventos/programados/nuevo` para mañana
- [ ] Abrir panel operativo en `/salon/reservas-operativo`, ver las barras de capacidad y la reserva creada
- [ ] Hacer transición `Llegó → Sentar → Cerrar mesa` con cantidad real, ver que se anima
- [ ] Como owner, abrir `/estadisticas/comisiones` y ver la entry generada en el mes actual
- [ ] Login con otro tenant (o usuario sin membership) y verificar que `/reservas` devuelve `notFound`

---

## Próximos pasos (post-MVP)

- Drag & drop para mover reservas entre zonas (panel operativo).
- Tabla materializada `daily_capacity_snapshot` con `pg_cron` si escalamos a cadenas con >1000 reservas/día.
- Asignación opcional de `physical_table_id` a la reserva.
- Hard-capacity lock (flag tenant) — hoy permite overbooking voluntario.
- Vista "mi liquidación" para que cada gestor vea sus propias comisiones.
- Recibo PDF de comisión por gestor/período.

---

## Addendum 2026-06 — Mejoras UX

- **Alta inline de formato**: en el alta de reserva (cumpleaños/especial) hay un
  botón "Crear formato nuevo" que inserta un `scheduled_event_templates` con
  campos mínimos. Lo puede usar staff (owner + cashier) — policy RLS
  `set_staff_insert`. La edición/borrado de formatos sigue siendo owner-only.
- **Popup de gestión rápida**: "Ver" en el listado abre `ReservationQuickView`
  (datos + controles Llegó/Sentar/Cerrar/cancelar). La edición a fondo sigue en
  `/reservas/[id]`. Los controles viven en `components/reservations/`.
- **Vista por día**: `/reservas` usa el param `?day=YYYY-MM-DD` (default hoy) con
  stepper de flechas + "Hoy" + contador de cubiertos. El rango (`from`/`to`)
  queda como filtro avanzado.
- **Calendario**: `/eventos/programados` muestra un badge `used/total` por día y
  un popup (`DayReservationsDialog`) con el listado completo de reservas del día
  y el desglose de capacidad. Capacidad mensual: `getMonthCapacity` +
  `aggregateMonthCapacity`.
- **Torta/champagne**: selector con toggle Sí/No + stepper de cantidad
  (`BringsItemControl`).
- Bonus condicional por día de semana o estacionalidad.

---

## Addendum 2026-09 — Servicios, festejos y tortas

Tres pedidos del dueño del HUB, con el mismo diagnóstico de fondo: **la agenda
mostraba todo al mismo nivel y lo importante se perdía adentro**.

### 1. La agenda cortada por servicio

> "Necesito que muestres las reservas filtrado por desayuno, almuerzo, merienda
> y cena. Algo como desayuno: X reservas en salón, X en terraza — actualmente
> está todo junto y se mezcla para poder leerlo."

Armar el salón es una decisión **por servicio**, no por día: la merienda de 12
personas a las 17:00 y la cena de 2 a las 22:30 no comparten nada. Ahora:

- `lib/salon/services.ts` — `groupByService()` corta las filas por `meal_type`
  (orden cronológico, que coincide con el `enumsortorder` del enum en Postgres)
  y devuelve por servicio: cubiertos, **desglose por zona** (cubiertos **y**
  mesas: 38 personas pueden ser 9 mesas o 19, y para armar el salón hacen falta
  las dos), reservas activas, cumpleaños, tortas y la franja horaria real. Es genérico sobre `ServiceRow`
  (7 columnas), así que sirve tanto con reservas completas como con la query
  liviana del día.
- `components/reservations/service-summary.tsx` — el encabezado: barra apilada
  con la proporción por zona (`--chart-1` PA, `--chart-4` PB, `--chart-3`
  evento) + números. La proporción se lee antes que los dígitos.
- `/reservas` en modo día: chips de filtro (`?servicio=dinner`) y la tabla
  agrupada por servicio en vez de una lista plana. En modo rango se conserva el
  agrupado por día y el subheader suma el desglose por servicio.
- **`PAGE_SIZE_DAY` pasó de 25 a 200**: un servicio partido entre la página 1 y
  la 2 rompía justo lo que el corte vino a arreglar. El día más cargado del HUB
  tiene 33 reservas.
- Los contadores de los chips salen de `listDayServiceRows()` (el día entero),
  **no** de la página cargada: si salieran de la página, filtrar por Cena
  dejaría Merienda en 0 y no habría cómo volver.

### 2. Cumpleaños y eventos, al mismo nivel

> "El lunes 21 tenemos pizza libre. Metí un cumple de 15 que también va a comer
> pizza libre de casualidad. El problema es que es un cumple y lleva torta y se
> ve como pizza libre: no lo vamos a identificar. Debería ser cumpleaños y
> eventos como si fueran lo mismo, no el cumpleaños dentro del evento."

Es una corrección de **lectura**, no de datos: la reserva sigue colgada del
evento (consume su cupo y liquida su comisión). Lo que cambia es dónde se lee.

- `lib/salon/day-highlights.ts` — `buildDayHighlights()` mezcla eventos
  programados y celebraciones (`kind = birthday | special`) en una sola lista
  ordenada por hora. A igual hora el evento va primero: es el marco, la
  celebración pasa adentro. Las canceladas y no-show quedan afuera (un hito es
  algo que hay que preparar).
- `components/reservations/day-highlights.tsx` — el renglón "Lo que pasa este
  día". El cumple conserva **su zona real** (Planta Alta, aunque venga al
  evento) y dice a qué evento viene. Sin estado: se usa igual desde el RSC de
  `/reservas` y desde el diálogo del calendario.
- El calendario mensual marca los días con festejo (`monthCapacity.celebrations`
  → `CelebrationBadge`): a nivel mes el 21/09 decía "Pizza libre" y nada más.
- La lista de reservas de un evento (`EventReservationsList`) marca "Cumple" /
  "Especial" con pastilla propia.

### 3. Qué torta va — catálogo por bar

> "Agregamos la opción de personalizar la torta: cuando seleccionamos la opción
> que lleva torta, debería abrir un desplegable con las opciones. Cada torta
> trae dos rellenos."

La torta **la hace el bar**. Anotar "torta: 1" y no el sabor era el moco caro.

| Pieza | Dónde |
|---|---|
| Tabla `cake_options` (por tenant) + `salon_reservations.cake_option_id` | `supabase/migrations/20260904192724_cake_options_catalog.sql` |
| Schemas + actions CRUD (`upsertCakeOption`, `deleteCakeOption`, `reorderCakeOptions`) | `lib/salon/schemas.ts`, `lib/salon/actions.ts` |
| Editor del dueño | `/[slug]/configuracion/tortas` |
| Selector en el alta/edición de reserva | `components/reservations/cake-option-picker.tsx` |
| Chip de lectura (todas las pantallas) | `components/reservations/cake-chip.tsx` |

Decisiones:

- **Tarjetas, no un `<select>`.** Quien carga la reserva está eligiendo por
  teléfono con el cliente del otro lado: tiene que poder dictarle los tres
  bizcochuelos con sus rellenos de un vistazo. Son `<input type="radio">`
  visualmente ocultos, así que se navega con flechas.
- **"Todavía no saben cuál" es una opción de verdad**, no la ausencia de una: la
  reserva entra hoy y el sabor se decide después. Sin ese botón, "no elegí" y
  "eligieron y se borró" se ven igual. El chip lo muestra en ámbar: es una
  tarea pendiente del bar.
- **Una opción por reserva** (no una por torta). `cake_count` llega a 2 y en 194
  reservas históricas solo 2 tienen dos tortas; para ese caso raro con dos
  sabores distintos está el comentario. A cambio la opción viaja gratis en el
  `select *` que ya hacen todas las pantallas, con un solo join más.
- **`on delete restrict`** en la FK: borrar una opción que alguna reserva ya
  eligió dejaría a la cocina sin saber qué hacer. El editor solo ofrece borrar
  la que nadie usó; para el resto, desactivar (sale del selector, la historia
  queda intacta).
- **`cake_option_id` es "ausente ≠ vacío"** en la action de update, igual que
  los avisos de servicio y el horario de fin: el popup del listado manda un
  payload completo cada vez que se mueve la hora, y sin esa guarda cada toque
  borraría qué torta hay que hacer. `cake_count = 0` sí la limpia siempre.

### Seed HUB

```
Opción 1 · Bizcochuelo de vainilla   → Dulce de leche · Crema chantilly y frutillas
Opción 2 · Bizcochuelo de chocolate  → Mousse de chocolate · Crema y frutillas
Opción 3 · Bizcochuelo de vainilla   → Dulce de leche · Crema y durazno
```

### Correcciones de la revisión adversarial

El diff pasó por un panel de revisores por dimensión + verificación adversarial
(3 refutadores por hallazgo). Lo que sobrevivió y se arregló:

- **El filtro `?servicio=` quedaba pegado.** Los chips —única UI que lo pone y
  lo saca— se ocultaban con menos de dos servicios, así que filtrar "Merienda" y
  pasar a un día que es todo cena dejaba la lista vacía sin forma de volver.
  Ahora los chips se dibujan siempre que el filtro esté puesto (con el servicio
  elegido en 0 si ese día no tiene), "Limpiar" lo conoce, y cambiar de período
  lo borra (en modo rango no hay chips que lo muestren y la barra decía
  "130 reservas" arriba de 8).
- **Los hitos del día mezclaban dos fuentes.** Los eventos venían de su propia
  query y los festejos de la página YA filtrada: con `?zone=` puesto el panel
  mostraba "Pizza libre" y cero cumpleaños — el moco original de vuelta. Ahora
  las celebraciones tienen su propia query (`listDayCelebrations`) y hablan del
  día, no de la página.
- **La torta era inalcanzable si la reserva no era cumpleaños.** Hay una fila
  real así (28/05, `kind='normal'`, 2 tortas): mostraba el aviso ámbar "falta
  elegir torta" y el bloque para elegirla no se renderizaba. El bloque ahora se
  abre con `kind === 'birthday' || cake_count > 0 || champagne_count > 0`, y esas
  reservas también suben al renglón de hitos (variante `cake`).
- **Tres números para la misma pregunta.** El chip "Todo el día" contaba sin
  no-show y el header los contaba como activas. Ahora el chip cuenta lo que se
  lista.
- **Contraste.** `text-warning-foreground` es para ir sobre el ámbar SÓLIDO:
  sobre un tinte al 10% daba 1.3:1 en dark y el aviso "Falta elegir torta" —
  justo el que la feature vino a hacer visible— desaparecía. Se pasó a
  `text-foreground` con el ícono tintado, el patrón que el repo ya usa.
- **`--chart-1` y `--chart-3` son el mismo ámbar en dark** (ΔE 0.044): la barra
  de zonas se leía como un bloque. "En evento" pasó a `--chart-2` (terracota).
- **La FK de la torta fallaba en las dos direcciones con el mismo mensaje.**
  Borrar una torta en uso y elegir una torta borrada daban ambas "Desactivala en
  vez de borrarla" — imposible de seguir en el segundo caso. Ahora se discrimina
  por el verbo del mensaje de Postgres.
- **Integridad multi-tenant (migración `20260904204655`).** La FK simple dejaba
  meter la torta de OTRO bar en una reserva: RLS filtra filas al leer, no valores
  al escribir. Se pasó a FK compuesta `(cake_option_id, tenant_id) →
  cake_options(id, tenant_id)`, con test de RLS
  (`tests/rls/cake-options.test.ts`). De paso se sacó el `default '{}'` de
  `fillings`, que chocaba con su propio CHECK.
- **Editor de tortas**: el reorder numeraba sobre las guardadas y el alta sobre
  la lista completa, así que un borrador en el medio dejaba dos tortas
  empatadas; la `position` ahora viaja explícita desde el índice visible. Y la
  `key` de React ya no cambia al guardar (cambiaba de `nueva-0` al uuid y
  `AnimatePresence` desmontaba la tarjeta recién guardada, con pérdida de foco).
- **`/configuracion/tortas` era inalcanzable en mobile**: el nav lateral de
  Configuración es `lg:block` y la card apuntaba a Capacidad. Ahora Tortas tiene
  su propia card.
- **Realtime**: `mergeRow` conserva los joins viejos a propósito, así que en el
  panel del mozo el chip decía "Falta elegir torta" con la torta ya elegida (o
  mostraba la anterior). `CakeChip` recibe además `cake_option_id` y distingue
  "nadie eligió" de "el join no vino".

### Tests

- `tests/lib/salon-services.test.ts` — corte por servicio, zonas, canceladas,
  franja horaria, totales.
- `tests/lib/salon-day-highlights.test.ts` — el caso real 21/09 (Pizza libre +
  cumple de 15 con torta), orden, zona real, cubiertos por evento.
- `tests/lib/salon-cake-options.test.ts` — schema del catálogo, `describeCake` y
  los mensajes de error de la FK en sus dos direcciones.
- `tests/rls/cake-options.test.ts` — quién lee y quién escribe el menú, y que la
  torta de un bar no entre en la reserva de otro (corre en el job `rls` de CI).
- `tests/lib/salon-schemas.test.ts` — `cake_option_id`: uuid / vacío→null /
  ausente→undefined.

### Smoke manual

1. `/hub/reservas` en un día con varios servicios → aparecen los chips
   "Todo el día · Merienda 3 · Cena 12" y la tabla queda cortada por servicio
   con la barra de zonas.
2. Tocar "Cena" → la URL queda `?servicio=dinner`, la lista muestra solo cena y
   los otros chips **siguen mostrando su número**.
3. `/hub/eventos/programados` → el 21/09 tiene el badge 🎂 en la celda; abrir el
   día muestra "Pizza libre" y, debajo y al mismo nivel, la tarjeta de
   cumpleaños de Lourdes Roldan con 15p, Planta Alta, "en Pizza libre" y el chip
   de la torta.
4. `/hub/configuracion/tortas` → editar un relleno, guardar, ver el preview.
   Intentar borrar la Opción 2 (ya elegida) → el editor ofrece desactivar.
4b. En un día con dos servicios, cada encabezado dice `Cena · 62 cubiertos ·
   12 reservas` y abajo `Planta Alta 38 (9 mesas) · Planta Baja 16 (4 mesas) ·
   En evento 8 (2 mesas)`. Las tres zonas suman los cubiertos del servicio.
5. `/hub/reservas/nuevo` → Cumpleaños → "¿Lleva torta?" Sí → se abre el
   desplegable con las 3 opciones; elegir la 2 y guardar; abrir la reserva y
   confirmar que quedó.
6. Desde el popup del listado, mover la hora de esa reserva → la torta **sigue
   elegida** (regresión de "ausente ≠ vacío").

## Addendum 2026-09 — El tablero operativo (`/[slug]/operativo`)

Rediseño total de la pantalla que usan el dueño y la anfitriona durante el
servicio, pensada como app de celular (acceso directo / PWA) y con
master-detail en desktop. Lo que era una lista plana con botones pasó a ser
un tablero que late con el salón.

### Qué hace

- **Pulso de la noche**: cubiertos adentro sobre reservados (ticker), barra
  apilada en cubiertos (adentro · atrasados rayados · por llegar · no vinieron),
  pico estimado con sparkline de 30′, hitos del día (eventos con cupo, tortas,
  cumples). Las píldoras de la leyenda son alias de los filtros de la lista.
- **Barra de trabajo sticky** (`top-14`, bajo el topbar del manager): búsqueda
  instantánea client-side por nombre, apellido de la ficha, dígitos del
  teléfono, mesa y gestor (sin tildes, palabras en cualquier orden; con
  búsqueda activa el filtro de estado se ignora), chips Todas · Por llegar ·
  Adentro · Terminadas con contadores, "N tarde" cuando hay atrasadas, y un
  mini-rail de progreso cuando el pulso salió de la vista. En mobile suma los
  botones "Escanear QR" y "Nueva reserva".
- **Lista por servicio, en orden de hora y NUNCA por estado**: marcar "Llegó"
  no mueve la tarjeta. La línea **AHORA · 21:42** se cuela donde corresponde y
  al abrir el día de hoy la pantalla hace scroll hasta ella (una vez).
- **Tarjeta**: el riel izquierdo es la HORA mientras espera (con "hace 25 min"
  en ámbar si se atrasó más de 15′) y pasa a ser la MESA en serif grande una
  vez adentro ("Mesa?" punteado si no se asignó). A la derecha, la acción del
  momento: "Llegó" (success, 44 px), tilde cuando entró, "Apareció" si se la
  había dado por no venida, "No vino" chico cuando ya está atrasada.
- **Ficha** (sheet inferior en mobile, aside pegado en desktop; un solo nivel,
  el contenido se reemplaza): acciones por estado, mesa y personas editables,
  avisos/torta/champagne/comentario, panel del club, datos fríos, historia del
  turno y link a la edición completa.
- **Llegó = un gesto**: contador (arranca en lo reservado) + mesa (input libre
  "12", "12+13", "Barra" con atajos de las mesas de la noche y aviso no
  bloqueante si otra reserva ya la tiene) + botón con label vivo "Confirmar · 6
  personas · Mesa 12". Una sola Server Action (`transitionStatus` acepta
  `table_label`).
- **Puntos del club desde la reserva**: si tiene socio, nivel + saldo + "ya
  sumó +120 pts a las 22:41"; "Sumar puntos" pide el monto en pesos, muestra en
  vivo cuántos suma y al confirmar el saldo cuenta hasta el nuevo. Si no tiene
  socio pero sí teléfono: "Vincular al club" (busca por teléfono o crea la ficha
  con `acquisition_channel = 'reservation'`). El anfitrión ve todo en lectura
  ("los puntos los suma caja"): `REDEMPTION_STAFF_ROLES` lo excluye y la RPC
  también.
- **Optimista + Deshacer**: llegó, no vino, cerrar mesa y los reversos cambian
  la fila al toque y dejan un toast de 6 s con "Deshacer". La única que confirma
  es "me equivoqué, no llegó" desde adentro (recalcula comisión). Si la action
  falla, se vuelve atrás y se explica.
- **Realtime** (canal `operativo-<tenant>-<fecha>`): lo que marca el mozo desde
  `/salon` aparece solo, con un tinte de 1,2 s en la fila. Guard de
  `updated_at` para que un payload viejo no pise un cambio optimista; refetch
  debounced tras un INSERT (llega sin joins); red de seguridad cada 60 s;
  pill "Sin conexión" con `navigator.onLine`.
- **Día de servicio**: hasta las **5 AM** "hoy" sigue siendo la noche anterior
  (`serviceDayInCordoba`), y el reloj del tablero sigue contando desde 24:00
  (`boardClockMinutes`) para que "hace 40 min" y la línea de AHORA sean verdad a
  la 1:30. Una reserva a las 00:30 se lee al final de la noche
  (`serviceMinutes`), no antes del desayuno. Solo aplica a `/operativo`; el
  salón y `/reservas` siguen con el día calendario.
- **Desktop**: `/` enfoca la búsqueda, `↑↓`/`j k` recorren, `Enter` abre,
  `Esc` limpia/cierra. Sin reserva elegida, el aside muestra el "pulso
  extendido" (ocupación por zona, eventos con cupo, tortas a preparar, salón
  armado).

### Modelo de datos y backend

- `salon_reservations.table_label text` (check 1..24 tras trim) — migración
  `20260905150000_reservation_table_label.sql`. Texto libre a propósito: se
  juntan mesas para los grupos y el plano físico vive detrás de feature-flag.
- `transition_reservation_status` admite `no_show → pending` y `no_show →
  arrived` — migración `20260905150100_transition_no_show_revert.sql`. Cancelada
  sigue siendo terminal.
- `RESERVATION_JOIN_SELECT` trae además `customer.points_balance` y
  `customer.tier(name, color)` (normalizado en `flattenReservation`).
- Actions nuevas en `lib/salon/actions.ts`: `updateReservationTableLabel`
  (STAFF, espeja `sr_staff_write`), `closeTable` (OPERATORS; encadena
  `arrived → seated → closed`), `linkReservationCustomer` (STAFF; busca por
  teléfono o crea, chequea el error del insert). `transitionStatus` acepta
  `table_label` (UPDATE posterior a la RPC; si falla, la llegada queda y se
  avisa). `updateSalonReservation` respeta "ausente ≠ vacío" para la mesa.
- `lib/points/queries.ts#listRecentQrAwards` + `fetchOperativoExtras`
  (capacidad + eventos + acreditaciones del día en una invocación).
- Lógica pura en `lib/salon/operativo.ts` (búsqueda, ranking, orden, franjas,
  pulso, mesas ocupadas, máquina de estados de la UI, día de servicio) y
  `lib/salon/update-payload.ts`.

### Tests

- `tests/lib/salon-operativo.test.ts` — reloj del servicio, franjas,
  búsqueda (tildes, orden, teléfono, mesa), orden estable, filtros, marcador de
  ahora, pulso, mesas, máquina de estados.
- `tests/lib/salon-schemas.test.ts` — `reservationTableLabelSchema`
  (trim/normalización, '' → null, ausente → undefined, tope) y `table_label`
  en la transición y en la edición completa.
- `tests/lib/operativo-board-render.test.tsx` — SSR del tablero entero con una
  noche realista (todos los estados, evento, torta, cancelada, trasnoche), día
  vacío y día futuro.

### Smoke manual (hacer en producción con el celular)

1. `/hub/operativo` un día con reservas → pulso con "N / M cubiertos", barra
   apilada, pico, hitos; barra de búsqueda pegada al scrollear; línea AHORA
   entre las reservas y el mini-rail verde bajo la búsqueda al pasar el pulso.
2. Escribir "gar" → solo García(s), resaltado, contador "2 coincidencias"; la
   búsqueda ignora el chip activo. Borrar con la × o Esc.
3. Tocar **Llegó** en una pendiente → sheet con contador (arranca en lo
   reservado) y mesa; poner "12" (o tocar un atajo), confirmar → la tarjeta
   pasa a verde, el riel muestra **12** grande, el toast ofrece Deshacer, el
   pulso tickea. Ver en `/hub/salon/reservas-operativo` (otro dispositivo) que
   aparece "Mesa 12" sin recargar.
4. Marcar **No vino** en una atrasada (botón chico bajo Llegó) → toast con
   Deshacer; tocar "Apareció" en la tarjeta → vuelve a pendiente.
5. Abrir una reserva adentro → cambiar personas con el stepper (se guarda solo)
   y la mesa desde el botón "Mesa" → "12+13". Dueño: "Cerrar mesa" → contador →
   cerrada; "Reabrir mesa" la devuelve.
6. Reserva con socio → "Sumar puntos" → $12.000 → "Suma 12 puntos" → confirmar
   → animación +12 pts, saldo nuevo, chip "+12 pts" en la tarjeta, "Ya sumó…"
   en la ficha. Entrar con un usuario `host` → el panel del club es solo
   lectura.
7. Reserva sin socio con teléfono → "Vincular al club" → aparece la ficha con
   saldo 0 y ya se puede sumar.
8. Flechas de fecha → mañana muestra el banner ámbar y no ofrece Llegó; ayer
   sí. A la 1:30 de la madrugada, "Hoy" sigue siendo la noche anterior.
9. Desktop ≥ 1024 px: la ficha se abre al costado; `/`, `↑↓`, `Enter`, `Esc`.
