# Editor visual de plano de mesas (floor plan) — guía técnica v2

> Rediseño 2026-06-06. El editor usa **`react-zoom-pan-pinch`** (pan/zoom robusto) + drag
> propio con pointer events (dnd-kit **removido del canvas**; sigue instalado para otras
> features: menu/flows/eventos); se agrega la **vista operativa en vivo** con
> Supabase Realtime; y las tres páginas de "Local" se mueven a su **propia tab del
> sidebar**.

Ruta: `/{tenantSlug}/local/mesas` (solo `owner`; staff en `/{tenantSlug}/salon/mesas`).

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
| Lógica pura | grid/snap/clamp + `stagePointFromClient` | `lib/floor-plan/grid.ts` |
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

### Drag de elementos (pointer events, sin dnd-kit)

Cada `floor-element` usa `onPointerDown` → `setPointerCapture` + `e.stopPropagation()`.
En `onPointerMove` lee `scale` desde `transformRef.current.state` **sin re-render** y
aplica:

```ts
newX = snapToGrid(origX + (clientX - startX) / scale)
newY = snapToGrid(origY + (clientY - startY) / scale)
```

La división por `scale` es la corrección del bug de v1 (a `scale=2` el drift era el
doble del movimiento visual). Luego `clampToArea` antes del set optimista y del commit
vía `use-geometry-queue.ts`.

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

Donde `rect = wrapper.getBoundingClientRect()` y `posX/posY/scale = transformRef.current.state`.
Se usa tanto para el drop-from-palette como para la conversión inicial del drag.

### Colocar desde la paleta (drag-from-palette)

Las chips de `element-palette.tsx` son arrastrables (HTML5 drag,
`dataTransfer 'application/x-floor-kind'`). Al soltar sobre el stage,
`PanZoomStage.onDropKind` recibe `(kind, clientX, clientY)`, convierte a coords lógicas
con `stagePointFromClient` y llama:

- **Mesa** → `createTableInPlanAction` → abre el inspector (sin diálogo al centro).
  `create-table-dialog.tsx` fue retirado.
- **Decoración** → `addDecorAction` con `ELEMENT_DEFAULTS[kind]`.

Fallback (click en la chip): coloca el elemento en el centro del área visible.

### Persistencia de geometría (reusado de v1)

`use-geometry-queue.ts` sin cambios: cola debounced 600 ms, flush en `beforeunload`,
rollback de ids afectados si falla.

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
| `floor-element.tsx` | Elemento editable (reescrito; pointer drag + scale) |
| `resize-handles.tsx` | Handles de resize (reescrito; delta / scale) |
| `element-palette.tsx` | Chips arrastrables (reescrito; drop-to-create + click fallback) |
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
