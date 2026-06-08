# Editor visual de plano de mesas (floor plan) — guía técnica v3

> **Rediseño v3 (2026-06-08) — calidad SevenRooms.** Sobre la base v2
> (`react-zoom-pan-pinch` + pointer drag), v3 suma: **sillas dibujadas** alrededor
> de cada mesa (derivadas de `capacity`), **rotación** viva, **formas** reales
> (redonda/óvalo/cuadrada/rect/banquette), **vocabulario** de decoración
> (puerta/texto/escenario + barra en L con banquetas), **edición sin fricción**
> (guías de alineación + snap-a-objeto, multi-selección + group-drag, teclado,
> **deshacer/rehacer**, encajar-a-contenido, barra contextual flotante),
> **velocidad de armado** (duplicar, crear N mesas en grilla, impresión masiva de
> QR por área), y operación en vivo (**cambio de mesa cross-área**, tap-a-sentar).

Ruta: `/{tenantSlug}/local/mesas` (solo `owner`; staff en `/{tenantSlug}/salon/mesas`).

---

## v3 — qué cambió respecto a v2

### Modelo de datos (migraciones aditivas, idempotentes)
- `20260609000100_floor_plan_v2_enums.sql`: `floor_element_kind` += `door, text, stage, booth`;
  `floor_element_shape` += `banquette`.
- `20260609000200_floor_plan_v2_geometry.sql`: columna `corner_radius int` (0..200);
  CHECK `rotation` 0..359; publica `floor_plan_elements`/`floor_plan_areas` en `supabase_realtime`.
- `rotation` (existía, muerta en v2) ahora se **persiste** end-to-end (schema → `saveGeometryAction`
  → `getFloorPlan`/`getLiveFloor`). Tipos regenerados en `types/database.ts`.

### Render (sillas + formas)
- `lib/floor-plan/chairs.ts` — `computeChairs(shape, kind, w, h, capacity)` PURO + testeado
  (`tests/lib/floor-plan-chairs.test.ts`): reparte sillas por forma (círculo equiespaciado;
  rect por densidad de lados — 4-top 1/1/1/1, 8-top 3/3/1/1; banquette un solo lado);
  `computeBarStools` para la barra. Máx 12 sillas dibujadas.
- `components/floor-plan/table-glyph.tsx` (compartido editor + vivo + salón): `ChairsSvg`
  (SVG `overflow:visible`, fill por `--fp-seat`), `bodyRadius`, `decorSurfaceStyle/Class`,
  `DecorContent` (íconos puerta/escenario, texto sin caja).
- Tokens nuevos en `globals.css`: `--seat`/`--seat-border` (light+dark), clases `.fp-chair`/
  `.fp-stool`/`.fp-canvas` (grilla token-driven que arregla el dark + viñeta, en UNA regla).

### Edición sin fricción (`floor-plan-editor.tsx`)
- `lib/floor-plan/snap.ts` — `computeSnap` (guías de alineación + snap-a-objeto, testeado) +
  `alignBoxes`.
- Multi-selección (shift/cmd-click) + **group-drag** (los pares siguen vía `registerNode` +
  `onMoveLive`); teclado (flechas = 1px, Shift+flechas = grilla; Supr; Esc; `[`/`]` orden;
  `r` rotar 90°; **⌘Z/⌘⇧Z deshacer/rehacer** de geometría vía transacciones `runOp`);
  encajar-a-contenido (`fitTargetId` → `zoomToElement`); barra contextual flotante
  (`contextual-toolbar.tsx`); handle de rotación (`rotate-handle.tsx`).

### Velocidad de armado
- `duplicateElementAction` (⌘D / barra) — clona mesa (mintea PT+QR nuevo) o decoración.
- `bulkCreateTablesAction` + `bulk-create-dialog.tsx` — crea N mesas en grilla, auto-numeradas,
  cada una con su QR; agranda el área si no entran.
- **Impresión masiva de QR**: `/print/qrs/[areaId]` (owner-gated) + botón "Imprimir QRs" por área.

### Operación en vivo
- **Cambio de mesa (cross-área)**: `getMoveTargets` + `loadMoveTargetsAction` + `move-table-sheet.tsx`
  (compartido) sobre el RPC existente `move_session`. Wireado en el detalle de sesión del salón
  (dropdown "Mover de mesa") y en la vista En vivo del dueño.
- **Tap-a-sentar**: tocar una mesa libre en el plano del salón abre el flujo de activación.
- `LiveTableCard` memoizado (comparador por campos) — el live floor reemplaza `data` entero por refresh.

---

## Qué cambió respecto a v1

| Área | v1 | v2 |
|---|---|---|
| Ruta del editor | `/configuracion/mesas` | `/local/mesas` |
| Sidebar | "Configuración → Local" | Tab **"Local"** propia |
| Librería de canvas | dnd-kit v6 + modifiers custom | **react-zoom-pan-pinch v3.7** + pointer events |
| Colocar elementos | Clic en paleta → diálogo al centro | **Arrastrar** desde la paleta al lugar |
| Pan/zoom | Pan CSS transform + botones de zoom | `TransformWrapper` nativo (scroll, pinch, `+/-/fit`) |
| Drag a escala ≠ 1 | Bug: delta no dividido → drift | Correcto: `delta / scale` antes de snap |
| `a11y.ts` | Announcements dnd-kit es-AR | Retirado del plano (dnd-kit sigue en menu/flows/eventos). Lista accesible sigue canónica |
| Vista en vivo | No existía | **Live floor** + Realtime (dueño toggle + staff `/salon`) |
| Realtime | — | Migración publica 4 tablas; Supabase Realtime efectivo |

---

## TL;DR

| Capa | Qué hay | Dónde |
|---|---|---|
| DB | 2 tablas (`floor_plan_areas`, `floor_plan_elements`) + enums + triggers + RLS + seed HUB | `supabase/migrations/20260605000100_floor_plan_editor.sql` |
| DB | RPCs `fp_*` SECURITY DEFINER | `supabase/migrations/20260605000200_floor_plan_rpcs.sql` |
| DB | Publicación Realtime para `table_sessions`, `tickets`, `ticket_items`, `table_session_events` | `supabase/migrations/20260606000100_realtime_salon_publication.sql` |
| Tipos | tablas + enums `floor_element_kind` / `floor_element_shape` | `types/database.ts` |
| Lógica pura | grid/snap/clamp + `stagePointFromClient` + `freeDragPosition`/`commitDragPosition` (drag) | `lib/floor-plan/grid.ts` |
| Lógica servidor | `getFloorPlan` + `getLiveFloor` + `listFloorAreas` | `lib/floor-plan/queries.ts` |
| Server Actions | owner-only (`lib/floor-plan/actions.ts`) + live refetch (`lib/floor-plan/live-actions.ts`) | |
| Navegación | NavGroup "Local" + rutas movidas de `/configuracion` | `components/shell/nav-config.ts`, `app/(manager)/[tenantSlug]/local/` |
| UI editor | `pan-zoom-stage`, `floor-canvas`, `floor-element`, `resize-handles`, `element-palette`, `floor-plan-editor` | `app/(manager)/[tenantSlug]/local/mesas/_components/` |
| UI live | `live-floor`, `live-table-card` (compartidos dueño + staff) | |
| Tests | unit (grid + drag-commit math) + RLS (isolation + area scope + session join) | `tests/lib/floor-plan-grid.test.ts`, `tests/rls/floor-plan-live.test.ts` |

---

## Modelo de datos

Sin cambios respecto a v1. Ver sección "Modelo de datos" del README anterior para el
detalle completo de `floor_plan_areas` y `floor_plan_elements`.

### Migración de Realtime (`20260606000100_realtime_salon_publication.sql`)

Agrega idempotentemente cuatro tablas a la publicación `supabase_realtime`:

```sql
do $$
begin
  begin alter publication supabase_realtime add table public.table_sessions;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tickets;              exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ticket_items;         exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.table_session_events; exception when duplicate_object then null; end;
end $$;
```

RLS no cambia (realtime respeta las políticas SELECT existentes; solo `authenticated`
recibe). `db:types` no es necesario (sin cambio de schema).

**Por qué:** antes de esta migración, las suscripciones realtime a esas tablas en
`salon-view.tsx` y en `live-floor.tsx` nunca disparaban eventos; la UI se apoyaba solo
en el safety-net de 30 s. La migración hace efectivo el push en tiempo real.

---

## Navegación — tab "Local"

El sidebar del dueño tiene ahora un `NavGroup` "Local" independiente (antes las tres
páginas eran sub-secciones de "Configuración"):

| Ítem | Ruta | Icono |
|---|---|---|
| Plano | `/{slug}/local/mesas` | `LayoutGrid` |
| Captura QRs | `/{slug}/local/captura` | `QrCode` |
| Auto-aceptación | `/{slug}/local/auto-aceptacion` | `Zap` |

La sección "Local" fue eliminada de `configuracion/_components/settings-nav.tsx` y de
`configuracion/page.tsx`.

---

## Editor (modo Editar)

### Canvas con `react-zoom-pan-pinch` v3.7

```tsx
<TransformWrapper
  ref={transformRef}
  initialScale={1}
  centerOnInit
  minScale={0.25}
  maxScale={4}
  limitToBounds={false}
  panning={{ excluded: ['floor-element'], velocityDisabled: true }}
  wheel={{ step: 0.2 }}
  pinch={{ step: 5 }}
>
  <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
    {/* Stage div position:relative, tamaño = área lógica, grilla CSS */}
    {/* Hijos: divs position:absolute en coords lógicas, className="floor-element" */}
  </TransformComponent>
</TransformWrapper>
```

- **Pan**: arrastrar el fondo (excluye `.floor-element`).
- **Zoom**: scroll/pinch + botones `+` / `−` / fit via `transformRef.current`.
- **`limitToBounds={false}`**: permite panear más allá de los bordes del área.

### Drag de elementos (pointer events, sin dnd-kit) — revisión v2.1 (2026-06-07)

> **Por qué cambió:** la v2 snapeaba a la grilla en **cada** `pointermove` y pintaba la
> posición desde `element.x/y` vía `setElements` por frame. Eso producía: movimiento "a
> saltos" de 20px, **zona muerta a zoom alto** (a `scale=4` una celda son 80px de
> pantalla, arrastres <40px resolvían a no-op → "no se mueve"), y jank por re-render
> O(n) de todos los elementos. Además `touch-action:'none'` estaba sólo en el wrapper y
> no en el `<button>` → en tablet el gesto se cortaba (`pointercancel`). La v2.1 adopta
> el patrón de tldraw/Excalidraw (el mismo que ya usaba el resize en este repo):
> **mover imperativamente durante el gesto, commitear una sola vez al soltar.**

Cada `floor-element` usa `onPointerDown` → `setPointerCapture` + `e.stopPropagation()`
+ congela el `scale` del stage en ese instante con **`readStageTransform(transformRef)`**.

> **Gotcha de react-zoom-pan-pinch (v2.1):** el ref que entrega `<TransformWrapper ref>`
> es `getControls(instance)` → `{ instance, zoomIn, … }`, que **NO tiene `.state`** (eso vive
> en `getContext`/render-prop). El tipo `ReactZoomPanPinchRef` declara `.state`, así que
> TypeScript no avisa, pero en runtime `ref.current.state` es `undefined` y leer
> `ref.current.state.scale` **lanza** "Cannot read properties of undefined (reading 'scale')"
> → el `onPointerDown` explotaba y el drag quedaba **congelado**. El estado vivo está en
> `instance.transformState`. El helper puro `lib/floor-plan/stage-transform.ts`
> (`readStageTransform`, testeado) centraliza el acceso correcto; lo usan el drag, el
> resize y el drop-from-palette.

- **`onPointerMove`**: calcula la posición **libre** (sin snap) con `freeDragPosition`
  (`origX + dxPantalla/scale`, sólo `clampToArea`) y la pinta **imperativamente** con
  `wrapperRef.style.transform = translate3d(freeX-origX, freeY-origY, 0)`, batcheada en
  un `requestAnimationFrame` deduplicado. **No toca el estado de React** → seguimiento
  1:1 a cualquier zoom, capa GPU, 0 re-render por frame.
- **`onPointerUp`/`onPointerCancel`**: calcula la posición final con `commitDragPosition`
  (`snap = !e.altKey` → **Alt** mueve libre sin snap), fija ese transform y llama
  `onMove(id, x, y)` **una sola vez** → `commitGeometry` + encola en `use-geometry-queue`
  (debounce 600ms, ahora 1 enqueue por gesto, no por pixel).
- **Sin parpadeo al soltar**: un `useLayoutEffect([element.x, element.y])` zera el
  `transform` **después** de que React aplica el nuevo `left/top` (mismo commit, antes
  del paint) → la mesa "cae" en su lugar.
- **Touch**: `touch-none` está también en el `<button>` (no se hereda del wrapper).
- **Guard anti-reseed**: `FloorElement` avisa `onDragStart`/`onDragEnd`; el editor pone
  `draggingRef` y el `useEffect([initialSig])` no pisa el estado optimista mid-gesto.
- **`React.memo`**: `FloorElement` está memoizado (comparador por geometría + selección
  + identidad de handlers) → seleccionar/cambiar de área no re-renderiza los N elementos.

`freeDragPosition` y `commitDragPosition` son **puras** y testeadas (a scale 0.25/1/4)
en `tests/lib/floor-plan-grid.test.ts`. La división por `scale` sigue siendo la
corrección del bug de v1 (a `scale=2` el drift era el doble del movimiento visual).

### `stagePointFromClient` (en `lib/floor-plan/grid.ts`)

Convierte un punto de pantalla (`clientX`/`clientY`) a coords lógicas del stage:

```ts
export function stagePointFromClient(
  clientX: number, clientY: number,
  rect: { left: number; top: number },
  scale: number, posX: number, posY: number,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - posX) / scale,
    y: (clientY - rect.top - posY) / scale,
  }
}
```

Donde `rect = wrapper.getBoundingClientRect()` y `{ scale, positionX, positionY } = readStageTransform(transformRef)`
(ver el gotcha del ref más arriba — NO `transformRef.current.state`).
Se usa tanto para el drop-from-palette como para la conversión inicial del drag.

### Colocar desde la paleta (drag-from-palette) — pointer events (v2.1)

> **Por qué cambió:** la v2 usaba HTML5 drag-and-drop (`draggable` +
> `dataTransfer`), que **no dispara en tablet/celular** — y el staff usa tablet. La v2.1
> lo reemplaza por un drag con **pointer events** (`use-palette-drag.tsx`), que funciona
> en mouse y touch por igual.

`element-palette.tsx` ya no es `draggable`; cada chip dispara `onChipPointerDown`. El
hook `usePaletteDrag({ wrapperRef, onDrop })`:

- Escucha `pointermove`/`pointerup`/`pointercancel` en `window` (handlers locales y
  estables, sin re-render — patrón del resize).
- Pinta un **ghost** `position:fixed pointer-events-none` siguiendo al puntero/dedo.
- Al soltar **dentro del rect del stage** (re-medido al soltar), llama
  `onDrop(kind, clientX, clientY)` = el `handleDropKind` del editor, que convierte a
  coords lógicas con `stagePointFromClient` y crea:
  - **Mesa** → `createTableInPlanAction` → abre el inspector (sin diálogo al centro).
    `create-table-dialog.tsx` fue retirado.
  - **Decoración** → `addDecorAction` con `ELEMENT_DEFAULTS[kind]`.
- `shouldSuppressClick()` evita que el `click` posterior a un drag real dispare doble
  alta.

Fallback (tap/teclado sobre la chip → `onClick`): coloca el elemento en el centro del
área visible.

### Persistencia de geometría (reusado de v1)

`use-geometry-queue.ts` sin cambios: cola debounced 600 ms, flush en `beforeunload`,
rollback de ids afectados si falla. **v2.1:** `saveGeometryAction` ya **no** llama
`revalidatePath` — revalidar re-streameaba el RSC y pisaba el estado optimista a
mitad/fin del drag (la geometría es optimista con rollback propio; el próximo SSR trae
lo persistido). Las acciones estructurales (crear/borrar/split/merge) sí revalidan.

### Estilo de la decoración: "poche" sólido (v2.1)

> **Por qué cambió:** la decoración (paredes/columnas/barra/islas) usaba `var(--muted)`
> — un token de **superficie**, casi idéntico al `--card` del lienzo en light — con
> borde al 70% y label `opacity-70`; en la vista en vivo era peor (`bg-muted/60`,
> literalmente semitransparente). Se veía "lavada/transparente".

Tokens nuevos en `app/globals.css` (OKLCH, dark-safe, hue 165 estructural):
`--wall` (fill sólido oscuro), `--wall-foreground` (texto claro), `--wall-border`
(borde marcado), expuestos en `@theme` como `--color-wall*` → utilidades
`bg-wall`/`text-wall-foreground`/`border-wall-border`.

La decoración usa `backgroundColor: element.color ?? var(--wall)` (el color del dueño
tiene prioridad) + `border-2 border-wall-border` + `text-wall-foreground`, **sin** sombra
ni opacidad. Las mesas siguen claras (`bg-card`, `shadow-sm`, `cursor-grab`): la jerarquía
**mate-fija vs clara-flotante** comunica "estructura no interactiva vs mobiliario movible"
(convención OpenTable/Resy/SevenRooms). Mismo lenguaje en editor (`floor-element.tsx`) y
en vivo (`live-floor.tsx` `DecorBox`).

---

## Vista en vivo (modo En vivo)

### `getLiveFloor(tenantId, areaId)`

Query server-only en `lib/floor-plan/queries.ts`. Combina:

1. `floor_plan_elements WHERE area_id = $areaId` (geometría completa).
2. Para los `kind='table'`: join a `physical_tables` (label, capacity) y a la **única
   sesión abierta** por `physical_table_id` (`status='open'`).
3. Flag `kitchen`: `'ready'` si algún ticket de la sesión tiene `status='ready'`;
   `'preparing'` si tiene `'accepted'`/`'preparing'` y ninguno `'ready'`; `'none'` si no hay
   tickets activos.
4. Flag `bill_requested`: `true` si existe un `table_session_events` de tipo
   `'bill_requested'` para la sesión.

Patrón TS + supabase-js (anti-join/conteos en JS, como `listSalonTables`). RLS abre
SELECT a cualquier miembro del tenant (owner + staff).

### Tipos de la vista en vivo

```ts
type LiveSession = {
  id: string
  status: 'open' | 'paid' | 'merged' | 'abandoned'
  total_cents: number
  party_size: number | null
  alias: string | null
  opened_at: string
  kitchen: 'none' | 'preparing' | 'ready'
  bill_requested: boolean
}
type LiveTable  = { element_id, physical_table_id, x, y, width, height, shape, z_index, label, capacity, session: LiveSession | null }
type LiveDecor  = { element_id, kind, shape, x, y, width, height, z_index, label, color }
type LiveFloorData = { area: AreaRow; tables: LiveTable[]; decor: LiveDecor[] }
```

### Render (`live-floor.tsx`)

El mismo canvas (`TransformWrapper`) sin handles de resize ni drag de elementos
(`interactive={false}` en `PanZoomStage`). Cada mesa renderiza un `LiveTableCard`:

| Estado `session` | Color de fondo |
|---|---|
| `null` (libre) | Verde tenue |
| `open` | Ámbar |
| `paid` | Azul/slate |

Tarjeta completa: `alias ?? label`, `ARSFormat(total_cents)`, `party_size` (👥),
`elapsedLabel(opened_at)`, punto de cocina (ámbar = preparando / verde = lista), badge
"cuenta pedida".

Header: resumen ocupadas / libres / total vía `getSalonOccupancy`.

### Realtime

```ts
subscribeChanges({
  channel: `live-${tenantId}`,
  events: [
    { event: '*', table: 'table_sessions', filter: `tenant_id=eq.${tenantId}`, onChange },
    { event: '*', table: 'tickets',        filter: `tenant_id=eq.${tenantId}`, onChange },
  ],
})
```

`onChange` = `useDebouncedRefresh(() => refreshLiveFloorAction(slug, areaId))`.
Safety-net adicional de `setInterval` 30 s. Requiere la migración de publicación de
Realtime (ver arriba).

### Dónde vive

- **Dueño** (`/local/mesas`): toggle **Editar / En vivo** en el header del editor. En
  modo "En vivo" monta `<LiveFloor>`.
- **Staff** (`/salon/mesas`): tab "Plano" renderiza `<LiveFloor>` con `interactive={false}`
  y `onTableOpen` navegando a `/salon/mesas/[sessionId]`.

---

## Componentes

### Nuevos

| Archivo | Descripción |
|---|---|
| `pan-zoom-stage.tsx` | Wrapper compartido `TransformWrapper` + stage + controles `+/-/fit` |
| `floor-plan-editor.tsx` | Orquestador (reescrito sin `DndContext`; toggle Editar/En vivo) |
| `floor-canvas.tsx` | Canvas editor (reescrito; usa `PanZoomStage`) |
| `floor-element.tsx` | Elemento editable (v2.1: drag imperativo `translate3d` + snap al soltar + `React.memo` + poche) |
| `resize-handles.tsx` | Handles de resize (reescrito; delta / scale) |
| `element-palette.tsx` | Chips de la paleta (v2.1: drag por pointer events, ya no HTML5) |
| `use-palette-drag.tsx` | Hook del drag-from-palette por pointer + ghost (v2.1) |
| `live-floor.tsx` | Vista en vivo read-only (nuevo; dueño + staff) |
| `live-table-card.tsx` | Tarjeta de mesa en vivo (nuevo) |

### Reusados sin cambios (o con ajustes mínimos)

`table-inspector.tsx`, `decor-inspector.tsx`, `area-manager.tsx`,
`tables-list-fallback.tsx`, `print-qr-button.tsx`, `floor-plan-error-boundary.tsx`,
`zero-area-cta.tsx`, `use-geometry-queue.ts`.

`unplaced-tray.tsx` fue reescrito para quitar la dependencia de dnd-kit: conserva el
botón **"Colocar"** como única ruta de ubicación (ya no hay handle de drag desde la
bandeja).

### Retirados

`create-table-dialog.tsx` (reemplazado por drop-from-palette + inspector),
`lib/floor-plan/a11y.ts` (era de dnd-kit).

---

## RPCs (`fp_*`) y Server Actions

Sin cambios funcionales respecto a v1. La única diferencia es que `revalidatePath`
ahora usa `/${slug}/local/mesas` en lugar de `/${slug}/configuracion/mesas`.

Nueva Server Action: `refreshLiveFloorAction(slug, areaId)` en
`lib/floor-plan/live-actions.ts` — cualquier miembro del tenant puede llamarla
(no es owner-only); revalidación de la vista en vivo vía Realtime.

---

## Accesibilidad

El canvas con `react-zoom-pan-pinch` no provee navegación por teclado nativa para mover
elementos.

- **Lista accesible (canónica):** la tab "Lista" siempre visible en el editor muestra
  `TablesListFallback` — una `<table>` HTML con todas las mesas y sus acciones. Es el
  camino canónico para usuarios de teclado/lector de pantalla, no un respaldo de segunda
  clase.
- **Elementos focusables:** cada `floor-element` es focusable (Tab), con `aria-label`
  (kind + etiqueta). Enter abre el inspector.
- **Nudge por flechas en el canvas:** fuera de alcance v2 (anotado en BACKLOG).
- **Staff `/salon/mesas`:** la tab "Lista" siempre visible muestra la grilla de cards,
  accesible por teclado sin depender del canvas.

---

## Multi-tenant / seguridad

Sin cambios respecto a v1. El live floor amplía el SELECT a `authenticated` (cualquier
miembro) por diseño — el staff debe ver la vista operativa. Realtime solo llega a
`authenticated`; `anon` (comensal) no recibe eventos (sin policy `to anon`).

---

## Testing

### Unit (Vitest, `tests/lib/`)

```bash
npx vitest run tests/lib/floor-plan-grid.test.ts
# Cubre: GRID/RESIZE_MIN/ELEMENT_DEFAULTS; snapToGrid (positivos/negativos/custom);
#         clampToArea (bordes, oversized); stagePointFromClient (scale 1/2/0.5, pan);
#         drag-commit math a scale 1 y 2 (documenta el bug de v1 y la corrección).
```

### RLS / integración (`tests/rls/`, CI contra Supabase local)

```bash
npx vitest run tests/rls/floor-plan.test.ts        # editor v1 (intacto)
npx vitest run tests/rls/floor-plan-live.test.ts   # live floor v2
```

`floor-plan-live.test.ts` cubre:
- Tenant B no ve áreas / elementos / sesiones de tenant A.
- Query scopeada a `areaA1` devuelve solo elementos de esa área (no `areaA2`).
- La sesión abierta de `tableA1` es visible vía join directo (total_cents, party_size,
  alias).
- `tableA2` sin sesión devuelve `length = 0`.
- Staff (waiter) también puede leer el floor y la sesión de su tenant.
- Staff de A no puede ver sesiones de B.

> Sin Docker local → migraciones aplicadas vía Supabase MCP `apply_migration`
> (proyecto `ogplsevtrclzxvyejlns`); `tests/rls` corre en CI contra Supabase local.

### Smoke manual

Checklist runnable en `docs/superpowers/plans/2026-06-06-floor-plan-rediseno-smoke.md`.
