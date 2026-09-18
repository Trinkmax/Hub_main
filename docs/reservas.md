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
| Stats | Señas por día (criterio reserva / carga, canceladas aparte) | `app/(manager)/[tenantSlug]/estadisticas/senas/*`, `lib/salon/deposits.ts` |
| Stats | Cómo nos fue: gente por noche y por evento | `app/(manager)/[tenantSlug]/estadisticas/como-nos-fue/*`, `lib/salon/events-report.ts` |
| Nav | Items "Operativo", "Reservas", "Comisiones", "Señas", "Cómo nos fue" | `components/shell/nav-config.ts` |
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
- [ ] Como owner, abrir `/estadisticas/comisiones` y ver la entry generada en el período por defecto (mes en curso); ver también el addendum 2026-09-18 para el filtro de rango
- [ ] Login con otro tenant (o usuario sin membership) y verificar que `/reservas` devuelve `notFound`

---

## Próximos pasos (post-MVP)

- Drag & drop para mover reservas entre zonas (panel operativo).
- Tabla materializada `daily_capacity_snapshot` con `pg_cron` si escalamos a cadenas con >1000 reservas/día.
- Asignación opcional de `physical_table_id` a la reserva.
- Hard-capacity lock (flag tenant) — hoy permite overbooking voluntario.
- ~~Vista "mi liquidación" para que cada gestor vea sus propias comisiones.~~
  Hecho: `/[slug]/mis-numeros` (ver addendum 2026-09-18).
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

### Exportar el listado (2026-09-05)

Botón **Exportar** en la cabecera de `/[slug]/reservas`: descarga una planilla
CSV con **todo lo que se está viendo** (el día o el rango elegido, con los
filtros activos: búsqueda, estado, zona, servicio, gestor), sin paginar y
ordenado por fecha, hora (la madrugada al final de su noche) y nombre. Abre
directo en Excel/Sheets: separador `;`, BOM UTF-8 (tildes bien), fechas
`dd/MM/yyyy`, seña en pesos, avisos y estados con las palabras del bar.

- Ruta: `GET /api/reservas/export?slug=&day=|from=&to=&q=&status=&zone=&servicio=&manager=`
  (`app/api/reservas/export/route.ts`). Solo owner/cashier/host
  (`RESERVATION_STAFF_ROLES`); cada descarga queda en `audit_log`
  (`salon_reservations.exported`, con período y cantidad, sin PII).
- Lógica pura en `lib/salon/export.ts` (`sortForExport`, `reservationToExportRow`,
  `reservationsToCsv`, `exportFilename`); query `listSalonReservationsForExport`
  comparte los filtros con el listado (`applyReservationFilters`). Tope de
  2000 filas: si se supera, la respuesta lleva `X-Export-Truncated: true`.
- Tests: `tests/lib/salon-export.test.ts`.
- Smoke manual: en un día con reservas, tocar **Exportar** → baja
  `reservas-hub-2026-09-05.csv`; abrirlo en Excel → columnas separadas, "García"
  con tilde, filas en orden de hora y nombre; con "Esta semana" activo el
  archivo se llama `reservas-hub-<lunes>_<domingo>.csv` y trae toda la semana.

---

## Addendum 2026-09 — Reporte de señas (`/[slug]/estadisticas/senas`)

Lo pidió el dueño así: *"un reporte del dinero que ingresa por señas, que me
muestre cuánto ingresó por día, teniendo en cuenta todas las reservas"*.

### Las dos decisiones que definen los números

**1. Dos criterios de fecha, con interruptor.** No existe una fecha de cobro
guardada: `salon_reservations.deposit_cents` es la única columna de plata de
seña en todo el schema, y no hay tabla de pagos ni de devoluciones. Entonces el
día se puede leer de dos maneras y ninguna es "la correcta":

| Criterio | Columna | Qué contesta |
|---|---|---|
| **Día de la reserva** (default) | `reservation_date` | Cuánta seña respalda cada fecha de servicio. |
| **Día de carga** | `created_at` en `America/Argentina/Cordoba` | Cuánta plata entró ese día. |

No son intercambiables: septiembre 2026 daba **$3.347.304** por fecha de reserva
y **$2.679.304** por fecha de carga (20% de diferencia), y los días más altos ni
siquiera coinciden. Por eso el criterio activo está siempre rotulado y el
subtítulo explica qué está midiendo.

**2. Las canceladas y las no-show SUMAN, pero se muestran aparte.** La plata
entró igual (el bar en general se la queda). Al revés que `covers.ts`,
`month-capacity.ts` y `getRangeReservationTotals` —que descartan esos estados
porque cuentan cubiertos—, acá contamos plata. La barra del día viene partida y
hay una StatCard propia. **No copiar `.not('status', 'in', '(cancelled,no_show)')`
en este agregador**: borra $79.004 reales de septiembre.

### Piezas

| Qué | Dónde |
|---|---|
| Agregador puro (buckets, totales, mediana, CSV) | `lib/salon/deposits.ts` |
| Query + bordes del histórico | `getDepositsByDay` / `getDepositsBounds` en `lib/salon/queries.ts` |
| Helpers de zona horaria | `cordobaDayStartUtc`, `nextIsoDay`, `isoDayInCordoba`, `eachIsoDayInclusive` en `lib/salon/date-presets.ts` |
| Pantalla (owner-only) | `app/(manager)/[tenantSlug]/estadisticas/senas/*` |
| Planilla | `GET /api/senas/export?slug&from&to&fecha` |
| Tests | `tests/lib/salon-deposits.test.ts` (21 casos) |

### Detalles que no son obvios

- **El rango viene denso.** El agregador devuelve un bucket por día del rango,
  con ceros. Entre la primera y la última reserva del HUB, el 74% de los días de
  calendario no tiene ninguna: sin ceros el gráfico no tendría eje continuo.
  Y un día con reservas y sin señas se pinta como una rayita, no como un hueco:
  "nadie dejó seña" es información distinta de "no hubo nada".
- **El relleno denso tiene tope (`MAX_DENSE_DAYS`, 800 días) y el agregador NO
  se apoya en él para decidir qué cuenta.** Si una fila cae dentro de
  `[from, to]` pero fuera de la lista rellenada, `aggregateDepositsByDay` crea
  el bucket al vuelo y ordena. Al revés —confiando en la lista— un histórico más
  largo que el tope descartaba plata en silencio: los totales se suman
  recorriendo los días, no las filas, así que no habría quedado ningún rastro.
- **Las fechas de la URL se validan de verdad.** `2026-13` o `2026-02-31` pasan
  un regex de forma pero no existen: Postgres devuelve 22008 y `fromZonedTime`
  un `Invalid Date`. El mes cae al actual (`YM_RE` exige 01-12 y un año
  plausible) y el CSV devuelve 400 (`isRealIsoDay`), no un 500.
- **Mediana y promedio, los dos.** En septiembre difieren ($106.502 vs
  $138.887) porque una sola seña de $254.300 corre el promedio. La línea
  punteada del gráfico es la mediana.
- **`created_at` se filtra con instantes UTC** (`fromZonedTime`) en rango medio
  abierto `[00:00 del from, 00:00 del to+1)`. El Postgres del proyecto corre en
  UTC: una carga de las 21:00 de Córdoba —horario pico— cae al día siguiente si
  se compara contra un `yyyy-MM-dd` pelado.
- **`requireRole(['owner'])` explícito** en la página y en la route del CSV: la
  RLS `sr_select_member` deja leer `deposit_cents` a cualquier miembro del
  tenant, mozo y cocina incluidos.
- **Techo de 1000 filas + flag `truncated`.** PostgREST corta sin error; un
  reporte de plata truncado daría un total equivocado sin ningún síntoma.
- **El CSV va en pesos enteros sin símbolo** y escribe `0` en los días sin seña
  (al revés que `lib/salon/export.ts`, que deja la celda vacía): es una serie
  temporal y un hueco rompe cualquier gráfico hecho en Excel.

### Smoke manual

> Las cifras de abajo son del 08/09/2026 y la base está viva: si no dan
> exactas, contrastá contra el SQL del día, no contra este texto. Lo que tiene
> que cerrar siempre es pantalla = CSV = `GROUP BY` en Postgres.

1. `/hub/estadisticas/senas` como owner → abre en el mes actual con **Día de la
   reserva** activo. Septiembre 2026: total **$3.347.304**, vigente
   **$3.268.300**, canceladas/no vino **$79.004**, 195 de 213 reservas con seña.
2. Cambiar a **Día de carga** → la URL pasa a `?fecha=carga`, aparece el aviso, y
   los totales cambian a **$2.679.304** (vigente $2.608.300, caídas $71.004,
   171 reservas). Día más alto: **08/09 $586.304**.
3. ← Mes anterior hasta junio 2026 → mes casi vacío, con días que tienen
   reservas y cero señas (11/06 y 21/06): en el gráfico se ven como rayita.
4. **Todo el histórico** → ~162 días, el eje pasa a rotular meses en vez de días
   y el total tiene que coincidir con `sum(deposit_cents)` de todo el tenant.
5. Exportar en los dos criterios → bajan `senas-hub-…csv` y
   `senas-hub-carga-…csv`, abren en columnas en Excel es-AR y la columna Total
   suma lo mismo que la pantalla.
6. Entrar como `cashier` → redirect a `/hub/salon`. Como `host` → redirect a
   `/hub/reservas`. Ninguno ve la plata.
7. `⌘K` → "senas" o "señas" trae la entrada; el sidebar marca activo solo el
   hijo **Señas** (no Comisiones ni el padre Estadísticas).

---

## Addendum 2026-09 — Cómo nos fue (`/[slug]/estadisticas/como-nos-fue`)

Lo pidió el dueño así: *"un dashboard donde pueda seleccionar por evento o día y
ver cómo nos fue. Que solo nos tire: personas totales, reservas totales,
promedio de personas por reserva"*. El ejemplo que dio es el contrato: el Ramen
del lunes 7 de septiembre, y abajo las reservas normales de esa misma noche.

### Las tres decisiones que definen los números

**1. Las canceladas y las no-show NO cuentan.** Decisión del dueño, y es la
inversa de la del reporte de Señas: allá la seña de una reserva caída es plata
que entró igual, acá contamos gente que se sentó y la que no vino no se sentó.
Quedan como nota al costado del número de reservas: `3 canceladas (6 personas)`.
El Ramen del 7/9 da **53 / 21 / 2,5**; con las canceladas daría 59 / 24 / 2,46.

**2. El corte de bloque es `scheduled_event_id`, nunca la zona.** Hay reservas
de evento sentadas en Planta Alta: filtrar por zona pierde gente. Es el mismo
bug que ya se corrigió dos veces (`covers.ts`, `month-capacity.ts`).

**3. "Asistieron" no va en el podio, y no es un porcentaje.** `actual_guests`
está en NULL en la mayoría de las reservas — en el Ramen del 7/9, 20 de 24
mesas—. Un `14` al lado del `53` se leería "vino un cuarto de la gente" y es
falso. La pantalla dice lo que sabe: *"Contamos 14 personas en 3 de 21 mesas.
Las otras 18 quedaron sin cerrar."* Y un NULL no es un campo que alguien olvidó:
es una mesa que nunca se cerró, así que la copy usa esas palabras.
Con cobertura completa recién ahí aparece el delta, y como diferencia absoluta:
*"Vinieron 65 · 3 más de las reservadas"* (Pizza libre del 3/9).
**Prohibido**: `%` de asistencia, dona, gauge o `Progress` con techo 100. El
numerador está incompleto y el ratio real se pasa de 100.

### El muro de mesas

Es la pieza visual de la pantalla y no es decorativa. **Una mesa es un tablero
con una silla por persona**, alternando arriba y abajo. El ancho sigue siendo
exactamente `personas × --mw-seat` (7px en celular, 9px desde `sm`) y la unidad
es la misma en toda la pantalla. Sin piso de ancho, a propósito — con un
`min-width`, una mesa de 2 y una de 3 miden igual y el muro deja de valer la
gente justo en el valor más frecuente del bar.

Hay un `<span>` por persona: una mesa más larga que su fila se parte sola con
`flex-wrap`, sin `ResizeObserver` y sin esconder gente (la de 48 del 05/09 se
parte en dos renglones dentro de la ficha de 328px). El número exacto se lee
arriba al pasar el mouse, **tocar** (en iPhone antes no aparecía nunca) o
tabular: el muro es una sola parada de Tab y las flechas recorren las mesas.

Sirve para tres cosas que un gráfico no hace:

- Explica el tercer número. "2,5 por reserva" no dice nada solo; un muro de
  mesitas de dos dice *"vinieron todos de a dos"* y un muro con una mesa
  larguísima dice *"esto fue un cumpleaños con relleno"*. El 12/09 es el caso de
  manual: Merienda y Arte 16 personas en 5 mesas, y Sin evento con más de 120
  en 5.
- Transporta la asistencia sin un porcentaje: silla llena = vino, silla hueca =
  reservó y no vino, silla tenue sobre tablero rayado = la mesa nunca se cerró,
  silla afuera del tablero sobre una línea punteada = se sumó alguien, rayita
  gris en su propia fila = se cayó. La cuenta de qué silla es qué vive en
  `lib/salon/tables-wall.ts` (`seatStates`, `tableReadout`, `legendFlags`).
- Compara bloques sin compartir eje: como la unidad es la misma, un evento de 16
  al lado de uno de 125 se ve como lo que es.

**La tinta es la del evento, domada.** `lib/salon/event-ink.ts` toma el tono
del template y le recorta luz y croma (claro: L ≤ 0,50 y C ≤ 0,14; oscuro:
L ≥ 0,78 y C ≤ 0,12) para que los 14 colores vivos se lean a más de 4,5:1 sobre
la ficha en los dos temas (está testeado). La ficha la pasa inline como
`--ev-l` / `--ev-d` y `.ev-ink` elige según el tema; sin color cae a
`--primary`. Los tokens del muro llevan prefijo `--mw-` porque `--seat` y
`--wall` ya son colores del plano de mesas.

**La tira de "Por evento" NO comparte unidad con el muro.** Tiene su propio
`--u` (3px / 5px): con el asiento del muro las barras crecían un tercio y se
salían de la fila en las fechas grandes. Son dos gráficos distintos.

### Piezas

| Qué | Dónde |
|---|---|
| Agregador puro + tipos + CSV + `eventTitle()` + `aggregateEditions()` | `lib/salon/events-report.ts` |
| Muro: sillas por mesa, lectura, leyenda | `lib/salon/tables-wall.ts` |
| Tinta del evento | `lib/salon/event-ink.ts` + `.ev-ink` / `.wall` en `app/globals.css` |
| Queries | `getDayReport`, `getTemplateReport`, `listRecentReservationDays`, `listEventTemplateOptions` en `lib/salon/queries.ts` |
| Pantalla (owner-only) | `app/(manager)/[tenantSlug]/estadisticas/como-nos-fue/*` |
| Planilla | `GET /api/como-nos-fue/export?slug&vista=dia|evento|pauta&dia|evento|mes` |
| Tests | `tests/lib/salon-events-report.test.ts` (32 casos) |

`eventTitle()` es el primer helper para el ternario
`name_override ?? template.name ?? 'Evento'`, que estaba copiado a mano en 14
lugares del repo; además normaliza los espacios de más, que existen en los datos
("Tapeo  y Malbec"). Los otros 14 sitios siguen con su copia: migrarlos es un
barrido aparte.

### Detalles que no son obvios

- **La vista por día bucketea por `reservation_date`; la vista por evento, por
  `scheduled_event_id`.** Hoy todas las reservas de evento caen en la fecha de
  su evento, pero nada en el schema lo garantiza. Si alguien mueve una fecha,
  cada vista sigue contando lo suyo sin contradecirse, y una reserva atada a un
  evento de otro día cuenta como reserva normal del día que dice la reserva.
- **El bloque "Sin evento" se devuelve siempre**, aunque esté en cero: que la
  noche haya sido íntegramente del evento es información. Y cuando no hay
  evento, ese bloque se promueve a protagonista — es todo lo que pasó.
- **Las flechas ‹ › se mueven de a un día real.** Un martes sin nadie ES el
  dato. El salto largo vive en el calendario, que además lista las últimas
  noches con gente. El default sí abre en la última noche con movimiento.
- **La edición de HOY no cuenta como concluida.** Una noche que arranca a las
  21:00 todavía está vendiendo: no puede ser "la última fecha", ni "la mejor",
  ni entrar en el promedio de referencia, ni tener flecha de comparación. Va con
  `isTonight` aparte de `isFuture` y la tira la rotula *"es esta noche"*.
- **Una fecha vendiendo ahora no puede ser el hero, pero se nombra.** Si ninguna
  edición concluida tuvo reservas y la de hoy (o una futura) sí, el texto lo
  dice: *"Todavía no terminó ninguna fecha de Sushi libre con reservas. La de
  esta noche va 70 personas en 28 reservas."* Decir "ninguna tuvo reservas"
  arriba de una fila que muestra 70 personas era contradecirse en el mismo
  scroll — y la planilla la exportaba igual, marcada "es hoy".
- **La leyenda del muro sale de las mesas que están DIBUJADAS.** `NightCard`
  esconde el muro cuando el bloque no tiene reservas en pie, y en la vista por
  evento solo dibuja muro el hero. Contar las caídas de una edición colapsada
  prendía el ítem "se cayó" sin un solo chip caído en pantalla (pasa con Fernet
  Libre + Lomo: sus 2 canceladas viven en el 28/08, que ni se lista).
- **El selector de eventos ordena por gente que YA se sentó.** Cuenta solo
  fechas concluidas: ordenar por lo anotado a futuro ponía primero a Ratatuille
  —dos ediciones, las dos futuras, cero historia— por encima del Ramen, y el
  default abría en un evento que nunca corrió. Lo que viene se cuenta aparte.
- **El atajo "Últimas noches con gente" cuenta reservas EN PIE.** Sin eso
  ofrecía el 27/08 con un "2" que en la ficha valía 0, porque sus dos únicas
  reservas se habían cancelado. Y si la ventana de lectura se llena, el día más
  viejo se descarta en vez de mostrar un conteo partido al medio.
- **Una noche que se cayó entera no es una noche vacía.** El estado vacío exige
  que tampoco haya caídas; si no, la nota *"Se cayó entera: 2 canceladas"* —que
  es justo lo que el dueño viene a ver— quedaba tapada por un "no hubo ninguna
  reserva".
- **Sin línea de tendencia ni proyección.** Los eventos tienen entre 1 y 7
  ediciones y varias son futuras: una recta sobre n=2 es adivinación con
  estética de dato. El delta contra la edición anterior va en absoluto y con la
  base nombrada (`+49 que el 06/08`), nunca en porcentaje — de 4 a 53 personas
  es "+1225%" y la base eran dos reservas.
- **El cupo no se compara entre ediciones.** `capacity` cambia por edición
  (Merienda y Arte: 99 → 30 → 40 → 100), así que va como texto dentro de una
  sola edición (`de 100 lugares`, o `52 de 50 lugares · se pasó`), sin barra.
- **Un promedio de una sola mesa se pinta en gris** y dice `una sola mesa`: el
  `12,0` del bloque Sin evento del 7/9 no es un promedio de nada.

### Smoke manual

> Las cifras son del 09/09/2026 y la base está viva: si no dan exactas,
> contrastá contra el SQL del día. Lo que tiene que cerrar siempre es
> pantalla = CSV = `GROUP BY` en Postgres.

1. `/hub/estadisticas/como-nos-fue` como owner → abre en la última noche con
   gente, vista **Por día**.
2. Ir al **07/09** (calendario → "Últimas noches con gente"). Tiene que decir
   **Ramen · 21:00 → 53 personas / 21 reservas / 2,5 por reserva**, hint
   `de 100 lugares`, `3 canceladas (6 personas)`, `de 2 a 6 por mesa`, y abajo
   *"Contamos 14 personas en 3 de 21 mesas. Las otras 18 quedaron sin cerrar."*
   La franja **Sin evento** debajo: 12 personas · 1 reserva · 12,0 con `una sola
   mesa` y *"Vinieron 13 · 1 más de la reservada."*
   **Ojo**: el dueño escribió 57/22/2,5 en su ejemplo. Con su propia decisión de
   no contar las caídas, la pantalla dice 53/21/2,5. No es un bug.
3. **03/09** → dos fichas lado a lado (Pizza libre 62/17/3,6 con cobertura
   completa y *"Vinieron 65 · 3 más de las reservadas"*, y Fernet Libre + Lomo
   2/1/2,0).
4. **12/09** → Merienda y Arte 16/5/3,2 arriba y Sin evento 125/5/25,0 abajo: el
   muro de abajo tiene que verse muchísimo más largo y hecho de piezas enormes.
5. **05/09** → no hay evento: la franja Sin evento se promueve a ficha
   protagonista (135/6/22,5).
6. **22/09** → 2x1 Burger Martes con `Nadie reservó para este evento` al lado de
   Ratatuille 28/12/2,3, y el aviso de que la noche todavía no pasó.
7. **Por evento → Ramen** → hero con la última fecha pasada (07/09) y la tira de
   todas sus fechas; la del 28/09 marcada como *todavía no pasó*, la primera con
   `primera fecha`, y las fechas sin reservas agrupadas al pie.
8. Clic en una fecha de la tira → vuelve a **Por día** en esa noche. Clic en
   *"Ver todas sus fechas"* desde el día → vuelve a **Por evento**. El ida y
   vuelta no pierde la selección.
9. Exportar en las dos vistas → `como-nos-fue-hub-2026-09-07.csv` y
   `como-nos-fue-hub-ramen.csv`, en columnas en Excel es-AR.
10. Entrar como `cashier` → redirect a `/hub/salon`. Como `host` → redirect a
    `/hub/reservas`.
11. `⌘K` → "como nos fue" / "gente" / "evento" trae la entrada; el sidebar marca
    activo solo ese hijo.

---

## Addendum 2026-09-15 — Pauta en Meta dentro de «Cómo nos fue»

Nacho (marketing, entra como `owner`) carga lo que dice Ads Manager de cada
fecha de evento, y los socios leen cuánto costó traer a la gente que ya cuenta
la ficha. No hay integración con la API de Meta: son cuatro números a mano por
edición.

### Dónde vive

- **Tabla** `scheduled_event_marketing` (migración
  `20260915120000_scheduled_event_marketing.sql`): una fila por
  `scheduled_event_id`, con `ad_spend_usd_cents` (0 = «No tuvo pauta»),
  `messages`, `reach`, `revenue_ars_cents`, `usd_ars_rate` y `notes` (≤ 280).
  Checks: una fila sin pauta va pelada, y facturación y dólar van juntos.
- **RLS solo dueño, SELECT incluido** (`sem_owner_all`, como
  `commission_ledger`). Se aparta a propósito de la regla general: host y cajero
  leen `scheduled_events`, pero la plata de la pauta no.
- **FK compuesta `(scheduled_event_id, tenant_id)` SIN cascade.** Un host puede
  borrar fechas del calendario y no ve la pauta: un cascade le borraría plata
  sin enterarse. `deleteScheduledEvent` traduce el 23503 a *"No se puede borrar:
  esta fecha tiene pauta cargada en «Cómo nos fue». Un dueño tiene que borrarla
  primero."* Borrar el tenant sí cascadea.

### Las reglas (encabezado de `lib/salon/event-marketing.ts`)

1. **Un solo denominador: el bloque en pantalla.** Reservas = reservas en pie, y
   personas = su gente: los mismos tres números grandes de la ficha.
2. **Faltante no es cero.** Sin fila = «Sin cargar»; gasto 0 = «No tuvo pauta»;
   gasto sin mensajes = «Incompleta»; mensajes 0 = «No escribió nadie».
3. **El cierre nunca pasa de 100 %.** Con más reservas que mensajes se dice en
   palabras: *"parte llegó por otro lado"*.
4. **El cierre es un techo y el costo por reserva un piso**: cuentan todas las
   reservas en pie, también las que no vinieron por el anuncio.
   `salon_reservations.origin` defaultea a `whatsapp` y no sirve para atribuir.
5. **Los totales son cocientes de sumas sobre el mismo conjunto**, con la base
   nombrada. Nunca promedio de cocientes.
6. **Hoy y lo que viene es «Por ahora»**: fuera de los cocientes agrupados y de
   los pendientes, pero su gasto sí suma en lo invertido del mes, rotulado aparte.
7. **Facturación no es ganancia.** El verbo es «facturó», nunca «volvió».
8. **Sin benchmarks ni semáforos.** La única alerta es aritmética: el evento
   facturó menos de lo que costó la pauta.
9. **Pantalla = CSV**: mismo redondeo, mismo formateador (hecho a mano, sin
   `Intl` para `%`: Node y el browser no coinciden y rompía la hidratación).

### Tres lugares

- **La ficha del evento** (Por día y el hero de Por evento): sección «Pauta en
  Meta» con oración, tres fichas (por mensaje, de cierre, por reserva), ficha
  técnica, recuadro de retorno y «¿Cómo se calcula?». Se carga en línea; «No
  tuvo pauta» es optimista con Deshacer 6 s. Guardar NO es optimista. "Sin
  evento" nunca tiene sección.
- **Por evento**: segunda línea por fecha en la tira y resumen agrupado arriba
  (solo con 2 fechas o más con mensajes). Una fecha con pauta y cero reservas NO
  colapsa al pie: esa es la que más hay que ver.
- **Pestaña «Pauta»** (`?vista=pauta&mes=YYYY-MM`): recuadro de pendientes con
  el mismo formulario en línea (Nacho se pone al día sin navegar), oración del
  mes, fichas con su base, lista cronológica y notas al pie. Cada fila de
  «Fechas con pauta» y cada fecha de «Sin pauta» tiene **Editar** (pedido del
  dueño, 15/09: corregir un número mal cargado sin ir a buscar la noche): abre
  el mismo formulario debajo de la fila, con Borrar pauta incluido. Un solo form
  abierto a la vez en toda la pestaña; se monta en la tabla (≥ `md`) o en la
  tarjeta, nunca en las dos.

**Concurrencia**: el guardado filtra por el `updated_at` que el dueño tenía
delante; si otro dueño guardó en el medio, vuelve `stale`, se refresca y el form
queda abierto con lo tipeado. Toda mutación va a `audit_log` sin la nota (texto
libre).

### Piezas

| Qué | Dónde |
|---|---|
| Fórmulas, formateo, parser de números, oraciones, mes, CSV | `lib/salon/event-marketing.ts` |
| Schemas zod y mapeo a la DB | `lib/salon/event-marketing-schemas.ts` |
| Borrador del form (chequeo con el mismo schema del server, copy) | `lib/salon/event-marketing-draft.ts` |
| Server Actions (`saveEventMarketing`, `markEventWithoutAds`, `deleteEventMarketing`) | `lib/salon/event-marketing-actions.ts` |
| Queries (`listEventMarketing`, `getLastUsdArsRate`, `getMonthMarketingReport`) | `lib/salon/queries.ts` |
| UI | `_components/event-marketing-section.tsx`, `marketing-report.tsx`, `marketing-form.tsx`, `money-field.tsx`, `marketing-month-view.tsx` |
| Planillas | día y evento suman las columnas de pauta; `vista=pauta&mes=` baja el mes |
| Tests | `tests/lib/salon-event-marketing*.test.ts`, `tests/rls/scheduled-event-marketing.test.ts` |

### Smoke manual

1. **09/09, Noche Astral** → 29 / 11 / 2,6; muro en rosa: 27 sillas llenas, 2
   huecas y aparte `se cayeron · 2 (4 personas)`. Sección `Sin cargar` en ámbar.
2. `Cargar pauta`, pegar `US$175,26`, Tab, `51` → la vista previa dice
   `US$ 3,44 por mensaje`, `21,6 % de cierre`, `US$ 15,93 por reserva · US$ 6,04
   por persona`. Enter guarda: oración, tres fichas, `Cargó … · dd/MM HH:mm` y
   toast.
3. Editar: alcance `8.420` → `US$ 20,81` y `0,6 % (6 de cada 1.000)`.
   Facturación `2.480.000` sin dólar → error; chip o `1.450` → `Por cada US$ 1
   de pauta, el evento facturó US$ 9,76.`, `$ 254.127`, `10,2 %`, `$ 85.517 por
   persona`.
4. `1,234.50` en Gastado → al salir queda `1.234,50`. `51,5` en Mensajes →
   `Va sin decimales.` y `Corregí «Mensajes» para guardar.`
5. Dos sesiones de dueño sobre la misma fecha → la segunda recibe el toast de
   stale y ve los números nuevos.
6. Fecha pasada sin reservas → `No tuvo pauta` y Deshacer vuelve a `Sin cargar`.
7. Fecha futura con US$ 60 / 12 → `Por ahora: pusimos …`; no aparece en
   pendientes, sí en Invertido con `(1 todavía no pasó)`.
8. 05/09 y toda ficha "Sin evento" → sin sección de pauta.
9. Pestaña **Pauta**, septiembre → cargar una pendiente en línea y que salga del
   recuadro; a 400px la lista son tarjetas.
9b. En «Fechas con pauta», **Editar** en una fila → el form abre debajo con los
   números guardados; cambiar Mensajes y guardar actualiza la fila, las fichas y
   la oración del mes, y el foco vuelve a Editar. Tocar una fecha de «Sin pauta»
   abre el mismo form vacío. Abrir otro Editar (o un «Cargar» del recuadro)
   cierra el anterior. A 400px pasa lo mismo en las tarjetas.
10. Exportar las tres vistas → en Excel es-AR `175,26` y `21,6` en columnas.
11. Como host: la página no se sirve, `select` sobre la tabla devuelve `[]` y
    borrar del calendario una fecha con pauta muestra el mensaje del 23503.
12. Antes de mergear: confirmar en el Ads Manager del bar los nombres «Importe
    gastado», «Conversaciones con mensajes iniciadas», «Costo por resultado» y
    «Alcance».

---

## Addendum 2026-09-18 — Liquidar por rango de fechas

Pedido del dueño, textual: *«A Luz le pagamos del 15 al 15 normalmente, puede
cambiar, pero qué pasa, nosotros tenemos del 15 de agosto al 15 de septiembre,
yo lo que necesito es que el filtro me permita mostrar del 1 de septiembre al
15 de septiembre.»*

El período dejó de ser un mes calendario. Antes las tres pantallas navegaban con
`?month=YYYY-MM` y botones «Mes anterior / Mes siguiente»; ahora son **dos
fechas libres, `?from=&to=`**, sin chips de atajos ni ciclo configurable en
Ajustes (decisión del dueño: no queremos una pantalla de configuración para
esto).

### Un solo lugar decide el rango

`lib/commissions/period.ts` — `resolveCommissionPeriod({from, to, month}, today)`
es el **único** lugar donde se resuelve qué período se está mirando. Lo llaman
las tres páginas y también la Server Action del pago por rango, así que los
bordes no pueden divergir. Orden de decisión (gana el primero que aplica):

1. `from` **y** `to` válidos → mandan. **Si vienen al revés se dan vuelta**: el
   dueño va a tipear mal alguna vez y una pantalla en cero se lee como «no hay
   comisiones», que es mentira.
2. Uno solo de los dos → el otro completa **el mes de ese día**.
3. `?month=YYYY-MM` → mes completo. **Los links viejos siguen abriendo** (hay
   bookmarks dando vuelta); el filtro borra el `month` de la URL apenas se
   aplica un rango.
4. Nada → mes en curso según `todayInCordoba()` (el calendario del bar, no el
   `new Date()` del server, que en UTC ya cambió de día mientras en Córdoba son
   las 21:30).

Y siempre, al final, el tope de `MAX_COMMISSION_PERIOD_DAYS = 400`. **Cuando
recorta lo dice en el label** (`… (recortado a 400 días)`): un total
silenciosamente parcial sería plata mal contada.

Todo viaja como `yyyy-MM-dd` y se compara como string —
`salon_reservations.reservation_date` es `date` puro, sin hora. La aritmética va
sobre `Date.UTC` porque las funciones locales de `Date` usan el TZ del runtime y
un rango calculado en Vercel (UTC) se corría un día respecto del navegador. Los
nombres de mes y día están a mano y no con `Intl`: el label se renderiza en el
server y se re-hidrata en el browser, y las diferencias de ICU («septiembre» vs
«sept.») disparaban un mismatch de hidratación.

`shiftPeriod(period, ±1)` corre el rango su propio largo sin huecos ni solapes
(del 1–15 al 16–30). **Está testeada pero hoy no tiene consumidor**: quedó para
cuando alguien pida «período anterior», y no se cableó ningún botón porque
convivir con el rango libre lo pisaba.

### El filtro es uno solo, compartido

`components/commissions/period-filter.tsx` (no en un `_components/` de una ruta:
lo usan dos rutas distintas y dos copias divergen justo en el borde que importa).
No calcula fechas — sólo empuja `?from=&to=` a la URL, mergeando lo que ya está
ahí para no perder el `?as=` con el que el dueño espía a otro gestor. El rango
que se muestra siempre es el que resolvió el server.

Está en las **tres** pantallas:

| Pantalla | Rol | Qué muestra |
|---|---|---|
| `/estadisticas/comisiones` | owner | Totales del período, torta y tabla por gestor. Cada «Detalle» lleva el **mismo** `?from=&to=` que hay en pantalla. |
| `/estadisticas/comisiones/[managerId]` | owner | Entries del gestor en el rango + el botón de liquidar. El link «Liquidación» vuelve con el rango puesto. |
| `/mis-numeros` | host (Luz) y owner | Lo mismo que ve el dueño, para el gestor propio. |

`/mis-numeros` **no filtra por rol en el cliente**: el host sólo resuelve su
propio gestor con `getManagerForUser`, y el `?as=<managerId>` que permite mirar
a otro se ignora salvo que el rol sea `owner`. Encima manda la RLS
(`cl_manager_self_select`).

### Marcar pagado todo el período

Botón en el detalle del gestor, con `AlertDialog` que dice **cuántas reservas y
cuánta plata** antes de tocar nada. Se mantiene el tildado de a una; lo que
cambia es que el botón de liquidar todo **se esconde mientras hay entries
tildadas**: dos botones de pagar juntos, uno por «las 3 que elegí» y otro por
«las 47 del período», es un error caro.

- `markCommissionRangePaid(slug, {manager_id, from, to})` (`lib/salon/actions.ts`)
  **no recibe ids del browser**. Con el rango vuelve a preguntarle a la DB quién
  está impago (`listUnpaidCommissionLedgerIds`), así el cliente no puede colar la
  entry de otro gestor ni de un período que el dueño no está mirando. El número
  del diálogo es informativo; el que paga es el del servidor.
- Valida con `isRealIsoDay` **antes** de pasar por `resolveCommissionPeriod`, y
  no cae al default: con el fallback puesto, un `from` basura habría marcado como
  pagado el mes en curso entero.
- Reusa la RPC `mark_commission_paid` (SECURITY DEFINER, exige `owner`, sólo toca
  `paid_at is null`) de a **500 ids** por tanda — el tope que ya estaba probado.
  Un doble click no paga dos veces. Si una tanda falla a mitad de camino el
  mensaje dice cuántas quedaron marcadas: las anteriores ya commitearon.
- Un solo `paid_at` para toda la liquidación: es un pago, no N pagos.
- Auditoría: `commission.paid_range` con `{manager_id, from, to, count, cents}`,
  sin PII. El tildado de a una sigue escribiendo `commission.paid`.
- Si el conteo de la RPC no coincide con lo leído (alguien pagó en paralelo), el
  toast **no muestra el monto**: dice `Marqué N reservas como pagadas (de M; el
  resto ya figuraba pagado).`

### El techo de 1000 filas

`COMMISSION_MAX_ROWS = 1000` en `lib/salon/queries.ts`, igual que
`DEPOSITS_MAX_ROWS`. **PostgREST corta en 1000 filas sin error**, y un total de
plata truncado no tiene ningún síntoma: se ve igual de prolijo, sólo que con
menos plata. Mientras el período fue siempre un mes calendario no se llegaba ni
cerca (el mes más cargado del HUB ronda las 250 reservas); con el rango libre de
hasta ~13 meses sí se llega. Las tres lecturas
(`listCommissionSummary`, `listCommissionBreakdown`,
`listUnpaidCommissionLedgerIds`) piden el tope explícito y devuelven
`truncated`, y las tres pantallas muestran el recuadro ámbar. En el pago por
rango el toast pide **repetir la acción**, porque ahí el corte silencioso sería
peor: dejaría comisiones sin marcar creyendo que se pagó todo.

### Piezas

| Qué | Dónde |
|---|---|
| Resolución del período, label es-AR, tope, `shiftPeriod` | `lib/commissions/period.ts` |
| Filtro compartido (dos fechas + Aplicar) | `components/commissions/period-filter.tsx` |
| `markPaidRangeSchema` | `lib/salon/schemas.ts` |
| `markCommissionRangePaid` | `lib/salon/actions.ts` |
| `listUnpaidCommissionLedgerIds`, `COMMISSION_MAX_ROWS` | `lib/salon/queries.ts` |
| Tests (22 casos: legacy `month`, rango dado vuelta, bisiesto, tope, label) | `tests/lib/commissions-period.test.ts` |

### Smoke manual

1. **El caso del dueño.** Entrar a `/[slug]/estadisticas/comisiones` sin
   parámetros → mes en curso. Poner **Desde 15/08/2026 / Hasta 15/09/2026** y
   Aplicar → el header dice `Liquidación de 15/08/2026 → 15/09/2026` y el filtro
   `Mostrando 15/08/2026 → 15/09/2026 · 32 días`. Anotar el total.
2. Cambiar a **01/09/2026 → 15/09/2026** → el label pasa a `1 al 15 de
   septiembre de 2026 · 15 días` y el total baja. Es el pedido textual.
3. **El link «Detalle» lleva el rango**: tocar Detalle en la fila de Luz → la URL
   trae `?from=2026-09-01&to=2026-09-15` y el header repite el mismo período.
   Volver por «Liquidación» → el rango sigue puesto (no vuelve al mes en curso).
4. **Legacy**: abrir a mano `…/comisiones?month=2026-08` → mes completo de
   agosto. Aplicar cualquier rango → el `month` desaparece de la URL. Probar lo
   mismo en `/mis-numeros?month=2026-08`.
5. **Rango dado vuelta**: `?from=2026-09-15&to=2026-08-15` → se da vuelta solo y
   muestra 32 días, no una pantalla vacía.
6. **Liquidar todo**: en el detalle de Luz del 01→15/09, sin nada tildado, el
   recuadro dice `Quedan N reservas sin pagar … por $X`. Tocar el botón → el
   diálogo repite N y $X. Confirmar → toast `Marqué N reservas como pagadas por
   $X.`, las filas quedan «Cobrada», Pendiente en `$ 0` y **el recuadro y el
   botón desaparecen**. Tocarlo de nuevo (recargando antes) → `No había nada
   pendiente en ese período.`
7. **No conviven los dos botones**: tildar 2 reservas → el recuadro de liquidar
   todo se esconde y sólo queda la barra flotante («2 reservas seleccionadas»).
   Destildar → vuelve el recuadro.
8. **Vista de Luz (host), en celular**: entrar a `/[slug]/mis-numeros` con la
   cuenta de Luz → el filtro de rango está, los KPIs responden al período y **no
   aparece** el picker «Ver los números de otro gestor». Probar
   `?as=<id de otro gestor>` a mano → sigue mostrando los números de Luz.
   Verificar que los dos `<input type="date">` entran a lo ancho a 400px
   (iOS Safari a veces se niega a achicarlos).
9. **Tope**: `?from=2020-01-01&to=2026-01-01` → el label termina en
   `(recortado a 400 días)` y el `to` real es `2021-02-03`.
