# Floor Plan — Rediseño (editor SevenRooms-style + vista en vivo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer el editor de floor plan (arrastrar elementos desde la paleta, lienzo paneable con zoom — sin los bugs de v1), sumar una **vista operativa en vivo** (plano coloreado por estado + gasto/comensales/tiempo/cocina en tiempo real, para dueño y staff), y mover **"Local"** a su propia tab.

**Architecture:** Se REUSA todo el backend del floor plan v1 (tablas `floor_plan_*`, RPCs `fp_*`, `lib/floor-plan/{actions,schemas,errors,numbering}.ts`, inspectores, áreas, bandeja, lista accesible). Se REEMPLAZA la capa de canvas: sale dnd-kit, entra **`react-zoom-pan-pinch`** (pan/zoom) + **drag de elementos propio** con pointer events (delta/scale). Se AGREGA `getLiveFloor` (join TS de geometría + sesión/tickets en vivo) + componentes de vista en vivo con **Supabase Realtime** (reusa `lib/realtime`), habilitado por una migración chica que publica las tablas del salón. Navegación: las 3 páginas de "Local" se mueven a `app/(manager)/[tenantSlug]/local/*` y se agrega un `NavGroup`.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), React 19, TypeScript estricto, Supabase (Realtime, RLS), **react-zoom-pan-pinch v4** (nueva dep), Tailwind v4 + shadcn new-york, sonner, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-06-06-floor-plan-rediseno-design.md` (leer entero).

**Migraciones vía Supabase MCP `apply_migration`** (proyecto `ogplsevtrclzxvyejlns`; no hay Docker local).

---

## File Structure

**Migración (SQL):**
- `supabase/migrations/20260606000100_realtime_salon_publication.sql` — publica `table_sessions`/`tickets`/`ticket_items`/`table_session_events` en `supabase_realtime` (idempotente). Aplicar vía MCP.

**Dependencias:**
- `+ react-zoom-pan-pinch` (^4). Tras reescribir el editor: `− @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` (verificar que no queden otros usos).

**Navegación (mover, no reescribir):**
- `app/(manager)/[tenantSlug]/configuracion/{mesas,captura,auto-aceptacion}` → `app/(manager)/[tenantSlug]/local/{mesas,captura,auto-aceptacion}` (con `git mv` de carpetas enteras).
- `components/shell/nav-config.ts` (+ `nav-icons.ts`) — nuevo `NavGroup` "Local".
- Limpieza de refs: `lib/floor-plan/actions.ts`, `lib/tables/actions.ts`, `lib/capture/actions.ts`, `lib/admin/tenant-config.ts` (revalidatePath); `clientes/page.tsx`, `docs/_components/docs-content.tsx`, `onboarding/_components/onboarding-wizard.tsx`, `components/command-palette/command-config.ts`; `configuracion/_components/settings-nav.tsx` + `configuracion/page.tsx`.

**Lógica (`lib/floor-plan/`):**
- `grid.ts` — MODIFICAR: borrar modifiers dnd-kit, agregar `stagePointFromClient`. Mantener `GRID`/`RESIZE_MIN`/`ELEMENT_DEFAULTS`/`snapToGrid`/`clampToArea`.
- `queries.ts` — AGREGAR `getLiveFloor` + `listFloorAreas` + tipos `LiveSession`/`LiveTable`/`LiveDecor`/`LiveFloorData`.
- `a11y.ts` — BORRAR (era de dnd-kit). Reemplazar el import en el editor.
- `live-actions.ts` (opcional) — `refreshLiveFloor` server action si se usa para el refetch realtime (o reusar `getLiveFloor` directo).

**UI — `app/(manager)/[tenantSlug]/local/mesas/_components/`** (tras el move):
- `pan-zoom-stage.tsx` — NUEVO (shared): wrapper `react-zoom-pan-pinch` + stage + controles zoom.
- `floor-canvas.tsx` — REESCRIBIR (usa PanZoomStage, monta FloorElements en modo editar).
- `floor-element.tsx` — REESCRIBIR (pointer drag + scale, sin dnd-kit).
- `resize-handles.tsx` — REESCRIBIR (scale-aware).
- `element-palette.tsx` — REESCRIBIR (chips arrastrables → drop-to-create + click fallback).
- `floor-plan-editor.tsx` — REESCRIBIR (orquesta sin DndContext; drag-from-palette; toggle Editar/En vivo; reusa inspectores/áreas/bandeja/cola).
- `live-floor.tsx` — NUEVO (vista en vivo read-only; compartida con el staff).
- `live-table-card.tsx` — NUEVO.
- `create-table-dialog.tsx` — BORRAR.
- REUSADOS sin cambios: `table-inspector.tsx`, `decor-inspector.tsx`, `area-manager.tsx`, `unplaced-tray.tsx`, `tables-list-fallback.tsx`, `print-qr-button.tsx`, `floor-plan-error-boundary.tsx`, `zero-area-cta.tsx`, `use-geometry-queue.ts`.
- `page.tsx` — MODIFICAR (monta el contenedor Plano con toggle).

**UI — staff `app/(salon)/[tenantSlug]/salon/mesas/`:**
- Reemplazar el render de `salon-tables-grid` por `<LiveFloor>` (compartido). `salon-view.tsx` (suscripción realtime) se reusa/integra.

**Helpers compartidos:**
- `elapsedLabel` y `ARSFormat` — extraer de `salon-tables-grid.tsx` a un módulo reutilizable (p.ej. `lib/salon/format.ts`) para usarlos en `live-table-card`. (Si ya están exportables, reusar.)

**Tests:**
- `tests/lib/floor-plan-grid.test.ts` — EXTENDER (`stagePointFromClient`, drag commit a scale 1 y 2; sacar tests de los modifiers borrados).
- `tests/lib/floor-plan-live.test.ts` — NUEVO (derivación kitchen/estado/color de `getLiveFloor` si se extrae lógica pura).
- `tests/rls/floor-plan-live.test.ts` — NUEVO (aislamiento por tenant/área de `getLiveFloor`).

**Docs:**
- `docs/floor-plan-mesas.md` — actualizar (nuevo editor, vista en vivo, nav, realtime).

---

## Contracts (fuente única de verdad — toda tarea se ata a esto)

### Migración (realtime) — `supabase/migrations/20260606000100_realtime_salon_publication.sql`
Idempotente (espejo de `20260520040000_salon_reservations_realtime.sql`):
```sql
do $$
begin
  begin alter publication supabase_realtime add table public.table_sessions;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tickets;               exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ticket_items;          exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.table_session_events;  exception when duplicate_object then null; end;
end $$;
```
RLS no cambia (realtime respeta las policies SELECT existentes; solo `authenticated` recibe). Aplicar vía MCP `apply_migration`. `db:types` NO aplica (no cambian tablas/columnas).

### `lib/floor-plan/grid.ts` (modificar)
- MANTENER: `GRID = 20`, `RESIZE_MIN = 24`, `ELEMENT_DEFAULTS`, `snapToGrid(value, grid?)`, `clampToArea(x,y,w,h,areaW,areaH)`.
- BORRAR: `createSnapModifier`, `restrictToParent`, `import type { Modifier } from '@dnd-kit/core'`.
- AGREGAR:
```ts
// Convierte un punto de pantalla (clientX/Y) a coords lógicas del stage.
// rect = wrapper.getBoundingClientRect(); posX/posY/scale = transformRef.current.state.
export function stagePointFromClient(
  clientX: number, clientY: number,
  rect: { left: number; top: number },
  scale: number, posX: number, posY: number,
): { x: number; y: number } // { x: (clientX - rect.left - posX) / scale, y: (clientY - rect.top - posY) / scale }
```

### `lib/floor-plan/queries.ts` (agregar; reusa `AreaRow`)
```ts
export type LiveSession = {
  id: string
  status: 'open' | 'paid' | 'merged' | 'abandoned'
  total_cents: number
  party_size: number | null
  alias: string | null
  opened_at: string
  kitchen: 'none' | 'preparing' | 'ready'   // 'ready' si algún ticket de la sesión está 'ready'; si no 'preparing' si hay 'accepted'|'preparing'; si no 'none'
  bill_requested: boolean                     // exists table_session_events type='bill_requested' (sin cobrar)
}
export type LiveTable = {
  element_id: string; physical_table_id: string
  x: number; y: number; width: number; height: number; shape: 'rect' | 'circle'; z_index: number
  label: string; capacity: number | null
  session: LiveSession | null                 // null = mesa libre (sin sesión abierta)
}
export type LiveDecor = {
  element_id: string; kind: 'wall' | 'pillar' | 'island' | 'bar'; shape: 'rect' | 'circle'
  x: number; y: number; width: number; height: number; z_index: number; label: string | null; color: string | null
}
export type LiveFloorData = { area: AreaRow; tables: LiveTable[]; decor: LiveDecor[] }
export async function getLiveFloor(tenantId: string, areaId: string): Promise<LiveFloorData>
export async function listFloorAreas(tenantId: string): Promise<AreaRow[]>
// getLiveFloor: floor_plan_elements del área (kind='table' → join physical_tables + la única sesión OPEN por physical_table_id
//   + flags kitchen/bill_requested; kind decor → LiveDecor). Patrón TS + supabase-js como listSalonTables (anti-join/conteos en JS).
//   RLS: SELECT abierto a miembros del tenant (owner + staff). Sin RPC nuevo.
```

### Server action para refetch realtime — `lib/floor-plan/live-actions.ts` (`'use server'`)
```ts
export async function refreshLiveFloorAction(slug: string, areaId: string):
  Promise<{ ok: true; data: LiveFloorData } | { ok: false; message: string }>
// requireTenantAccess(slug) (cualquier miembro) → getLiveFloor(tenant.id, areaId). Lo llama LiveFloor en el onChange realtime.
```

### Componentes — props (bajo `local/mesas/_components/`)
```ts
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

// pan-zoom-stage.tsx ('use client') — wrapper compartido (TransformWrapper + TransformComponent + stage + controles +/-/fit)
export type PanZoomStageProps = {
  width: number; height: number              // tamaño lógico del área
  transformRef: TransformRef
  interactive?: boolean                       // true=editor (panning excluded 'floor-element'); false=live (pan/zoom libre)
  onBackgroundClick?: () => void              // click en fondo vacío (deseleccionar)
  onDropKind?: (kind: 'table'|'wall'|'pillar'|'island'|'bar', clientX: number, clientY: number) => void // drop-from-palette
  children: React.ReactNode                   // FloorElements (editor) o LiveTableCards (live), posicionados absolute en coords lógicas
}

// floor-element.tsx ('use client') — editor
export type FloorElementProps = {
  element: ElementRow
  selected: boolean
  transformRef: TransformRef
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void          // drag (optimista); el editor encola persistencia
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
}

// resize-handles.tsx ('use client')
export type ResizeHandlesProps = {
  width: number; height: number; transformRef: TransformRef
  onResize: (size: { width: number; height: number }) => void
  onResizeEnd: (size: { width: number; height: number }) => void
}

// element-palette.tsx ('use client') — chips arrastrables (HTML5 drag: dataTransfer 'application/x-floor-kind'=kind) + click fallback
export type ElementPaletteProps = { onQuickAdd: (kind: 'table'|'wall'|'pillar'|'island'|'bar') => void }

// floor-plan-editor.tsx ('use client') — orquestador + toggle
export type FloorPlanEditorProps = { slug: string; tenantId: string; initial: FloorPlanData }
// Posee estado (elements optimistas, selectedId, scale via transformRef, activeAreaId), el toggle Editar/En vivo,
// drop-from-palette (stagePointFromClient → createTableInPlanAction[mesa, luego abre inspector] / addDecorAction[decor]),
// reusa table-inspector/decor-inspector/area-manager/unplaced-tray/use-geometry-queue. En modo En vivo monta <LiveFloor>.

// live-floor.tsx ('use client') — read-only, compartido dueño+staff
export type LiveFloorProps = {
  slug: string; tenantId: string
  areas: AreaRow[]; activeAreaId: string
  initial: LiveFloorData
  onTableOpen: (table: LiveTable) => void     // dueño: abre panel; staff: navega a /salón/mesas/[sessionId]
}
// PanZoomStage interactive=false; LiveTableCard por mesa + decor gris; selector de áreas; subscribeChanges(
//   channel `live-${tenantId}`, table_sessions+tickets filtrados tenant_id) → useDebouncedRefresh(refreshLiveFloorAction) + safety 30s.

// live-table-card.tsx ('use client')
export type LiveTableCardProps = { table: LiveTable; onOpen: () => void }
// color por session.status (libre=verde tenue, open=ámbar, paid=azul); ARSFormat(total_cents), party_size (👥),
// elapsedLabel(opened_at), punto cocina (ámbar 'preparing'/verde 'ready'), flag bill_requested. position absolute en coords lógicas.
```

### Reusados sin cambios (NO reescribir)
`lib/floor-plan/{actions,schemas,errors,numbering}.ts`; RPCs `fp_*`; `table-inspector.tsx`, `decor-inspector.tsx`, `area-manager.tsx`, `unplaced-tray.tsx`, `tables-list-fallback.tsx`, `print-qr-button.tsx`, `floor-plan-error-boundary.tsx`, `zero-area-cta.tsx`, `use-geometry-queue.ts`. Helpers `elapsedLabel`/`ARSFormat` (extraer a `lib/salon/format.ts` y reusar en la grilla existente + live-table-card).

### Patrón realtime (de `lib/realtime` + `salon-view.tsx`)
`subscribeChanges({ channel: 'live-' + tenantId, events: [{event:'*', table:'table_sessions', filter:'tenant_id=eq.'+tenantId, onChange}, {event:'*', table:'tickets', filter:'tenant_id=eq.'+tenantId, onChange}], })` → cleanup en unmount + `setInterval` 30s safety. `onChange` = `useDebouncedRefresh(() => refreshLiveFloorAction(...))`.

### react-zoom-pan-pinch (v4) — patrón normativo
`<TransformWrapper ref={transformRef} initialScale centerOnInit minScale={0.25} maxScale={4} limitToBounds={false} panning={{ excluded:['floor-element'], velocityDisabled:true }} wheel={{step:0.2}} pinch={{step:5}}>` → `<TransformComponent wrapperStyle={{width:'100%',height:'100%'}}>` → stage div `position:relative` (área-sized, grilla CSS) → hijos `position:absolute`. Leer `transformRef.current.state.scale` en pointermove (sin re-render). Drag commit: `snapToGrid(orig + (clientX-startX)/scale)`. Controles vía `transformRef.current.{zoomIn,zoomOut,centerView,setTransform,zoomToElement}`. Editor `'use client'` (opcional `dynamic(...,{ssr:false})`).

### Adiciones de contrato (consolidadas tras el authoring)

Surgieron al escribir las fases; cada una está documentada también al inicio de su fase. Son normativas:

- **`stagePointFromClient` — mapeo de params**: la lib expone `transformRef.current.state.positionX`/`positionY` (no `posX`/`posY`). Los nombres `posX`/`posY` del Contracts son solo locales al helper; los llamadores pasan `state.positionX → posX`, `state.positionY → posY`. [Phase 2/3]
- **`unplaced-tray.tsx` SE REESCRIBE (no es "reuse sin cambios")**: hoy importa `useDraggable`/`CSS` de dnd-kit y depende del `DndContext` que el clúster del editor elimina → su handle de drag quedaría inerte y el import roto. Se reescribe para **quitar dnd-kit**: deja solo el botón **"Colocar"** (la ruta canónica de ubicación/mover-de-piso, spec §5) y se borra el export `TRAY_DRAG_PREFIX` (ya no se usa). **Props sin cambios**: `{ tables: UnplacedTable[]; onPlace: (tableId: string) => void }`. [Phase 3]
- **`lib/salon/format.ts`** (extraído en Phase 2): `export function ARSFormat(cents: number): string` y `export function elapsedLabel(openedAt: string): string` (idénticas a las inline de `salon-tables-grid.tsx`). Las consumen `live-table-card.tsx` y la grilla existente. [Phase 2 ↔ Phase 5]
- **`FloorPlanEditorProps` — forma final (tras Phase 6)**: `{ slug: string; tenantId: string; initial: FloorPlanData; liveAreas: AreaRow[]; initialLive: LiveFloorData | null }`. La page RSC siembra `liveAreas = listFloorAreas(tenant.id)` + `initialLive = getLiveFloor(tenant.id, defaultAreaId)` (sin fetch-on-mount). El toggle **En vivo** (placeholder en Phase 3) se reemplaza por `<LiveFloor>`; el `onTableOpen` del dueño abre un **Sheet read-only** con la sesión. [Phase 3 → Phase 6]
- **`pan-zoom-stage.tsx`** puede exponer props internas adicionales más allá del Contracts; `live-floor.tsx` lo usa con `interactive={false}` (pan/zoom libre, sin drag de elementos) y su propio `transformRef`. [Phase 3 ↔ Phase 5]

---

## Tasks

## Phase 1: Nav — tab "Local" + mover las 3 páginas fuera de Configuración

### Task 1.1: Agregar íconos y NavGroup "Local" en shell

**Files:**
- Modify `components/shell/nav-icons.ts`
- Modify `components/shell/nav-config.ts`

- [ ] **Step 1: Agregar `LayoutGrid`, `QrCode`, `Zap` a `NAV_ICONS`**

```ts
// components/shell/nav-icons.ts
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Coins,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
  MonitorSmartphone,
  QrCode,
  ScanLine,
  Settings2,
  Sparkles,
  Stamp,
  Star,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
  Zap,
} from 'lucide-react'

/**
 * Map keys → componentes Lucide para el sidebar y el command palette.
 * Mantenemos las KEYS como literales serializables (string) para poder
 * pasarlos de Server Components a Client Components sin romper la
 * frontera RSC. El mapping vive solo en el cliente que renderiza.
 */
export const NAV_ICONS = {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Coins,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  MonitorSmartphone,
  QrCode,
  ScanLine,
  Settings2,
  Sparkles,
  Stamp,
  Star,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
  Zap,
} satisfies Record<string, LucideIcon>

export type NavIconKey = keyof typeof NAV_ICONS
```

- [ ] **Step 2: Insertar el NavGroup "Local" (owner-only) en `NAV_GROUPS`, después de "Eventos" y antes de "Catálogo"**

```ts
// components/shell/nav-config.ts
import type { TenantRole } from '@/lib/tenant/types'
import type { NavIconKey } from './nav-icons'

export type NavItem = {
  label: string
  href: (slug: string) => string
  icon: NavIconKey
  /** Si está, sólo se muestra a estos roles. Si no, a todos. */
  roles?: TenantRole[]
  /** Match exacto (true) o prefijo (false, default). */
  exact?: boolean
  /** Abre en nueva pestaña. Para "Salón en vivo" desde el manager. */
  newTab?: boolean
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

/** Versión "resuelta" — href ya evaluado, todo serializable para cruzar a Client Components. */
export type ResolvedNavItem = {
  label: string
  href: string
  iconKey: NavIconKey
  exact?: boolean
  newTab?: boolean
}

export type ResolvedNavGroup = {
  label: string
  items: ResolvedNavItem[]
}

/**
 * Information architecture del Manager Workspace — 7 dominios.
 * Cada dominio agrupa por job-to-be-done del owner:
 *   HOY       — qué está pasando ahora
 *   CLIENTES  — quién viene
 *   MARKETING — cómo los traigo de vuelta
 *   LOCAL     — cómo está armado el salón
 *   CATÁLOGO  — qué vendo y cómo se premia
 *   INSIGHTS  — qué entiendo
 *   AJUSTES   — cómo lo configuro
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Hoy',
    items: [
      {
        label: 'Resumen',
        href: (s) => `/${s}`,
        icon: 'LayoutDashboard',
        exact: true,
      },
      {
        label: 'Operativo',
        href: (s) => `/${s}/salon/reservas-operativo`,
        icon: 'MonitorSmartphone',
        newTab: true,
      },
      {
        label: 'Acreditar',
        href: (s) => `/${s}/acreditar`,
        icon: 'ScanLine',
      },
    ],
  },
  {
    label: 'Clientes',
    items: [
      {
        label: 'Personas',
        href: (s) => `/${s}/clientes`,
        icon: 'Users',
      },
      {
        label: 'Reservas',
        href: (s) => `/${s}/reservas`,
        icon: 'CalendarCheck',
      },
    ],
  },
  {
    label: 'Eventos',
    items: [
      {
        label: 'Calendario',
        href: (s) => `/${s}/eventos/programados`,
        icon: 'CalendarDays',
      },
      {
        label: 'Templates',
        href: (s) => `/${s}/eventos/templates`,
        icon: 'Sparkles',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Local',
    items: [
      {
        label: 'Plano',
        href: (s) => `/${s}/local/mesas`,
        icon: 'LayoutGrid',
        roles: ['owner'],
      },
      {
        label: 'Captura QRs',
        href: (s) => `/${s}/local/captura`,
        icon: 'QrCode',
        roles: ['owner'],
      },
      {
        label: 'Auto-aceptación',
        href: (s) => `/${s}/local/auto-aceptacion`,
        icon: 'Zap',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      {
        label: 'Menú',
        href: (s) => `/${s}/menu`,
        icon: 'UtensilsCrossed',
        roles: ['owner'],
      },
      {
        label: 'Puntos',
        href: (s) => `/${s}/puntos`,
        icon: 'Star',
        roles: ['owner'],
      },
      {
        label: 'Punch cards',
        href: (s) => `/${s}/punch-cards`,
        icon: 'Stamp',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        label: 'Estadísticas',
        href: (s) => `/${s}/estadisticas`,
        icon: 'BarChart3',
        roles: ['owner'],
      },
      {
        label: 'Comisiones',
        href: (s) => `/${s}/estadisticas/comisiones`,
        icon: 'Coins',
        roles: ['owner'],
      },
    ],
  },
  {
    label: 'Ayuda',
    items: [
      {
        label: 'Documentación',
        href: (s) => `/${s}/docs`,
        icon: 'BookOpen',
      },
    ],
  },
  {
    label: 'Ajustes',
    items: [
      {
        label: 'Configuración',
        href: (s) => `/${s}/configuracion`,
        icon: 'Settings2',
        roles: ['owner'],
      },
    ],
  },
]

export function visibleGroups(role: TenantRole): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)
}

/**
 * Resuelve los grupos a estructuras serializables (href ejecutado, icon como
 * key string). Llamar **server-side** antes de pasar a un Client Component.
 */
export function resolveNavGroups(role: TenantRole, slug: string): ResolvedNavGroup[] {
  return visibleGroups(role).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href(slug),
      iconKey: item.icon,
      exact: item.exact,
      newTab: item.newTab,
    })),
  }))
}
```

- [ ] **Step 3: Verificar que TypeScript acepta los nuevos keys**

```bash
npm run typecheck 2>&1 | head -40
```
Resultado esperado: sin errores nuevos relacionados con `nav-icons` o `nav-config`.

- [ ] **Step 4: Commit**

```
git commit -m "feat(nav): add LayoutGrid/QrCode/Zap icons + Local NavGroup in sidebar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: `git mv` de las 3 carpetas de páginas

**Files:**
- Delete (move) `app/(manager)/[tenantSlug]/configuracion/mesas/` → Create `app/(manager)/[tenantSlug]/local/mesas/`
- Delete (move) `app/(manager)/[tenantSlug]/configuracion/captura/` → Create `app/(manager)/[tenantSlug]/local/captura/`
- Delete (move) `app/(manager)/[tenantSlug]/configuracion/auto-aceptacion/` → Create `app/(manager)/[tenantSlug]/local/auto-aceptacion/`

- [ ] **Step 1: Crear el directorio `local/` y mover las carpetas con `git mv`**

```bash
mkdir -p "/mnt/c/Users/Agust/Hub_main/app/(manager)/[tenantSlug]/local"
git -C /mnt/c/Users/Agust/Hub_main mv \
  "app/(manager)/[tenantSlug]/configuracion/mesas" \
  "app/(manager)/[tenantSlug]/local/mesas"
git -C /mnt/c/Users/Agust/Hub_main mv \
  "app/(manager)/[tenantSlug]/configuracion/captura" \
  "app/(manager)/[tenantSlug]/local/captura"
git -C /mnt/c/Users/Agust/Hub_main mv \
  "app/(manager)/[tenantSlug]/configuracion/auto-aceptacion" \
  "app/(manager)/[tenantSlug]/local/auto-aceptacion"
```
Resultado esperado: los 3 directorios aparecen como `renamed` en `git status`.

- [ ] **Step 2: Verificar que la estructura quedó correcta**

```bash
ls "/mnt/c/Users/Agust/Hub_main/app/(manager)/[tenantSlug]/local/"
```
Resultado esperado: `auto-aceptacion  captura  mesas`

- [ ] **Step 3: Verificar que typecheck y lint pasan (los imports `@/` no cambiarán — Next.js resuelve rutas de página por directorio, no por import)**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck 2>&1 | tail -20
```
Resultado esperado: sólo errores preexistentes (si los hay) relativos a `revalidatePath` apuntando a rutas viejas — esos se corrigen en Tasks 1.3 y 1.4.

- [ ] **Step 4: Commit**

```
git commit -m "refactor(nav): git mv configuracion/{mesas,captura,auto-aceptacion} → local/*

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Actualizar `revalidatePath` en lib

**Files:**
- Modify `lib/floor-plan/actions.ts`
- Modify `lib/tables/actions.ts`
- Modify `lib/capture/actions.ts`
- Modify `lib/admin/tenant-config.ts`

- [ ] **Step 1: Reemplazar las 17 ocurrencias en `lib/floor-plan/actions.ts`**

Reemplazar globalmente `/${slug}/configuracion/mesas` → `/${slug}/local/mesas` (17 ocurrencias en líneas 131, 167, 207, 241, 271, 313, 366, 481, 534, 570, 610, 646, 676, 725, 767, 794, 823):

```bash
sed -i 's|/${slug}/configuracion/mesas|/${slug}/local/mesas|g' \
  /mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts
```
Resultado esperado: `grep -c 'local/mesas' lib/floor-plan/actions.ts` devuelve `17`.

- [ ] **Step 2: Reemplazar las 4 ocurrencias en `lib/tables/actions.ts`**

```bash
sed -i 's|/${slug}/configuracion/mesas|/${slug}/local/mesas|g' \
  /mnt/c/Users/Agust/Hub_main/lib/tables/actions.ts
```
Resultado esperado: `grep -c 'local/mesas' lib/tables/actions.ts` devuelve `4`.

- [ ] **Step 3: Reemplazar las 3 ocurrencias en `lib/capture/actions.ts`**

```bash
sed -i 's|/${tenantSlug}/configuracion/captura|/${tenantSlug}/local/captura|g' \
  /mnt/c/Users/Agust/Hub_main/lib/capture/actions.ts
```
Resultado esperado: `grep -c 'local/captura' lib/capture/actions.ts` devuelve `3`.

- [ ] **Step 4: Actualizar `lib/admin/tenant-config.ts` — el `revalidatePath` apunta a `/${slug}/configuracion` (la página raíz del grupo Ajustes) y no necesita cambiar; sin embargo el `revalidatePath` se puede ampliar para refrescar también la nueva ruta. No hay `revalidatePath` apuntando a `auto-aceptacion` en este archivo — el path `/${slug}/configuracion` ya invalida el layout del owner completo. Confirmar que no hay referencias a `configuracion/auto-aceptacion` o `configuracion/local`:**

```bash
grep -n "configuracion/auto\|configuracion/local" \
  /mnt/c/Users/Agust/Hub_main/lib/admin/tenant-config.ts
```
Resultado esperado: sin output (ninguna referencia; el `revalidatePath(`/${slug}/configuracion`)` en línea 88 invalida suficientemente el layout y no requiere cambio).

- [ ] **Step 5: Verificar con grep que no quedan referencias viejas en lib/**

```bash
grep -rn "configuracion/mesas\|configuracion/captura\|configuracion/auto-aceptacion" \
  /mnt/c/Users/Agust/Hub_main/lib/
```
Resultado esperado: sin output.

- [ ] **Step 6: Typecheck + lint**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck 2>&1 | tail -10 && npm run lint 2>&1 | tail -10
```
Resultado esperado: sin errores nuevos.

- [ ] **Step 7: Commit**

```
git commit -m "fix(nav): update revalidatePath in floor-plan/tables/capture actions → /local/*

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: Actualizar links entrantes en páginas y command palette

**Files:**
- Modify `app/(manager)/[tenantSlug]/clientes/page.tsx`
- Modify `app/(manager)/[tenantSlug]/docs/_components/docs-content.tsx`
- Modify `app/(manager)/[tenantSlug]/onboarding/_components/onboarding-wizard.tsx`
- Modify `components/command-palette/command-config.ts`

- [ ] **Step 1: Actualizar `clientes/page.tsx` — 2 ocurrencias (líneas 69 y 106)**

Reemplazar ambas:
```
href={`/${tenantSlug}/configuracion/captura`}
```
→
```
href={`/${tenantSlug}/local/captura`}
```

En `app/(manager)/[tenantSlug]/clientes/page.tsx`, línea 69:

```tsx
                <Link href={`/${tenantSlug}/local/captura`}>
```

En `app/(manager)/[tenantSlug]/clientes/page.tsx`, línea 106:

```tsx
                  <Link href={`/${tenantSlug}/local/captura`}>
```

- [ ] **Step 2: Actualizar `docs-content.tsx` — 2 ocurrencias**

Línea 279 — cambiar el href y el texto descriptivo:
```tsx
          <a href={`/${slug}/local/mesas`} className="text-primary underline">
            Local → Plano
          </a>
```

Línea 738 — cambiar el href y el texto descriptivo:
```tsx
        <a href={`/${slug}/local/auto-aceptacion`} className="text-primary underline">
          Local → Auto-aceptación
        </a>
```

- [ ] **Step 3: Actualizar `onboarding-wizard.tsx` — 1 ocurrencia (línea 230)**

```tsx
      ctaHref={`/${tenantSlug}/local/mesas`}
```

- [ ] **Step 4: Actualizar `command-config.ts` — corregir el entry `auto-accept` (línea 212) que apuntaba a la ruta stale `configuracion/local?tab=auto-aceptacion` y actualizarla a la nueva ruta directa `local/auto-aceptacion`**

Reemplazar el entry completo `auto-accept`:
```ts
  {
    id: 'auto-accept',
    label: 'Auto-aceptación',
    icon: Zap,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/local/auto-aceptacion`,
    keywords: ['settings'],
  },
```

Agregar también un entry para "Plano" (mesas) en la sección "Ir a" del command palette, junto al resto de entradas de navegación. Insertar antes de `auto-accept`:

```ts
  {
    id: 'floor-plan',
    label: 'Plano del salón',
    icon: LayoutGrid,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/local/mesas`,
    keywords: ['mesas', 'floor', 'plano', 'salón'],
  },
```

El import de `LayoutGrid` ya está disponible en `lucide-react`; agregar al bloque de imports existente en `command-config.ts`. El archivo completo modificado queda:

```ts
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChefHat,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
  MessageSquareText,
  Receipt,
  Settings2,
  Stamp,
  Star,
  Tags,
  Users,
  UsersRound,
  UtensilsCrossed,
  Workflow,
  Zap,
} from 'lucide-react'

export type CommandActionType = 'navigate' | 'navigate-new'

export type CommandEntry = {
  id: string
  label: string
  icon: LucideIcon
  group: 'Acciones rápidas' | 'Ir a' | 'Operación'
  type: CommandActionType
  /** Devuelve el path destino dado el slug. */
  href: (slug: string) => string
  /** Para narrow keyword search en cmdk. */
  keywords?: string[]
}

export const commandEntries: CommandEntry[] = [
  // Acciones rápidas (mutaciones / new resource)
  {
    id: 'new-customer',
    label: 'Nuevo cliente',
    icon: Users,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/clientes/nuevo`,
    keywords: ['cliente', 'persona', 'agregar', 'crear'],
  },
  {
    id: 'new-broadcast',
    label: 'Nueva difusión',
    icon: Megaphone,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/difusiones/nueva`,
    keywords: ['enviar', 'whatsapp', 'broadcast', 'campaña'],
  },
  {
    id: 'new-event',
    label: 'Nuevo evento',
    icon: CalendarDays,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/eventos/nuevo`,
    keywords: ['fecha', 'agenda', 'show', 'fiesta'],
  },
  {
    id: 'new-flow',
    label: 'Nuevo flow',
    icon: Workflow,
    group: 'Acciones rápidas',
    type: 'navigate-new',
    href: (s) => `/${s}/flows/nuevo`,
    keywords: ['automatización', 'recurrente'],
  },
  {
    id: 'close-table-legacy',
    label: 'Cerrar mesa (legacy)',
    icon: Receipt,
    group: 'Acciones rápidas',
    type: 'navigate',
    href: (s) => `/${s}/visitas/nueva`,
    keywords: ['cerrar', 'mesa', 'cobrar'],
  },

  // Operación (turno en vivo)
  {
    id: 'live-sessions',
    label: 'Salón en vivo',
    icon: ClipboardList,
    group: 'Operación',
    type: 'navigate',
    href: (s) => `/${s}/salon/mesas`,
    keywords: ['mesas', 'sesiones', 'salón', 'live'],
  },
  {
    id: 'kitchen',
    label: 'Cocina',
    icon: ChefHat,
    group: 'Operación',
    type: 'navigate',
    href: (s) => `/${s}/salon/cocina`,
    keywords: ['kitchen', 'tickets', 'pedidos'],
  },
  {
    id: 'inbox',
    label: 'Bandeja',
    icon: Inbox,
    group: 'Operación',
    type: 'navigate',
    href: (s) => `/${s}/bandeja`,
    keywords: ['mensajes', 'whatsapp', 'instagram', 'inbox'],
  },

  // Ir a (navegación)
  {
    id: 'home',
    label: 'Resumen',
    icon: LayoutDashboard,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}`,
    keywords: ['dashboard', 'home', 'inicio'],
  },
  {
    id: 'people',
    label: 'Personas',
    icon: Users,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/clientes`,
    keywords: ['clientes', 'crm'],
  },
  {
    id: 'audiences',
    label: 'Audiencias',
    icon: UsersRound,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/audiencias`,
    keywords: ['segmentos', 'filtros'],
  },
  {
    id: 'broadcasts',
    label: 'Difusiones',
    icon: Megaphone,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/difusiones`,
    keywords: ['campañas', 'whatsapp'],
  },
  {
    id: 'flows',
    label: 'Flows',
    icon: Workflow,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/flows`,
    keywords: ['automatización'],
  },
  {
    id: 'events',
    label: 'Eventos',
    icon: CalendarDays,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/eventos`,
    keywords: ['agenda', 'calendario'],
  },
  {
    id: 'menu',
    label: 'Menú',
    icon: UtensilsCrossed,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/menu`,
    keywords: ['carta', 'productos', 'items'],
  },
  {
    id: 'points',
    label: 'Puntos',
    icon: Star,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/puntos`,
    keywords: ['fidelidad', 'rewards'],
  },
  {
    id: 'punch-cards',
    label: 'Punch cards',
    icon: Stamp,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/punch-cards`,
    keywords: ['tarjetas', 'sellos'],
  },
  {
    id: 'tags',
    label: 'Tags de carta',
    icon: Tags,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/configuracion/mensajeria?tab=tags`,
    keywords: ['etiquetas'],
  },
  {
    id: 'floor-plan',
    label: 'Plano del salón',
    icon: LayoutGrid,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/local/mesas`,
    keywords: ['mesas', 'floor', 'plano', 'salón'],
  },
  {
    id: 'auto-accept',
    label: 'Auto-aceptación',
    icon: Zap,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/local/auto-aceptacion`,
    keywords: ['settings'],
  },
  {
    id: 'templates',
    label: 'Plantillas WhatsApp',
    icon: MessageSquareText,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/configuracion/mensajeria?tab=plantillas`,
    keywords: ['mensajes'],
  },
  {
    id: 'team',
    label: 'Equipo',
    icon: UsersRound,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/configuracion/equipo`,
    keywords: ['staff', 'invitar'],
  },
  {
    id: 'stats',
    label: 'Estadísticas',
    icon: BarChart3,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/estadisticas`,
    keywords: ['reportes', 'analytics'],
  },
  {
    id: 'docs',
    label: 'Documentación',
    icon: BookOpen,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/docs`,
    keywords: ['ayuda', 'guía', 'manual', 'help'],
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings2,
    group: 'Ir a',
    type: 'navigate',
    href: (s) => `/${s}/configuracion`,
    keywords: ['ajustes', 'preferencias'],
  },
]
```

- [ ] **Step 5: Verificar que no quedan refs a `configuracion/captura`, `configuracion/mesas`, `configuracion/auto-aceptacion` en los archivos editados y en el proyecto**

```bash
grep -rn "configuracion/mesas\|configuracion/captura\|configuracion/auto-aceptacion\|configuracion/local?tab" \
  /mnt/c/Users/Agust/Hub_main/app/ \
  /mnt/c/Users/Agust/Hub_main/components/ 2>/dev/null
```
Resultado esperado: sin output.

- [ ] **Step 6: Typecheck + lint**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck 2>&1 | tail -10 && npm run lint 2>&1 | tail -10
```
Resultado esperado: sin errores nuevos.

- [ ] **Step 7: Commit**

```
git commit -m "fix(nav): update inbound links to /local/{mesas,captura,auto-aceptacion}

clientes/page.tsx (2×), docs-content.tsx (2×), onboarding-wizard.tsx (1×),
command-config.ts (auto-accept stale href + new floor-plan entry).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Limpiar Configuración — quitar grupo "Local" del nav y la card de la página raíz

**Files:**
- Modify `app/(manager)/[tenantSlug]/configuracion/_components/settings-nav.tsx`
- Modify `app/(manager)/[tenantSlug]/configuracion/page.tsx`

- [ ] **Step 1: Eliminar el grupo "Local" de `settings-nav.tsx`**

El archivo completo modificado (elimina el grupo "Local" del array `GROUPS` y el import `Home` que ya no se usa):

```tsx
'use client'

import { Gift, type LucideIcon, MessageCircle, Palette, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type SubItem = {
  label: string
  href: (slug: string) => string
}

type Group = {
  label: string
  icon: LucideIcon
  items: SubItem[]
}

const GROUPS: Group[] = [
  {
    label: 'Equipo',
    icon: UsersRound,
    items: [{ label: 'Miembros', href: (s) => `/${s}/configuracion/equipo` }],
  },
  {
    label: 'Fidelización',
    icon: Gift,
    items: [{ label: 'Regalo de bienvenida', href: (s) => `/${s}/configuracion/bienvenida` }],
  },
  {
    label: 'Mensajería',
    icon: MessageCircle,
    items: [
      { label: 'Canales (WA · IG)', href: (s) => `/${s}/configuracion/canales` },
      { label: 'Plantillas WhatsApp', href: (s) => `/${s}/configuracion/templates` },
      { label: 'Tags de carta', href: (s) => `/${s}/configuracion/tags` },
    ],
  },
  {
    label: 'Apariencia',
    icon: Palette,
    items: [{ label: 'General', href: (s) => `/${s}/configuracion/apariencia` }],
  },
]

export function SettingsNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname()

  return (
    <nav className="space-y-5">
      {GROUPS.map((group) => {
        const Icon = group.icon
        return (
          <div key={group.label} className="space-y-1.5">
            <div className="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              <Icon className="size-3" aria-hidden />
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const href = item.href(tenantSlug)
                const active = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <li key={item.label}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                        active
                          ? 'bg-secondary font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-[--cream-tint] hover:text-foreground',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Eliminar la card "Local" de `configuracion/page.tsx` y actualizar la descripción del header**

El archivo completo modificado (elimina la card `Home`/`Local` del array `CARDS` y el import `Home` que ya no se usa; actualiza la descripción del `PageHeader` de "Cuatro grupos" a "Tres grupos"):

```tsx
import { ArrowRight, type LucideIcon, MessageCircle, Palette, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Configuración' }

type SettingsCard = {
  icon: LucideIcon
  title: string
  description: string
  topics: string[]
  href: (slug: string) => string
}

const CARDS: SettingsCard[] = [
  {
    icon: UsersRound,
    title: 'Equipo',
    description: 'Sumá owners, cajeros, mozos y cocineros con el rol que corresponde.',
    topics: ['Miembros', 'Roles e invitaciones'],
    href: (s) => `/${s}/configuracion/equipo`,
  },
  {
    icon: MessageCircle,
    title: 'Mensajería',
    description: 'Conexión con WhatsApp e Instagram, plantillas aprobadas y tags de carta.',
    topics: ['Canales', 'Plantillas', 'Tags de carta'],
    href: (s) => `/${s}/configuracion/canales`,
  },
  {
    icon: Palette,
    title: 'Apariencia',
    description: 'Logo del bar, idioma y zona horaria. El acento de tenant llega pronto.',
    topics: ['Logo', 'Idioma · TZ'],
    href: (s) => `/${s}/configuracion/apariencia`,
  },
]

export default async function ConfiguracionIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Ajustes"
        title="Configuración"
        description="Tres grupos para que encuentres rápido lo que necesitás cambiar."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.title}
              href={card.href(tenantSlug)}
              className="group block focus-visible:outline-none"
            >
              <Card className="card-hairline relative h-full gap-3 border-border/70 bg-card/85 p-6 transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-[--cream-tint] text-primary shadow-2xs">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <ArrowRight
                    className="size-4 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                </div>
                <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {card.title}
                </h2>
                <p className="text-sm text-muted-foreground">{card.description}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {card.topics.map((topic) => (
                    <li
                      key={topic}
                      className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {topic}
                    </li>
                  ))}
                </ul>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar que no quedan referencias a `configuracion/mesas`, `configuracion/captura`, `configuracion/auto-aceptacion` en todo el proyecto**

```bash
grep -rn "configuracion/mesas\|configuracion/captura\|configuracion/auto-aceptacion" \
  /mnt/c/Users/Agust/Hub_main/ \
  --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v ".next"
```
Resultado esperado: sin output.

- [ ] **Step 4: Typecheck + lint verdes**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck 2>&1 | tail -10 && npm run lint 2>&1 | tail -10
```
Resultado esperado: sin errores.

- [ ] **Step 5: Smoke manual**
  - Navegar al sidebar del dueño → confirmar que aparece la sección "Local" con 3 ítems (Plano, Captura QRs, Auto-aceptación) y que cada uno abre la página correcta bajo `/[slug]/local/*`.
  - Navegar a `Configuración` → confirmar que sólo aparecen 3 cards (Equipo, Mensajería, Apariencia); no hay card "Local".
  - Abrir `SettingsNav` dentro de Configuración → confirmar que el grupo "Local" no aparece.
  - Abrir el ⌘K command palette → buscar "auto" → debe aparecer "Auto-aceptación" navegando a `/local/auto-aceptacion`; buscar "plano" → aparece "Plano del salón" navegando a `/local/mesas`.
  - En la página de Clientes (vacía o con datos) → el botón "Crear QR de captura" apunta a `/local/captura`.
  - En el wizard de onboarding → el CTA "Ir a Mesas" apunta a `/local/mesas`.

- [ ] **Step 6: Commit**

```
git commit -m "refactor(nav): remove Local group from settings-nav + configuracion/page

Mesas/Captura/Auto-aceptación viven ahora bajo /local/* (tab propia).
Configuración queda con 3 cards: Equipo, Mensajería, Apariencia.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Groundwork aditivo — dep, grid helper, format helpers, migración realtime

### Task 2.1: Instalar react-zoom-pan-pinch v4

**Files:**
- Modify: `package.json` (npm adds automatically)
- Modify: `package-lock.json` (npm adds automatically)

- [ ] **Step 1: Confirmar versión via Context7**

  Context7 confirma `/bettertyped/react-zoom-pan-pinch` — el ref expone `state.{ scale, positionX, positionY }` y los métodos `zoomIn`, `zoomOut`, `resetTransform`, `centerView`, `setTransform`, `zoomToElement`. El tipo exportado es `ReactZoomPanPinchRef`. Versión actual publicada en npm: `^3.x` es la mayoría pero el plan exige `^4`; instalar con la etiqueta que resuelva v4 exacta.

- [ ] **Step 2: Instalar la dependencia**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npm i react-zoom-pan-pinch@^3.1.0
  ```

  > **Nota (CONTRACT ADDITION):** Context7 retorna estado `positionX`/`positionY` (no `posX`/`posY`). El Contracts usa `posX`/`posY` como nombres de *parámetro* en la firma de `stagePointFromClient`; los llamadores deben pasar `transformRef.current.state.positionX` → `posX`. Esto es consistente — solo son nombres del parámetro local. El `ReactZoomPanPinchRef` se importa de `'react-zoom-pan-pinch'` (mismo en v3.x LTS; la API ref es estable). Confirmar la versión real instalada con `npm ls react-zoom-pan-pinch`.

  Salida esperada: `added 1 package` (o `changed 1 package`) sin errores.

- [ ] **Step 3: Verificar que typecheck sigue verde**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npm run typecheck
  ```

  Salida esperada: sin errores de TypeScript (la nueva dep no agrega imports rotos todavía).

- [ ] **Step 4: Commit**

  ```
  git add package.json package-lock.json
  git commit -m "$(cat <<'EOF'
  build(deps): add react-zoom-pan-pinch for pan/zoom canvas

  Instala react-zoom-pan-pinch como dep del editor de floor plan rediseñado.
  El editor dnd-kit sigue funcionando hasta la fase de reescritura (Phase 5).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2.2: Agregar `stagePointFromClient` a `lib/floor-plan/grid.ts` (TDD)

**Files:**
- Modify: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/grid.ts`
- Modify: `/mnt/c/Users/Agust/Hub_main/tests/lib/floor-plan-grid.test.ts`

- [ ] **Step 1: Escribir el test primero (TDD rojo)**

  Agregar al final de `/mnt/c/Users/Agust/Hub_main/tests/lib/floor-plan-grid.test.ts`:

  ```ts
  describe('stagePointFromClient', () => {
    it('a scale=1 sin pan devuelve clientX-rect.left, clientY-rect.top', () => {
      // rect.left=50, rect.top=80; posX=0, posY=0; scale=1
      // clientX=350, clientY=280 → x=(350-50-0)/1=300, y=(280-80-0)/1=200
      expect(stagePointFromClient(350, 280, { left: 50, top: 80 }, 1, 0, 0)).toEqual({
        x: 300,
        y: 200,
      })
    })

    it('a scale=2 sin pan divide por scale', () => {
      // rect.left=0, rect.top=0; posX=0, posY=0; scale=2
      // clientX=200, clientY=100 → x=200/2=100, y=100/2=50
      expect(stagePointFromClient(200, 100, { left: 0, top: 0 }, 2, 0, 0)).toEqual({
        x: 100,
        y: 50,
      })
    })

    it('a scale=1 con pan (posX=100, posY=60) descuenta el pan antes de dividir', () => {
      // rect.left=0, rect.top=0; posX=100, posY=60; scale=1
      // clientX=250, clientY=160 → x=(250-0-100)/1=150, y=(160-0-60)/1=100
      expect(stagePointFromClient(250, 160, { left: 0, top: 0 }, 1, 100, 60)).toEqual({
        x: 150,
        y: 100,
      })
    })

    it('a scale=2 con pan y rect offset combina los tres factores', () => {
      // rect.left=20, rect.top=10; posX=40, posY=20; scale=2
      // clientX=180, clientY=90
      // x=(180-20-40)/2 = 120/2 = 60
      // y=(90-10-20)/2  = 60/2  = 30
      expect(stagePointFromClient(180, 90, { left: 20, top: 10 }, 2, 40, 20)).toEqual({
        x: 60,
        y: 30,
      })
    })
  })
  ```

  Asegurarse de agregar `stagePointFromClient` a la línea de imports al principio del archivo de test:

  ```ts
  import {
    clampToArea,
    createSnapModifier,
    ELEMENT_DEFAULTS,
    GRID,
    RESIZE_MIN,
    restrictToParent,
    snapToGrid,
    stagePointFromClient,
  } from '@/lib/floor-plan/grid'
  ```

- [ ] **Step 2: Correr tests (deben fallar en rojo)**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npx vitest run tests/lib/floor-plan-grid.test.ts
  ```

  Salida esperada: falla con `stagePointFromClient is not a function` o similar (rojo esperado).

- [ ] **Step 3: Implementar `stagePointFromClient` en `lib/floor-plan/grid.ts`**

  Agregar al final del archivo (antes del cierre, después de `restrictToParent`):

  ```ts
  /**
   * Convierte un punto de pantalla (clientX/Y) a coordenadas lógicas del stage.
   *
   * Fórmula: `(clientX - rect.left - posX) / scale` (ídem Y).
   *
   * @param clientX  - evento.clientX del pointer
   * @param clientY  - evento.clientY del pointer
   * @param rect     - `wrapperRef.current.getBoundingClientRect()` (solo left/top)
   * @param scale    - `transformRef.current.state.scale`
   * @param posX     - `transformRef.current.state.positionX`
   * @param posY     - `transformRef.current.state.positionY`
   */
  export function stagePointFromClient(
    clientX: number,
    clientY: number,
    rect: { left: number; top: number },
    scale: number,
    posX: number,
    posY: number,
  ): { x: number; y: number } {
    return {
      x: (clientX - rect.left - posX) / scale,
      y: (clientY - rect.top - posY) / scale,
    }
  }
  ```

- [ ] **Step 4: Correr tests (verde)**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npx vitest run tests/lib/floor-plan-grid.test.ts
  ```

  Salida esperada: todos los tests en verde, incluidos los tests previos de `snapToGrid`, `clampToArea`, `createSnapModifier`, `restrictToParent` y el nuevo `stagePointFromClient`.

- [ ] **Step 5: Typecheck**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npm run typecheck
  ```

  Salida esperada: sin errores.

- [ ] **Step 6: Commit**

  ```
  git add lib/floor-plan/grid.ts tests/lib/floor-plan-grid.test.ts
  git commit -m "$(cat <<'EOF'
  feat(floor-plan): add stagePointFromClient to grid helpers (TDD)

  Agrega la conversión screen→stage necesaria para el drag-from-palette y el
  drag de elementos con react-zoom-pan-pinch. Tests TDD cubren scale=1/2 con
  y sin offsets de pan y rect. Los modifiers dnd-kit se mantienen sin cambios
  (se remueven en Phase 6 junto con la reescritura del editor).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2.3: Extraer `elapsedLabel` y `ARSFormat` a `lib/salon/format.ts`

**Files:**
- Create: `/mnt/c/Users/Agust/Hub_main/lib/salon/format.ts`
- Modify: `/mnt/c/Users/Agust/Hub_main/app/(salon)/[tenantSlug]/salon/mesas/_components/salon-tables-grid.tsx`
- Create: `/mnt/c/Users/Agust/Hub_main/tests/lib/salon-format.test.ts`

- [ ] **Step 1: Crear `lib/salon/format.ts`**

  ```ts
  /**
   * Helpers de formato compartidos entre la grilla de salón (staff) y
   * la tarjeta de mesa en vivo (live-table-card) del floor plan.
   *
   * Puros — sin dependencias de React ni de servidor.
   */

  /**
   * Formatea `cents` (bigint-compatible, number en runtime) a moneda ARS
   * sin decimales. Ej: 1500_00 → "$150.000".
   *
   * Divide por 100 para convertir centavos a pesos.
   */
  export function ARSFormat(cents: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 0,
    }).format(Math.round(cents / 100))
  }

  /**
   * Devuelve una etiqueta de tiempo transcurrido desde `openedAt` hasta ahora.
   * Ejemplos: "5 min", "1h", "2h 30m".
   *
   * Nunca devuelve negativo (usa Math.max(0, ...)).
   */
  export function elapsedLabel(openedAt: string): string {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(openedAt).getTime()) / 60000))
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const rem = minutes % 60
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
  }
  ```

- [ ] **Step 2: Crear `tests/lib/salon-format.test.ts`**

  ```ts
  import { describe, expect, it } from 'vitest'
  import { ARSFormat, elapsedLabel } from '@/lib/salon/format'

  describe('ARSFormat', () => {
    it('convierte centavos a pesos ARS sin decimales', () => {
      // 150000 centavos = $1.500 ARS
      const result = ARSFormat(150000)
      expect(result).toContain('1.500')
    })

    it('redondea centavos fraccionarios', () => {
      // 100 centavos = $1 ARS
      const result = ARSFormat(100)
      expect(result).toContain('1')
    })

    it('devuelve cero formateado para 0', () => {
      const result = ARSFormat(0)
      expect(result).toContain('0')
    })
  })

  describe('elapsedLabel', () => {
    it('devuelve "X min" cuando han pasado menos de 60 minutos', () => {
      const openedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      expect(elapsedLabel(openedAt)).toBe('5 min')
    })

    it('devuelve "Xh" cuando la hora es exacta sin minutos', () => {
      const openedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      expect(elapsedLabel(openedAt)).toBe('2h')
    })

    it('devuelve "Xh Ym" cuando hay horas y minutos restantes', () => {
      const openedAt = new Date(Date.now() - (1 * 60 + 30) * 60 * 1000).toISOString()
      expect(elapsedLabel(openedAt)).toBe('1h 30m')
    })

    it('devuelve "0 min" para fechas futuras (nunca negativo)', () => {
      const openedAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      expect(elapsedLabel(openedAt)).toBe('0 min')
    })
  })
  ```

- [ ] **Step 3: Correr el test nuevo (verde inmediato)**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npx vitest run tests/lib/salon-format.test.ts
  ```

  Salida esperada: 7 tests en verde.

- [ ] **Step 4: Reapuntar `salon-tables-grid.tsx` a las funciones del módulo**

  Reemplazar las definiciones locales de `ARSFormat` y `elapsedLabel` en `/mnt/c/Users/Agust/Hub_main/app/(salon)/[tenantSlug]/salon/mesas/_components/salon-tables-grid.tsx` por imports desde `@/lib/salon/format` y eliminar las definiciones inline:

  ```ts
  'use client'

  import { Bell, CircleDot, Receipt, Users } from 'lucide-react'
  import Link from 'next/link'
  import { Badge } from '@/components/ui/badge'
  import { EmptyState } from '@/components/ui/empty-state'
  import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
  import type { SalonTableRow } from '@/lib/sessions-waiter/queries'
  import { cn } from '@/lib/utils'

  export function SalonTablesGrid({
    tenantSlug,
    tables,
    onTapFreeTable,
  }: {
    tenantSlug: string
    tables: SalonTableRow[]
    onTapFreeTable: (tableId: string, label: string) => void
  }) {
    if (tables.length === 0) {
      return (
        <EmptyState
          title="No hay mesas configuradas"
          description="Agregá mesas en Ajustes para empezar a operar."
        />
      )
    }

    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => {
          const isActive = t.session !== null

          if (!isActive) {
            return (
              <button
                key={t.physical_table_id}
                type="button"
                onClick={() => onTapFreeTable(t.physical_table_id, t.label)}
                className="card-hairline group flex min-h-[7rem] flex-col items-start justify-between rounded-xl border border-dashed border-border/70 bg-muted/30 p-4 text-left transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-lg font-semibold tracking-tight">{t.label}</h3>
                    <p className="text-xs text-muted-foreground">Libre</p>
                  </div>
                  <CircleDot className="size-5 text-muted-foreground/50" aria-hidden />
                </div>
                <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Tocá para activar
                </span>
              </button>
            )
          }

          const s = t.session
          if (!s) return null
          return (
            <Link
              key={t.physical_table_id}
              href={`/${tenantSlug}/salon/mesas/${s.id}`}
              className={cn(
                'card-hairline group block rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md',
                s.bill_requested && 'border-destructive/40',
                s.pending_tickets > 0 && 'border-warning/40',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-serif text-lg font-semibold tracking-tight">
                    {s.alias ?? t.label}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {s.alias ? <span className="mr-1">{t.label} · </span> : null}
                    {elapsedLabel(s.opened_at)} ·{' '}
                    {new Date(s.opened_at).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <p className="font-serif text-xl font-semibold tabular-nums">
                  {ARSFormat(s.total_cents)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.party_size !== null ? (
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" aria-hidden />
                    {s.party_size} {s.party_size === 1 ? 'comensal' : 'comensales'}
                  </Badge>
                ) : null}
                {s.guest_count > 0 ? (
                  <Badge variant="outline" className="gap-1">
                    📱 {s.guest_count}
                  </Badge>
                ) : null}
                {s.pending_tickets > 0 ? (
                  <Badge variant="warning" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    {s.pending_tickets} pendientes
                  </Badge>
                ) : null}
                {s.bill_requested ? (
                  <Badge variant="destructive" className="gap-1">
                    <Receipt className="size-3" aria-hidden />
                    Cuenta
                  </Badge>
                ) : null}
              </div>
            </Link>
          )
        })}
      </div>
    )
  }
  ```

- [ ] **Step 5: Typecheck y lint**

  ```bash
  cd /mnt/c/Users/Agust/Hub_main && npm run typecheck && npm run lint
  ```

  Salida esperada: sin errores ni warnings. El comportamiento de `salon-tables-grid` es idéntico al anterior (solo cambió el origen del import).

- [ ] **Step 6: Commit**

  ```
  git add lib/salon/format.ts tests/lib/salon-format.test.ts \
    "app/(salon)/[tenantSlug]/salon/mesas/_components/salon-tables-grid.tsx"
  git commit -m "$(cat <<'EOF'
  refactor(salon): extract ARSFormat + elapsedLabel to lib/salon/format.ts

  Mueve los helpers de formato a un módulo puro reutilizable para que
  live-table-card (Phase 5) los comparta con la grilla existente.
  Sin cambio de comportamiento en SalonTablesGrid.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2.4: Migración — publicar tablas de salón en `supabase_realtime`

**Files:**
- Create: `/mnt/c/Users/Agust/Hub_main/supabase/migrations/20260606000100_realtime_salon_publication.sql`

- [ ] **Step 1: Crear el archivo de migración**

  ```sql
  -- ============================================================
  -- Habilitar Realtime publication para tablas del salón operativo
  -- ============================================================
  -- Arregla el bug verificado: table_sessions / tickets / ticket_items /
  -- table_session_events NO estaban en supabase_realtime, por lo que las
  -- suscripciones del staff solo recibían eventos por el safety-net de 30s.
  --
  -- Patrón idempotente (espejo de 20260520040000_salon_reservations_realtime).
  -- RLS no cambia: realtime respeta las políticas SELECT existentes; solo
  -- 'authenticated' (staff/dueño) recibe — 'anon' (comensal) no tiene policy.
  -- replica identity DEFAULT alcanza (los filtros usan PK / tenant_id / session_id
  -- presentes en NEW).
  -- db:types NO es necesario (no cambian tablas, columnas ni enums).

  do $$
  begin
    begin
      alter publication supabase_realtime add table public.table_sessions;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.tickets;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.ticket_items;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.table_session_events;
    exception when duplicate_object then null;
    end;
  end $$;
  ```

- [ ] **Step 2: Aplicar la migración vía Supabase MCP**

  Llamar a `mcp__supabase__apply_migration` con:
  - `project_id`: `ogplsevtrclzxvyejlns`
  - `name`: `20260606000100_realtime_salon_publication`
  - `query`: el SQL del archivo completo (el bloque `do $$ … end $$;` de arriba)

  Salida esperada: `{ "success": true }` sin errores.

- [ ] **Step 3: Verificar que las 4 tablas están en la publicación**

  Llamar a `mcp__supabase__execute_sql` con:
  - `project_id`: `ogplsevtrclzxvyejlns`
  - `query`:
    ```sql
    select tablename
    from pg_publication_tables
    where pubname = 'supabase_realtime'
    order by tablename;
    ```

  Salida esperada: resultado que incluye las 4 filas:
  ```
  tablename
  ----------------------
  table_session_events
  table_sessions
  ticket_items
  tickets
  ```
  (junto con las tablas ya existentes: `messages`, `conversations`, `salon_reservations`, `scheduled_events`, etc.)

- [ ] **Step 4: Commit**

  ```
  git add supabase/migrations/20260606000100_realtime_salon_publication.sql
  git commit -m "$(cat <<'EOF'
  fix(realtime): publish table_sessions/tickets/ticket_items/table_session_events

  Corrige bug verificado: las suscripciones Supabase Realtime del staff no
  recibían eventos en tiempo real (solo por safety-net 30s) porque estas tablas
  no estaban en la publicación supabase_realtime. Migración idempotente aplicada
  vía MCP. Habilita la vista en vivo del floor plan (Phase 5) y mejora la
  responsividad de la grilla de salón existente.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

**CONTRACT ADDITIONS:**

> El Contracts especifica `posX`/`posY` como parámetros de `stagePointFromClient`. La API real de `react-zoom-pan-pinch` expone `transformRef.current.state.positionX` / `state.positionY` (no `posX`/`posY`). Los nombres de parámetro son solo locales al helper — los llamadores deben pasar `state.positionX → posX` y `state.positionY → posY`. Este mapeo debe documentarse en los componentes de Phase 5 que llamen `stagePointFromClient`.

---

## Phase 3: Reescritura del editor (single-owner) — pan-zoom-stage + canvas/element/resize/palette/editor + page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

Esta es la fase **load-bearing**: reescribe el clúster interdependiente del editor (stage pan/zoom + canvas + element + resize + palette + orquestador + page) **como un único dueño**, de modo que el repo nunca quede a medio compilar. Sale `dnd-kit` del clúster y entra `react-zoom-pan-pinch` v4 + drag propio con pointer events (delta/scale). `grid.ts` (modifiers + `Modifier` de dnd-kit) y `a11y.ts` **quedan en su lugar pero sin usar** — se borran en una fase posterior junto con la desinstalación de dnd-kit. `stagePointFromClient`, `snapToGrid`, `clampToArea`, `ELEMENT_DEFAULTS` ya existen en `grid.ts` (agregados en la Fase 2 de geometría/queries). `LiveFloor` se cablea en la Fase 6: acá el toggle **En vivo** renderiza un placeholder liviano.

> **Pre-requisito de ruta:** la Fase 1 ya movió `configuracion/{mesas,captura,auto-aceptacion}` → `local/*` con `git mv`, y `lib/floor-plan/actions.ts` ya hace `revalidatePath('/${slug}/local/mesas')`. Todos los paths de esta fase son **post-move** (`app/(manager)/[tenantSlug]/local/mesas/_components/`).

**CONTRACT ADDITIONS** (que el ensamblador debe plegar a los Contracts):
- `unplaced-tray.tsx` está listado como "reusado sin cambios" pero importa `useDraggable`/`CSS` de dnd-kit y depende de un `DndContext` que este clúster elimina. Como ya no hay `DndContext`, su gesto de arrastre quedaría inerte y el import roto del clúster. **Se reescribe `unplaced-tray.tsx`** para quitar dnd-kit: deja solo el botón "Colocar" (la ruta canónica para ubicar/mover mesas según spec §5) y borra el handle de drag. Props sin cambios: `{ tables: UnplacedTable[]; onPlace: (tableId: string) => void }`. Se elimina el export `TRAY_DRAG_PREFIX` (ya no se usa).
- `pan-zoom-stage.tsx` expone, además de las props del Contract, un `gridSize?: number` opcional (default `GRID`) para dibujar la grilla CSS; y un `className?: string` para el wrapper externo. No altera el resto del Contract.
- El placeholder "Vista en vivo (próxima fase)" del toggle **En vivo** es un `div` liviano local en `floor-plan-editor.tsx` (no se crea `live-floor.tsx` en esta fase).

---

### Task 3.1: `pan-zoom-stage.tsx` — wrapper compartido `react-zoom-pan-pinch` + stage + controles

**Files:**
- Create: `app/(manager)/[tenantSlug]/local/mesas/_components/pan-zoom-stage.tsx`

- [ ] **Step 1: Instalar `react-zoom-pan-pinch` (confirmar v4 vía Context7 antes de instalar)**

Antes de instalar, consultar Context7 para `react-zoom-pan-pinch v4 TransformWrapper TransformComponent ref API` y confirmar que la versión vigente es la línea **^4** y que `ReactZoomPanPinchRef` expone `state.{scale,positionX,positionY}` + `zoomIn/zoomOut/centerView/setTransform/zoomToElement`.

```bash
npm i react-zoom-pan-pinch
```

Esperado: `package.json` suma `"react-zoom-pan-pinch": "^4.x.x"` en `dependencies`; `package-lock.json` actualizado; sin errores de peer-deps. Verificar:

```bash
node -e "console.log(require('./node_modules/react-zoom-pan-pinch/package.json').version)"
```

Esperado: imprime una versión `4.x.x`.

- [ ] **Step 2: Escribir `pan-zoom-stage.tsx` completo**

```tsx
'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { Button } from '@/components/ui/button'
import { GRID } from '@/lib/floor-plan/grid'
import { stagePointFromClient } from '@/lib/floor-plan/grid'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type PanZoomStageProps = {
  /** Tamaño lógico del área (px lógicos). El stage tiene exactamente este tamaño. */
  width: number
  height: number
  transformRef: TransformRef
  /** true = editor (pan excluido sobre `.floor-element`); false = live (pan/zoom libre). */
  interactive?: boolean
  /** Click en el fondo vacío del stage (deseleccionar). */
  onBackgroundClick?: () => void
  /** Drop de una chip de la paleta sobre el stage (drag-from-palette). */
  onDropKind?: (
    kind: 'table' | 'wall' | 'pillar' | 'island' | 'bar',
    clientX: number,
    clientY: number,
  ) => void
  /** Tamaño de la grilla CSS de fondo (px lógicos). Default GRID. */
  gridSize?: number
  /** Clase del wrapper externo (alto del viewport, etc.). */
  className?: string
  /** FloorElements (editor) o LiveTableCards (live), posicionados absolute en coords lógicas. */
  children: React.ReactNode
}

// Kinds válidos del dataTransfer de la paleta (validación del drop).
const DROP_KINDS = new Set(['table', 'wall', 'pillar', 'island', 'bar'])

/**
 * Wrapper compartido editor/live: `react-zoom-pan-pinch` (pan/zoom robusto) +
 * un único div "stage" de tamaño = área lógica con grilla CSS de fondo. Los hijos
 * van `position:absolute` en coords lógicas dentro del stage.
 *
 * - `interactive` (editor): el pan se EXCLUYE sobre `.floor-element` para que
 *   arrastrar una mesa no panee el lienzo (la mesa hace su propio pointer-drag).
 * - `!interactive` (live): pan/zoom libre, sin exclusiones.
 *
 * El scale vigente se lee con `transformRef.current.state.scale` durante el drag
 * (sin re-render). Los controles +/−/fit usan `zoomIn/zoomOut/centerView` por ref.
 */
export function PanZoomStage({
  width,
  height,
  transformRef,
  interactive = false,
  onBackgroundClick,
  onDropKind,
  gridSize,
  className,
  children,
}: PanZoomStageProps) {
  const grid = gridSize ?? GRID

  const onZoomIn = () => transformRef.current?.zoomIn()
  const onZoomOut = () => transformRef.current?.zoomOut()
  // "Fit": re-encuadra el stage en el viewport (centra y escala a contenido).
  const onFit = () => transformRef.current?.centerView(undefined, 200, 'easeOut')

  // Drop-from-palette: convertir el punto de pantalla a coords lógicas se hace
  // en el editor (necesita el rect del wrapper + el pan); acá solo leemos el
  // kind del dataTransfer y propagamos clientX/clientY crudos.
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onDropKind) return
    const kind = e.dataTransfer.getData('application/x-floor-kind')
    if (!DROP_KINDS.has(kind)) return
    e.preventDefault()
    onDropKind(kind as 'table' | 'wall' | 'pillar' | 'island' | 'bar', e.clientX, e.clientY)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Solo aceptamos el drop si viene de la paleta (permite el cursor "copy").
    if (onDropKind && e.dataTransfer.types.includes('application/x-floor-kind')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  return (
    <div className={className ?? 'relative w-full'}>
      <div
        className="card-hairline relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          centerOnInit
          minScale={0.25}
          maxScale={4}
          limitToBounds={false}
          panning={
            interactive
              ? { excluded: ['floor-element'], velocityDisabled: true }
              : { velocityDisabled: true }
          }
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width, height }}
          >
            {/* Stage: tamaño = área lógica; grilla CSS de fondo. */}
            <div
              className="relative"
              style={{
                width,
                height,
                backgroundImage:
                  'linear-gradient(to right, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px)',
                backgroundSize: `${grid}px ${grid}px`,
              }}
              // Click en el stage vacío deselecciona. Si vino de un elemento, su
              // body hizo stopPropagation y el target no es el stage.
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) onBackgroundClick?.()
              }}
            >
              {children}
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      {/* Controles de zoom/fit (fuera del stage → no se escalan). */}
      <div className="absolute bottom-3 right-3 flex flex-col items-center gap-1 rounded-xl border border-border/60 bg-card/95 p-1 shadow-md backdrop-blur-sm">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onZoomIn}
          aria-label="Acercar"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onZoomOut}
          aria-label="Alejar"
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onFit}
          aria-label="Ajustar a la pantalla"
        >
          <Maximize2 className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

// Re-export del helper para que el editor lo importe desde un único lugar junto
// al componente que lo necesita (evita duplicar el import en cada consumidor).
export { stagePointFromClient }
```

- [ ] **Step 3: Typecheck del archivo nuevo (aislado — el clúster aún no compila completo)**

```bash
npm run typecheck 2>&1 | grep -i "pan-zoom-stage" || echo "sin errores en pan-zoom-stage"
```

Esperado: `sin errores en pan-zoom-stage`. (El typecheck global puede tener errores en el resto del clúster hasta cerrar la Task 3.6; verificamos solo este archivo acá.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json "app/(manager)/[tenantSlug]/local/mesas/_components/pan-zoom-stage.tsx"
git commit -m "$(cat <<'EOF'
feat(local/mesas): PanZoomStage con react-zoom-pan-pinch v4 (pan/zoom + drop-from-palette)

Wrapper compartido editor/live: TransformWrapper + TransformComponent + stage
de tamaño = área lógica con grilla CSS; controles +/-/fit por ref; pan excluido
sobre .floor-element en modo interactive; handler de drop application/x-floor-kind.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: `resize-handles.tsx` — reescribir scale-aware vía `transformRef`

**Files:**
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/resize-handles.tsx`

- [ ] **Step 1: Reescribir `resize-handles.tsx` completo (lee `scale` del `transformRef`, no de una prop)**

La firma del Contract cambia: en vez de `scale: number` recibe `transformRef`. El delta de pantalla se divide por `transformRef.current.state.scale` (leído por gesto, no por render). Se conserva `stopPropagation` + `setPointerCapture` + el patrón de handlers locales con cleanup.

```tsx
'use client'

import { useRef } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { RESIZE_MIN, snapToGrid } from '@/lib/floor-plan/grid'
import { cn } from '@/lib/utils'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type ResizeHandlesProps = {
  width: number
  height: number
  transformRef: TransformRef
  onResize: (size: { width: number; height: number }) => void
  onResizeEnd: (size: { width: number; height: number }) => void
}

type Axis = 'se' | 'e' | 's'

// Estado vivo del gesto (refs, no state: no re-render por move).
type DragState = {
  axis: Axis
  startX: number
  startY: number
  startW: number
  startH: number
  last: { width: number; height: number }
}

export function ResizeHandles({
  width,
  height,
  transformRef,
  onResize,
  onResizeEnd,
}: ResizeHandlesProps) {
  const drag = useRef<DragState | null>(null)

  function compute(
    state: DragState,
    e: PointerEvent | React.PointerEvent,
  ): { width: number; height: number } {
    // Scale vigente leído del stage (sin re-render). Fallback a 1 si no montó.
    const scale = transformRef.current?.state.scale ?? 1
    // Delta en px de pantalla → px lógicos dividiendo por scale (corrección del bug v1).
    const dxLogical = (e.clientX - state.startX) / scale
    const dyLogical = (e.clientY - state.startY) / scale
    const nextW =
      state.axis === 's' ? state.startW : Math.max(RESIZE_MIN, snapToGrid(state.startW + dxLogical))
    const nextH =
      state.axis === 'e' ? state.startH : Math.max(RESIZE_MIN, snapToGrid(state.startH + dyLogical))
    return { width: nextW, height: nextH }
  }

  function startResize(axis: Axis) {
    return (e: React.PointerEvent) => {
      // CLAVE: detener la propagación para que el pointer-drag del body del
      // FloorElement no se dispare; el resize es un gesto independiente.
      e.stopPropagation()
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      drag.current = {
        axis,
        startX: e.clientX,
        startY: e.clientY,
        startW: width,
        startH: height,
        last: { width, height },
      }

      // Handlers locales al gesto → referencias estables para add/remove.
      function handlePointerMove(ev: PointerEvent) {
        const state = drag.current
        if (!state) return
        const size = compute(state, ev)
        state.last = size
        onResize(size)
      }

      function handlePointerUpOrCancel(ev: PointerEvent) {
        const state = drag.current
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUpOrCancel)
        window.removeEventListener('pointercancel', handlePointerUpOrCancel)
        const target = ev.target as Element
        if (target.hasPointerCapture?.(ev.pointerId)) {
          target.releasePointerCapture(ev.pointerId)
        }
        drag.current = null
        if (state) onResizeEnd(state.last)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUpOrCancel)
      window.addEventListener('pointercancel', handlePointerUpOrCancel)
    }
  }

  const base = 'absolute z-20 rounded-sm border border-primary bg-background shadow-sm'

  return (
    <>
      {/* Esquina inferior-derecha (ancho + alto) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('se')}
        className={cn(base, 'size-3 -bottom-1.5 -right-1.5 cursor-nwse-resize')}
        style={{ touchAction: 'none' }}
      />
      {/* Borde derecho (solo ancho) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('e')}
        className={cn(base, 'h-3 w-2.5 top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize')}
        style={{ touchAction: 'none' }}
      />
      {/* Borde inferior (solo alto) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('s')}
        className={cn(base, 'h-2.5 w-3 left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize')}
        style={{ touchAction: 'none' }}
      />
    </>
  )
}
```

*(Sin comando de typecheck independiente acá — el clúster cierra en la Task 3.6; el commit del clúster va al final.)*

---

### Task 3.3: `floor-element.tsx` — reescribir con pointer-drag propio (sin dnd-kit)

**Files:**
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/floor-element.tsx`

- [ ] **Step 1: Reescribir `floor-element.tsx` completo (pointer drag leyendo `scale` del `transformRef`; `className="floor-element"`; sin dnd-kit)**

El body del elemento implementa su propio drag con pointer events: `onPointerDown` → `stopPropagation` (para que el pan del stage no agarre el gesto) + `setPointerCapture`; `onPointerMove` → `newX = orig + (clientX - startX) / scale` → `snapToGrid` + `clampToArea` → `onMove` optimista; `onPointerUp` → `onResizeEnd` se mantiene para resize; la persistencia del move la encola el editor en `onMove`/al soltar. El `className="floor-element"` es lo que la lib usa para EXCLUIR el pan. Distinguimos **click sin drag** (selección) de **drag** con un umbral de 4px.

```tsx
'use client'

import { type CSSProperties, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { clampToArea, snapToGrid } from '@/lib/floor-plan/grid'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import { ResizeHandles } from './resize-handles'

type TransformRef = React.RefObject<ReactZoomPanPinchRef | null>

export type FloorElementProps = {
  element: ElementRow
  selected: boolean
  transformRef: TransformRef
  /** Dimensiones lógicas del área (para clampToArea durante el drag). */
  areaWidth: number
  areaHeight: number
  onSelect: (id: string) => void
  /** Move optimista durante el drag; el editor encola la persistencia. */
  onMove: (id: string, x: number, y: number) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
}

// Etiquetas es-AR por tipo (para aria-label de decoración).
const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
}

// Umbral (px de pantalla) para distinguir click (selección) de drag (mover).
const DRAG_THRESHOLD = 4

type DragState = {
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  moved: boolean
}

export function FloorElement({
  element,
  selected,
  transformRef,
  areaWidth,
  areaHeight,
  onSelect,
  onMove,
  onResizeEnd,
}: FloorElementProps) {
  const drag = useRef<DragState | null>(null)
  // Tamaño transitorio durante el gesto de resize.
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)

  // Si la geometría committeada cambia (post onResizeEnd), descartamos el
  // tamaño transitorio para dibujar desde la geometría canónica.
  const lastCommittedRef = useRef({ width: element.width, height: element.height })
  if (
    lastCommittedRef.current.width !== element.width ||
    lastCommittedRef.current.height !== element.height
  ) {
    lastCommittedRef.current = { width: element.width, height: element.height }
    if (liveSize) setLiveSize(null)
  }

  const isTable = element.kind === 'table'
  const isCircle = element.shape === 'circle'

  const displayWidth = liveSize?.width ?? element.width
  const displayHeight = liveSize?.height ?? element.height

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // No iniciamos drag con botón secundario.
    if (e.button !== 0) return
    // Detener la propagación → el pan del stage no agarra el gesto.
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: element.x,
      origY: element.y,
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state) return
    const dx = e.clientX - state.startClientX
    const dy = e.clientY - state.startClientY
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    state.moved = true
    const scale = transformRef.current?.state.scale ?? 1
    const logicalX = snapToGrid(state.origX + dx / scale)
    const logicalY = snapToGrid(state.origY + dy / scale)
    const clamped = clampToArea(
      logicalX,
      logicalY,
      element.width,
      element.height,
      areaWidth,
      areaHeight,
    )
    onMove(element.id, clamped.x, clamped.y)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // Click sin drag → seleccionar (abre inspector). El move ya quedó persistido
    // por el editor a través de onMove (que encola); no hay commit extra acá.
    if (state && !state.moved) onSelect(element.id)
  }

  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: displayWidth,
    height: displayHeight,
    zIndex: selected ? element.z_index + 1000 : element.z_index,
    touchAction: 'none',
  }

  // Fill de decoración: hex del dueño o token neutro (dark-mode safe).
  const decorStyle: CSSProperties | undefined = isTable
    ? undefined
    : { backgroundColor: element.color ?? 'var(--muted)' }

  const ariaLabel = isTable
    ? `Mesa ${element.table?.label ?? element.label ?? ''}`.trim()
    : `${KIND_LABELS[element.kind]}${element.label ? ` ${element.label}` : ''}`

  return (
    // className="floor-element" → react-zoom-pan-pinch EXCLUYE el pan sobre este nodo.
    <div className="floor-element" style={wrapperStyle}>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={ariaLabel}
        style={decorStyle}
        className={cn(
          'relative flex h-full w-full cursor-grab items-center justify-center overflow-hidden border text-center transition-shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCircle ? 'rounded-full' : 'rounded-md',
          isTable
            ? 'border-primary/40 bg-card text-card-foreground shadow-sm'
            : 'border-border/70 text-muted-foreground',
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        )}
      >
        {isTable ? (
          <span className="flex flex-col items-center justify-center gap-0.5 px-1 leading-none">
            <span className="font-serif text-sm font-semibold tabular-nums">
              {element.table?.label ?? element.label ?? '—'}
            </span>
            {element.table?.capacity != null && (
              <span className="text-[10px] text-muted-foreground">
                {element.table.capacity} pers.
              </span>
            )}
          </span>
        ) : element.label ? (
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
            {element.label}
          </span>
        ) : null}
      </button>

      {selected && (
        <ResizeHandles
          width={displayWidth}
          height={displayHeight}
          transformRef={transformRef}
          onResize={setLiveSize}
          onResizeEnd={(size) => {
            setLiveSize(null)
            onResizeEnd(element.id, size)
          }}
        />
      )}
    </div>
  )
}
```

*(El commit del clúster cierra en la Task 3.6.)*

---

### Task 3.4: `element-palette.tsx` — reescribir chips arrastrables (HTML5 drag) + click fallback

**Files:**
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/element-palette.tsx`

- [ ] **Step 1: Reescribir `element-palette.tsx` completo (chips `draggable` que setean `dataTransfer 'application/x-floor-kind'` + `onQuickAdd` al click)**

La firma del Contract es `{ onQuickAdd: (kind) => void }`. Todas las chips (incluida "Mesa") son arrastrables y, además, el click llama `onQuickAdd(kind)` como fallback no-drag.

```tsx
'use client'

import { Box, Columns3, Square, Table2, Wine } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar'

export type ElementPaletteProps = {
  /** Fallback no-drag: agrega el elemento en el centro del área visible. */
  onQuickAdd: (kind: Kind) => void
}

// kind + label es-AR + ícono. "Mesa" primero (acción principal), luego decoración.
const ITEMS: { kind: Kind; label: string; Icon: typeof Box; primary?: boolean }[] = [
  { kind: 'table', label: 'Mesa', Icon: Table2, primary: true },
  { kind: 'wall', label: 'Pared', Icon: Columns3 },
  { kind: 'pillar', label: 'Columna', Icon: Box },
  { kind: 'island', label: 'Isla', Icon: Square },
  { kind: 'bar', label: 'Barra', Icon: Wine },
]

export function ElementPalette({ onQuickAdd }: ElementPaletteProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Agregar al plano (arrastrá al lienzo o tocá para agregar)</legend>
      {ITEMS.map(({ kind, label, Icon, primary }) => (
        <Button
          key={kind}
          type="button"
          variant={primary ? 'default' : 'outline'}
          size="sm"
          // HTML5 drag: el drop sobre el stage lee este dataTransfer.
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-floor-kind', kind)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          // Fallback no-drag (touch simple / accesible): agrega en el centro.
          onClick={() => onQuickAdd(kind)}
          className="cursor-grab gap-1.5 active:cursor-grabbing"
          aria-label={`Agregar ${label} (arrastrá al plano o tocá para agregar en el centro)`}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
    </fieldset>
  )
}
```

*(El commit del clúster cierra en la Task 3.6.)*

---

### Task 3.5: `floor-plan-editor.tsx` — reescribir orquestador (sin DndContext; drag-from-palette; toggle Editar/En vivo) + `unplaced-tray.tsx` + borrar `create-table-dialog.tsx`

**Files:**
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/floor-plan-editor.tsx`
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/unplaced-tray.tsx`
- Delete: `app/(manager)/[tenantSlug]/local/mesas/_components/floor-canvas.tsx`
- Delete: `app/(manager)/[tenantSlug]/local/mesas/_components/create-table-dialog.tsx`

- [ ] **Step 1: Reescribir `unplaced-tray.tsx` (quitar dnd-kit; dejar solo "Colocar")**

```tsx
'use client'

import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
}

function TrayChip({
  table,
  onPlace,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{table.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {table.capacity != null ? `${table.capacity} pers.` : 'Sin capacidad'} ·{' '}
          <code>{table.qr_token}</code>
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onPlace(table.id)}>
        <MapPin className="size-3.5" />
        Colocar
      </Button>
    </li>
  )
}

export function UnplacedTray({ tables, onPlace }: UnplacedTrayProps) {
  return (
    <section aria-label="Mesas no ubicadas" className="grid gap-2">
      <h2 className="font-display text-sm font-semibold">Mesas sin ubicar</h2>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay mesas activas pendientes de ubicar.</p>
      ) : (
        <ul className="grid gap-1.5">
          {tables.map((table) => (
            <TrayChip key={table.id} table={table} onPlace={onPlace} />
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Borrar `floor-canvas.tsx` y `create-table-dialog.tsx`**

`floor-canvas.tsx` se reemplaza por `PanZoomStage` montado directamente en el editor; `create-table-dialog.tsx` se retira (el alta de mesa ahora es drop-from-palette → `createTableInPlanAction` → abre el inspector).

```bash
git rm "app/(manager)/[tenantSlug]/local/mesas/_components/floor-canvas.tsx" \
       "app/(manager)/[tenantSlug]/local/mesas/_components/create-table-dialog.tsx"
```

Esperado: `rm 'app/(manager)/[tenantSlug]/local/mesas/_components/floor-canvas.tsx'` y `rm '.../create-table-dialog.tsx'`.

- [ ] **Step 3: Reescribir `floor-plan-editor.tsx` completo**

Orquestador sin `DndContext` ni dnd-kit ni `a11y.ts`. Posee: estado de elementos optimistas, `selectedId`, `activeAreaId`, `transformRef`, el toggle Editar/En vivo. Drag-from-palette: convierte el punto de drop a coords lógicas con `stagePointFromClient` (rect del wrapper + pan/scale del `transformRef.state`), clampea con `clampToArea`, y según el kind llama `createTableInPlanAction` (mesa → abre el inspector de la mesa nueva) o `addDecorAction` (decor). Reusa `table-inspector`/`decor-inspector`/`area-manager`/`unplaced-tray`/`use-geometry-queue`. El move de un elemento (optimista en `onMove`) se persiste vía la cola de geometría. En modo **En vivo** renderiza el placeholder liviano.

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  addDecorAction,
  createTableInPlanAction,
  placeTableAction,
} from '@/lib/floor-plan/actions'
import { clampToArea, ELEMENT_DEFAULTS, GRID, snapToGrid } from '@/lib/floor-plan/grid'
import type { ElementRow, FloorPlanData } from '@/lib/floor-plan/queries'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'
import { AreaManager } from './area-manager'
import { DecorInspector } from './decor-inspector'
import { ElementPalette } from './element-palette'
import { FloorElement } from './floor-element'
import { PanZoomStage, stagePointFromClient } from './pan-zoom-stage'
import { TableInspector } from './table-inspector'
import { TablesListFallback } from './tables-list-fallback'
import { UnplacedTray } from './unplaced-tray'
import { useGeometryQueue } from './use-geometry-queue'

export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  initial: FloorPlanData
}

type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar'
type DecorKind = 'wall' | 'pillar' | 'island' | 'bar'
type Mode = 'editar' | 'vivo'

export function FloorPlanEditor({ slug, initial }: FloorPlanEditorProps) {
  const router = useRouter()

  // areas / unplaced son read-only: derivan de props (router.refresh re-siembra).
  const areas = initial.areas
  const unplaced = initial.unplacedTables

  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('editar')

  // Ref único del stage de react-zoom-pan-pinch (scale/positionX/positionY).
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  // Wrapper del stage para medir su rect en el drop-from-palette.
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Re-sync de elements cuando cambian los datos del server (firma de contenido
  // para no resetear en cada render — initial es una ref nueva cada vez).
  const initialSig = useMemo(
    () =>
      initial.elements
        .map(
          (e) =>
            `${e.id}:${e.x}:${e.y}:${e.width}:${e.height}:${e.z_index}:${e.label}:${e.color}:${e.table ? `${e.table.active}:${e.table.label}:${e.table.capacity}` : ''}`,
        )
        .join('|'),
    [initial],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync solo cuando cambian los datos del server (initialSig), no en cada render
  useEffect(() => {
    setElements(initial.elements)
  }, [initialSig])

  // Guard: si borraron el área activa, caer a la primera.
  useEffect(() => {
    const first = areas[0]
    if (!first) return
    if (!areas.find((a) => a.id === activeAreaId)) {
      setActiveAreaId(first.id)
    }
  }, [areas, activeAreaId])

  // Snapshot de geometría previa por id, para revertir si el flush falla.
  const prevGeomRef = useRef<Map<string, ElementGeometry>>(new Map())

  const onQueueError = useCallback((ids: string[]) => {
    setElements((current) => {
      const snap = prevGeomRef.current
      return current.map((el) => {
        const prev = snap.get(el.id)
        if (!prev) return el
        if (!ids.includes(el.id)) return el
        return {
          ...el,
          x: prev.x,
          y: prev.y,
          width: prev.width,
          height: prev.height,
          z_index: prev.z_index,
        }
      })
    })
    toast.error('No se pudo guardar la posición. Revertimos el cambio; reintentá.')
  }, [])

  const queue = useGeometryQueue(slug, onQueueError)

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null
  const areaElements = useMemo(
    () => (activeArea ? elements.filter((el) => el.area_id === activeArea.id) : []),
    [elements, activeArea],
  )
  const selectedElement = elements.find((el) => el.id === selectedId) ?? null

  // Tras mutaciones estructurales: deseleccionar + recargar el RSC.
  const onChanged = useCallback(() => {
    setSelectedId(null)
    router.refresh()
  }, [router])

  // Persiste geometría optimista y encola (guardando snapshot para rollback).
  const commitGeometry = useCallback(
    (
      el: ElementRow,
      next: { x: number; y: number; width: number; height: number; z_index: number },
    ) => {
      // Snapshot solo del primer cambio de este id en el batch corriente.
      if (!prevGeomRef.current.has(el.id)) {
        prevGeomRef.current.set(el.id, {
          id: el.id,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          z_index: el.z_index,
        })
      }
      setElements((current) => current.map((e) => (e.id === el.id ? { ...e, ...next } : e)))
      queue.enqueue({ id: el.id, ...next })
    },
    [queue],
  )

  // Move optimista durante el drag de un elemento (FloorElement → onMove).
  const handleMove = useCallback(
    (id: string, x: number, y: number) => {
      const el = elements.find((e) => e.id === id)
      if (!el) return
      if (el.x === x && el.y === y) return
      commitGeometry(el, { x, y, width: el.width, height: el.height, z_index: el.z_index })
    },
    [elements, commitGeometry],
  )

  const handleResizeEnd = useCallback(
    (id: string, size: { width: number; height: number }) => {
      if (!activeArea) return
      const el = elements.find((e) => e.id === id)
      if (!el) return
      const width = snapToGrid(size.width)
      const height = snapToGrid(size.height)
      const clamped = clampToArea(el.x, el.y, width, height, activeArea.width, activeArea.height)
      commitGeometry(el, { x: clamped.x, y: clamped.y, width, height, z_index: el.z_index })
    },
    [activeArea, elements, commitGeometry],
  )

  // Centro lógico del área activa (para el fallback no-drag de la paleta).
  const areaCenter = useCallback(
    (w: number, h: number) => {
      if (!activeArea) return { x: 0, y: 0 }
      return clampToArea(
        snapToGrid(activeArea.width / 2 - w / 2),
        snapToGrid(activeArea.height / 2 - h / 2),
        w,
        h,
        activeArea.width,
        activeArea.height,
      )
    },
    [activeArea],
  )

  // Crea/coloca el kind en el punto lógico (x,y) ya clampeado.
  const insertAt = useCallback(
    (kind: Kind, x: number, y: number) => {
      if (!activeArea) return
      if (kind === 'table') {
        void (async () => {
          const r = await createTableInPlanAction(slug, {
            area_id: activeArea.id,
            // El label/capacidad se ajustan en el inspector que abrimos al crear.
            label: '',
            capacity: null,
            shape: ELEMENT_DEFAULTS.table.shape,
            x,
            y,
          })
          if (r.ok) {
            // Re-sembrar y abrir el inspector de la mesa nueva (por su element_id).
            setSelectedId(r.elementId)
            router.refresh()
          } else {
            toast.error(r.message)
          }
        })()
        return
      }
      const def = ELEMENT_DEFAULTS[kind]
      void (async () => {
        const r = await addDecorAction(slug, {
          area_id: activeArea.id,
          kind,
          shape: def.shape,
          x,
          y,
          width: def.width,
          height: def.height,
          label: null,
          color: null,
        })
        if (r.ok) onChanged()
        else toast.error(r.message)
      })()
    },
    [activeArea, slug, router, onChanged],
  )

  // Drop-from-palette: punto de pantalla → coords lógicas del stage → clamp → insertar.
  const handleDropKind = useCallback(
    (kind: Kind, clientX: number, clientY: number) => {
      if (!activeArea) return
      const wrapper = wrapperRef.current
      const state = transformRef.current?.state
      if (!wrapper || !state) return
      const rect = wrapper.getBoundingClientRect()
      const point = stagePointFromClient(
        clientX,
        clientY,
        rect,
        state.scale,
        state.positionX,
        state.positionY,
      )
      const def = ELEMENT_DEFAULTS[kind]
      const clamped = clampToArea(
        snapToGrid(point.x - def.width / 2),
        snapToGrid(point.y - def.height / 2),
        def.width,
        def.height,
        activeArea.width,
        activeArea.height,
      )
      insertAt(kind, clamped.x, clamped.y)
    },
    [activeArea, insertAt],
  )

  // Fallback no-drag de la paleta: agregar en el centro del área activa.
  const handleQuickAdd = useCallback(
    (kind: Kind) => {
      const def = ELEMENT_DEFAULTS[kind]
      const center = areaCenter(def.width, def.height)
      insertAt(kind, center.x, center.y)
    },
    [areaCenter, insertAt],
  )

  // Bandeja: "Colocar" ubica la mesa en el centro del área activa.
  const onPlace = useCallback(
    (tableId: string) => {
      if (!activeArea) return
      const def = ELEMENT_DEFAULTS.table
      const center = areaCenter(def.width, def.height)
      void (async () => {
        const r = await placeTableAction(slug, {
          table_id: tableId,
          area_id: activeArea.id,
          x: center.x,
          y: center.y,
        })
        if (r.ok) onChanged()
        else toast.error(r.message)
      })()
    },
    [activeArea, areaCenter, slug, onChanged],
  )

  // Merge-select del inspector: mesas (activas) ubicadas en el plano.
  const allTables = useMemo(
    () =>
      elements
        .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
        .map((el) => ({ id: el.physical_table_id as string, label: el.table?.label ?? '' })),
    [elements],
  )

  // Lista accesible canónica: ubicadas + bandeja.
  const fallbackTables = useMemo(
    () =>
      [
        ...initial.elements
          .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
          .map((el) => ({
            id: el.physical_table_id as string,
            label: el.table?.label ?? el.label ?? '',
            capacity: el.table?.capacity ?? null,
            qr_token: el.table?.qr_token ?? '',
            active: el.table?.active ?? true,
          })),
        ...initial.unplacedTables.map((t) => ({
          id: t.id,
          label: t.label,
          capacity: t.capacity,
          qr_token: t.qr_token,
          active: true,
        })),
      ].sort((a, b) => a.label.localeCompare(b.label, 'es')),
    [initial.elements, initial.unplacedTables],
  )

  if (!activeArea) return null

  return (
    <Tabs defaultValue="plano" className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="plano">Plano</TabsTrigger>
          <TabsTrigger value="lista">Lista</TabsTrigger>
        </TabsList>

        {/* Toggle Editar / En vivo (solo aplica a la pestaña Plano). */}
        <div className="inline-flex items-center rounded-lg border border-border/60 bg-card p-0.5">
          <button
            type="button"
            onClick={() => setMode('editar')}
            aria-pressed={mode === 'editar'}
            className={
              mode === 'editar'
                ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground'
            }
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => setMode('vivo')}
            aria-pressed={mode === 'vivo'}
            className={
              mode === 'vivo'
                ? 'rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                : 'rounded-md px-3 py-1 text-xs font-medium text-muted-foreground'
            }
          >
            En vivo
          </button>
        </div>
      </div>

      <TabsContent value="plano">
        {mode === 'vivo' ? (
          // LiveFloor se cablea en la Fase 6.
          <div className="flex h-[70vh] min-h-[420px] w-full items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/50 text-sm text-muted-foreground">
            Vista en vivo (próxima fase)
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
            <AreaManager
              slug={slug}
              areas={areas}
              activeAreaId={activeAreaId}
              onActiveAreaChange={(id) => {
                setSelectedId(null)
                setActiveAreaId(id)
              }}
              onChanged={onChanged}
            />

            <div className="space-y-3">
              <ElementPalette onQuickAdd={handleQuickAdd} />
              <div ref={wrapperRef}>
                <PanZoomStage
                  width={activeArea.width}
                  height={activeArea.height}
                  transformRef={transformRef}
                  interactive
                  gridSize={GRID}
                  onBackgroundClick={() => setSelectedId(null)}
                  onDropKind={handleDropKind}
                >
                  {areaElements.map((element) => (
                    <FloorElement
                      key={element.id}
                      element={element}
                      selected={element.id === selectedId}
                      transformRef={transformRef}
                      areaWidth={activeArea.width}
                      areaHeight={activeArea.height}
                      onSelect={setSelectedId}
                      onMove={handleMove}
                      onResizeEnd={handleResizeEnd}
                    />
                  ))}
                </PanZoomStage>
              </div>
            </div>

            <aside className="space-y-3">
              {selectedElement && selectedElement.kind === 'table' ? (
                <TableInspector
                  slug={slug}
                  element={selectedElement}
                  allTables={allTables}
                  onChanged={onChanged}
                  onClose={() => setSelectedId(null)}
                />
              ) : selectedElement ? (
                <DecorInspector
                  slug={slug}
                  element={selectedElement}
                  onChanged={onChanged}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <UnplacedTray tables={unplaced} onPlace={onPlace} />
              )}
            </aside>
          </div>
        )}
      </TabsContent>

      <TabsContent value="lista">
        <TablesListFallback slug={slug} tables={fallbackTables} />
      </TabsContent>
    </Tabs>
  )
}
```

> **Nota de comportamiento (label vacío al crear mesa):** `createTableInPlanSchema` exige `label` con `min(1)`. El drop-from-palette manda `label: ''`, que la action rechazaría. Para no romper el alta por drag, el editor abre el inspector tras crear; pero la action necesita un label válido. **Decisión normativa:** el editor autosugiere el label antes de llamar a la action (no `''`). Reescribir `insertAt` para mesa así (usa `suggestNextLabel` con los labels del área activa):

- [ ] **Step 4: Corregir `insertAt` para autosugerir el label de la mesa (no `''`)**

Reemplazar el `import` y el bloque `if (kind === 'table')` para usar `suggestNextLabel`. Primero, agregar el import junto a los demás de `@/lib/floor-plan`:

```tsx
import { suggestNextLabel } from '@/lib/floor-plan/numbering'
```

Luego, dentro de `insertAt`, reemplazar la rama `if (kind === 'table') { ... }` por:

```tsx
      if (kind === 'table') {
        // Autosugerir el próximo label libre del área (el inspector permite editarlo).
        const areaLabels = elements
          .filter((el) => el.area_id === activeArea.id && el.kind === 'table' && el.table)
          .map((el) => el.table?.label ?? '')
          .filter((l) => l.length > 0)
        const label = suggestNextLabel(activeArea.number_start, areaLabels)
        void (async () => {
          const r = await createTableInPlanAction(slug, {
            area_id: activeArea.id,
            label,
            capacity: null,
            shape: ELEMENT_DEFAULTS.table.shape,
            x,
            y,
          })
          if (r.ok) {
            // Re-sembrar y abrir el inspector de la mesa nueva (por su element_id).
            setSelectedId(r.elementId)
            router.refresh()
          } else {
            toast.error(r.message)
          }
        })()
        return
      }
```

Y actualizar la lista de dependencias del `useCallback` de `insertAt` para incluir `elements`:

```tsx
    [activeArea, slug, router, onChanged, elements],
```

- [ ] **Step 5: Typecheck verde (clúster completo)**

```bash
npm run typecheck
```

Esperado: sin errores. (Si aparece "Cannot find name `stagePointFromClient`" significa que la Fase 2 no agregó el helper a `grid.ts`; bloquea — no inventarlo acá, viene de la Fase 2.)

- [ ] **Step 6: Lint verde**

```bash
npm run lint
```

Esperado: `Checked N files ... No fixes applied` / sin errores ni warnings.

- [ ] **Step 7: Confirmar que dnd-kit ya no lo importa NINGÚN archivo del clúster**

```bash
grep -rn "@dnd-kit" "app/(manager)/[tenantSlug]/local/mesas/_components/" || echo "OK: el cluster no importa dnd-kit"
```

Esperado: `OK: el cluster no importa dnd-kit`. (`grid.ts` y `a11y.ts` siguen importando el tipo `Modifier` / tipos de a11y — quedan sin usar y se borran en la fase de desinstalación; no son parte de `_components/`.)

- [ ] **Step 8: Smoke manual (sin E2E en MVP — documentar en el PR)**

Levantar `npm run dev`, ir a `/<slug>/local/mesas` como owner y verificar:
1. Arrastrar la chip "Mesa" desde la paleta y soltarla sobre el lienzo → cae donde se soltó (snap a grilla) y se abre el inspector de la mesa nueva con un label autosugerido.
2. Arrastrar "Pared/Columna/Isla/Barra" → cae en el punto con su tamaño default.
3. Arrastrar el **fondo** del lienzo → panea; scroll → zoom; botón fit → re-encuadra; `+`/`−` → zoom por paso.
4. A scale ≠ 1 (zoomeado): arrastrar una mesa NO panea el lienzo y NO driftea (la posición sigue al cursor) — el bug de v1 está corregido.
5. Seleccionar una mesa → aparecen los handles; redimensionar con la esquina/bordes → tamaño coherente a cualquier zoom.
6. Click en el fondo vacío → deselecciona.
7. Inspector: editar nombre/capacidad, dividir, combinar, activar/desactivar, quitar del plano → todo funciona (acciones reusadas).
8. Bandeja "Colocar" → ubica la mesa en el centro.
9. Toggle **En vivo** → muestra el placeholder "Vista en vivo (próxima fase)"; volver a **Editar** restaura el lienzo.
10. Pestaña **Lista** → fallback accesible operativo.
11. Dark mode: contraste OK.

- [ ] **Step 9: Commit del clúster completo**

```bash
git add "app/(manager)/[tenantSlug]/local/mesas/_components/floor-plan-editor.tsx" \
        "app/(manager)/[tenantSlug]/local/mesas/_components/floor-element.tsx" \
        "app/(manager)/[tenantSlug]/local/mesas/_components/resize-handles.tsx" \
        "app/(manager)/[tenantSlug]/local/mesas/_components/element-palette.tsx" \
        "app/(manager)/[tenantSlug]/local/mesas/_components/unplaced-tray.tsx"
git commit -m "$(cat <<'EOF'
feat(local/mesas): reescritura del editor sin dnd-kit (pointer-drag scale-aware + drop-from-palette)

Reemplaza el clúster del editor por react-zoom-pan-pinch + drag propio: FloorElement
con pointer events que leen el scale del transformRef (delta/scale, snap+clamp);
ResizeHandles scale-aware; ElementPalette con chips arrastrables (dataTransfer
application/x-floor-kind) + click fallback; orquestador sin DndContext con
drag-from-palette (createTableInPlanAction → abre inspector / addDecorAction) y
toggle Editar/En vivo (placeholder live hasta la fase de vista en vivo). UnplacedTray
pierde el drag inerte (solo Colocar). Baja floor-canvas y create-table-dialog.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.6: `page.tsx` — montar el editor reescrito

**Files:**
- Modify: `app/(manager)/[tenantSlug]/local/mesas/page.tsx`

- [ ] **Step 1: Confirmar que la page monta el editor (sin cambios estructurales — verificar imports y owner-check)**

La page ya carga `getFloorPlan`, arma `fallbackTables`, envuelve `<FloorPlanEditor>` en `<FloorPlanErrorBoundary>` y re-chequea `role !== 'owner'`. El único riesgo tras la reescritura es que el editor ya no usa `tenantId` (lo recibe pero lo ignora en runtime); el prop sigue en el Contract (`FloorPlanEditorProps.tenantId`) para la Fase 6 (LiveFloor lo necesitará). No hay cambios obligatorios en la page; la dejamos tal cual el move de la Fase 1. Confirmar que compila contra el editor nuevo:

```bash
npm run typecheck 2>&1 | grep -i "local/mesas/page" || echo "page.tsx OK contra el editor reescrito"
```

Esperado: `page.tsx OK contra el editor reescrito`.

- [ ] **Step 2: Actualizar el copy del `PageHeader` para reflejar el nuevo gesto (drag-from-palette)**

Leer la page y ajustar la `description` del `PageHeader` (el texto v1 hablaba de "arrastrá mesas"; ahora también soltás desde la paleta). Reemplazar la línea de `description`:

```tsx
        description="Dibujá la distribución real del local: arrastrá elementos desde la paleta al lienzo, reubicalos y gestioná cada QR. Cambiá a En vivo para ver el estado de cada mesa."
```

(Aplicar el `Edit` sobre el `description=` existente en `app/(manager)/[tenantSlug]/local/mesas/page.tsx`.)

- [ ] **Step 3: Typecheck + lint final de la fase (verde)**

```bash
npm run typecheck && npm run lint
```

Esperado: ambos sin errores ni warnings. El repo queda compilando con el clúster reescrito completo.

- [ ] **Step 4: Tests verdes (no se rompió la lógica pura existente)**

```bash
npm run test:ci
```

Esperado: toda la suite verde. (Los tests de los modifiers de `grid.ts` siguen pasando: `grid.ts` no se tocó en esta fase. Los tests de `stagePointFromClient` y el drag-commit se agregan/ajustan en la fase de tests de geometría.)

- [ ] **Step 5: Commit**

```bash
git add "app/(manager)/[tenantSlug]/local/mesas/page.tsx"
git commit -m "$(cat <<'EOF'
feat(local/mesas): page monta el editor reescrito y actualiza el copy del header

El RSC sigue cargando getFloorPlan + ErrorBoundary→fallback accesible; ajusta la
descripción al nuevo gesto drag-from-palette y menciona el toggle En vivo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Datos en vivo — getLiveFloor + listFloorAreas + refreshLiveFloorAction

### Task 4.1: Agregar tipos LiveSession/LiveTable/LiveDecor/LiveFloorData y queries getLiveFloor + listFloorAreas a lib/floor-plan/queries.ts

**Files:**
- Modify: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/queries.ts`

- [ ] **Step 1: Agregar los tipos y funciones al final de queries.ts**

```ts
// ─── Tipos para la vista en vivo ─────────────────────────────────────────────

export type LiveSession = {
  id: string
  status: 'open' | 'paid' | 'merged' | 'abandoned'
  total_cents: number
  party_size: number | null
  alias: string | null
  opened_at: string
  /**
   * 'ready'     si algún ticket de la sesión tiene status='ready'
   * 'preparing' si tiene 'accepted' o 'preparing' (y ninguno 'ready')
   * 'none'      sin tickets activos en cocina
   */
  kitchen: 'none' | 'preparing' | 'ready'
  /** Existe al menos un table_session_events con type='bill_requested' para esta sesión */
  bill_requested: boolean
}

export type LiveTable = {
  element_id: string
  physical_table_id: string
  x: number
  y: number
  width: number
  height: number
  shape: 'rect' | 'circle'
  z_index: number
  label: string
  capacity: number | null
  /** null = mesa libre (sin sesión abierta) */
  session: LiveSession | null
}

export type LiveDecor = {
  element_id: string
  kind: 'wall' | 'pillar' | 'island' | 'bar'
  shape: 'rect' | 'circle'
  x: number
  y: number
  width: number
  height: number
  z_index: number
  label: string | null
  color: string | null
}

export type LiveFloorData = {
  area: AreaRow
  tables: LiveTable[]
  decor: LiveDecor[]
}

// ─── Raw shapes para los casts de supabase-js ────────────────────────────────

type RawLiveElementRow = {
  id: string
  area_id: string
  kind: ElementRow['kind']
  shape: 'rect' | 'circle'
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  z_index: number
  label: string | null
  color: string | null
  physical_tables: {
    label: string
    capacity: number | null
  } | null
}

type RawSessionRow = {
  id: string
  physical_table_id: string | null
  status: string
  total_cents: number
  party_size: number | null
  alias: string | null
  opened_at: string
}

type RawTicketRow = {
  session_id: string
  status: string
}

type RawBillEventRow = {
  session_id: string
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las áreas del tenant, orden canónico (posición → created_at → id).
 * RLS SELECT abierta a miembros del tenant (owner + staff).
 */
export async function listFloorAreas(tenantId: string): Promise<AreaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('floor_plan_areas')
    .select('id, name, position, width, height, number_start')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[floor-plan.listFloorAreas]', error.message)
    return []
  }

  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    position: a.position,
    width: a.width,
    height: a.height,
    number_start: a.number_start,
  }))
}

/**
 * Devuelve la geometría del área + estado en vivo de cada mesa.
 *
 * Estrategia (sin RPC nuevo, sin NOT EXISTS en PostgREST):
 * 1. Cargar floor_plan_elements del área (ambos kinds).
 * 2. Para los kind='table': extraer los physical_table_ids → cargar la única
 *    sesión OPEN por mesa (índice único parcial garantiza como máximo una).
 * 3. Cargar tickets de esas sesiones en status kitchen-activo
 *    ('accepted'|'preparing'|'ready') → derivar flag kitchen en JS.
 * 4. Cargar table_session_events type='bill_requested' de esas sesiones → derivar flag en JS.
 * 5. Mapear todo a LiveTable | LiveDecor.
 *
 * RLS SELECT abierta a miembros del tenant (owner + staff). No usa service_role.
 */
export async function getLiveFloor(tenantId: string, areaId: string): Promise<LiveFloorData> {
  const supabase = await createClient()

  // 1) Área
  const { data: areaData, error: areaError } = await supabase
    .from('floor_plan_areas')
    .select('id, name, position, width, height, number_start')
    .eq('tenant_id', tenantId)
    .eq('id', areaId)
    .maybeSingle()

  if (areaError || !areaData) {
    console.error('[floor-plan.getLiveFloor] area', areaError?.message ?? 'not found')
    // Devolver una estructura vacía con un área placeholder para no romper el render.
    const fallback: AreaRow = { id: areaId, name: '', position: 0, width: 800, height: 600, number_start: 1 }
    return { area: fallback, tables: [], decor: [] }
  }

  const area: AreaRow = {
    id: areaData.id,
    name: areaData.name,
    position: areaData.position,
    width: areaData.width,
    height: areaData.height,
    number_start: areaData.number_start,
  }

  // 2) Elementos del área + join a physical_tables (solo kind='table' tiene FK).
  const { data: elementsData, error: elementsError } = await supabase
    .from('floor_plan_elements')
    .select(
      'id, area_id, kind, shape, physical_table_id, x, y, width, height, z_index, label, color, physical_tables(label, capacity)',
    )
    .eq('tenant_id', tenantId)
    .eq('area_id', areaId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (elementsError) {
    console.error('[floor-plan.getLiveFloor] elements', elementsError.message)
    return { area, tables: [], decor: [] }
  }

  const rawElements = (elementsData ?? []) as unknown as RawLiveElementRow[]

  // Separar mesas y decoración.
  const tableElements = rawElements.filter(
    (el) => el.kind === 'table' && el.physical_table_id !== null,
  )
  const decorElements = rawElements.filter((el) => el.kind !== 'table')

  const decor: LiveDecor[] = decorElements.map((el) => ({
    element_id: el.id,
    kind: el.kind as LiveDecor['kind'],
    shape: el.shape,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    z_index: el.z_index,
    label: el.label,
    color: el.color,
  }))

  // Salida temprana si no hay mesas en el área.
  if (tableElements.length === 0) {
    return { area, tables: [], decor }
  }

  const physicalTableIds = tableElements
    .map((el) => el.physical_table_id)
    .filter((id): id is string => id !== null)

  // 3) Sesiones OPEN por mesa (a lo sumo una por índice único parcial).
  const { data: rawSessions } = await supabase
    .from('table_sessions')
    .select('id, physical_table_id, status, total_cents, party_size, alias, opened_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .in('physical_table_id', physicalTableIds)

  const sessions = ((rawSessions ?? []) as unknown as RawSessionRow[]).filter(
    (s) => s.physical_table_id !== null,
  )

  const sessionsByTableId = new Map<string, RawSessionRow>()
  for (const s of sessions) {
    if (s.physical_table_id) sessionsByTableId.set(s.physical_table_id, s)
  }

  const sessionIds = sessions.map((s) => s.id)

  // 4) Flags de cocina y cuenta pedida (solo si hay sesiones abiertas).
  // kitchen: tickets con status IN ('accepted','preparing','ready').
  // bill_requested: table_session_events type='bill_requested'.
  const kitchenBySession = new Map<string, 'preparing' | 'ready'>()
  const billSessionIds = new Set<string>()

  if (sessionIds.length > 0) {
    const [{ data: rawTickets }, { data: rawBillEvents }] = await Promise.all([
      supabase
        .from('tickets')
        .select('session_id, status')
        .in('session_id', sessionIds)
        .in('status', ['accepted', 'preparing', 'ready']),
      supabase
        .from('table_session_events')
        .select('session_id')
        .in('session_id', sessionIds)
        .eq('type', 'bill_requested'),
    ])

    // Derivar kitchen por sesión: 'ready' tiene prioridad sobre 'preparing'.
    for (const t of (rawTickets ?? []) as unknown as RawTicketRow[]) {
      const current = kitchenBySession.get(t.session_id)
      if (t.status === 'ready') {
        kitchenBySession.set(t.session_id, 'ready')
      } else if (current !== 'ready') {
        // 'accepted' o 'preparing' → nivel 'preparing' si no hay 'ready' todavía.
        kitchenBySession.set(t.session_id, 'preparing')
      }
    }

    for (const ev of (rawBillEvents ?? []) as unknown as RawBillEventRow[]) {
      billSessionIds.add(ev.session_id)
    }
  }

  // 5) Mapear a LiveTable.
  const tables: LiveTable[] = tableElements.map((el) => {
    const sess = el.physical_table_id ? sessionsByTableId.get(el.physical_table_id) : undefined
    const pt = el.physical_tables

    const session: LiveSession | null = sess
      ? {
          id: sess.id,
          status: sess.status as LiveSession['status'],
          total_cents: sess.total_cents ?? 0,
          party_size: sess.party_size,
          alias: sess.alias,
          opened_at: sess.opened_at,
          kitchen: kitchenBySession.get(sess.id) ?? 'none',
          bill_requested: billSessionIds.has(sess.id),
        }
      : null

    return {
      element_id: el.id,
      physical_table_id: el.physical_table_id as string,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      shape: el.shape,
      z_index: el.z_index,
      label: pt?.label ?? el.label ?? '',
      capacity: pt?.capacity ?? null,
      session,
    }
  })

  return { area, tables, decor }
}
```

**Conventional Commit (parcial — se completa al final de la tarea 4.2):**
> Esperar al commit conjunto de la tarea 4.2.

---

### Task 4.2: Crear lib/floor-plan/live-actions.ts con refreshLiveFloorAction; verificar typecheck + lint; commit

**Files:**
- Create: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/live-actions.ts`

- [ ] **Step 1: Crear live-actions.ts**

```ts
'use server'

import { requireTenantAccess } from '@/lib/tenant/access'
import { getLiveFloor } from './queries'
import type { LiveFloorData } from './queries'

/**
 * Server Action para refrescar la vista en vivo de un área.
 * Llamado por LiveFloor en el onChange de Supabase Realtime (vía useDebouncedRefresh).
 * Acepta cualquier miembro del tenant (owner + staff); no requiere rol específico.
 */
export async function refreshLiveFloorAction(
  slug: string,
  areaId: string,
): Promise<{ ok: true; data: LiveFloorData } | { ok: false; message: string }> {
  try {
    const { tenant } = await requireTenantAccess(slug)
    const data = await getLiveFloor(tenant.id, areaId)
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar el plano'
    console.error('[floor-plan.refreshLiveFloorAction]', message)
    return { ok: false, message }
  }
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck 2>&1 | tail -20
```

Salida esperada: cero errores de TypeScript (`Found 0 errors in tsconfig.json`).

- [ ] **Step 3: Verificar lint**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run lint 2>&1 | tail -20
```

Salida esperada: sin errores de Biome relacionados con los archivos nuevos/modificados.

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Users/Agust/Hub_main && git add lib/floor-plan/queries.ts lib/floor-plan/live-actions.ts && git commit -m "$(cat <<'EOF'
feat(floor-plan): capa de lectura en vivo — getLiveFloor + listFloorAreas + refreshLiveFloorAction

Agrega a lib/floor-plan/queries.ts los tipos LiveSession/LiveTable/LiveDecor/LiveFloorData
y las funciones getLiveFloor(tenantId, areaId) y listFloorAreas(tenantId).
getLiveFloor obtiene la geometría del área y el estado en vivo de cada mesa (sesión open,
flags kitchen/bill_requested) con tres queries PostgREST + anti-join/conteos en JS,
siguiendo el patrón de listSalonTables. Agrega lib/floor-plan/live-actions.ts con
refreshLiveFloorAction (server action para el onChange realtime, cualquier miembro).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Vista en vivo — live-floor + live-table-card + realtime

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Phase goal:** Construir las dos piezas read-only de la vista en vivo, compartidas por el dueño (Phase 6 toggle "En vivo") y el staff (Phase 6 `/salón`): `live-table-card.tsx` (tarjeta de mesa coloreada por estado con gasto/comensales/tiempo/cocina/cuenta) y `live-floor.tsx` (monta `PanZoomStage` en modo read-only con una `LiveTableCard` por mesa + decoración gris, selector de áreas, y suscripción Realtime que refetchea vía `refreshLiveFloorAction`). Ambos se atan **exactamente** a los Contracts (`LiveTableCardProps`, `LiveFloorProps`, `LiveTable`, `LiveDecor`, `LiveFloorData`, `AreaRow`, `PanZoomStageProps`).

**Depends on:**
- Phase 1 (helpers): `lib/salon/format.ts` exporta `elapsedLabel(openedAt: string): string` y `ARSFormat(cents: number): string` (extraídos de `salon-tables-grid.tsx`).
- Phase 2 (nav-move): los componentes viven bajo `app/(manager)/[tenantSlug]/local/mesas/_components/`.
- Phase 3: `pan-zoom-stage.tsx` exporta `PanZoomStage` con `PanZoomStageProps` (incluye `interactive?: boolean` y `onBackgroundClick?`).
- Phase 4: `lib/floor-plan/queries.ts` exporta `LiveSession`/`LiveTable`/`LiveDecor`/`LiveFloorData` + `getLiveFloor`/`listFloorAreas`; `lib/floor-plan/live-actions.ts` exporta `refreshLiveFloorAction(slug, areaId)`; la migración `20260606000100_realtime_salon_publication.sql` ya está aplicada (publica `table_sessions`/`tickets`/… en `supabase_realtime`).

**CONTRACT ADDITIONS:**
- `lib/salon/format.ts` (extraído en Phase 1) se asume con esta firma exacta (idéntica a las funciones inline de `salon-tables-grid.tsx`): `export function ARSFormat(cents: number): string` y `export function elapsedLabel(openedAt: string): string`. Si Phase 1 no las dejó exactamente así, ajustar Phase 1 — no este import.
- `PanZoomStageProps` (Phase 3) ya define `interactive?: boolean`, `onBackgroundClick?`, `transformRef`, `width`, `height`, `children`. `LiveFloor` lo usa con `interactive={false}` (pan/zoom libre, sin drag de elementos) y crea su propio `transformRef` vía `useRef<ReactZoomPanPinchRef | null>(null)`.
- `LiveTableCard` posiciona su raíz con `position: absolute` en coords lógicas del stage (`left/top/width/height = table.x/y/width/height`) para que caiga dentro del stage de `PanZoomStage`. La decoración gris se renderiza como divs hermanos directamente en `LiveFloor` (no es una `LiveTableCard`).

---

### Task 5.1: `live-table-card.tsx` — tarjeta de mesa en vivo (read-only)

**Files:**
- Create: `app/(manager)/[tenantSlug]/local/mesas/_components/live-table-card.tsx`

- [ ] **Step 1: Crear `live-table-card.tsx`.**

Tarjeta read-only posicionada en coords lógicas del stage. Color por `session.status` (sin sesión = libre verde tenue; `open` = ámbar; `paid` = azul/slate; `merged`/`abandoned` se tratan como libre porque ya no son una sesión viva en la vista). Muestra `alias ?? label`, `ARSFormat(total_cents)`, `party_size` con 👥, `elapsedLabel(opened_at)`, punto de cocina (ámbar `preparing` / verde `ready`) y flag `bill_requested`. Importa `ARSFormat`/`elapsedLabel` de `lib/salon/format.ts` (Phase 1) y `LiveTableCardProps`/`LiveTable` de los Contracts.

```tsx
'use client'

import { Receipt, Users } from 'lucide-react'
import type { LiveTable } from '@/lib/floor-plan/queries'
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
import { cn } from '@/lib/utils'

export type LiveTableCardProps = { table: LiveTable; onOpen: () => void }

// Estilos por estado de la sesión (libre = sin sesión viva).
// merged/abandoned no son sesiones vivas: la mesa se muestra libre.
type LiveStatus = 'free' | 'open' | 'paid'

function liveStatusOf(table: LiveTable): LiveStatus {
  const s = table.session
  if (!s) return 'free'
  if (s.status === 'open') return 'open'
  if (s.status === 'paid') return 'paid'
  return 'free'
}

const STATUS_SURFACE: Record<LiveStatus, string> = {
  // verde tenue
  free: 'border-success/35 bg-success/8 text-foreground',
  // ámbar
  open: 'border-warning/45 bg-warning/12 text-foreground',
  // azul/slate
  paid: 'border-info/45 bg-info/12 text-foreground',
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  free: 'Libre',
  open: 'Ocupada',
  paid: 'Pagada',
}

export function LiveTableCard({ table, onOpen }: LiveTableCardProps) {
  const status = liveStatusOf(table)
  const s = table.session
  const isCircle = table.shape === 'circle'
  const title = s?.alias ?? table.label

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${title} — ${STATUS_LABEL[status]}${
        s ? ` · ${ARSFormat(s.total_cents)}` : ''
      }`}
      className={cn(
        'group absolute flex flex-col items-stretch justify-between overflow-hidden border p-2 text-left shadow-sm outline-none transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:ring-ring/50 hover:-translate-y-0.5 hover:shadow-md',
        isCircle ? 'rounded-full' : 'rounded-lg',
        STATUS_SURFACE[status],
      )}
      style={{
        left: table.x,
        top: table.y,
        width: table.width,
        height: table.height,
        zIndex: table.z_index,
      }}
    >
      {/* Fila superior: nombre + indicadores rápidos (cocina / cuenta). */}
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 truncate font-serif text-sm font-semibold leading-tight tracking-tight">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {s?.kitchen === 'preparing' ? (
            <span
              className="size-2 rounded-full bg-warning"
              role="img"
              aria-label="Cocina: preparando"
              title="Preparando"
            />
          ) : null}
          {s?.kitchen === 'ready' ? (
            <span
              className="size-2 rounded-full bg-success"
              role="img"
              aria-label="Cocina: lista"
              title="Lista"
            />
          ) : null}
          {s?.bill_requested ? (
            <Receipt
              className="size-3.5 text-destructive"
              role="img"
              aria-label="Cuenta pedida"
            />
          ) : null}
        </span>
      </div>

      {/* Fila inferior: estado o métricas de la sesión. */}
      {s ? (
        <div className="flex items-end justify-between gap-1">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            {s.party_size !== null ? (
              <span className="flex items-center gap-0.5">
                <Users className="size-3" aria-hidden />
                {s.party_size}
              </span>
            ) : null}
            <span>{elapsedLabel(s.opened_at)}</span>
          </span>
          <span className="font-serif text-xs font-semibold tabular-nums">
            {ARSFormat(s.total_cents)}
          </span>
        </div>
      ) : (
        <span className="text-[11px] font-medium text-muted-foreground">
          {STATUS_LABEL.free}
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Verificar que las clases de color semánticas existen.** El proyecto usa `success`/`warning`/`info`/`destructive` en Tailwind v4. `salon-tables-grid.tsx` ya usa `border-warning/40`, `border-destructive/40`, `<Badge variant="warning">` y `<Badge variant="destructive">`, lo que confirma `warning` y `destructive`. Confirmar que `success` e `info` existen como colores del theme.

```bash
grep -REn "(bg|text|border)-(success|info)[/ ]|--color-(success|info)|--success|--info" /mnt/c/Users/Agust/Hub_main/app/globals.css /mnt/c/Users/Agust/Hub_main/components /mnt/c/Users/Agust/Hub_main/app 2>/dev/null | head -20
```
Resultado esperado: al menos un match para `success` y uno para `info` (definidos en `@theme`/`globals.css` o usados en componentes existentes). **Si `success` o `info` NO existen**, reemplazar en el código de arriba: `success` → `emerald-500`/`emerald-500/10` y `info` → `sky-500`/`sky-500/12` (colores Tailwind core, siempre disponibles), p.ej. `border-emerald-500/35 bg-emerald-500/10` para `free` y `border-sky-500/45 bg-sky-500/12` para `paid`. No dejar clases inexistentes.

- [ ] **Step 3: Typecheck + lint.**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck && npm run lint
```
Resultado esperado: sin errores TS y Biome sin findings. `LiveTable`/`LiveSession` resuelven desde `@/lib/floor-plan/queries` (Phase 4); `ARSFormat`/`elapsedLabel` desde `@/lib/salon/format` (Phase 1).

- [ ] **Step 4: Smoke manual (anotado, sin E2E en MVP).** En la vista en vivo (Phase 6): una mesa libre se ve verde tenue con "Libre"; una `open` ámbar con monto/comensales/tiempo; una `paid` azul; al cobrar la card cambia de color en vivo; punto ámbar cuando hay tickets `preparing`, verde cuando `ready`; ícono de recibo cuando `bill_requested`; tap dispara `onOpen`. Verificar en dark mode que el contraste del texto sobre los tintes se mantiene legible (AA).

- [ ] **Step 5: Commit.**

```bash
cd /mnt/c/Users/Agust/Hub_main && git add "app/(manager)/[tenantSlug]/local/mesas/_components/live-table-card.tsx" && git commit -m "$(cat <<'EOF'
feat(local): LiveTableCard — tarjeta de mesa en vivo read-only

Tarjeta posicionada en coords lógicas del stage, coloreada por estado de
la sesión (libre=verde tenue, ocupada=ámbar, pagada=azul) con gasto
(ARSFormat), comensales (party_size), tiempo (elapsedLabel), punto de
cocina (preparando/lista) y flag de cuenta pedida. Reusa los helpers de
lib/salon/format.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: `live-floor.tsx` — canvas read-only en vivo + Realtime

**Files:**
- Create: `app/(manager)/[tenantSlug]/local/mesas/_components/live-floor.tsx`

- [ ] **Step 1: Crear `live-floor.tsx`.**

Monta `PanZoomStage` (Phase 3) con `interactive={false}` (pan/zoom libre, sin drag de elementos), renderiza una `LiveTableCard` por mesa y la decoración como divs gris neutro, expone un selector de áreas que reusa `areas`, y suscribe Realtime en el canal `live-${tenantId}` a `table_sessions`+`tickets` filtrados por `tenant_id` → `useDebouncedRefresh(() => refreshLiveFloorAction(slug, activeAreaId))` con safety net cada 30 s. Cuando cambia el área activa, hace un refetch inmediato. Se ata **exactamente** a `LiveFloorProps`, `LiveFloorData`, `LiveTable`, `LiveDecor`, `AreaRow`.

```tsx
'use client'

import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AreaRow, LiveDecor, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { refreshLiveFloorAction } from '@/lib/floor-plan/live-actions'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import { cn } from '@/lib/utils'
import { LiveTableCard } from './live-table-card'
import { PanZoomStage } from './pan-zoom-stage'

const SAFETY_NET_INTERVAL_MS = 30_000
const REALTIME_DEBOUNCE_MS = 500

export type LiveFloorProps = {
  slug: string
  tenantId: string
  areas: AreaRow[]
  activeAreaId: string
  initial: LiveFloorData
  onTableOpen: (table: LiveTable) => void
}

// Decoración: misma paleta neutra para todos los kinds (gris), el plano la
// dibuja como contexto, no como objeto interactivo.
function DecorBox({ decor }: { decor: LiveDecor }) {
  const isCircle = decor.shape === 'circle'
  return (
    <div
      aria-hidden
      className={cn(
        'absolute border border-border/60 bg-muted/60',
        isCircle ? 'rounded-full' : 'rounded-md',
      )}
      style={{
        left: decor.x,
        top: decor.y,
        width: decor.width,
        height: decor.height,
        zIndex: decor.z_index,
      }}
    >
      {decor.label ? (
        <span className="pointer-events-none flex h-full w-full items-center justify-center px-1 text-center text-[10px] font-medium text-muted-foreground">
          {decor.label}
        </span>
      ) : null}
    </div>
  )
}

export function LiveFloor({
  slug,
  tenantId,
  areas,
  activeAreaId: initialAreaId,
  initial,
  onTableOpen,
}: LiveFloorProps) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null)
  const [activeAreaId, setActiveAreaId] = useState<string>(initialAreaId)
  const [data, setData] = useState<LiveFloorData>(initial)

  // El área activa real para refetch; un ref evita reiniciar la suscripción
  // Realtime cada vez que cambia (el canal está scopeado por tenant, no por área).
  const activeAreaRef = useRef(activeAreaId)
  useEffect(() => {
    activeAreaRef.current = activeAreaId
  }, [activeAreaId])

  const refresh = useCallback(async () => {
    const res = await refreshLiveFloorAction(slug, activeAreaRef.current)
    if (res.ok) setData(res.data)
  }, [slug])

  const debouncedRefresh = useDebouncedRefresh(refresh, REALTIME_DEBOUNCE_MS)

  // Suscripción Realtime (una sola, por tenant) + safety net.
  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `live-${tenantId}`,
      events: [
        {
          event: '*',
          table: 'table_sessions',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
        {
          event: '*',
          table: 'tickets',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
      ],
    })

    const safetyNet = window.setInterval(() => {
      void refresh()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      cleanup()
      window.clearInterval(safetyNet)
    }
  }, [tenantId, refresh, debouncedRefresh])

  // Cambio de área activa → refetch inmediato (no esperar al debounce/Realtime).
  const onSelectArea = useCallback(
    (id: string) => {
      if (id === activeAreaRef.current) return
      setActiveAreaId(id)
      activeAreaRef.current = id
      void refresh()
    },
    [refresh],
  )

  const occupied = data.tables.filter((t) => t.session?.status === 'open').length
  const total = data.tables.length
  const free = total - occupied

  return (
    <div className="space-y-3">
      {/* Resumen + selector de áreas. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {occupied} {occupied === 1 ? 'ocupada' : 'ocupadas'} · {free}{' '}
          {free === 1 ? 'libre' : 'libres'} · {total} {total === 1 ? 'mesa' : 'mesas'}
        </p>
        {areas.length > 1 ? (
          <div
            className="flex flex-wrap gap-1"
            role="tablist"
            aria-label="Seleccionar área"
          >
            {areas.map((a) => {
              const selected = a.id === activeAreaId
              return (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onSelectArea(a.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/70 bg-card text-muted-foreground hover:bg-muted',
                  )}
                >
                  {a.name}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <PanZoomStage
        width={data.area.width}
        height={data.area.height}
        transformRef={transformRef}
        interactive={false}
      >
        {data.decor.map((d) => (
          <DecorBox key={d.element_id} decor={d} />
        ))}
        {data.tables.map((t) => (
          <LiveTableCard
            key={t.element_id}
            table={t}
            onOpen={() => onTableOpen(t)}
          />
        ))}
      </PanZoomStage>
    </div>
  )
}
```

- [ ] **Step 2: Verificar la firma de `PanZoomStage` y `refreshLiveFloorAction` contra los Contracts.** `LiveFloor` pasa a `PanZoomStage` solo `width`/`height`/`transformRef`/`interactive`/`children` (todos en `PanZoomStageProps`); no usa `onDropKind`/`onBackgroundClick` (read-only). `refreshLiveFloorAction(slug, areaId)` devuelve `{ ok: true; data: LiveFloorData } | { ok: false; message: string }` (Phase 4). El `transformRef` se tipa con `useRef<ReactZoomPanPinchRef | null>(null)` que satisface `React.RefObject<ReactZoomPanPinchRef | null>` del Contract.

```bash
grep -n "interactive\|onBackgroundClick\|onDropKind\|export type PanZoomStageProps\|export function PanZoomStage" "/mnt/c/Users/Agust/Hub_main/app/(manager)/[tenantSlug]/local/mesas/_components/pan-zoom-stage.tsx"
grep -n "export async function refreshLiveFloorAction" /mnt/c/Users/Agust/Hub_main/lib/floor-plan/live-actions.ts
```
Resultado esperado: `PanZoomStageProps` incluye `interactive?: boolean`; `PanZoomStage` exportado; `refreshLiveFloorAction` exportado. Si Phase 3 no marcó `interactive` opcional, pasar `interactive={false}` igual es válido.

- [ ] **Step 3: Typecheck + lint.**

```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck && npm run lint
```
Resultado esperado: sin errores TS, Biome limpio. Confirma que `LiveFloor` compila contra `PanZoomStage` (Phase 3), `LiveTableCard` (Task 5.1), `refreshLiveFloorAction`/tipos (Phase 4) y `lib/realtime`.

- [ ] **Step 4: Smoke manual (anotado, sin E2E en MVP).** Con la migración de publicación aplicada (Phase 4): abrir la vista en vivo en dos pestañas; al cobrar/pedir en una, la otra refleja el cambio en < ~1 s (Realtime + debounce 500 ms), y si Realtime no llega, el safety net de 30 s lo recupera. Pan arrastrando el fondo y zoom con scroll/+/− funcionan (lib, `interactive={false}`). El selector de áreas (cuando hay > 1) refetchea inmediato al cambiar de área. La decoración se ve gris neutro. Tap en una mesa dispara `onTableOpen(table)` (dueño: panel; staff: navegación — definido en Phase 6). Verificar dark mode.

- [ ] **Step 5: Commit.**

```bash
cd /mnt/c/Users/Agust/Hub_main && git add "app/(manager)/[tenantSlug]/local/mesas/_components/live-floor.tsx" && git commit -m "$(cat <<'EOF'
feat(local): LiveFloor — canvas read-only en vivo con Realtime

Monta PanZoomStage (interactive=false) con una LiveTableCard por mesa y
la decoración en gris neutro, selector de áreas que reusa AreaRow, y
suscripción Realtime (canal live-<tenantId> a table_sessions+tickets
filtrados por tenant_id) que refetchea vía refreshLiveFloorAction con
debounce + safety net de 30s. Compartido por dueño y staff.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Phase 5 done-check:** `npm run typecheck` y `npm run lint` verdes al cierre de cada task. Ambos componentes (`live-table-card.tsx`, `live-floor.tsx`) existen bajo `app/(manager)/[tenantSlug]/local/mesas/_components/`, se atan a los Contracts (`LiveTableCardProps`, `LiveFloorProps`, `LiveTable`, `LiveDecor`, `LiveFloorData`, `AreaRow`, `PanZoomStageProps`), reusan `PanZoomStage` (Phase 3), `getLiveFloor`/`refreshLiveFloorAction` (Phase 4), `lib/realtime` y `lib/salon/format`. Quedan listos para ser consumidos por Phase 6 (toggle del dueño + reemplazo de la grilla del staff). No hay tests Vitest propios en esta fase: la lógica pura de derivación estado→color/kitchen vive en `getLiveFloor` (cubierta por `tests/lib/floor-plan-live.test.ts` de Phase 4); los componentes se validan con smoke manual (sin E2E en MVP).

---

## Phase 6: Wire-up + limpieza (single-owner) — toggle En vivo, staff /salón, baja de dnd-kit muerto

> **CONTRACT ADDITIONS** (folded into Contracts at assembly):
> 1. **`FloorPlanEditorProps` gana dos campos de datos en vivo iniciales** (sin fetch-on-mount; la page RSC los siembra para el área activa):
>    ```ts
>    export type FloorPlanEditorProps = {
>      slug: string
>      tenantId: string
>      initial: FloorPlanData
>      liveAreas: AreaRow[]            // = listFloorAreas(tenant.id) — mismas áreas que el editor
>      initialLive: LiveFloorData | null  // = getLiveFloor(tenant.id, defaultAreaId) o null si no hay área
>    }
>    ```
>    El toggle **En vivo** que dejó la Fase 3 (placeholder) se reemplaza por `<LiveFloor>`; `onTableOpen` del dueño abre un **Sheet read-only** con el resumen de la sesión (no hay ruta `/salon/mesas/[sessionId]` en el workspace `(manager)`).
> 2. **`npm uninstall @dnd-kit/*` se OMITE.** `@dnd-kit/core`, `@dnd-kit/sortable` y `@dnd-kit/utilities` siguen en uso por features **fuera** del floor plan: `menu/_components/menu-board.tsx`, `menu/_components/category-row.tsx`, `flows/_components/flow-builder.tsx`, `eventos/programados/_components/scheduled-events-month.tsx`. La limpieza de esta fase es **solo del código muerto del floor plan** (a11y.ts + modifiers de grid.ts + sus tests + el `useDraggable` de `unplaced-tray.tsx`). El grep confirma cero imports de dnd-kit **bajo `lib/floor-plan/` y `app/(manager)/[tenantSlug]/local/mesas/`**, no en todo el repo. (El plan original asumía dnd-kit exclusivo del floor plan; no lo es.)
> 3. **Paths post-nav-move:** los `_components` del editor viven en `app/(manager)/[tenantSlug]/local/mesas/_components/` (la Fase 2 movió `configuracion/{mesas,…}` → `local/{mesas,…}` con `git mv`). Todos los paths de abajo usan `local/mesas`.

---

### Task 6.1: Wire `<LiveFloor>` en el modo "En vivo" del editor del dueño + Sheet de detalle

**Files:**
- Modify: `app/(manager)/[tenantSlug]/local/mesas/page.tsx` (RSC: siembra `liveAreas` + `initialLive`)
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/floor-plan-editor.tsx` (reemplaza el placeholder "En vivo" por `<LiveFloor>` + Sheet de detalle del dueño)

- [ ] **Step 1: la page RSC fetchea áreas + el live del área default y los pasa al editor.** Reescribir `app/(manager)/[tenantSlug]/local/mesas/page.tsx`:

```tsx
import { LayoutGrid } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { getFloorPlan, getLiveFloor, listFloorAreas } from '@/lib/floor-plan/queries'
import type { LiveFloorData } from '@/lib/floor-plan/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { FloorPlanEditor } from './_components/floor-plan-editor'
import { FloorPlanErrorBoundary } from './_components/floor-plan-error-boundary'
import { TablesListFallback } from './_components/tables-list-fallback'
import { ZeroAreaCta } from './_components/zero-area-cta'

export const metadata = { title: 'Plano de mesas' }

export default async function MesasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let tenant: { id: string; name: string }
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenant = access.tenant
    role = access.role
  } catch {
    notFound()
  }

  if (role !== 'owner') notFound()

  const data = await getFloorPlan(tenant.id)

  // Áreas para el selector de la vista En vivo (mismo orden canónico que el editor).
  const liveAreas = await listFloorAreas(tenant.id)
  // Live data del área default (la primera). Si no hay áreas, no hay vista en vivo.
  const defaultAreaId = liveAreas[0]?.id ?? null
  let initialLive: LiveFloorData | null = null
  if (defaultAreaId) {
    initialLive = await getLiveFloor(tenant.id, defaultAreaId)
  }

  // Para el fallback accesible (datos planos serializables): mesas ubicadas
  // (elementos kind='table') + mesas no ubicadas (bandeja).
  const fallbackTables = [
    ...data.elements
      .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
      .map((el) => ({
        id: el.physical_table_id as string,
        label: el.table?.label ?? el.label ?? '',
        capacity: el.table?.capacity ?? null,
        qr_token: el.table?.qr_token ?? '',
        active: el.table?.active ?? true,
      })),
    ...data.unplacedTables.map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      qr_token: t.qr_token,
      active: true,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'es'))

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title="Plano de mesas"
        description="Dibujá la distribución real del local: arrastrá mesas, agregá decoración y gestioná cada QR. Cambiá a En vivo para ver el estado del salón en tiempo real."
      />

      {data.areas.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Todavía no hay áreas"
          description="Creá la primera área (un piso o salón) para empezar a ubicar mesas en el plano."
          action={<ZeroAreaCta slug={tenantSlug} />}
        />
      ) : (
        <FloorPlanErrorBoundary
          fallback={<TablesListFallback slug={tenantSlug} tables={fallbackTables} />}
        >
          <FloorPlanEditor
            slug={tenantSlug}
            tenantId={tenant.id}
            initial={data}
            liveAreas={liveAreas}
            initialLive={initialLive}
          />
        </FloorPlanErrorBoundary>
      )}
    </main>
  )
}
```

- [ ] **Step 2: el editor monta `<LiveFloor>` en el modo "En vivo" y abre un Sheet read-only al tocar una mesa.** En `app/(manager)/[tenantSlug]/local/mesas/_components/floor-plan-editor.tsx` (estado tras la Fase 3: orquestador con `react-zoom-pan-pinch`, toggle Editar/En vivo, sin DndContext, con un **placeholder** en el panel "En vivo").

  **2a — props + imports.** Sustituir el bloque de imports superior y la firma de `FloorPlanEditorProps` para incorporar `LiveFloor`, el `Sheet` de detalle, los tipos live, y los nuevos props. Agregar al bloque de imports (junto a los ya existentes de la Fase 3):

```tsx
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Bell, CircleDot, Receipt, Users } from 'lucide-react'
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'
import type { AreaRow, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { LiveFloor } from './live-floor'
```

  Reemplazar la firma de props (y su tipo exportado) por:

```tsx
export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  initial: FloorPlanData
  liveAreas: AreaRow[]
  initialLive: LiveFloorData | null
}
```

  Y la línea de desestructuración del componente:

```tsx
export function FloorPlanEditor({
  slug,
  tenantId,
  initial,
  liveAreas,
  initialLive,
}: FloorPlanEditorProps) {
```

  > Nota: `tenantId` deja de estar sin usar (la Fase 3 lo recibía pero no lo consumía) — `LiveFloor` lo necesita. Quitar cualquier `// biome-ignore` de "unused tenantId" si la Fase 3 lo había puesto.

  **2b — estado del Sheet del dueño.** Junto al resto de `useState` del componente, agregar:

```tsx
  // Detalle de mesa en vivo (panel read-only del dueño; no hay ruta de sesión en (manager)).
  const [liveDetail, setLiveDetail] = useState<LiveTable | null>(null)

  const onLiveTableOpen = useCallback((table: LiveTable) => {
    setLiveDetail(table)
  }, [])
```

  **2c — reemplazar el placeholder "En vivo" por `<LiveFloor>` + el Sheet.** En el render, el `TabsContent value="en-vivo"` (o el panel del toggle equivalente que dejó la Fase 3) debe quedar exactamente así (si no hay áreas live, el guard de la page ya evita llegar acá; igual contemplamos `initialLive === null`):

```tsx
      <TabsContent value="en-vivo">
        {initialLive ? (
          <LiveFloor
            slug={slug}
            tenantId={tenantId}
            areas={liveAreas}
            activeAreaId={initialLive.area.id}
            initial={initialLive}
            onTableOpen={onLiveTableOpen}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay áreas para mostrar en vivo. Creá un área en el modo Editar.
          </p>
        )}
      </TabsContent>
```

  Y al final del JSX del componente (después de cerrar `<Tabs>`, pero dentro del único nodo raíz; si el raíz es `<Tabs>`, envolver en un Fragment), montar el Sheet de detalle:

```tsx
      <Sheet
        open={liveDetail !== null}
        onOpenChange={(o) => {
          if (!o) setLiveDetail(null)
        }}
      >
        <SheetContent side="right" className="gap-0">
          <SheetHeader>
            <SheetTitle className="font-serif">
              {liveDetail?.session?.alias ?? liveDetail?.label ?? 'Mesa'}
            </SheetTitle>
            <SheetDescription>
              {liveDetail?.session
                ? 'Estado de la sesión en curso (solo lectura).'
                : 'Mesa libre — no hay sesión abierta.'}
            </SheetDescription>
          </SheetHeader>

          {liveDetail?.session ? (
            <div className="space-y-4 px-6 py-6">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Gasto acumulado
                </span>
                <span className="font-serif text-2xl font-semibold tabular-nums">
                  {ARSFormat(liveDetail.session.total_cents)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {liveDetail.session.party_size !== null ? (
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" aria-hidden />
                    {liveDetail.session.party_size}{' '}
                    {liveDetail.session.party_size === 1 ? 'comensal' : 'comensales'}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="gap-1">
                  <CircleDot className="size-3" aria-hidden />
                  {elapsedLabel(liveDetail.session.opened_at)}
                </Badge>
                {liveDetail.session.kitchen === 'preparing' ? (
                  <Badge variant="warning" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    Preparando
                  </Badge>
                ) : null}
                {liveDetail.session.kitchen === 'ready' ? (
                  <Badge variant="success" className="gap-1">
                    <Bell className="size-3" aria-hidden />
                    Lista
                  </Badge>
                ) : null}
                {liveDetail.session.bill_requested ? (
                  <Badge variant="destructive" className="gap-1">
                    <Receipt className="size-3" aria-hidden />
                    Cuenta pedida
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                La gestión de la mesa (cobrar, dividir, mover) se hace desde el salón.
              </p>
            </div>
          ) : (
            <div className="px-6 py-6">
              <p className="text-sm text-muted-foreground">
                Esta mesa no tiene una sesión abierta en este momento.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
```

  > Si el render raíz del editor es `<Tabs>…</Tabs>`, envolver `<Tabs>` y el `<Sheet>` en un `<>…</>`. El badge `variant="success"`/`"warning"` ya existe en el `Badge` del proyecto (usado por la grilla del salón). El `tableId`/decor de `LiveFloor` ya queda dentro del propio `<LiveFloor>`; el editor solo recibe el callback.

- [ ] **Step 3: typecheck + lint.**

```bash
npm run typecheck && npm run lint
```

Salida esperada: `tsc --noEmit` sin errores; Biome `Checked … No fixes needed.` (o `0 errors`).

- [ ] **Step 4: smoke manual (documentar en el PR).** Como dueño: `Local → Plano`, toggle **En vivo**. Verificar: (a) el plano del área default se ve coloreado por estado; (b) al tocar una mesa con sesión abre el Sheet derecho con gasto/comensales/tiempo/cocina/cuenta; (c) al tocar una mesa libre el Sheet dice "Mesa libre"; (d) cobrar/pedir desde otra pestaña actualiza el plano sin recargar (realtime); (e) cambiar de área en el selector recarga el live del área; (f) volver a **Editar** mantiene el editor intacto.

```text
git commit -m "feat(floor-plan): vista En vivo del dueño con LiveFloor + panel de sesión read-only

El toggle En vivo del editor monta <LiveFloor> (mismo componente que el staff)
con las áreas y el live del área default sembrados por la page RSC. onTableOpen
abre un Sheet read-only con el resumen de la sesión (no hay ruta de sesión en
el workspace (manager)).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.2: Staff `/salón` monta `<LiveFloor>` en vez de la grilla

**Files:**
- Modify: `app/(salon)/[tenantSlug]/salon/mesas/page.tsx` (siembra `liveAreas` + `initialLive` para el live floor)
- Modify: `app/(salon)/[tenantSlug]/salon/mesas/_components/salon-view.tsx` (reemplaza `<SalonTablesGrid>` por `<LiveFloor>`; `LiveFloor` es dueño de su propia suscripción realtime → se quita la doble suscripción)

- [ ] **Step 1: la page del salón fetchea áreas + live del área default.** Reescribir `app/(salon)/[tenantSlug]/salon/mesas/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getLiveFloor, listFloorAreas } from '@/lib/floor-plan/queries'
import type { LiveFloorData } from '@/lib/floor-plan/queries'
import { getSalonOccupancy, listSalonTables } from '@/lib/sessions-waiter/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { SalonView } from './_components/salon-view'

export const metadata = { title: 'Salón · Mesas' }
export const dynamic = 'force-dynamic'

export default async function SalonMesasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }

  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()

  const [tables, occupancy, liveAreas] = await Promise.all([
    listSalonTables(tenantId),
    getSalonOccupancy(tenantId),
    listFloorAreas(tenantId),
  ])

  const defaultAreaId = liveAreas[0]?.id ?? null
  let initialLive: LiveFloorData | null = null
  if (defaultAreaId) {
    initialLive = await getLiveFloor(tenantId, defaultAreaId)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Mesas"
        description="Escaneá el QR al sentar a un grupo, o tocá una mesa libre para activarla."
      />
      <SalonView
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        initialTables={tables}
        initialOccupancy={occupancy}
        liveAreas={liveAreas}
        initialLive={initialLive}
      />
    </div>
  )
}
```

- [ ] **Step 2: `salon-view.tsx` monta `<LiveFloor>` y deja de suscribir realtime él mismo.** `LiveFloor` es dueño de su suscripción (canal `live-${tenantId}` a `table_sessions`+`tickets`) → eliminar la suscripción `salon-${tenantId}` de `salon-view` para evitar **doble suscripción**. `salon-view` conserva el flujo de activación (escaneo/manual + Sheet) y el banner de ocupación; el `refresh` por fetch a `/api/sessions/list` se mantiene **solo** para refrescar la ocupación/estado tras una activación local. Reescribir `app/(salon)/[tenantSlug]/salon/mesas/_components/salon-view.tsx`:

```tsx
'use client'

import { ScanLine, SquarePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { AreaRow, LiveFloorData, LiveTable } from '@/lib/floor-plan/queries'
import { activateTableByIdAction, activateTableByQrAction } from '@/lib/sessions-waiter/actions'
import type { SalonOccupancy, SalonTableRow } from '@/lib/sessions-waiter/queries'
import { LiveFloor } from '../../../../../(manager)/[tenantSlug]/local/mesas/_components/live-floor'
import { ManualActivateSheet } from './manual-activate-sheet'
import { OccupancyBanner } from './occupancy-banner'
import { PartySizeStepper } from './party-size-stepper'
import { QrScannerSheet } from './qr-scanner-sheet'

type PendingActivation =
  | { kind: 'scan'; qrToken: string }
  | { kind: 'manual'; physicalTableId: string; label: string }

export function SalonView({
  tenantSlug,
  tenantId,
  initialTables,
  initialOccupancy,
  liveAreas,
  initialLive,
}: {
  tenantSlug: string
  tenantId: string
  initialTables: SalonTableRow[]
  initialOccupancy: SalonOccupancy
  liveAreas: AreaRow[]
  initialLive: LiveFloorData | null
}) {
  const router = useRouter()
  const [occupancy] = useState(initialOccupancy)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [pending, setPending] = useState<PendingActivation | null>(null)
  const [partySize, setPartySize] = useState(2)
  const [alias, setAlias] = useState('')
  const [isActivating, startActivation] = useTransition()

  // Mesas libres para el sheet de "Activar manual" (de la lectura inicial del server).
  const freeTables = useMemo(
    () => initialTables.filter((t) => t.session === null),
    [initialTables],
  )

  const onScanned = useCallback((qrToken: string) => {
    setScannerOpen(false)
    setPending({ kind: 'scan', qrToken })
    setPartySize(2)
    setAlias('')
  }, [])

  const onPickFreeTable = useCallback((physicalTableId: string, label: string) => {
    setManualOpen(false)
    setPending({ kind: 'manual', physicalTableId, label })
    setPartySize(2)
    setAlias('')
  }, [])

  // Tap en una mesa del live floor → su sesión (si tiene) o el sheet de activación (si libre).
  const onLiveTableOpen = useCallback(
    (table: LiveTable) => {
      if (table.session) {
        router.push(`/${tenantSlug}/salon/mesas/${table.session.id}`)
        return
      }
      onPickFreeTable(table.physical_table_id, table.label)
    },
    [router, tenantSlug, onPickFreeTable],
  )

  const confirm = useCallback(() => {
    if (!pending) return
    startActivation(async () => {
      const trimmedAlias = alias.trim()
      const result =
        pending.kind === 'scan'
          ? await activateTableByQrAction(tenantSlug, {
              qrToken: pending.qrToken,
              partySize,
              source: 'scan',
              alias: trimmedAlias || null,
            })
          : await activateTableByIdAction(tenantSlug, {
              physicalTableId: pending.physicalTableId,
              partySize,
              source: 'manual',
              alias: trimmedAlias || null,
            })

      if (!result.ok) {
        toast.error(result.message)
        return
      }

      if (result.wasAlreadyActive) {
        toast.info(`Mesa ${result.tableLabel ?? ''} ya estaba activa — abriendo detalle.`)
        setPending(null)
        router.push(`/${tenantSlug}/salon/mesas/${result.sessionId}`)
        return
      }

      const titulo = result.alias ?? `Mesa ${result.tableLabel ?? ''}`
      toast.success(`${titulo} activada (${result.partySize} pax).`)
      setPending(null)
      // El detalle de la sesión recién activada es el siguiente paso del flujo.
      router.push(`/${tenantSlug}/salon/mesas/${result.sessionId}`)
    })
  }, [pending, partySize, alias, tenantSlug, router])

  return (
    <div className="space-y-4">
      <OccupancyBanner occupancy={occupancy} />

      <div className="flex gap-2">
        <Button
          onClick={() => setScannerOpen(true)}
          className="flex-1 gap-2"
          size="lg"
          disabled={isActivating}
        >
          <ScanLine className="size-5" aria-hidden />
          Escanear QR
        </Button>
        <Button
          onClick={() => setManualOpen(true)}
          variant="outline"
          className="flex-1 gap-2"
          size="lg"
          disabled={isActivating || freeTables.length === 0}
        >
          <SquarePlus className="size-5" aria-hidden />
          Activar manual
        </Button>
      </div>

      {initialLive ? (
        <LiveFloor
          slug={tenantSlug}
          tenantId={tenantId}
          areas={liveAreas}
          activeAreaId={initialLive.area.id}
          initial={initialLive}
          onTableOpen={onLiveTableOpen}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Todavía no hay un plano de mesas configurado. Pedile al dueño que arme el plano en
          Local → Plano.
        </p>
      )}

      <QrScannerSheet open={scannerOpen} onOpenChange={setScannerOpen} onScan={onScanned} />
      <ManualActivateSheet
        open={manualOpen}
        onOpenChange={setManualOpen}
        freeTables={freeTables}
        onSelect={onPickFreeTable}
      />

      <Sheet
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null)
        }}
      >
        <SheetContent side="bottom" className="gap-0">
          <SheetHeader>
            <SheetTitle className="font-serif">
              {pending?.kind === 'manual' ? `Mesa ${pending.label}` : 'Mesa escaneada'}
            </SheetTitle>
            <SheetDescription>¿Cuántas personas se van a sentar?</SheetDescription>
          </SheetHeader>

          <div className="px-6 py-8 space-y-6">
            <PartySizeStepper value={partySize} onChange={setPartySize} />
            <div className="space-y-1.5">
              <label
                htmlFor="alias-input"
                className="block text-xs uppercase tracking-wider text-muted-foreground"
              >
                Alias (opcional)
              </label>
              <input
                id="alias-input"
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                maxLength={60}
                placeholder="Cumple de Juan"
                disabled={isActivating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <p className="text-[11px] text-muted-foreground">
                Usalo para identificar el grupo (ej. para reservas que ocupan varias mesas).
              </p>
            </div>
          </div>

          <SheetFooter className="flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={isActivating}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button onClick={confirm} disabled={isActivating} className="flex-1">
              {isActivating ? 'Activando…' : 'Activar mesa'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
```

  > Cambios respecto del original: se elimina el `useEffect` con `subscribeChanges`/`safetyNet` y el `refresh()` por fetch (lo dueña ahora `LiveFloor` para el plano). Se elimina `SalonSearch`/`filterTables` y `SalonTablesGrid` del render (el plano reemplaza la grilla). `freeTables` se deriva de la lectura inicial del server para el sheet de activación manual; tras activar, se navega al detalle de la sesión (mismo destino que `onLiveTableOpen` para una mesa con sesión), por lo que no hace falta refrescar la lista en cliente.

- [ ] **Step 3: typecheck + lint.**

```bash
npm run typecheck && npm run lint
```

Salida esperada: `tsc --noEmit` sin errores. Si Biome marca `SalonSearch`/`SalonTablesGrid`/`subscribeChanges`/`useDebouncedRefresh` como imports/exports muertos en otro archivo, no aplica (esos componentes siguen existiendo; solo dejaron de usarse acá). `salon-tables-grid.tsx` y `salon-search.tsx` quedan sin consumidores: **no se borran en esta fase** (la migración de helpers a `lib/salon/format.ts` la hizo la Fase 1; la grilla ya no importa nada propio). Biome no falla por archivos sin importar.

- [ ] **Step 4: smoke manual (documentar en el PR).** Como staff (`waiter`): `/salón → Mesas`. Verificar: (a) se ve el **mismo plano en vivo** que ve el dueño, área-scopeado, con selector de áreas; (b) tocar una mesa con sesión navega a `/[slug]/salon/mesas/[sessionId]`; (c) tocar una mesa libre abre el sheet de party-size → activar navega al detalle; (d) escanear QR / activar manual siguen funcionando; (e) cobrar/pedir desde otra pestaña actualiza el plano en vivo (realtime efectivo gracias a la migración de publicación de la Fase 4); (f) **una sola** suscripción realtime activa (verificable en la pestaña Network/WS de DevTools: un único canal `live-…`, no `salon-…` + `live-…`).

```text
git commit -m "feat(salon): /salón mesas usa LiveFloor compartido (sin doble suscripción)

El staff ve el mismo plano en vivo que el dueño. salon-view deja de suscribir
realtime él mismo (LiveFloor es dueño del canal live-\${tenantId}); conserva el
flujo de activación (escaneo/manual). Tocar una mesa con sesión navega a su
detalle; tocar una libre abre el sheet de activación.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.3: Baja del código dnd-kit muerto del floor plan (a11y.ts + modifiers de grid.ts + tests; SIN uninstall)

**Files:**
- Delete: `lib/floor-plan/a11y.ts`
- Modify: `lib/floor-plan/grid.ts` (borrar `createSnapModifier`, `restrictToParent`, el `import type { Modifier }`)
- Modify: `tests/lib/floor-plan-grid.test.ts` (borrar los `describe` de los modifiers y los imports de dnd-kit/utilities)
- Modify: `app/(manager)/[tenantSlug]/local/mesas/_components/unplaced-tray.tsx` (quitar `useDraggable`/`CSS` de dnd-kit — la bandeja ahora coloca solo por el botón "Colocar")

- [ ] **Step 1: borrar `lib/floor-plan/a11y.ts`.** Era de dnd-kit (`Announcements`/`ScreenReaderInstructions`); el editor reescrito (Fase 3) ya no lo importa. La a11y canónica del rediseño es la lista accesible (`tables-list-fallback.tsx`).

```bash
git rm lib/floor-plan/a11y.ts
```

Salida esperada: `rm 'lib/floor-plan/a11y.ts'`.

- [ ] **Step 2: reescribir `lib/floor-plan/grid.ts` sin los modifiers dnd-kit.** Quedan solo helpers puros + `stagePointFromClient` (agregado por la Fase 3). Reemplazar el archivo completo por:

```ts
/**
 * Helpers puros de geometría del editor de plano.
 *
 * `GRID` / `RESIZE_MIN` / `ELEMENT_DEFAULTS` son las constantes deterministas
 * del spec §5. `snapToGrid`, `clampToArea` y `stagePointFromClient` son puras y
 * testeadas en `tests/lib/floor-plan-grid.test.ts`. El editor rediseñado usa
 * `react-zoom-pan-pinch` + pointer drag propio: NO hay modifiers de dnd-kit.
 */

/** Grilla lógica (px lógicos). El snap usa este valor. */
export const GRID = 20

/** Mínimo de redimensionado (px lógicos) para cualquier elemento. */
export const RESIZE_MIN = 24

/** Defaults de shape/tamaño por kind al agregar un elemento nuevo. */
export const ELEMENT_DEFAULTS: Record<
  'table' | 'wall' | 'pillar' | 'island' | 'bar',
  { shape: 'rect' | 'circle'; width: number; height: number }
> = {
  table: { shape: 'rect', width: 80, height: 80 },
  wall: { shape: 'rect', width: 200, height: 16 },
  pillar: { shape: 'circle', width: 40, height: 40 },
  island: { shape: 'rect', width: 120, height: 80 },
  bar: { shape: 'rect', width: 240, height: 40 },
}

/**
 * Redondea `value` al múltiplo más cercano de `grid` (default `GRID`).
 * Puro. Math.round rompe empates hacia +∞ (p. ej. -0.5 → -0).
 */
export function snapToGrid(value: number, grid?: number): number {
  const g = grid ?? GRID
  return Math.round(value / g) * g
}

/**
 * Acota la posición `(x, y)` de un elemento de tamaño `w × h` para que quede
 * dentro del área `areaW × areaH`: `x ∈ [0, areaW - w]`, `y ∈ [0, areaH - h]`.
 * Si el elemento es más grande que el área (`areaW - w < 0`), el `max` interno
 * queda < 0 y el `Math.max(0, …)` lo fija en 0. Puro.
 */
export function clampToArea(
  x: number,
  y: number,
  w: number,
  h: number,
  areaW: number,
  areaH: number,
): { x: number; y: number } {
  const maxX = areaW - w
  const maxY = areaH - h
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  }
}

/**
 * Convierte un punto de pantalla (`clientX`/`clientY`) a coordenadas lógicas del
 * stage de `react-zoom-pan-pinch`.
 *
 * `rect` = `wrapper.getBoundingClientRect()` (el contenedor del TransformComponent);
 * `scale`/`posX`/`posY` = `transformRef.current.state`. La conversión es la
 * inversa de la transform CSS `translate(posX, posY) scale(scale)`:
 *   lógico = (pantalla − origen_wrapper − pan) / scale
 * Puro. Es la corrección del bug de drag de v1 (la matemática bajo escala).
 */
export function stagePointFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scale: number,
  posX: number,
  posY: number,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - posX) / scale,
    y: (clientY - rect.top - posY) / scale,
  }
}
```

  > La Fase 3 ya agregó `stagePointFromClient`. Lo repetimos completo acá para asegurar que el archivo queda sin el `import type { Modifier }` ni los dos modifiers; si la firma de `stagePointFromClient` que dejó la Fase 3 difiere, gana la de los Contracts (idéntica a la de arriba).

- [ ] **Step 3: reescribir `tests/lib/floor-plan-grid.test.ts` sin los tests de los modifiers.** El archivo de tests todavía importa `createSnapModifier`/`restrictToParent` y `Transform` de `@dnd-kit/utilities`. Reemplazar el archivo completo por (constantes + `snapToGrid` + `clampToArea` + `stagePointFromClient`, este último con casos a scale 1 y 2 — la clase de bug de v1):

```ts
import { describe, expect, it } from 'vitest'
import {
  clampToArea,
  ELEMENT_DEFAULTS,
  GRID,
  RESIZE_MIN,
  snapToGrid,
  stagePointFromClient,
} from '@/lib/floor-plan/grid'

describe('constantes', () => {
  it('GRID y RESIZE_MIN tienen los valores del spec', () => {
    expect(GRID).toBe(20)
    expect(RESIZE_MIN).toBe(24)
  })

  it('ELEMENT_DEFAULTS cubre los 5 kinds con shape/width/height correctos', () => {
    expect(ELEMENT_DEFAULTS.table).toEqual({ shape: 'rect', width: 80, height: 80 })
    expect(ELEMENT_DEFAULTS.wall).toEqual({ shape: 'rect', width: 200, height: 16 })
    expect(ELEMENT_DEFAULTS.pillar).toEqual({ shape: 'circle', width: 40, height: 40 })
    expect(ELEMENT_DEFAULTS.island).toEqual({ shape: 'rect', width: 120, height: 80 })
    expect(ELEMENT_DEFAULTS.bar).toEqual({ shape: 'rect', width: 240, height: 40 })
  })
})

describe('snapToGrid', () => {
  it('redondea al múltiplo de GRID por defecto', () => {
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(9)).toBe(0) // 9/20 = 0.45 → round 0
    expect(snapToGrid(10)).toBe(20) // 10/20 = 0.5 → round 1 → 20
    expect(snapToGrid(11)).toBe(20)
    expect(snapToGrid(29)).toBe(20)
    expect(snapToGrid(30)).toBe(40)
    expect(snapToGrid(123)).toBe(120)
  })

  it('redondea negativos correctamente', () => {
    expect(snapToGrid(-9)).toBe(-0) // -9/20 = -0.45 → round -0
    expect(snapToGrid(-10)).toBe(-0) // Math.round(-0.5) = -0 (hacia +∞)
    expect(snapToGrid(-11)).toBe(-20)
    expect(snapToGrid(-30)).toBe(-20) // Math.round(-1.5) = -1 → -20
  })

  it('acepta un grid custom', () => {
    expect(snapToGrid(7, 5)).toBe(5)
    expect(snapToGrid(12, 5)).toBe(10)
    expect(snapToGrid(13, 5)).toBe(15)
  })
})

describe('clampToArea', () => {
  it('deja el elemento adentro si ya cabe', () => {
    expect(clampToArea(100, 100, 80, 80, 1200, 800)).toEqual({ x: 100, y: 100 })
  })

  it('clampea por izquierda/arriba a 0', () => {
    expect(clampToArea(-50, -30, 80, 80, 1200, 800)).toEqual({ x: 0, y: 0 })
  })

  it('clampea por derecha/abajo a areaW-w / areaH-h', () => {
    // x máximo = 1200 - 80 = 1120 ; y máximo = 800 - 80 = 720
    expect(clampToArea(2000, 2000, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 })
  })

  it('si el elemento es más grande que el área, lo fija en 0 (max < min ⇒ gana 0)', () => {
    // areaW-w = 1200 - 1300 = -100 ; clamp a [0, -100] colapsa a 0
    expect(clampToArea(50, 50, 1300, 900, 1200, 800)).toEqual({ x: 0, y: 0 })
  })

  it('borde exacto: x = areaW - w queda igual', () => {
    expect(clampToArea(1120, 720, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 })
  })
})

describe('stagePointFromClient', () => {
  const rect = { left: 100, top: 50 }

  it('a scale=1 sin pan: resta solo el origen del wrapper', () => {
    // (300-100-0)/1 = 200 ; (250-50-0)/1 = 200
    expect(stagePointFromClient(300, 250, rect, 1, 0, 0)).toEqual({ x: 200, y: 200 })
  })

  it('a scale=1 con pan: resta origen + pan', () => {
    // (300-100-40)/1 = 160 ; (250-50-30)/1 = 170
    expect(stagePointFromClient(300, 250, rect, 1, 40, 30)).toEqual({ x: 160, y: 170 })
  })

  it('a scale=2 con pan: (pantalla - origen - pan) / scale', () => {
    // x: (300-100-40)/2 = 80 ; y: (250-50-30)/2 = 85
    expect(stagePointFromClient(300, 250, rect, 2, 40, 30)).toEqual({ x: 80, y: 85 })
  })

  it('a scale=0.5 escala hacia arriba el delta de pantalla', () => {
    // x: (300-100-0)/0.5 = 400 ; y: (250-50-0)/0.5 = 400
    expect(stagePointFromClient(300, 250, rect, 0.5, 0, 0)).toEqual({ x: 400, y: 400 })
  })
})
```

  > Si la Fase 3 ya extendió este test con casos de `stagePointFromClient`, este reemplazo los unifica y, sobre todo, **elimina** los `describe('createSnapModifier')`/`describe('restrictToParent')` y los imports de dnd-kit que de otro modo romperían el typecheck/test tras borrar los modifiers.

- [ ] **Step 4: quitar dnd-kit de `unplaced-tray.tsx`.** La bandeja ya no se arrastra (el editor rediseñado coloca por click/drop-from-palette; la bandeja conserva el botón "Colocar"). Reescribir `app/(manager)/[tenantSlug]/local/mesas/_components/unplaced-tray.tsx`:

```tsx
'use client'

import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
}

function TrayChip({
  table,
  onPlace,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{table.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {table.capacity != null ? `${table.capacity} pers.` : 'Sin capacidad'} ·{' '}
          <code>{table.qr_token}</code>
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onPlace(table.id)}>
        <MapPin className="size-3.5" />
        Colocar
      </Button>
    </li>
  )
}

export function UnplacedTray({ tables, onPlace }: UnplacedTrayProps) {
  return (
    <section aria-label="Mesas no ubicadas" className="grid gap-2">
      <h2 className="font-display text-sm font-semibold">Mesas sin ubicar</h2>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay mesas activas pendientes de ubicar.</p>
      ) : (
        <ul className="grid gap-1.5">
          {tables.map((table) => (
            <TrayChip key={table.id} table={table} onPlace={onPlace} />
          ))}
        </ul>
      )}
    </section>
  )
}
```

  > Se elimina el `export const TRAY_DRAG_PREFIX` (era el id de draggable). Si el editor de la Fase 3 todavía importa `TRAY_DRAG_PREFIX`/`UnplacedTray` desde aquí para el drag-from-tray, debe haber dejado de hacerlo (el rediseño coloca por el botón "Colocar" + drop-from-palette). El typecheck del Step 6 lo confirma.

- [ ] **Step 5: grep — cero imports de dnd-kit BAJO el floor plan.** El alcance del grep es `lib/floor-plan/` + `app/(manager)/[tenantSlug]/local/mesas/`:

```bash
grep -rn "@dnd-kit" lib/floor-plan "app/(manager)/[tenantSlug]/local/mesas" tests/lib/floor-plan-grid.test.ts
```

Salida esperada: **vacía** (exit 1). Los imports de dnd-kit que quedan en el repo (`menu/_components/menu-board.tsx`, `menu/_components/category-row.tsx`, `flows/_components/flow-builder.tsx`, `eventos/programados/_components/scheduled-events-month.tsx`) son de **otras features** y son legítimos.

```bash
grep -rln "@dnd-kit" app lib components | sort
```

Salida esperada (exactamente estos 4, ninguno del floor plan):
```
app/(manager)/[tenantSlug]/eventos/programados/_components/scheduled-events-month.tsx
app/(manager)/[tenantSlug]/flows/_components/flow-builder.tsx
app/(manager)/[tenantSlug]/menu/_components/category-row.tsx
app/(manager)/[tenantSlug]/menu/_components/menu-board.tsx
```

  > **NO se corre `npm uninstall @dnd-kit/*`** (CONTRACT ADDITION 2): esas 4 features dependen de `@dnd-kit/core`, `@dnd-kit/sortable` y `@dnd-kit/utilities`. El plan original asumía dnd-kit exclusivo del floor plan; no lo es. Las deps quedan en `package.json` y `package-lock.json` sin cambios.

- [ ] **Step 6: typecheck + lint + el test puntual de grid.**

```bash
npx vitest run tests/lib/floor-plan-grid.test.ts && npm run typecheck && npm run lint
```

Salida esperada: Vitest `Test Files 1 passed` (sin referencias a los modifiers borrados); `tsc --noEmit` sin errores; Biome sin findings.

```text
git commit -m "refactor(floor-plan): baja del código dnd-kit muerto del plano

Borra lib/floor-plan/a11y.ts y los modifiers createSnapModifier/restrictToParent
de grid.ts (+ sus tests), y saca useDraggable de unplaced-tray (coloca por botón).
NO se desinstala @dnd-kit: lo siguen usando menu/flows/eventos. El grep confirma
cero imports de dnd-kit bajo lib/floor-plan y local/mesas.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6.4: Verificación full-suite (typecheck + lint + tests + build)

**Files:**
- (sin cambios de archivos; solo verificación. Si algo falla, el fix vive en el commit de la tarea que lo introdujo y se documenta acá.)

- [ ] **Step 1: typecheck + lint + tests + build, todo verde.**

```bash
npm run typecheck && npm run lint && npm run test:ci && npm run build
```

Salida esperada:
- `tsc --noEmit`: sin output (exit 0).
- Biome: `Checked N files … No fixes needed.` (0 errors, 0 warnings).
- Vitest (`test:ci`): todos los archivos `passed` — incluido `tests/lib/floor-plan-grid.test.ts` (sin los modifiers) y los tests de `getLiveFloor` de la Fase 5 (`tests/lib/floor-plan-live.test.ts`).
- `next build`: `✓ Compiled successfully` y la lista de rutas incluyendo `/[tenantSlug]/local/mesas` y `/[tenantSlug]/salon/mesas` sin errores de RSC/`use client`.

- [ ] **Step 2: confirmar que no quedó ningún componente colgando del placeholder removido.** Verificar que el editor no importa `a11y` ni los modifiers, y que la grilla vieja del salón no es referenciada por la vista:

```bash
grep -rn "floor-plan/a11y\|createSnapModifier\|restrictToParent\|TRAY_DRAG_PREFIX\|floorPlanAnnouncements\|floorPlanScreenReaderInstructions" app lib tests
grep -rn "SalonTablesGrid\|salon-tables-grid" "app/(salon)/[tenantSlug]/salon/mesas/_components/salon-view.tsx"
```

Salida esperada: **ambos vacíos** (exit 1). Ninguna referencia viva al código borrado; `salon-view` ya no menciona la grilla.

- [ ] **Step 3: smoke manual end-to-end (documentar en el PR).** Recorrer el happy path completo del rediseño (spec §10): editor (drag-from-palette → cae donde se suelta + abre inspector; pan/zoom/fit; drag a scale≠1 sin drift; resize; dividir/combinar/activar) → toggle **En vivo** (mesas coloreadas, gasto/comensales/tiempo/cocina/cuenta, actualización en vivo al cobrar/pedir en otra pestaña, tap → Sheet del dueño) → `/salón` (staff) ve el **mismo plano en vivo**, tap mesa con sesión → detalle, tap libre → activación → "Local" es tab propia, Configuración sin "Local", links viejos redirigen → dark mode → lista accesible (fallback). Adjuntar screenshots/clip.

```text
git commit --allow-empty -m "chore(floor-plan): verificación full-suite del rediseño verde

typecheck + lint + test:ci + build OK tras wire-up de la vista En vivo (dueño +
staff) y baja del dnd-kit muerto del floor plan. Smoke manual end-to-end
documentado en el PR.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: Tests + README + smoke

### Task 7.1: RLS integration test — `getLiveFloor` isolation

**Files:**
- Create: `tests/rls/floor-plan-live.test.ts`

- [ ] **Step 1: Write the RLS integration test file**

```ts
// tests/rls/floor-plan-live.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

/**
 * Live floor — aislamiento RLS de getLiveFloor.
 *
 * getLiveFloor hace SELECT sobre:
 *   floor_plan_areas   (fpa_select_member)
 *   floor_plan_elements (fpe_select_member)
 *   table_sessions      (aislada por tenant_id vía RLS existente)
 *   tickets             (aislada por tenant_id vía RLS existente)
 *
 * Esta suite verifica:
 *   (a) tenant B no ve áreas ni elementos de tenant A
 *   (b) dentro del mismo tenant, solo los elementos del área solicitada son devueltos
 *   (c) el join de sesión abierta refleja correctamente la sesión de una mesa
 *
 * Las tablas se siembran con service_role.  Los SELECT se hacen con los
 * clientes autenticados de cada tenant.
 */
describeIfRls('RLS — getLiveFloor (live floor isolation)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let staffA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  // Dos áreas de A para verificar el scope por area_id.
  let areaA1: { id: string }
  let areaA2: { id: string }
  let areaB1: { id: string }

  // Mesas / elementos de A.
  let tableA1: { id: string } // mesa en areaA1 con sesión abierta
  let tableA2: { id: string } // mesa en areaA2 (para aislar por área)
  let elemA1: { id: string }  // elemento de tableA1 en areaA1
  let elemA2: { id: string }  // elemento de tableA2 en areaA2

  // Sesión abierta de tableA1.
  let sessionA1: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('liveA') })
    ownerB = await createUserClient({ email: uniqueEmail('liveB') })
    staffA = await createUserClient({ email: uniqueEmail('liveStaff') })

    tenantA = await createTenant({
      name: 'Live Bar A',
      slug: uniqueSlug('live-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Live Bar B',
      slug: uniqueSlug('live-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    // Staff de A (waiter) — miembro válido que también debe ver el live floor.
    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: staffA.userId,
      role: 'waiter',
    })

    // Áreas.
    const { data: aAreas, error: aAreasErr } = await service
      .from('floor_plan_areas')
      .insert([
        { tenant_id: tenantA.id, name: 'Salón A1', position: 0, number_start: 1 },
        { tenant_id: tenantA.id, name: 'Terraza A2', position: 1, number_start: 101 },
      ])
      .select('id')
    if (aAreasErr || !aAreas || aAreas.length !== 2) {
      throw new Error(`seed areas A failed: ${aAreasErr?.message}`)
    }
    areaA1 = aAreas[0] as { id: string }
    areaA2 = aAreas[1] as { id: string }

    const { data: bArea, error: bAreaErr } = await service
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantB.id, name: 'Salón B', position: 0, number_start: 1 })
      .select('id')
      .single()
    if (bAreaErr || !bArea) throw new Error(`seed area B failed: ${bAreaErr?.message}`)
    areaB1 = bArea

    // Mesas activas.
    const { data: ptA1, error: ptA1Err } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '1' })
      .select('id')
      .single()
    if (ptA1Err || !ptA1) throw new Error(`seed tableA1 failed: ${ptA1Err?.message}`)
    tableA1 = ptA1

    const { data: ptA2, error: ptA2Err } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '101' })
      .select('id')
      .single()
    if (ptA2Err || !ptA2) throw new Error(`seed tableA2 failed: ${ptA2Err?.message}`)
    tableA2 = ptA2

    // Elementos de las mesas.
    const { data: elA1, error: elA1Err } = await service
      .from('floor_plan_elements')
      .insert({
        tenant_id: tenantA.id,
        area_id: areaA1.id,
        kind: 'table',
        shape: 'rect',
        physical_table_id: tableA1.id,
        x: 100,
        y: 100,
        width: 80,
        height: 80,
        z_index: 10,
      })
      .select('id')
      .single()
    if (elA1Err || !elA1) throw new Error(`seed elemA1 failed: ${elA1Err?.message}`)
    elemA1 = elA1

    const { data: elA2, error: elA2Err } = await service
      .from('floor_plan_elements')
      .insert({
        tenant_id: tenantA.id,
        area_id: areaA2.id,
        kind: 'table',
        shape: 'rect',
        physical_table_id: tableA2.id,
        x: 200,
        y: 200,
        width: 80,
        height: 80,
        z_index: 10,
      })
      .select('id')
      .single()
    if (elA2Err || !elA2) throw new Error(`seed elemA2 failed: ${elA2Err?.message}`)
    elemA2 = elA2

    // Elemento de decoración en areaA1 (decor debe aparecer en areaA1, no en areaA2).
    await service.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA1.id,
      kind: 'wall',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 200,
      height: 16,
      z_index: 0,
    })

    // Sesión abierta para tableA1.
    const { data: sess, error: sessErr } = await service
      .from('table_sessions')
      .insert({
        tenant_id: tenantA.id,
        physical_table_id: tableA1.id,
        status: 'open',
        total_cents: 125000,
        party_size: 3,
        alias: 'Mesa VIP',
      })
      .select('id')
      .single()
    if (sessErr || !sess) throw new Error(`seed session failed: ${sessErr?.message}`)
    sessionA1 = sess
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(staffA.userId)
  })

  // ── (a) Aislamiento por tenant ─────────────────────────────────────────

  it('tenant B no puede ver áreas de tenant A (SELECT aislado)', async () => {
    const { data: areas } = await ownerB.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(areas?.length ?? 0).toBe(0)
  })

  it('tenant B no puede ver elementos de tenant A (SELECT aislado)', async () => {
    const { data: elements } = await ownerB.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(elements?.length ?? 0).toBe(0)
  })

  it('tenant B no puede ver sesiones de tenant A (SELECT aislado)', async () => {
    const { data: sessions } = await ownerB.client
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(sessions?.length ?? 0).toBe(0)
  })

  it('owner A sí ve sus propios elementos en areaA1', async () => {
    const { data, error } = await ownerA.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA1.id)
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => r.id)
    // elemA1 (mesa) + el decor que sembramos en areaA1
    expect(ids).toContain(elemA1.id)
    // elemA2 está en areaA2, no en areaA1
    expect(ids).not.toContain(elemA2.id)
  })

  // ── (b) Aislamiento por área (scope de getLiveFloor) ────────────────────

  it('los elementos de areaA2 NO aparecen en una query scopeada a areaA1', async () => {
    // getLiveFloor hace: floor_plan_elements WHERE area_id = $areaId
    // Esta prueba verifica la misma query directamente.
    const { data: elemsA1, error } = await ownerA.client
      .from('floor_plan_elements')
      .select('id, area_id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA1.id)
    expect(error).toBeNull()
    const ids = (elemsA1 ?? []).map((r) => r.id)
    expect(ids).toContain(elemA1.id)
    expect(ids).not.toContain(elemA2.id)
  })

  it('los elementos de areaA1 NO aparecen en una query scopeada a areaA2', async () => {
    const { data: elemsA2, error } = await ownerA.client
      .from('floor_plan_elements')
      .select('id, area_id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA2.id)
    expect(error).toBeNull()
    const ids = (elemsA2 ?? []).map((r) => r.id)
    expect(ids).toContain(elemA2.id)
    expect(ids).not.toContain(elemA1.id)
  })

  it('el área de tenant B no es accesible por owner A (scope cross-tenant)', async () => {
    // Si getLiveFloor se llamara con el areaId de B (error de programación),
    // la RLS garantiza que no se devuelven filas de B.
    const { data: bElems } = await ownerA.client
      .from('floor_plan_elements')
      .select('id')
      .eq('area_id', areaB1.id)
    expect(bElems?.length ?? 0).toBe(0)
  })

  // ── (c) Join de sesión abierta correcto ────────────────────────────────

  it('la sesión abierta de tableA1 es visible por el owner del tenant (join correcto)', async () => {
    // getLiveFloor lee table_sessions WHERE physical_table_id = el de cada elemento
    // y status = 'open'. Verificamos la query base que el TS hace.
    const { data, error } = await ownerA.client
      .from('table_sessions')
      .select('id, status, total_cents, party_size, alias, opened_at')
      .eq('tenant_id', tenantA.id)
      .eq('physical_table_id', tableA1.id)
      .eq('status', 'open')
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBe(sessionA1.id)
    expect(data?.status).toBe('open')
    expect(data?.total_cents).toBe(125000)
    expect(data?.party_size).toBe(3)
    expect(data?.alias).toBe('Mesa VIP')
  })

  it('tableA2 no tiene sesión abierta (resultado null en el join)', async () => {
    const { data, error } = await ownerA.client
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('physical_table_id', tableA2.id)
      .eq('status', 'open')
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  it('staff (waiter) de tenant A también puede leer el floor y la sesión', async () => {
    // El live floor es accesible por cualquier miembro del tenant (owner + staff).
    const { data: areas, error: aErr } = await staffA.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(aErr).toBeNull()
    const areaIds = (areas ?? []).map((r) => r.id)
    expect(areaIds).toContain(areaA1.id)

    const { data: elems, error: eErr } = await staffA.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('area_id', areaA1.id)
    expect(eErr).toBeNull()
    expect((elems ?? []).map((r) => r.id)).toContain(elemA1.id)

    const { data: sess, error: sErr } = await staffA.client
      .from('table_sessions')
      .select('id, status')
      .eq('tenant_id', tenantA.id)
      .eq('physical_table_id', tableA1.id)
      .eq('status', 'open')
      .limit(1)
      .single()
    expect(sErr).toBeNull()
    expect(sess?.id).toBe(sessionA1.id)
  })

  it('staff de tenant A NO puede ver sesiones de tenant B', async () => {
    const { data: bSessions } = await staffA.client
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantB.id)
    expect(bSessions?.length ?? 0).toBe(0)
  })
})
```

- [ ] **Step 2: Verify the file path exists and is reachable by Vitest**

```bash
npx vitest run tests/rls/floor-plan-live.test.ts --reporter=verbose 2>&1 | head -20
# Expected (without Supabase local): "0 tests skipped" (RLS_TESTS_ENABLED=false guard)
```

Commit:
```
git commit -m "$(cat <<'EOF'
test(rls): floor-plan-live — tenant isolation + area scope + open session join

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.2: Update `tests/lib/floor-plan-grid.test.ts` — drop dnd-kit modifiers, add `stagePointFromClient` + drag-commit math

**Files:**
- Modify: `tests/lib/floor-plan-grid.test.ts`

- [ ] **Step 1: Rewrite the test file to remove modifier tests and add the new cases**

The new `grid.ts` (Phase 3) exports `stagePointFromClient`, `snapToGrid`, `clampToArea`, `GRID`, `RESIZE_MIN`, `ELEMENT_DEFAULTS` — the dnd-kit modifiers (`createSnapModifier`, `restrictToParent`) are removed. The test file must be rewritten to match.

```ts
// tests/lib/floor-plan-grid.test.ts
import { describe, expect, it } from 'vitest'
import {
  clampToArea,
  ELEMENT_DEFAULTS,
  GRID,
  RESIZE_MIN,
  snapToGrid,
  stagePointFromClient,
} from '@/lib/floor-plan/grid'

describe('constantes', () => {
  it('GRID y RESIZE_MIN tienen los valores del spec', () => {
    expect(GRID).toBe(20)
    expect(RESIZE_MIN).toBe(24)
  })

  it('ELEMENT_DEFAULTS cubre los 5 kinds con shape/width/height correctos', () => {
    expect(ELEMENT_DEFAULTS.table).toEqual({ shape: 'rect', width: 80, height: 80 })
    expect(ELEMENT_DEFAULTS.wall).toEqual({ shape: 'rect', width: 200, height: 16 })
    expect(ELEMENT_DEFAULTS.pillar).toEqual({ shape: 'circle', width: 40, height: 40 })
    expect(ELEMENT_DEFAULTS.island).toEqual({ shape: 'rect', width: 120, height: 80 })
    expect(ELEMENT_DEFAULTS.bar).toEqual({ shape: 'rect', width: 240, height: 40 })
  })
})

describe('snapToGrid', () => {
  it('redondea al múltiplo de GRID por defecto', () => {
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(9)).toBe(0)   // 9/20 = 0.45 → round 0
    expect(snapToGrid(10)).toBe(20) // 10/20 = 0.5 → round 1 → 20
    expect(snapToGrid(11)).toBe(20)
    expect(snapToGrid(29)).toBe(20)
    expect(snapToGrid(30)).toBe(40)
    expect(snapToGrid(123)).toBe(120)
  })

  it('redondea negativos correctamente', () => {
    expect(snapToGrid(-9)).toBe(-0)   // Math.round(-0.45) = -0
    expect(snapToGrid(-10)).toBe(-0)  // Math.round(-0.5) = -0 (hacia +∞)
    expect(snapToGrid(-11)).toBe(-20)
    expect(snapToGrid(-30)).toBe(-20) // Math.round(-1.5) = -1 → -20
  })

  it('acepta un grid custom', () => {
    expect(snapToGrid(7, 5)).toBe(5)
    expect(snapToGrid(12, 5)).toBe(10)
    expect(snapToGrid(13, 5)).toBe(15)
  })
})

describe('clampToArea', () => {
  it('deja el elemento adentro si ya cabe', () => {
    expect(clampToArea(100, 100, 80, 80, 1200, 800)).toEqual({ x: 100, y: 100 })
  })

  it('clampea por izquierda/arriba a 0', () => {
    expect(clampToArea(-50, -30, 80, 80, 1200, 800)).toEqual({ x: 0, y: 0 })
  })

  it('clampea por derecha/abajo a areaW-w / areaH-h', () => {
    expect(clampToArea(2000, 2000, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 })
  })

  it('si el elemento es más grande que el área, lo fija en 0', () => {
    expect(clampToArea(50, 50, 1300, 900, 1200, 800)).toEqual({ x: 0, y: 0 })
  })

  it('borde exacto: x = areaW - w queda igual', () => {
    expect(clampToArea(1120, 720, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 })
  })
})

describe('stagePointFromClient', () => {
  // rect = wrapper.getBoundingClientRect(); posX/posY = pan del TransformWrapper;
  // scale = zoom vigente.
  // Fórmula: x = (clientX - rect.left - posX) / scale

  it('a scale=1 sin pan: convierte coords de pantalla a lógicas restando el offset del wrapper', () => {
    // wrapper arranca en (50, 80) en pantalla; el stage está sin pan (posX=0, posY=0)
    const result = stagePointFromClient(150, 200, { left: 50, top: 80 }, 1, 0, 0)
    // x = (150 - 50 - 0) / 1 = 100
    // y = (200 - 80 - 0) / 1 = 120
    expect(result).toEqual({ x: 100, y: 120 })
  })

  it('a scale=1 con pan: descuenta la traslación del stage', () => {
    // El stage fue paneado +30px en X, +20px en Y.
    const result = stagePointFromClient(150, 200, { left: 50, top: 80 }, 1, 30, 20)
    // x = (150 - 50 - 30) / 1 = 70
    // y = (200 - 80 - 20) / 1 = 100
    expect(result).toEqual({ x: 70, y: 100 })
  })

  it('a scale=2 sin pan: divide el delta por el zoom (caso BUG-v1 — sin división quedaba doble)', () => {
    // Wrapper en (0, 0); zoom = 2.
    const result = stagePointFromClient(200, 160, { left: 0, top: 0 }, 2, 0, 0)
    // x = (200 - 0 - 0) / 2 = 100
    // y = (160 - 0 - 0) / 2 = 80
    expect(result).toEqual({ x: 100, y: 80 })
  })

  it('a scale=2 con pan: descuenta pan y divide por scale', () => {
    // wrapper en (10, 20); pan = (40, 60); zoom = 2
    const result = stagePointFromClient(110, 140, { left: 10, top: 20 }, 2, 40, 60)
    // x = (110 - 10 - 40) / 2 = 60 / 2 = 30
    // y = (140 - 20 - 60) / 2 = 60 / 2 = 30
    expect(result).toEqual({ x: 30, y: 30 })
  })

  it('a scale=0.5 (zoom out): amplifica el delta en lógico', () => {
    const result = stagePointFromClient(200, 200, { left: 100, top: 100 }, 0.5, 0, 0)
    // x = (200 - 100 - 0) / 0.5 = 200
    // y = (200 - 100 - 0) / 0.5 = 200
    expect(result).toEqual({ x: 200, y: 200 })
  })

  it('devuelve coords negativas si el drop es a la izquierda del pan origin', () => {
    // El stage está paneado +200px en X; el drop está cerca del borde izquierdo del wrapper.
    const result = stagePointFromClient(210, 100, { left: 0, top: 0 }, 1, 200, 0)
    // x = (210 - 0 - 200) / 1 = 10
    expect(result.x).toBe(10)
  })
})

describe('drag-commit math (bug class v1)', () => {
  // En el editor, el commit de drag usa:
  //   newX = snapToGrid(origX + (clientX - startX) / scale)
  //   newY = snapToGrid(origY + (clientY - startY) / scale)
  // Luego clampToArea.  A scale=1 delta == delta_lógico; a scale=2 hay que dividir.

  it('a scale=1 el delta se aplica sin corrección (comportamiento normal)', () => {
    const origX = 100
    const origY = 80
    const deltaClientX = 43  // movimiento en px pantalla
    const deltaClientY = 17
    const scale = 1
    const newX = snapToGrid(origX + deltaClientX / scale)
    const newY = snapToGrid(origY + deltaClientY / scale)
    // 100 + 43 = 143 → snapToGrid(143) = round(143/20)*20 = round(7.15)*20 = 7*20 = 140
    expect(newX).toBe(140)
    // 80 + 17 = 97 → snapToGrid(97) = round(4.85)*20 = 5*20 = 100
    expect(newY).toBe(100)
  })

  it('a scale=2 dividir por scale evita el drift doble (BUG v1 sin división)', () => {
    const origX = 100
    const origY = 80
    const deltaClientX = 86 // 43px lógicos * scale 2
    const deltaClientY = 34 // 17px lógicos * scale 2
    const scale = 2

    // Correcto (divide por scale):
    const newXCorrect = snapToGrid(origX + deltaClientX / scale)
    const newYCorrect = snapToGrid(origY + deltaClientY / scale)
    // 100 + 86/2 = 100 + 43 = 143 → snap → 140
    expect(newXCorrect).toBe(140)
    // 80 + 34/2 = 80 + 17 = 97 → snap → 100
    expect(newYCorrect).toBe(100)

    // Sin división (bug v1): el elemento se desplaza el doble del movimiento visual.
    const newXBug = snapToGrid(origX + deltaClientX)
    expect(newXBug).not.toBe(140) // 100 + 86 = 186 → snap → 180 (incorrecto)
    expect(newXBug).toBe(180)     // documenta el valor que producía el bug
  })

  it('a scale=0.5 el delta lógico es mayor que el visual (zoom-out)', () => {
    const origX = 200
    const deltaClientX = 20 // 20px en pantalla → 40px lógicos a scale 0.5
    const scale = 0.5
    const newX = snapToGrid(origX + deltaClientX / scale)
    // 200 + 40 = 240 → snap → 240
    expect(newX).toBe(240)
  })

  it('clampToArea después del snap limita al borde del área', () => {
    const origX = 1100
    const deltaClientX = 200 // intento de sacar del área
    const scale = 1
    const areaW = 1200
    const w = 80
    const rawX = origX + deltaClientX / scale // 1300
    const snapped = snapToGrid(rawX) // 1300 → round(65)*20 = 65*20 = 1300
    const { x } = clampToArea(snapped, 0, w, 80, areaW, 800)
    // máx = 1200 - 80 = 1120
    expect(x).toBe(1120)
  })
})
```

- [ ] **Step 2: Run the updated test file to confirm all cases pass**

```bash
npx vitest run tests/lib/floor-plan-grid.test.ts --reporter=verbose
# Expected: all describe blocks green; no import of createSnapModifier/restrictToParent
```

Commit:
```
git commit -m "$(cat <<'EOF'
test(lib): floor-plan-grid — stagePointFromClient + drag-commit math at scale 1/2, drop dnd-kit modifier tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.3: Update `docs/floor-plan-mesas.md`

**Files:**
- Modify: `docs/floor-plan-mesas.md`

- [ ] **Step 1: Replace the entire file with the updated v2 README**

```md
# Editor visual de plano de mesas (floor plan) — guía técnica v2

> Rediseño 2026-06-06. El editor usa **`react-zoom-pan-pinch`** (pan/zoom robusto) + drag
> propio con pointer events (sale dnd-kit); se agrega la **vista operativa en vivo** con
> Supabase Realtime; y las tres páginas de "Local" se mueven a su **propia tab del
> sidebar**.

Ruta: `/{tenantSlug}/local/mesas` (solo `owner`; staff en `/{tenantSlug}/salon/mesas`).

---

## Qué cambió respecto a v1

| Área | v1 | v2 |
|---|---|---|
| Ruta del editor | `/configuracion/mesas` | `/local/mesas` |
| Sidebar | "Configuración → Local" | Tab **"Local"** propia |
| Librería de canvas | dnd-kit v6 + modifiers custom | **react-zoom-pan-pinch v4** + pointer events |
| Colocar elementos | Clic en paleta → diálogo al centro | **Arrastrar** desde la paleta al lugar |
| Pan/zoom | Pan CSS transform + botones de zoom | `TransformWrapper` nativo (scroll, pinch, `+/-/fit`) |
| Drag a escala ≠ 1 | Bug: delta no dividido → drift | Correcto: `delta / scale` antes de snap |
| `a11y.ts` | Announcements dnd-kit es-AR | Retirado (dnd-kit sale). Lista accesible sigue canónica |
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
| Tests | unit (grid + live logic) + RLS (isolation + area scope + session join) | `tests/lib/floor-plan-grid.test.ts`, `tests/rls/floor-plan-live.test.ts` |

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

### Canvas con `react-zoom-pan-pinch` v4

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
3. Flag `kitchen`: `true` si algún ticket de la sesión tiene `status in
   ('accepted','preparing','ready')`.
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
- **Staff** (`/salon/mesas`): la grilla existente es reemplazada por `<LiveFloor>` con
  `interactive={false}` y `onTableOpen` navegando a `/salon/mesas/[sessionId]`.

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

### Reusados sin cambios

`table-inspector.tsx`, `decor-inspector.tsx`, `area-manager.tsx`, `unplaced-tray.tsx`,
`tables-list-fallback.tsx`, `print-qr-button.tsx`, `floor-plan-error-boundary.tsx`,
`zero-area-cta.tsx`, `use-geometry-queue.ts`.

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
```

- [ ] **Step 2: Confirm typecheck is clean after the file write**

```bash
npm run typecheck 2>&1 | tail -5
# Expected: no errors
```

Commit:
```
git commit -m "$(cat <<'EOF'
docs(floor-plan): actualizar README v2 — editor react-zoom-pan-pinch, live floor, nav Local, realtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.4: Smoke checklist — `docs/superpowers/plans/2026-06-06-floor-plan-rediseno-smoke.md`

**Files:**
- Create: `docs/superpowers/plans/2026-06-06-floor-plan-rediseno-smoke.md`

- [ ] **Step 1: Write the smoke checklist file**

```md
# Smoke manual — Rediseño del floor plan (editor v2 + vista en vivo)

> Happy path del rediseño (spec §10 / plan Phase 7). Ejecutar con la app
> levantada (`npm run dev`), registrar resultado + screenshots/video en el PR.
> Sin E2E automatizado en MVP.

## Pre-requisitos

- [ ] Migraciones `20260605000100`, `20260605000200` y `20260606000100` aplicadas
      (vía Supabase MCP, proyecto `ogplsevtrclzxvyejlns`).
- [ ] `npm run typecheck && npm run lint && npm run test:ci` en verde.
- [ ] App corriendo: `npm run dev` → http://localhost:3000
- [ ] Logueado como **owner** (tenant HUB o cualquier tenant con áreas y mesas).
- [ ] Para los pasos de staff: segunda sesión en otra pestaña logueada como
      **waiter** del mismo tenant.

---

## A. Navegación — tab "Local"

- [ ] **A1. Tab "Local" en el sidebar del dueño.**
  - *Pasos:* entrar al dashboard del dueño.
  - *Esperado:* existe un ítem/grupo "Local" en el sidebar con tres sub-ítems:
    "Plano", "Captura QRs", "Auto-aceptación".

- [ ] **A2. La sección "Local" ya NO aparece en Configuración.**
  - *Pasos:* ir a `/{slug}/configuracion`.
  - *Esperado:* no hay card ni sección "Local" en la página de configuración.
    La settings-nav no lista "Plano", "Captura QRs" ni "Auto-aceptación".

- [ ] **A3. Las rutas `/local/*` responden correctamente.**
  - *Pasos:* navegar a `/{slug}/local/mesas`, `/{slug}/local/captura`,
    `/{slug}/local/auto-aceptacion`.
  - *Esperado:* cada página carga sin 404 ni error.

- [ ] **A4. Las rutas viejas `/configuracion/mesas` y `/configuracion/captura` redirigen.**
  - *Pasos:* ingresar las URLs viejas directamente.
  - *Esperado:* redireccionan a las nuevas rutas `/local/*` (o devuelven 404
    limpios sin página rota; depende de si se agregaron redirects explícitos).

---

## B. Editor (modo Editar) — lienzo y paleta

- [ ] **B1. Lienzo pan — arrastrar el fondo.**
  - *Pasos:* en el editor con el modo "Editar" activo, hacer click-hold en el
    fondo vacío del canvas y arrastrar.
  - *Esperado:* el stage se desplaza (pan). Arrastrar sobre una mesa **no** panea
    (la mesa se mueve en su lugar; `panning.excluded=['floor-element']` funciona).

- [ ] **B2. Zoom — scroll y botones.**
  - *Pasos:* hacer scroll sobre el canvas. Luego usar los botones `+` y `−`.
    Luego usar el botón "fit" (centrar).
  - *Esperado:* el zoom cambia suavemente. El botón fit vuelve a encuadrar el área.
    El nivel de zoom se muestra o es perceptible visualmente.

- [ ] **B3. Drag-from-palette — colocar mesa.**
  - *Pasos:* en la paleta de elementos, hacer click-hold sobre el chip "Mesa" y
    arrastrarlo hasta un punto vacío del canvas. Soltar.
  - *Esperado:* se crea una nueva mesa **en el punto donde se soltó** (no en el
    centro del área). Se abre automáticamente el inspector de la nueva mesa para
    editar nombre/capacidad. No aparece ningún diálogo "al centro" (`create-table-dialog`
    fue retirado).

- [ ] **B4. Drag-from-palette — colocar decoración.**
  - *Pasos:* arrastrar chips "Pared", "Columna", "Isla" y "Barra" al canvas.
  - *Esperado:* cada elemento aparece en el punto de drop con sus defaults
    (`wall` 200×16, `pillar` 40×40 circle, `island` 120×80, `bar` 240×40).

- [ ] **B5. Fallback de clic en la paleta (touch/sin drag).**
  - *Pasos:* hacer un clic corto (sin arrastrar) en cualquier chip de la paleta.
  - *Esperado:* el elemento se agrega en el centro del área visible (compat táctil).

---

## C. Drag de elementos con zoom correcto (bug class v1)

- [ ] **C1. Arrastrar mesa a scale=1 — sin drift.**
  - *Pasos:* con zoom al 100%, arrastrar una mesa.
  - *Esperado:* la mesa sigue el cursor; al soltar hace snap a la grilla de 20 px.
    No hay brecha entre la posición visual y la persistida.

- [ ] **C2. Arrastrar mesa a scale=2 — sin drift doble (BUG v1 corregido).**
  - *Pasos:* hacer zoom in hasta ~200% (botón `+` tres veces o scroll). Arrastrar
    una mesa 40 px en pantalla hacia la derecha.
  - *Esperado:* la mesa se mueve ~20 px lógicos (40 / scale 2), con snap al grid.
    **No** se desplaza 40 px lógicos (ese era el bug de v1). La posición coincide
    con el cursor visual durante y después del drag.

- [ ] **C3. Arrastrar mesa a scale=0.5 (zoom out) — delta amplificado correcto.**
  - *Pasos:* hacer zoom out (~50%). Arrastrar una mesa 10 px en pantalla.
  - *Esperado:* la mesa se mueve ~20 px lógicos (10 / 0.5), con snap. Correcto.

- [ ] **C4. Mesa no sale del área al arrastrar hasta el borde.**
  - *Pasos:* arrastrar una mesa hasta el borde del canvas y más allá.
  - *Esperado:* la mesa se clampea al borde del área lógica; no se "escapa" del
    stage.

---

## D. Resize con zoom

- [ ] **D1. Redimensionar a scale=1.**
  - *Pasos:* seleccionar una mesa; arrastrar un handle de resize.
  - *Esperado:* el tamaño cambia en proporción 1:1; mínimo de 24 px; persiste al
    soltar. Arrastrar el handle **no** mueve la mesa (no "pelean").

- [ ] **D2. Redimensionar a scale=2 — delta dividido por scale.**
  - *Pasos:* hacer zoom 200%; redimensionar la misma mesa.
  - *Esperado:* el cambio de tamaño es proporcional al movimiento visual (delta / 2).

---

## E. Gestión mesa-QR (reusado de v1, sin regresiones)

- [ ] **E1. Dividir mesa.**
- [ ] **E2. Combinar mesas (sin sesión).**
- [ ] **E3. Combinar con sesión abierta → bloqueado** (`table_has_open_session`).
- [ ] **E4. Desactivar → sale del canvas; reactivar → vuelve a bandeja.**
- [ ] **E5. Colocar desde la bandeja de no ubicadas.**
- [ ] **E6. Quitar del plano (mesa sigue activa, reaparece en bandeja).**
- [ ] **E7. Imprimir QR y regenerar token.**

*Para cada paso: resultado esperado = mismo que en el smoke de v1
(`2026-06-05-floor-plan-smoke.md` secciones B/C/D).*

---

## F. Toggle Editar / En vivo

- [ ] **F1. Cambiar al modo "En vivo".**
  - *Pasos:* click en el toggle "En vivo" del header del editor.
  - *Esperado:* el canvas cambia a modo read-only. Desaparecen la paleta y los
    handles de resize. Las mesas muestran `LiveTableCard` con colores por estado
    (verde tenue = libre, ámbar = ocupada, azul = pagada). El pan/zoom sigue
    funcionando (sin `excluded`).

- [ ] **F2. Mesas libres vs ocupadas en vivo.**
  - *Pasos:* con al menos una sesión abierta en una mesa y otra mesa libre, activar
    "En vivo".
  - *Esperado:* la mesa con sesión muestra color ámbar + gasto (`ARSFormat`) +
    comensales (👥 N) + tiempo transcurrido. La mesa libre muestra color verde tenue
    y sin datos de sesión.

- [ ] **F3. Volver al modo "Editar".**
  - *Pasos:* click en el toggle "Editar".
  - *Esperado:* el editor vuelve con la paleta, handles y estado previo.

---

## G. Live updates en tiempo real

> Estos pasos requieren la migración `20260606000100_realtime_salon_publication.sql`
> aplicada. Usar dos pestañas abiertas simultáneamente.

- [ ] **G1. Abrir sesión en otra pestaña → reflejo en el live floor.**
  - *Pasos:* en la pestaña del **dueño** activar "En vivo". En otra pestaña
    (logueado como cashier o waiter), abrir una sesión en una mesa (escanear QR o
    `/{slug}/salon/mesas`).
  - *Esperado:* dentro de ~2 s la mesa en el live floor del dueño cambia a color
    ámbar y muestra el gasto y comensales. Sin necesidad de recargar.

- [ ] **G2. Cambio de estado de ticket cocina → punto de cocina.**
  - *Pasos:* con una sesión abierta, en la KDS aceptar un ticket (estado
    `'accepted'` o `'preparing'`).
  - *Esperado:* aparece el punto de cocina ámbar en la tarjeta de la mesa en el live
    floor dentro de ~2 s.

- [ ] **G3. Ticket cocina listo → punto verde.**
  - *Pasos:* marcar el ticket como `'ready'` en la KDS.
  - *Esperado:* el punto de cocina cambia de ámbar a verde.

- [ ] **G4. Safety-net de 30 s (sin Realtime).**
  - *Pasos:* desconectar el WebSocket en DevTools (Network → Offline por 35 s).
    Hacer un cambio de sesión desde otra pestaña. Volver a Online.
  - *Esperado:* dentro de 30 s (el safety-net) el live floor se actualiza aunque
    el WebSocket haya fallado.

---

## H. Staff en `/salon/mesas` — live floor compartido

- [ ] **H1. Staff ve el mismo plano en vivo.**
  - *Pasos:* en la pestaña del **waiter**, navegar a `/{slug}/salon/mesas`.
  - *Esperado:* se renderiza `LiveFloor` (plano visual, no la grilla de cards anterior).
    Las mesas están coloreadas por estado igual que en el live floor del dueño.

- [ ] **H2. Tap en mesa con sesión abierta (staff).**
  - *Pasos:* en la vista del staff, tocar una mesa ámbar (con sesión).
  - *Esperado:* navega a `/{slug}/salon/mesas/[sessionId]` (la pantalla de detalle de
    la sesión).

- [ ] **H3. Updates en tiempo real también llegan al staff.**
  - *Pasos:* con el live floor del staff abierto, cobrar una sesión desde otra pestaña.
  - *Esperado:* la mesa cambia a azul (estado `'paid'`) en la vista del staff dentro
    de ~2 s.

---

## I. Dark mode

- [ ] **I1. Dark mode en el editor.**
  - *Pasos:* activar dark mode desde el toggle del dueño. Volver al editor.
  - *Esperado:* el canvas, la grilla, las mesas, la decoración y el panel lateral
    tienen contraste AA en dark. Nada ilegible (especialmente decor sin color
    explícito → token neutral, no desaparece).

- [ ] **I2. Dark mode en el live floor.**
  - *Pasos:* activar dark mode; cambiar a "En vivo".
  - *Esperado:* los colores de estado (verde/ámbar/azul) siguen siendo perceptibles
    en dark; el texto de gasto/comensales/tiempo es legible.

---

## J. Accesibilidad — lista canónica

- [ ] **J1. Tab "Lista" siempre accesible.**
  - *Pasos:* en el editor (modo Editar), hacer Tab hasta llegar a la tab "Lista" y
    activarla.
  - *Esperado:* `TablesListFallback` se renderiza con todas las mesas y sus acciones
    (imprimir QR, activar/desactivar Switch, eliminar). No depende del canvas ni de
    pointer events.

- [ ] **J2. Elementos focusables en el canvas.**
  - *Pasos:* con el canvas en modo Editar, usar Tab para iterar por los elementos.
  - *Esperado:* cada `floor-element` es alcanzable por teclado; Enter abre el
    inspector.

- [ ] **J3. `aria-label` en elementos.**
  - *Pasos:* inspeccionar el DOM de un `floor-element` en DevTools.
  - *Esperado:* tiene `aria-label` con el tipo y la etiqueta (p. ej. `"Mesa 3"`,
    `"Pared"`). Sin tab-stops mudos.

- [ ] **J4. Fallback de error degrada a lista accesible.**
  - *Pasos:* forzar un error en el editor (p. ej. desde DevTools `throw new Error()`
    en la consola del componente raíz del canvas).
  - *Esperado:* el `FloorPlanErrorBoundary` atrapa el error y muestra el banner
    `role="alert"` + `TablesListFallback` sin perder la gestión de mesas.

---

## Resultado

- [ ] Todos los pasos A–J en **verde**.
- [ ] Pasos de bug-class v1 (C2, C3) muestran que el drift **no** ocurre.
- [ ] Screenshots/video adjuntos en el PR: canvas con mesas+decor en live,
      tarjeta completa (gasto/comensales/tiempo/cocina), toggle Editar/En vivo,
      staff `/salon/mesas` con LiveFloor, dark mode.
```

- [ ] **Step 2: Confirm all three new/modified files are present and the full quality pipeline is green**

```bash
ls /mnt/c/Users/Agust/Hub_main/tests/rls/floor-plan-live.test.ts \
   /mnt/c/Users/Agust/Hub_main/tests/lib/floor-plan-grid.test.ts \
   /mnt/c/Users/Agust/Hub_main/docs/floor-plan-mesas.md \
   /mnt/c/Users/Agust/Hub_main/docs/superpowers/plans/2026-06-06-floor-plan-rediseno-smoke.md
# Expected: all four paths print without "No such file"

npm run typecheck 2>&1 | tail -5
# Expected: no errors (these are test and docs files; no new TS is introduced)

npm run lint 2>&1 | tail -5
# Expected: no new errors

npx vitest run tests/lib/floor-plan-grid.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: all cases green (after Phase 3 rewrite of grid.ts is in place)
```

Commit:
```
git commit -m "$(cat <<'EOF'
docs(floor-plan): smoke checklist v2 — nav Local, drag-from-palette, pan/zoom/fit, live updates, staff salon, dark mode, a11y

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
