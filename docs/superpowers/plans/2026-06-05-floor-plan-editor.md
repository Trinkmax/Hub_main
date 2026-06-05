# Floor Plan Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la pantalla de mesas del dueño (`(manager)/[tenantSlug]/configuracion/mesas`) en un editor visual de plano: arrastrar/redimensionar mesas y decoración (paredes/columnas/islas/barra) sobre áreas configurables por tenant, con gestión mesa-QR (crear/dividir/combinar-soft/activar) desde un panel lateral.

**Architecture:** Dos tablas nuevas (`floor_plan_areas`, `floor_plan_elements`) con RLS owner-write + triggers de integridad; RPCs `fp_*` SECURITY DEFINER con guarda de sesión abierta atómica; queries server-only + Server Actions (auditadas en TS con `logAudit`); UI cliente con dnd-kit v6 (modifiers custom, sin `@dnd-kit/modifiers`) sobre un DOM de 3 capas (viewport / stage escalado / elementos posicionados en px lógicos).

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), React 19, TypeScript estricto, Supabase Postgres (RLS, RPC SECURITY DEFINER), `@dnd-kit/core ^6.3.1` + `@dnd-kit/sortable ^10` + `@dnd-kit/utilities ^3.2.2` (NO `@dnd-kit/modifiers`), Tailwind v4 + shadcn new-york, zod, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-06-05-floor-plan-editor-design.md` (leerlo entero antes de empezar).

**Migraciones vía Supabase MCP `apply_migration`** (proyecto `ogplsevtrclzxvyejlns`; no hay Docker local). Tras cada migración: `npm run db:types`.

---

## File Structure

**Migraciones (SQL):**
- `supabase/migrations/20260605000100_floor_plan_editor.sql` — enums, tablas, triggers de integridad + updated_at, RLS, GRANTs, seed HUB.
- `supabase/migrations/20260605000200_floor_plan_rpcs.sql` — RPCs `fp_create_table`, `fp_merge_tables`, `fp_set_table_active`, `fp_delete_table`, `fp_delete_area`.

**Lógica (`lib/floor-plan/`):**
- `numbering.ts` — `suggestNextLabel` (puro).
- `grid.ts` — `snapToGrid`, `clampToArea`, `createSnapModifier`, `restrictToParent`, constantes `GRID`/`RESIZE_MIN`/`ELEMENT_DEFAULTS` (puro + modifiers v6).
- `schemas.ts` — zod de todos los inputs.
- `queries.ts` — `getFloorPlan` (`server-only`).
- `actions.ts` — Server Actions (`'use server'`).
- `errors.ts` — mapa de errores Postgres → mensajes es-AR (`mapPgError`).

**Lógica (`lib/tables/`) — modificada:**
- `schemas.ts` — quitar `active` de `updateTableSchema`.
- `actions.ts` — `updateTable` deja de tocar `active`.

**UI (`app/(manager)/[tenantSlug]/configuracion/mesas/`):**
- `page.tsx` — RSC reescrita (carga `getFloorPlan`, empty-state zero-área, ErrorBoundary→fallback).
- `_components/floor-plan-editor.tsx` — orquestador cliente (estado, DndContext, layout).
- `_components/floor-canvas.tsx` — viewport+stage (3 capas), grilla, zoom/pan.
- `_components/floor-element.tsx` — div arrastrable (activator en el body).
- `_components/resize-handles.tsx` — handles de resize propios.
- `_components/element-palette.tsx` — botonera "agregar".
- `_components/table-inspector.tsx` — panel de mesa.
- `_components/decor-inspector.tsx` — panel de decoración.
- `_components/area-manager.tsx` — CRUD de áreas.
- `_components/unplaced-tray.tsx` — bandeja de no ubicadas.
- `_components/tables-list-fallback.tsx` — lista accesible (fallback canónico).
- `_components/use-geometry-queue.ts` — hook de cola de persistencia (debounce + rollback).
- `_components/print-qr-button.tsx` — **se conserva** (sin cambios).
- `_components/{tables-list,new-table-dialog,edit-table-dialog}.tsx` — **se eliminan**.

**Tests:**
- `tests/lib/floor-plan-numbering.test.ts`, `tests/lib/floor-plan-grid.test.ts`, `tests/lib/floor-plan-schemas.test.ts` (Vitest, node).
- `tests/rls/floor-plan.test.ts` (integración contra Supabase local en CI).

**Docs:**
- `docs/floor-plan-mesas.md` — README de la feature.
- `docs/superpowers/plans/2026-06-05-floor-plan-smoke.md` — checklist de smoke manual.

---

## Contracts (fuente única de verdad — toda tarea se ata a esto)

> Las firmas de abajo son normativas. Si una tarea necesita algo no listado, primero agregalo acá.

### Migración A — DDL (exacto del spec §4.1/§4.2/§4.3/§4.4/§4.5)
`floor_plan_areas(id, tenant_id, name(1-40), position default 0, width default 1200 [200-6000], height default 800 [200-6000], number_start default 1 [0-100000], created_at, updated_at)`. Índices: `floor_plan_areas_tenant_name_uidx` UNIQUE `(tenant_id, lower(trim(name)))`, `floor_plan_areas_tenant_pos_idx (tenant_id, position)`.

`floor_plan_elements(id, tenant_id, area_id→areas on delete cascade, kind floor_element_kind, shape floor_element_shape default 'rect', physical_table_id→physical_tables on delete cascade nullable, x[-10000..10000] default 0, y[-10000..10000] default 0, width[8-6000] default 80, height[8-6000] default 80, rotation default 0, z_index default 0, label(<=40) nullable, color(`^#[0-9a-fA-F]{6}$`) nullable, created_at, updated_at)`. CHECK `fpe_table_has_pt`: `kind='table' ⇔ physical_table_id not null`. Índices: `floor_plan_elements_pt_uidx` UNIQUE `(physical_table_id) where physical_table_id is not null`, `_area_idx (area_id)`, `_tenant_idx (tenant_id)`.

Enums: `floor_element_kind = ('table','wall','pillar','island','bar')`, `floor_element_shape = ('rect','circle')` — creados con guarda `do $$ if not exists (pg_type) then create type … end if; end $$`.

Trigger `fp_elements_integrity()` (BEFORE INSERT/UPDATE, `security definer set search_path=''`): valida `element.tenant_id = area.tenant_id`; si `kind='table'` valida `= physical_table.tenant_id` y `physical_table.active is true`. Raises: `fp_tenant_mismatch_area`/`fp_tenant_mismatch_table` (`42501`), `fp_table_inactive` (`P0001`). + triggers `set_updated_at` en ambas tablas.

RLS: `fpa_select_member`/`fpe_select_member` (SELECT `tenant_id in (select public.user_tenant_ids())`); `*_owner_insert/update/delete` (`public.user_role_in_tenant(tenant_id)='owner'`). GRANTs `select,insert,update,delete … to authenticated`.

Seed HUB (idempotente): `Planta Baja` (pos 0, number_start 1) + `Planta Alta` (pos 1, number_start 101) `on conflict (tenant_id, lower(trim(name))) do nothing` — solo si existe tenant slug `hub`.

### Migración B — RPCs (todas `language plpgsql security definer set search_path=''`, identificadores schema-qualified, owner check, `revoke all on function … from public; grant execute … to authenticated;`). Devuelven `jsonb`.
- `public.fp_create_table(p_area_id uuid, p_label text, p_capacity int, p_shape public.floor_element_shape, p_x int, p_y int)` → `{table_id, element_id, qr_token}`. Resuelve `v_tenant` desde el área; owner check sobre `v_tenant`; inserta `public.physical_tables(tenant_id,label,capacity)` (qr_token por default) y luego `public.floor_plan_elements(tenant_id,area_id,kind='table',shape,physical_table_id,x,y,z_index=10, width/height = defaults de 'table')`.
- `public.fp_merge_tables(p_survivor_table_id uuid, p_absorbed_table_id uuid)` → `{ok:true}`. Owner check; `select … from public.physical_tables where id=p_absorbed_table_id for update`; mismo-tenant que survivor (si no `cross_tenant_merge` P0001); si `exists(select 1 from public.table_sessions where physical_table_id=p_absorbed_table_id and status='open')` → `raise 'table_has_open_session' P0001`; `update physical_tables set active=false where id=p_absorbed_table_id`; `delete from public.floor_plan_elements where physical_table_id=p_absorbed_table_id`.
- `public.fp_set_table_active(p_table_id uuid, p_active boolean)` → `{ok:true}`. Owner check. Si `p_active=false`: `for update` + guarda `table_has_open_session` + `active=false` + `delete floor_plan_elements where physical_table_id=p_table_id`. Si `true`: `active=true` (su elemento ya no existe; vuelve a la bandeja).
- `public.fp_delete_table(p_table_id uuid)` → `{ok:true}`. Owner check; si `exists(table_sessions where physical_table_id=p_table_id)` → `raise 'table_has_history' P0001`; `delete from public.physical_tables where id=p_table_id` (elemento cae por cascade).
- `public.fp_delete_area(p_area_id uuid)` → `{ok:true}`. Owner check; si `exists(floor_plan_elements e join physical_tables pt on pt.id=e.physical_table_id where e.area_id=p_area_id and pt.active)` → `raise 'area_has_active_tables' P0001`; si `(select count(*) from public.floor_plan_areas where tenant_id=v_tenant) <= 1` → `raise 'cannot_delete_last_area' P0001`; `delete from public.floor_plan_areas where id=p_area_id` (elementos caen por cascade).

### `lib/floor-plan/numbering.ts`
```ts
export function suggestNextLabel(numberStart: number, existingLabels: string[]): string
// Devuelve String(n) del menor entero n >= numberStart tal que String(n) no esté en existingLabels.
```

### `lib/floor-plan/grid.ts`
```ts
import type { Modifier } from '@dnd-kit/core'
export const GRID = 20
export const RESIZE_MIN = 24
export const ELEMENT_DEFAULTS: Record<'table'|'wall'|'pillar'|'island'|'bar', { shape: 'rect'|'circle'; width: number; height: number }> = {
  table:  { shape: 'rect',   width: 80,  height: 80 },
  wall:   { shape: 'rect',   width: 200, height: 16 },
  pillar: { shape: 'circle', width: 40,  height: 40 },
  island: { shape: 'rect',   width: 120, height: 80 },
  bar:    { shape: 'rect',   width: 240, height: 40 },
}
export function snapToGrid(value: number, grid?: number): number      // Math.round(value/(grid??GRID))*(grid??GRID)
export function clampToArea(x: number, y: number, w: number, h: number, areaW: number, areaH: number): { x: number; y: number }
export function createSnapModifier(grid: number, getScale: () => number): Modifier   // snap en espacio lógico: x = round(t.x/scale/grid)*grid*scale; return {...transform, x, y}
export function restrictToParent(getScale: () => number): Modifier                   // clamp en espacio lógico (containerNodeRect/draggingNodeRect / scale); return {...transform, x, y}
```

### `lib/floor-plan/queries.ts` (`import 'server-only'`)
```ts
export type AreaRow = { id: string; name: string; position: number; width: number; height: number; number_start: number }
export type FloorTableMeta = { label: string; capacity: number | null; qr_token: string; active: boolean }
export type ElementRow = {
  id: string; area_id: string
  kind: 'table'|'wall'|'pillar'|'island'|'bar'; shape: 'rect'|'circle'
  physical_table_id: string | null
  x: number; y: number; width: number; height: number; rotation: number; z_index: number
  label: string | null; color: string | null
  table: FloorTableMeta | null   // poblado solo si kind='table'
}
export type UnplacedTable = { id: string; label: string; capacity: number | null; qr_token: string }
export type FloorPlanData = { areas: AreaRow[]; elements: ElementRow[]; unplacedTables: UnplacedTable[] }
export async function getFloorPlan(tenantId: string): Promise<FloorPlanData>
// areas: order by position, created_at, id
// elements: order by z_index, created_at, id; join a physical_tables para FloorTableMeta cuando kind='table'
// unplacedTables: physical_tables activas del tenant sin fila en floor_plan_elements (anti-join por physical_table_id)
```

### `lib/floor-plan/schemas.ts` (zod)
```ts
import { z } from 'zod'
export const KIND = z.enum(['table','wall','pillar','island','bar'])
export const SHAPE = z.enum(['rect','circle'])
export const areaCreateSchema   = z.object({ name: z.string().trim().min(1).max(40), number_start: z.coerce.number().int().min(0).max(100000).default(1) })
export const areaRenameSchema   = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(40) })
export const areaCanvasSchema   = z.object({ id: z.string().uuid(), width: z.coerce.number().int().min(200).max(6000), height: z.coerce.number().int().min(200).max(6000), number_start: z.coerce.number().int().min(0).max(100000) })
export const areaReorderSchema  = z.object({ ids: z.array(z.string().uuid()).min(1) })
export const elementGeometrySchema = z.object({ id: z.string().uuid(), x: z.number().int().min(-10000).max(10000), y: z.number().int().min(-10000).max(10000), width: z.number().int().min(8).max(6000), height: z.number().int().min(8).max(6000), z_index: z.number().int() })
export const geometryBatchSchema   = z.object({ items: z.array(elementGeometrySchema).min(1).max(500) })
export const createTableInPlanSchema = z.object({ area_id: z.string().uuid(), label: z.string().trim().min(1).max(40), capacity: z.coerce.number().int().min(1).max(50).nullable(), shape: SHAPE.default('rect'), x: z.number().int(), y: z.number().int() })
export const placeTableSchema   = z.object({ table_id: z.string().uuid(), area_id: z.string().uuid(), x: z.number().int(), y: z.number().int() })
export const splitTableSchema   = z.object({ source_element_id: z.string().uuid() })
export const mergeTablesSchema  = z.object({ survivor_table_id: z.string().uuid(), absorbed_table_id: z.string().uuid() })
export const setTableActiveSchema = z.object({ table_id: z.string().uuid(), active: z.boolean() })
export const addDecorSchema     = z.object({ area_id: z.string().uuid(), kind: z.enum(['wall','pillar','island','bar']), shape: SHAPE, x: z.number().int(), y: z.number().int(), width: z.number().int().min(8).max(6000), height: z.number().int().min(8).max(6000), label: z.string().max(40).nullable().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() })
export const updateDecorSchema  = z.object({ id: z.string().uuid(), label: z.string().max(40).nullable().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() })
export const elementIdSchema    = z.object({ id: z.string().uuid() })
export const setZIndexSchema    = z.object({ id: z.string().uuid(), z_index: z.number().int() })
export type CreateTableInPlanInput = z.infer<typeof createTableInPlanSchema>
export type ElementGeometry = z.infer<typeof elementGeometrySchema>
export type AddDecorInput = z.infer<typeof addDecorSchema>
```

### `lib/floor-plan/errors.ts`
```ts
export const PG_ERROR_MESSAGES: Record<string, string> = {
  table_has_open_session: 'La mesa tiene una sesión abierta. Cerrá o cobrá la sesión antes de continuar.',
  table_has_history:      'La mesa tiene historial. Desactivala en vez de borrarla.',
  area_has_active_tables: 'El área tiene mesas activas. Movélas o desactivalas antes de borrar el área.',
  cannot_delete_last_area:'No podés borrar la única área. Creá otra antes.',
  cross_tenant_merge:     'No se pueden combinar mesas de locales distintos.',
  fp_table_inactive:      'La mesa está inactiva.',
  owner_required:         'No tenés permiso para esta acción.',
}
export function mapPgError(error: { message?: string } | null | undefined): string
// Busca cada key de PG_ERROR_MESSAGES dentro de error?.message; devuelve el mensaje mapeado o un genérico.
// Para violación de unique de elemento (physical_table ya ubicada): si el message incluye 'floor_plan_elements_pt_uidx' → 'La mesa ya está ubicada en el plano.'
```

### `lib/floor-plan/actions.ts` (`'use server'`)
Patrón de cada action: `requireTenantAccess(slug)` → `requireRole(role, ['owner'])` → zod parse → `supabase.rpc(...)`/write → en éxito `logAudit({...})` + `revalidatePath('/${slug}/configuracion/mesas')`. Errores Postgres → `mapPgError`.
```ts
export type FloorPlanActionState = { ok: true; data?: unknown } | { ok: false; message: string; fieldErrors?: Record<string, string> }
export async function createAreaAction(slug: string, input: { name: string; number_start?: number }): Promise<FloorPlanActionState>
export async function renameAreaAction(slug: string, input: { id: string; name: string }): Promise<FloorPlanActionState>
export async function updateAreaCanvasAction(slug: string, input: { id: string; width: number; height: number; number_start: number }): Promise<FloorPlanActionState>
export async function reorderAreasAction(slug: string, ids: string[]): Promise<FloorPlanActionState>
export async function deleteAreaAction(slug: string, areaId: string): Promise<FloorPlanActionState>           // rpc fp_delete_area
export async function saveGeometryAction(slug: string, items: ElementGeometry[]): Promise<FloorPlanActionState> // update batch floor_plan_elements (solo x,y,width,height,z_index)
export async function createTableInPlanAction(slug: string, input: CreateTableInPlanInput): Promise<{ ok: true; tableId: string; elementId: string; qrToken: string } | { ok: false; message: string; fieldErrors?: Record<string,string> }> // rpc fp_create_table
export async function splitTableAction(slug: string, sourceElementId: string): Promise<FloorPlanActionState>  // lee source, calcula offset+label, rpc fp_create_table
export async function placeTableAction(slug: string, input: { table_id: string; area_id: string; x: number; y: number }): Promise<FloorPlanActionState> // insert element kind='table'
export async function removeFromPlanAction(slug: string, elementId: string): Promise<FloorPlanActionState>    // delete element (mesa sigue activa)
export async function mergeTablesAction(slug: string, survivorTableId: string, absorbedTableId: string): Promise<FloorPlanActionState> // rpc fp_merge_tables
export async function setTableActiveAction(slug: string, tableId: string, active: boolean): Promise<FloorPlanActionState> // rpc fp_set_table_active
export async function deleteTablePermanentlyAction(slug: string, tableId: string): Promise<FloorPlanActionState> // rpc fp_delete_table
export async function addDecorAction(slug: string, input: AddDecorInput): Promise<FloorPlanActionState>        // insert element decor
export async function updateDecorAction(slug: string, input: { id: string; label?: string|null; color?: string|null }): Promise<FloorPlanActionState>
export async function deleteDecorAction(slug: string, elementId: string): Promise<FloorPlanActionState>
export async function setElementZIndexAction(slug: string, elementId: string, zIndex: number): Promise<FloorPlanActionState>
```
> **`removeFromPlanAction`** es un `delete` simple (no RPC): quitar el elemento visual no afecta la sesión viva (la mesa sigue activa y ordenable por QR). La UI deshabilita "quitar del plano" si la mesa tiene sesión abierta (best-effort UX), sin guarda atómica (no hay riesgo de datos).

### `lib/tables/` (modificaciones)
- `schemas.ts`: `updateTableSchema` pierde el campo `active` → `{ id, label, capacity }`.
- `actions.ts`: `updateTable` deja de leer/escribir `active` (no toca esa columna). Verificar en la tarea que ningún otro caller lo necesite.

### Props de componentes (top-level)
```ts
// floor-plan-editor.tsx ('use client')
type FloorPlanEditorProps = { slug: string; tenantId: string; initial: FloorPlanData }
// floor-canvas.tsx
type FloorCanvasProps = { area: AreaRow; elements: ElementRow[]; scale: number; pan: { x: number; y: number }; selectedId: string | null; onSelectElement: (id: string | null) => void; onResizeEnd: (id: string, geom: { width: number; height: number }) => void }
// floor-element.tsx
type FloorElementProps = { element: ElementRow; selected: boolean; scale: number; onSelect: (id: string) => void; onResizeEnd: (id: string, size: { width: number; height: number }) => void }
// resize-handles.tsx
type ResizeHandlesProps = { width: number; height: number; scale: number; onResize: (size: { width: number; height: number }) => void; onResizeEnd: (size: { width: number; height: number }) => void }
// element-palette.tsx
type ElementPaletteProps = { onAddTable: () => void; onAddDecor: (kind: 'wall'|'pillar'|'island'|'bar') => void }
// table-inspector.tsx
type TableInspectorProps = { slug: string; element: ElementRow; allTables: { id: string; label: string }[]; onChanged: () => void; onClose: () => void }
// decor-inspector.tsx
type DecorInspectorProps = { slug: string; element: ElementRow; onChanged: () => void; onClose: () => void }
// area-manager.tsx
type AreaManagerProps = { slug: string; areas: AreaRow[]; activeAreaId: string; onActiveAreaChange: (id: string) => void; onChanged: () => void }
// unplaced-tray.tsx
type UnplacedTrayProps = { tables: UnplacedTable[]; onPlace: (tableId: string) => void }
// tables-list-fallback.tsx
type TablesListFallbackProps = { slug: string; tables: { id: string; label: string; capacity: number|null; qr_token: string; active: boolean }[] }
// use-geometry-queue.ts
type GeometryQueue = { enqueue: (geom: ElementGeometry) => void; flushNow: () => Promise<void> }
function useGeometryQueue(slug: string, onError: (ids: string[]) => void): GeometryQueue
```

### Adiciones de contrato (consolidadas tras el authoring)

Surgieron al escribir las fases; cada una está documentada también al inicio de su fase. Son normativas:

- **Tipos**: regenerar `types/database.ts` con el tool **MCP `mcp__supabase__generate_typescript_types`** (`project_id` `ogplsevtrclzxvyejlns`), **no** `npm run db:types` (usa `--local`/Docker, no disponible). [Phase 1]
- **`lib/floor-plan/errors.ts`**: el genérico de `mapPgError` es exactamente `'No se pudo completar la acción. Probá de nuevo.'`. [Phase 4]
- **`lib/floor-plan/actions.ts`**: helpers privados `authorize(slug)` (envuelve `requireTenantAccess` + `requireRole(['owner'])` + `getUser`) y `flattenIssues(error)` (poblar `fieldErrors` desde un `ZodError`), espejo de `lib/tables/actions.ts`. `logAudit` usa `entity ∈ {floor_plan_area, floor_plan_element, physical_table}` y `action` libre (`create/rename/update/reorder/delete/split/merge/deactivate/reactivate/delete_permanent/place/remove_from_plan`). [Phase 5]
- **`_components/unplaced-tray.tsx`** exporta `export const TRAY_DRAG_PREFIX = 'tray:'`; los chips son `useDraggable({ id: TRAY_DRAG_PREFIX + tableId })`. El editor lo importa para distinguir, en `onDragEnd`, un drop de bandeja (`placeTableAction`) de un move de elemento del plano. [Phase 8 ↔ Phase 9]
- **`lib/floor-plan/a11y.ts`**: `export const floorPlanAnnouncements: Announcements` y `floorPlanScreenReaderInstructions: ScreenReaderInstructions` (es-AR; tipos de `@dnd-kit/core`). [Phase 9]
- **`_components/floor-plan-error-boundary.tsx`**: `class FloorPlanErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }>` (no hay `react-error-boundary` en el repo). [Phase 9]
- **`_components/use-geometry-queue.ts`**: `const GEOMETRY_FLUSH_MS = 600`. [Phase 9]
- **`FloorCanvasProps`** suma tres handlers opcionales: `onZoomIn?: () => void; onZoomOut?: () => void; onFit?: () => void`. [Phase 9]
- **`_components/create-table-dialog.tsx`**: `type CreateTableDialogProps = { slug: string; areaId: string; areaNumberStart: number; existingLabels: string[]; centerX: number; centerY: number; open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }`. La forma se elige con `Select` (no hay `radio-group` en el repo). [Phase 9]
- **`_components/zero-area-cta.tsx`**: `{ slug: string }` — botón que llama `createAreaAction(slug, { name: 'Salón' })`. [Phase 9]

---

## Tasks

> **Orden de ejecución = orden del documento**: Fases **1 → 2 → 3 → 4 → 5 → 7 → 8 → 9 → 10**. No hay "Fase 6": la integración frontend (page, editor, canvas, cola, a11y, fallback, borrado de la UI vieja) quedó **consolidada en la Fase 9** para tener una única fuente de orquestación (las Fases 7 y 8 crean las hojas que la 9 cablea). Cada fase es autocontenida; ejecutalas en este orden.

## Phase 1: Migración A — tablas, enums, triggers, RLS, GRANTs, seed

> **Migraciones vía Supabase MCP `apply_migration`** (proyecto `ogplsevtrclzxvyejlns`; no hay Docker local). Toda DDL va **guardada** (`do $$ … create type if not exists …`, `create table if not exists`, `create index if not exists`, `create or replace function`, `on conflict … do nothing`) para que una re-aplicación sea idempotente. Los `create trigger` de Postgres **no** soportan `if not exists` en esta versión, así que se preceden de `drop trigger if exists …` para que el archivo sea re-aplicable.

### Task 1.1: Escribir la migración A — DDL completo (tablas, enums, trigger de integridad, updated_at, RLS, GRANTs, seed HUB)

**Files:**
- Create: `supabase/migrations/20260605000100_floor_plan_editor.sql`

- [ ] **Step 1: Escribir el archivo de migración completo**

Crear `supabase/migrations/20260605000100_floor_plan_editor.sql` con EXACTAMENTE este contenido. Reproduce los Contracts "Migración A" + spec §4.1–§4.5. Identificadores schema-qualified, enums con guarda, tablas `if not exists`, índices `if not exists`, trigger de integridad `security definer set search_path = ''`, `set_updated_at` (función existente de `20260504010000_phase1_multitenant.sql`), RLS `fpa_*`/`fpe_*` (helpers `public.user_tenant_ids()` y `public.user_role_in_tenant(uuid)`, ya existentes), GRANTs a `authenticated`, y seed HUB idempotente solo si existe el tenant slug `hub`.

```sql
-- ============================================================
-- Floor plan editor — Migración A (DDL)
-- ============================================================
-- Editor visual de plano de mesas para el dueño (manager).
-- Dos tablas nuevas:
--   - floor_plan_areas:    áreas/pisos configurables por tenant.
--   - floor_plan_elements: mesas + decoración posicionadas en el canvas.
-- physical_tables queda INTACTO (no se le agregan columnas).
--
-- Idempotente bajo Supabase MCP apply_migration (sin Docker local):
--   * enums con guarda do $$ if not exists (pg_type) ... end $$
--   * create table / index if not exists
--   * create or replace function para el trigger de integridad
--   * drop trigger if exists antes de cada create trigger (Postgres no
--     soporta create trigger if not exists en esta versión)
--   * seed con on conflict (tenant_id, lower(trim(name))) do nothing
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Enums (guardados)
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'floor_element_kind') then
    create type public.floor_element_kind  as enum ('table', 'wall', 'pillar', 'island', 'bar');
  end if;
  if not exists (select 1 from pg_type where typname = 'floor_element_shape') then
    create type public.floor_element_shape as enum ('rect', 'circle');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. floor_plan_areas — áreas/pisos configurables
-- ──────────────────────────────────────────────────────────
create table if not exists public.floor_plan_areas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 40),
  position      int  not null default 0,
  width         int  not null default 1200 check (width  between 200 and 6000),
  height        int  not null default 800  check (height between 200 and 6000),
  number_start  int  not null default 1 check (number_start between 0 and 100000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- unicidad por tenant (backing del on conflict del seed; evita áreas duplicadas)
create unique index if not exists floor_plan_areas_tenant_name_uidx
  on public.floor_plan_areas (tenant_id, lower(trim(name)));
create index if not exists floor_plan_areas_tenant_pos_idx
  on public.floor_plan_areas (tenant_id, position);

-- ──────────────────────────────────────────────────────────
-- 3. floor_plan_elements — todo lo que vive en el canvas
-- ──────────────────────────────────────────────────────────
create table if not exists public.floor_plan_elements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  area_id           uuid not null references public.floor_plan_areas(id) on delete cascade,
  kind              public.floor_element_kind  not null,
  shape             public.floor_element_shape not null default 'rect',
  physical_table_id uuid references public.physical_tables(id) on delete cascade, -- solo kind='table'
  x                 int  not null default 0   check (x between -10000 and 10000),
  y                 int  not null default 0   check (y between -10000 and 10000),
  width             int  not null default 80  check (width  between 8 and 6000),
  height            int  not null default 80  check (height between 8 and 6000),
  rotation          int  not null default 0,   -- reservado v2; siempre 0 en v1
  z_index           int  not null default 0,
  label             text check (label is null or length(label) <= 40),
  color             text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),  -- 6 dígitos
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fpe_table_has_pt check (
    (kind = 'table' and physical_table_id is not null) or
    (kind <> 'table' and physical_table_id is null)
  )
);

-- 1 mesa ⇒ a lo sumo 1 elemento (backing del anti-join de la bandeja)
create unique index if not exists floor_plan_elements_pt_uidx
  on public.floor_plan_elements (physical_table_id)
  where physical_table_id is not null;
create index if not exists floor_plan_elements_area_idx
  on public.floor_plan_elements (area_id);
create index if not exists floor_plan_elements_tenant_idx
  on public.floor_plan_elements (tenant_id);

-- ──────────────────────────────────────────────────────────
-- 4. Trigger de integridad (BEFORE INSERT/UPDATE)
-- ──────────────────────────────────────────────────────────
-- Valida tenant_id consistente entre elemento, área y (si mesa) physical_table,
-- y que la mesa referenciada esté activa. RLS solo verifica que el caller sea
-- owner de element.tenant_id; este trigger cierra cross-tenant y mesa-inactiva.
-- security definer + search_path = '' (LEY §6.1); identificadores schema-qualified.
create or replace function public.fp_elements_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_area_tenant uuid;
  v_pt_tenant   uuid;
  v_pt_active   boolean;
begin
  select tenant_id into v_area_tenant
    from public.floor_plan_areas where id = new.area_id;
  if v_area_tenant is null or v_area_tenant <> new.tenant_id then
    raise exception 'fp_tenant_mismatch_area' using errcode = '42501';
  end if;

  if new.kind = 'table' then
    select tenant_id, active into v_pt_tenant, v_pt_active
      from public.physical_tables where id = new.physical_table_id;
    if v_pt_tenant is null or v_pt_tenant <> new.tenant_id then
      raise exception 'fp_tenant_mismatch_table' using errcode = '42501';
    end if;
    if v_pt_active is not true then
      raise exception 'fp_table_inactive' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists fp_elements_integrity_biu on public.floor_plan_elements;
create trigger fp_elements_integrity_biu
  before insert or update on public.floor_plan_elements
  for each row execute function public.fp_elements_integrity();

-- updated_at en ambas tablas (función public.set_updated_at() existente)
drop trigger if exists floor_plan_areas_updated_at on public.floor_plan_areas;
create trigger floor_plan_areas_updated_at
  before update on public.floor_plan_areas
  for each row execute function public.set_updated_at();

drop trigger if exists floor_plan_elements_updated_at on public.floor_plan_elements;
create trigger floor_plan_elements_updated_at
  before update on public.floor_plan_elements
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 5. RLS + GRANTs
-- ──────────────────────────────────────────────────────────
alter table public.floor_plan_areas    enable row level security;
alter table public.floor_plan_elements enable row level security;

-- SELECT: cualquier miembro del tenant (la vista operativa de entrega 2 lo
-- consume; en v1 el editor es owner-only por guarda de ruta/acción).
drop policy if exists "fpa_select_member" on public.floor_plan_areas;
create policy "fpa_select_member" on public.floor_plan_areas
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

drop policy if exists "fpe_select_member" on public.floor_plan_elements;
create policy "fpe_select_member" on public.floor_plan_elements
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE: solo owner (idéntico a pt_owner_*).
drop policy if exists "fpa_owner_insert" on public.floor_plan_areas;
create policy "fpa_owner_insert" on public.floor_plan_areas
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpa_owner_update" on public.floor_plan_areas;
create policy "fpa_owner_update" on public.floor_plan_areas
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpa_owner_delete" on public.floor_plan_areas;
create policy "fpa_owner_delete" on public.floor_plan_areas
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpe_owner_insert" on public.floor_plan_elements;
create policy "fpe_owner_insert" on public.floor_plan_elements
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpe_owner_update" on public.floor_plan_elements;
create policy "fpe_owner_update" on public.floor_plan_elements
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

drop policy if exists "fpe_owner_delete" on public.floor_plan_elements;
create policy "fpe_owner_delete" on public.floor_plan_elements
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- LEY §5: sin GRANT, las tablas son invisibles para supabase-js. RLS sigue
-- siendo la única defensa de filas. Sin grant a anon (el editor es owner-only).
grant select, insert, update, delete on public.floor_plan_areas    to authenticated;
grant select, insert, update, delete on public.floor_plan_elements to authenticated;

-- ──────────────────────────────────────────────────────────
-- 6. Seed HUB (idempotente, solo-HUB — conveniencia demo)
-- ──────────────────────────────────────────────────────────
-- Todo tenant nuevo no-HUB arranca SIN áreas → empty-state + CTA crear primera.
do $seed$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'hub';
  if v_tenant is not null then
    insert into public.floor_plan_areas (tenant_id, name, position, number_start)
    values
      (v_tenant, 'Planta Baja', 0, 1),
      (v_tenant, 'Planta Alta', 1, 101)
    on conflict (tenant_id, lower(trim(name))) do nothing;
  end if;
end $seed$;
```

- [ ] **Step 2: Sanidad local del SQL (no aplica todavía)**

Run:
```bash
grep -c "create policy" supabase/migrations/20260605000100_floor_plan_editor.sql
```
Expected: `8` (4 políticas por tabla: select + owner insert/update/delete). Confirma que están las 8 RLS `fpa_*`/`fpe_*`.

- [ ] **Step 3: Commit del archivo de migración**

```bash
git add supabase/migrations/20260605000100_floor_plan_editor.sql
git commit -m "feat(floor-plan): migración A — tablas, enums, trigger de integridad, RLS, GRANTs, seed HUB

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Aplicar la migración vía Supabase MCP y verificar

**Files:**
- (sin cambios de archivos; aplicación remota + verificación)

- [ ] **Step 1: Aplicar la migración con `apply_migration`**

Llamar al tool `mcp__supabase__apply_migration` con:
- `project_id`: `ogplsevtrclzxvyejlns`
- `name`: `floor_plan_editor` (debe coincidir con el slug del archivo `20260605000100_floor_plan_editor.sql`; sin extensión ni timestamp)
- `query`: el contenido COMPLETO del archivo `supabase/migrations/20260605000100_floor_plan_editor.sql` (idéntico al de la Task 1.1, Step 1).

Expected: el tool responde sin error. Si la migración ya estaba aplicada, **re-aplicarla no debe fallar** (todo es `if not exists` / `create or replace` / `drop … if exists` / `on conflict do nothing`).

- [ ] **Step 2: Confirmar que las dos tablas existen con `list_tables`**

Llamar a `mcp__supabase__list_tables` con `project_id`: `ogplsevtrclzxvyejlns`, `schemas`: `["public"]`.

Expected: aparecen `floor_plan_areas` y `floor_plan_elements` en el listado, con RLS habilitada (`rls_enabled: true`) y las columnas del DDL (`floor_plan_elements` incluye `kind`, `shape`, `physical_table_id`, `x`, `y`, `width`, `height`, `rotation`, `z_index`, `label`, `color`).

- [ ] **Step 3: Verificar enums, índice 1:1, constraint y trigger con `execute_sql`**

Llamar a `mcp__supabase__execute_sql` con `project_id`: `ogplsevtrclzxvyejlns` y `query`:
```sql
select
  (select count(*) from pg_type where typname = 'floor_element_kind')  as kind_enum,
  (select count(*) from pg_type where typname = 'floor_element_shape') as shape_enum,
  (select count(*) from pg_indexes
     where schemaname = 'public' and indexname = 'floor_plan_elements_pt_uidx') as pt_uidx,
  (select count(*) from pg_constraint where conname = 'fpe_table_has_pt') as fpe_check,
  (select count(*) from pg_trigger where tgname = 'fp_elements_integrity_biu') as integrity_trg;
```
Expected: una fila con `kind_enum=1, shape_enum=1, pt_uidx=1, fpe_check=1, integrity_trg=1`.

- [ ] **Step 4: Confirmar el seed de las dos áreas de HUB**

Llamar a `mcp__supabase__execute_sql` con `project_id`: `ogplsevtrclzxvyejlns` y `query`:
```sql
select a.name, a.position, a.number_start
  from public.floor_plan_areas a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = 'hub'
  order by a.position;
```
Expected: exactamente 2 filas —
`Planta Baja | 0 | 1` y `Planta Alta | 1 | 101`.

- [ ] **Step 5: Confirmar idempotencia del seed (re-ejecutar el `do $seed$`)**

Llamar a `mcp__supabase__execute_sql` con `project_id`: `ogplsevtrclzxvyejlns` y `query`:
```sql
do $seed$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'hub';
  if v_tenant is not null then
    insert into public.floor_plan_areas (tenant_id, name, position, number_start)
    values (v_tenant, 'Planta Baja', 0, 1), (v_tenant, 'Planta Alta', 1, 101)
    on conflict (tenant_id, lower(trim(name))) do nothing;
  end if;
end $seed$;
select count(*) as hub_areas
  from public.floor_plan_areas a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = 'hub';
```
Expected: `hub_areas = 2` (re-ejecutar el seed NO duplica; el `on conflict … do nothing` lo absorbe).

- [ ] **Step 6: Verificar que no hay advisories de seguridad nuevos con `get_advisors`**

Llamar a `mcp__supabase__get_advisors` con `project_id`: `ogplsevtrclzxvyejlns`, `type`: `security`.

Expected: NO aparecen advisories nuevos para `floor_plan_areas`/`floor_plan_elements` (RLS habilitada en ambas). En particular, **NO** debe aparecer un `function_search_path_mutable` para `public.fp_elements_integrity` — la función ya declara `set search_path = ''`. Si aparece cualquier advisory que mencione estas dos tablas o la función `fp_elements_integrity`, detenerse y corregir la migración antes de continuar.

---

### Task 1.3: Regenerar `types/database.ts` y commitear

**Files:**
- Modify (generado): `types/database.ts`

- [ ] **Step 1: Regenerar los tipos desde el schema remoto (MCP)**

El script `npm run db:types` usa `supabase gen types --local`, que requiere Docker local (no disponible). Para este flujo MCP, generar los tipos con el tool `mcp__supabase__generate_typescript_types` (`project_id`: `ogplsevtrclzxvyejlns`) y escribir el resultado en `types/database.ts` (sobrescribir el archivo completo con el contenido devuelto por el tool).

Expected: el archivo `types/database.ts` cambia. `Database['public']['Tables']` ahora incluye `floor_plan_areas` y `floor_plan_elements`, y `Database['public']['Enums']` incluye `floor_element_kind` (`'table' | 'wall' | 'pillar' | 'island' | 'bar'`) y `floor_element_shape` (`'rect' | 'circle'`).

- [ ] **Step 2: Verificar el shape de los tipos generados**

Run:
```bash
grep -n "floor_plan_areas\|floor_plan_elements\|floor_element_kind\|floor_element_shape" types/database.ts | head -20
```
Expected: matches para ambas tablas (`Row`/`Insert`/`Update`) y ambos enums. `floor_plan_elements.Row` debe mostrar `physical_table_id: string | null`, `color: string | null`, `label: string | null`, `z_index: number`.

- [ ] **Step 3: Typecheck no rompe con los tipos nuevos**

Run:
```bash
npm run typecheck
```
Expected: `tsc --noEmit` termina sin errores (los tipos nuevos son aditivos; ningún consumidor existente se rompe en esta fase).

- [ ] **Step 4: Commit de los tipos regenerados**

```bash
git add types/database.ts
git commit -m "chore(floor-plan): regenerar types/database.ts con floor_plan_areas/elements + enums

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Migración B — RPCs `fp_*`

> Esta fase escribe y aplica la segunda migración del floor plan: las cinco RPCs `fp_*` (`fp_create_table`, `fp_merge_tables`, `fp_set_table_active`, `fp_delete_table`, `fp_delete_area`). Depende de la Migración A (tablas `floor_plan_areas` / `floor_plan_elements`, enums `floor_element_kind` / `floor_element_shape`, trigger de integridad) ya aplicada en la Phase 1. Todas las RPCs siguen la convención de Contracts "Migración B": `language plpgsql security definer set search_path = ''`, identificadores 100% schema-qualified, resolución de `v_tenant` desde la fila, owner check vía `public.user_role_in_tenant` (raise `owner_required` errcode `42501`), guardas de sesión abierta atómicas con `for update` (raise `table_has_open_session` errcode `P0001`) donde el spec lo exige, y cierre con `revoke all on function … from public; grant execute on function … to authenticated;`. Devuelven `jsonb`. Se aplica vía Supabase MCP `apply_migration` (proyecto `ogplsevtrclzxvyejlns`); no hay Docker local.

### Task 2.1: Escribir la migración SQL de las RPCs `fp_*`

**Files:**
- Create: `supabase/migrations/20260605000200_floor_plan_rpcs.sql`

- [ ] **Step 1: Escribir el archivo de migración completo**

Crear `supabase/migrations/20260605000200_floor_plan_rpcs.sql` con EXACTAMENTE este contenido. Las cinco funciones espejan la convención de `regenerate_qr_token` (`20260506100500_plan1_session_rpcs.sql`) y de los RPCs de sesión (`20260506140200_plan5_session_ops.sql`): `v_role text` asignado desde `public.user_role_in_tenant(...)`, owner check con dos `if` (`is null` y `<> 'owner'`), guarda de sesión abierta con `for update` + `exists`, y `revoke/grant` al final de cada función.

```sql
-- ============================================================
-- Floor plan editor — RPCs estructurales fp_*
-- ============================================================
-- Gestión de mesas-QP (physical_tables) y áreas desde el canvas del editor.
-- Convención (espejo de regenerate_qr_token / merge_sessions):
--   * language plpgsql security definer set search_path = ''
--   * identificadores 100% schema-qualified
--   * v_tenant resuelto desde la fila; owner check vía user_role_in_tenant
--     (raise 'owner_required' errcode '42501')
--   * guarda de sesión abierta atómica con FOR UPDATE
--     (raise 'table_has_open_session' errcode 'P0001')
--   * revoke all from public; grant execute to authenticated
-- Los RPC NO escriben audit_log: la auditoría se hace en la capa TS
-- (lib/floor-plan/actions.ts con logAudit) tras el RPC OK.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- fp_create_table
-- ──────────────────────────────────────────────────────────
-- Crea una physical_table (qr_token por default) + su floor_plan_element
-- (kind='table', z=10, width/height = defaults de 'table' = 80x80) en una
-- transacción. Resuelve el tenant desde el área. Owner-only.
-- Devuelve {table_id, element_id, qr_token}.
create or replace function public.fp_create_table(
  p_area_id  uuid,
  p_label    text,
  p_capacity int,
  p_shape    public.floor_element_shape,
  p_x        int,
  p_y        int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant     uuid;
  v_role       text;
  v_clean      text;
  v_table_id   uuid;
  v_element_id uuid;
  v_qr_token   text;
begin
  -- 1. Resolver tenant desde el área
  select tenant_id into v_tenant
    from public.floor_plan_areas
    where id = p_area_id;
  if v_tenant is null then
    raise exception 'area_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check sobre el tenant del área
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Validar label
  v_clean := nullif(trim(coalesce(p_label, '')), '');
  if v_clean is null or length(v_clean) > 40 then
    raise exception 'invalid_label' using errcode = 'P0001';
  end if;

  -- 4. Insertar la mesa (qr_token por default)
  insert into public.physical_tables (tenant_id, label, capacity)
    values (v_tenant, v_clean, p_capacity)
    returning id, qr_token into v_table_id, v_qr_token;

  -- 5. Insertar su elemento en el plano (kind='table', z=10, 80x80)
  --    El trigger fp_elements_integrity valida tenant + mesa activa.
  insert into public.floor_plan_elements (
    tenant_id, area_id, kind, shape, physical_table_id,
    x, y, width, height, z_index
  ) values (
    v_tenant, p_area_id, 'table', p_shape, v_table_id,
    p_x, p_y, 80, 80, 10
  ) returning id into v_element_id;

  return jsonb_build_object(
    'table_id',   v_table_id,
    'element_id', v_element_id,
    'qr_token',   v_qr_token
  );
end $$;

revoke all on function public.fp_create_table(uuid, text, int, public.floor_element_shape, int, int) from public;
grant execute on function public.fp_create_table(uuid, text, int, public.floor_element_shape, int, int) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_merge_tables
-- ──────────────────────────────────────────────────────────
-- Combina dos mesas-QR: la absorbida pasa a active=false (soft, conserva
-- historial) y se le borra el floor_plan_element. La sobreviviente conserva
-- su QR y su elemento. Guarda atómica: si la absorbida tiene sesión abierta,
-- raise 'table_has_open_session'. Owner-only.
-- Devuelve {ok:true}.
create or replace function public.fp_merge_tables(
  p_survivor_table_id uuid,
  p_absorbed_table_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant          uuid;
  v_role            text;
  v_survivor_tenant uuid;
begin
  -- 1. Lock pesimista sobre la mesa absorbida + resolver su tenant
  select tenant_id into v_tenant
    from public.physical_tables
    where id = p_absorbed_table_id
    for update;
  if v_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check sobre el tenant de la absorbida
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Mismo-tenant que la sobreviviente
  select tenant_id into v_survivor_tenant
    from public.physical_tables
    where id = p_survivor_table_id;
  if v_survivor_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;
  if v_survivor_tenant <> v_tenant then
    raise exception 'cross_tenant_merge' using errcode = 'P0001';
  end if;

  -- 4. Guarda de sesión abierta sobre la absorbida (atómica con el lock)
  if exists (
    select 1 from public.table_sessions
    where physical_table_id = p_absorbed_table_id and status = 'open'
  ) then
    raise exception 'table_has_open_session' using errcode = 'P0001';
  end if;

  -- 5. Soft-deactivate de la absorbida + sacar su elemento del plano
  update public.physical_tables
    set active = false, updated_at = now()
    where id = p_absorbed_table_id;

  delete from public.floor_plan_elements
    where physical_table_id = p_absorbed_table_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_merge_tables(uuid, uuid) from public;
grant execute on function public.fp_merge_tables(uuid, uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_set_table_active
-- ──────────────────────────────────────────────────────────
-- Activa/desactiva una mesa. Al desactivar: lock + guarda de sesión abierta
-- (table_has_open_session) + active=false + borra su elemento (sale del
-- canvas). Al reactivar: active=true (su elemento ya no existe; la mesa
-- reaparece en la bandeja de no ubicadas vía el anti-join de getFloorPlan).
-- Owner-only. Devuelve {ok:true}.
create or replace function public.fp_set_table_active(
  p_table_id uuid,
  p_active   boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   text;
begin
  -- 1. Lock pesimista + resolver tenant
  select tenant_id into v_tenant
    from public.physical_tables
    where id = p_table_id
    for update;
  if v_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  if p_active = false then
    -- 3a. Desactivar: guarda de sesión abierta (atómica con el lock)
    if exists (
      select 1 from public.table_sessions
      where physical_table_id = p_table_id and status = 'open'
    ) then
      raise exception 'table_has_open_session' using errcode = 'P0001';
    end if;

    update public.physical_tables
      set active = false, updated_at = now()
      where id = p_table_id;

    -- Sacar la mesa del canvas
    delete from public.floor_plan_elements
      where physical_table_id = p_table_id;
  else
    -- 3b. Reactivar: vuelve a la bandeja (sin elemento)
    update public.physical_tables
      set active = true, updated_at = now()
      where id = p_table_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_set_table_active(uuid, boolean) from public;
grant execute on function public.fp_set_table_active(uuid, boolean) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_delete_table
-- ──────────────────────────────────────────────────────────
-- Hard delete de una mesa SIN historial. Si existe alguna table_session
-- ligada a la mesa → raise 'table_has_history' (se debe desactivar en su
-- lugar). El floor_plan_element cae por on delete cascade. Owner-only.
-- Devuelve {ok:true}.
create or replace function public.fp_delete_table(
  p_table_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   text;
begin
  -- 1. Resolver tenant
  select tenant_id into v_tenant
    from public.physical_tables
    where id = p_table_id;
  if v_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Bloquear si tiene historial de sesiones (un delete pondría
  --    physical_table_id = NULL en cada sesión por la FK on delete set null,
  --    destruyendo el vínculo mesa↔sesión).
  if exists (
    select 1 from public.table_sessions
    where physical_table_id = p_table_id
  ) then
    raise exception 'table_has_history' using errcode = 'P0001';
  end if;

  -- 4. Hard delete (el floor_plan_element cae por cascade)
  delete from public.physical_tables
    where id = p_table_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_delete_table(uuid) from public;
grant execute on function public.fp_delete_table(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_delete_area
-- ──────────────────────────────────────────────────────────
-- Borra un área. Bloquea si tiene mesas activas ubicadas
-- (area_has_active_tables). No se puede borrar la última área del tenant
-- (cannot_delete_last_area). Los elementos del área (decor + mesas no
-- activas) caen por on delete cascade. Owner-only. Devuelve {ok:true}.
create or replace function public.fp_delete_area(
  p_area_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   text;
  v_count  bigint;
begin
  -- 1. Resolver tenant
  select tenant_id into v_tenant
    from public.floor_plan_areas
    where id = p_area_id;
  if v_tenant is null then
    raise exception 'area_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Bloquear si hay mesas activas ubicadas en el área
  if exists (
    select 1
    from public.floor_plan_elements e
    join public.physical_tables pt on pt.id = e.physical_table_id
    where e.area_id = p_area_id and pt.active
  ) then
    raise exception 'area_has_active_tables' using errcode = 'P0001';
  end if;

  -- 4. No borrar la última área del tenant
  select count(*) into v_count
    from public.floor_plan_areas
    where tenant_id = v_tenant;
  if v_count <= 1 then
    raise exception 'cannot_delete_last_area' using errcode = 'P0001';
  end if;

  -- 5. Borrar (los floor_plan_elements caen por cascade)
  delete from public.floor_plan_areas
    where id = p_area_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_delete_area(uuid) from public;
grant execute on function public.fp_delete_area(uuid) to authenticated;
```

- [ ] **Step 2: Commit del archivo SQL**

Run:
```bash
cd /mnt/c/Users/Agust/Hub_main && git add supabase/migrations/20260605000200_floor_plan_rpcs.sql && git commit -m "feat(floor-plan): RPCs fp_* (create/merge/set-active/delete table, delete area)

Cinco RPCs SECURITY DEFINER para gestión estructural de mesas-QR y áreas
desde el editor de plano. Owner-only via user_role_in_tenant (owner_required
42501). Guarda de sesión abierta atómica con FOR UPDATE en fp_merge_tables y
fp_set_table_active(false) (table_has_open_session P0001). fp_delete_table
bloquea con historial (table_has_history); fp_delete_area bloquea con mesas
activas (area_has_active_tables) y la última área (cannot_delete_last_area).
search_path='' + identificadores schema-qualified + revoke/grant.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected output: un commit creado con 1 file changed (el `.sql`). El hook de pre-commit no aplica a archivos SQL puros (typecheck/lint/test pasan sin tocar nada).

### Task 2.2: Aplicar la migración vía MCP y verificar

**Files:**
- (ninguno — operación contra la DB remota)

- [ ] **Step 1: Aplicar la migración con `apply_migration`**

Invocar la herramienta MCP `mcp__supabase__apply_migration` (proyecto `ogplsevtrclzxvyejlns`) con:
- `name`: `floor_plan_rpcs`
- `query`: el contenido COMPLETO del archivo `supabase/migrations/20260605000200_floor_plan_rpcs.sql` (las cinco funciones con sus `revoke`/`grant`).

Expected output: éxito sin error (las cinco `create or replace function` + los `revoke`/`grant`). Como cada RPC depende de las tablas/enums de la Migración A (`floor_plan_areas`, `floor_plan_elements`, `floor_element_shape`), esta migración debe correr DESPUÉS de la de Phase 1; si falla con `type "public.floor_element_shape" does not exist` o `relation "public.floor_plan_areas" does not exist`, la Migración A no está aplicada — detenerse y aplicarla primero.

- [ ] **Step 2: Verificar que las cinco funciones existen con `search_path` seteado**

Invocar `mcp__supabase__execute_sql` con esta query (chequea que las cinco funciones están en `public`, son `SECURITY DEFINER`, y tienen `search_path=''` en su config):
```sql
select
  p.proname,
  p.prosecdef                                   as security_definer,
  array_to_string(p.proconfig, ',')             as config,
  pg_get_function_identity_arguments(p.oid)     as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fp_create_table','fp_merge_tables','fp_set_table_active',
    'fp_delete_table','fp_delete_area'
  )
order by p.proname;
```

Expected output: 5 filas. Cada una con `security_definer = true` y `config` conteniendo `search_path=` (vacío tras el `=`, es decir `search_path=` o `search_path=""`). Las `args`:
- `fp_create_table` → `p_area_id uuid, p_label text, p_capacity integer, p_shape floor_element_shape, p_x integer, p_y integer`
- `fp_delete_area` → `p_area_id uuid`
- `fp_delete_table` → `p_table_id uuid`
- `fp_merge_tables` → `p_survivor_table_id uuid, p_absorbed_table_id uuid`
- `fp_set_table_active` → `p_table_id uuid, p_active boolean`

Si alguna fila falta o `config` es `null` para alguna, la función no quedó con `set search_path = ''` — revisar el SQL y re-aplicar.

- [ ] **Step 3: Verificar los GRANTs (execute para `authenticated`, no para `public`/`anon`)**

Invocar `mcp__supabase__execute_sql` con:
```sql
select
  p.proname,
  array(
    select grantee::text
    from information_schema.routine_privileges rp
    where rp.specific_schema = 'public'
      and rp.routine_name = p.proname
      and rp.privilege_type = 'EXECUTE'
    order by grantee::text
  ) as execute_grantees
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fp_create_table','fp_merge_tables','fp_set_table_active',
    'fp_delete_table','fp_delete_area'
  )
order by p.proname;
```

Expected output: 5 filas. `execute_grantees` debe contener `authenticated` y NO contener `PUBLIC` ni `anon` (efecto del `revoke all … from public; grant execute … to authenticated;`). Puede aparecer el owner de la DB (p. ej. `postgres`) — eso es normal. Si aparece `PUBLIC`, el `revoke` no corrió: re-aplicar.

- [ ] **Step 4: Ejecutar `get_advisors` (security) y confirmar que no hay regresiones por estas funciones**

Invocar `mcp__supabase__get_advisors` con `type: "security"`.

Expected output: lista de advisories. Las cinco `fp_*` son `security definer set search_path = ''`, por lo que NO deben aparecer bajo `function_search_path_mutable`. Confirmar que ninguno de los cinco nombres (`fp_create_table`, `fp_merge_tables`, `fp_set_table_active`, `fp_delete_table`, `fp_delete_area`) figura en advisories de `function_search_path_mutable` ni de `security_definer_*`. Advisories preexistentes ajenos a estas funciones se ignoran (no son scope de esta fase). Si alguna `fp_*` aparece como `function_search_path_mutable`, falta el `set search_path = ''` en esa función — corregir y re-aplicar.

- [ ] **Step 5: Regenerar los tipos de la DB**

Run:
```bash
cd /mnt/c/Users/Agust/Hub_main && npm run db:types
```

Expected output: el comando regenera `types/database.ts` sin error. Las RPCs `fp_*` aparecen bajo `Database['public']['Functions']` (con sus `Args` y `Returns: Json`). Nota: si `db:types` apunta a la DB local (sin Docker) y falla por falta de conexión, regenerarlo apuntando al proyecto remoto `ogplsevtrclzxvyejlns` con `npx supabase gen types typescript --project-id ogplsevtrclzxvyejlns > types/database.ts` (requiere el CLI linkeado/login). El objetivo es que `types/database.ts` incluya las cinco `Functions` nuevas.

### Task 2.3: Commit de los tipos regenerados

**Files:**
- Modify (generado): `types/database.ts`

- [ ] **Step 1: Verificar que las cinco RPCs están en los tipos**

Run:
```bash
cd /mnt/c/Users/Agust/Hub_main && grep -E "fp_create_table|fp_merge_tables|fp_set_table_active|fp_delete_table|fp_delete_area" types/database.ts | sort -u
```

Expected output: las cinco claves de función aparecen al menos una vez cada una (como keys dentro de `Functions`). Si alguna falta, `db:types` no tomó la migración — re-correr el Step 5 de la Task 2.2 contra la DB correcta antes de commitear.

- [ ] **Step 2: Typecheck para confirmar que el nuevo `database.ts` no rompe el build**

Run:
```bash
cd /mnt/c/Users/Agust/Hub_main && npm run typecheck
```

Expected output: `tsc --noEmit` termina sin errores. (Esta fase no agrega callers TS todavía; solo se valida que el `database.ts` regenerado es válido y consistente con el resto del repo.)

- [ ] **Step 3: Commit de los tipos**

Run:
```bash
cd /mnt/c/Users/Agust/Hub_main && git add types/database.ts && git commit -m "chore(db): regenerar types tras RPCs fp_*

types/database.ts incluye las Functions fp_create_table, fp_merge_tables,
fp_set_table_active, fp_delete_table y fp_delete_area.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected output: un commit con 1 file changed (`types/database.ts`). El pre-commit hook (`typecheck && lint && test:ci`) pasa en verde.

---

## Phase 3: Helpers puros (numbering, grid) — TDD

> Esta fase implementa los dos módulos puros de `lib/floor-plan/` con TDD completo (Vitest, environment node). `numbering.ts` no tiene dependencias. `grid.ts` importa solo el **tipo** `Modifier` de `@dnd-kit/core` (`import type`, cero runtime de dnd-kit en los tests). Las firmas se atan a la sección **Contracts → `lib/floor-plan/numbering.ts`** y **`lib/floor-plan/grid.ts`** del plan. La firma del `Modifier` v6 verificada en `node_modules/@dnd-kit/core/dist/modifiers/types.d.ts` es `(args: { transform: Transform; draggingNodeRect: ClientRect | null; containerNodeRect: ClientRect | null; … }) => Transform`, con `Transform = { x; y; scaleX; scaleY }` y `ClientRect = { width; height; top; left; right; bottom }`.

CONTRACT ADDITIONS: ninguna. Todo lo de esta fase ya está en los Contracts.

---

### Task 3.1: `suggestNextLabel` — TDD

**Files:**
- Create: `tests/lib/floor-plan-numbering.test.ts`
- Create: `lib/floor-plan/numbering.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/lib/floor-plan-numbering.test.ts` con este contenido exacto. Cubre: base case (sin existentes → `String(numberStart)`), gap-filling, saltar labels tomados, ignorar labels no numéricos, y PA arrancando en 101.

```ts
import { describe, expect, it } from 'vitest'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'

describe('suggestNextLabel', () => {
  it('base case: sin labels existentes devuelve String(numberStart)', () => {
    expect(suggestNextLabel(1, [])).toBe('1')
    expect(suggestNextLabel(101, [])).toBe('101')
    expect(suggestNextLabel(0, [])).toBe('0')
  })

  it('saltea labels tomados consecutivos (no hay hueco)', () => {
    expect(suggestNextLabel(1, ['1', '2', '3'])).toBe('4')
  })

  it('rellena el primer hueco disponible desde numberStart', () => {
    // 1 y 3 tomados, 2 libre
    expect(suggestNextLabel(1, ['1', '3'])).toBe('2')
    // 1,2,4 tomados, 3 libre
    expect(suggestNextLabel(1, ['1', '2', '4'])).toBe('3')
  })

  it('ignora labels no numéricos al buscar el próximo entero', () => {
    // 'Barra' y 'VIP' no son enteros → no afectan; 1 tomado, 2 libre
    expect(suggestNextLabel(1, ['1', 'Barra', 'VIP'])).toBe('2')
    // solo labels no numéricos → arranca en numberStart
    expect(suggestNextLabel(5, ['Barra', 'Reservada'])).toBe('5')
  })

  it('ignora numéricos con formato distinto a String(n) (ceros a la izquierda, decimales)', () => {
    // '01' no es igual a String(1) → '1' sigue libre como string
    expect(suggestNextLabel(1, ['01'])).toBe('1')
    // '2.0' no matchea String(2)
    expect(suggestNextLabel(2, ['2.0'])).toBe('2')
  })

  it('PA: arranca en 101 y rellena huecos por encima', () => {
    expect(suggestNextLabel(101, [])).toBe('101')
    expect(suggestNextLabel(101, ['101', '102'])).toBe('103')
    expect(suggestNextLabel(101, ['101', '103'])).toBe('102')
  })

  it('labels por debajo de numberStart no cuentan', () => {
    // '1','2' están por debajo de 101 → no afectan; arranca en 101
    expect(suggestNextLabel(101, ['1', '2', '50'])).toBe('101')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run:
```bash
npx vitest run tests/lib/floor-plan-numbering.test.ts
```
Expected output: falla porque `@/lib/floor-plan/numbering` no existe todavía. Vitest reporta algo como `Failed to resolve import "@/lib/floor-plan/numbering"` o `No test files found` → al menos NO debe pasar en verde. (Confirmar que el error es de módulo inexistente, no un falso verde.)

- [ ] **Step 3: Implementar `numbering.ts`**

Crear `lib/floor-plan/numbering.ts` con este contenido exacto. Itera desde `numberStart` hacia arriba devolviendo el primer entero `n` cuyo `String(n)` no esté en `existingLabels`. Como `existingLabels` es finito, el bucle termina a lo sumo en `numberStart + existing.length`.

```ts
/**
 * Sugiere el próximo label numérico libre para una mesa nueva dentro de un área.
 *
 * Devuelve `String(n)` del menor entero `n >= numberStart` tal que `String(n)`
 * no aparezca en `existingLabels`. Los labels no numéricos (o con formato
 * distinto a `String(n)`, p. ej. ceros a la izquierda o decimales) se ignoran,
 * porque solo nos interesa el espacio de enteros sugeridos.
 *
 * Puro: sin efectos, sin dependencias. Testeado en
 * `tests/lib/floor-plan-numbering.test.ts`.
 */
export function suggestNextLabel(numberStart: number, existingLabels: string[]): string {
  const taken = new Set(existingLabels)
  let n = numberStart
  // Cota: a lo sumo numberStart + cantidad de labels tomados; el bucle termina.
  const upperBound = numberStart + taken.size + 1
  while (n <= upperBound) {
    const candidate = String(n)
    if (!taken.has(candidate)) {
      return candidate
    }
    n += 1
  }
  // Inalcanzable en la práctica (el Set es finito), pero el type-system necesita
  // un retorno garantizado. Devolvemos el primer entero por encima de la cota.
  return String(upperBound + 1)
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run:
```bash
npx vitest run tests/lib/floor-plan-numbering.test.ts
```
Expected output: `Test Files  1 passed (1)` y `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

Run:
```bash
git add lib/floor-plan/numbering.ts tests/lib/floor-plan-numbering.test.ts
git commit -m "feat(floor-plan): suggestNextLabel (numbering puro) con tests"
```

---

### Task 3.2: `grid.ts` constantes + `snapToGrid` + `clampToArea` — TDD

**Files:**
- Create: `tests/lib/floor-plan-grid.test.ts`
- Create: `lib/floor-plan/grid.ts`

> Esta tarea implementa primero las constantes (`GRID`, `RESIZE_MIN`, `ELEMENT_DEFAULTS`) y las dos funciones puras (`snapToGrid`, `clampToArea`). Los dos modifiers (`createSnapModifier`, `restrictToParent`) se agregan en la Task 3.3 sobre el mismo archivo y el mismo test, para mantener cada round de TDD chico. En esta tarea, `grid.ts` aún **no** importa nada de dnd-kit.

- [ ] **Step 1: Escribir el test que falla (constantes + funciones puras)**

Crear `tests/lib/floor-plan-grid.test.ts` con este contenido. Los `describe` de los modifiers se agregan en la Task 3.3; arrancamos solo con constantes y funciones puras.

```ts
import { describe, expect, it } from 'vitest'
import {
  clampToArea,
  ELEMENT_DEFAULTS,
  GRID,
  RESIZE_MIN,
  snapToGrid,
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
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run:
```bash
npx vitest run tests/lib/floor-plan-grid.test.ts
```
Expected output: falla con `Failed to resolve import "@/lib/floor-plan/grid"` (el módulo no existe). NO debe pasar en verde.

- [ ] **Step 3: Implementar `grid.ts` (sin modifiers todavía)**

Crear `lib/floor-plan/grid.ts` con este contenido. En la Task 3.3 se agregan `createSnapModifier` y `restrictToParent` al final del mismo archivo.

```ts
/**
 * Helpers puros de geometría del editor de plano.
 *
 * `GRID` / `RESIZE_MIN` / `ELEMENT_DEFAULTS` son las constantes deterministas
 * del spec §5. `snapToGrid` y `clampToArea` son puras y testeadas en
 * `tests/lib/floor-plan-grid.test.ts`. Los modifiers de dnd-kit
 * (`createSnapModifier`, `restrictToParent`) se agregan al final de este
 * archivo (Task 3.3) y solo importan el TIPO `Modifier`.
 */

/** Grilla lógica (px lógicos). El snap y el paso de teclado usan este valor. */
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
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run:
```bash
npx vitest run tests/lib/floor-plan-grid.test.ts
```
Expected output: `Test Files  1 passed (1)` y `Tests  4 passed (4)` (los `describe` `constantes`, `snapToGrid` × 3, `clampToArea` suman 4 bloques `it`-grupos → 4+ tests; confirmar que todos los `it` pasan en verde).

- [ ] **Step 5: Commit**

Run:
```bash
git add lib/floor-plan/grid.ts tests/lib/floor-plan-grid.test.ts
git commit -m "feat(floor-plan): grid constantes + snapToGrid + clampToArea con tests"
```

---

### Task 3.3: Modifiers v6 `createSnapModifier` + `restrictToParent` — TDD

**Files:**
- Modify: `tests/lib/floor-plan-grid.test.ts`
- Modify: `lib/floor-plan/grid.ts`

> Los modifiers de dnd-kit v6 tienen la firma `(args) => Transform` donde `args` incluye `transform`, `draggingNodeRect`, `containerNodeRect` (todos verificados en `@dnd-kit/core/dist/modifiers/types.d.ts`). Importamos **solo el tipo** `Modifier` (`import type`, cero runtime dnd-kit). En el test construimos los args como objetos planos tipados con un helper, y casteamos cada modifier a una función que recibe el subconjunto que usa, para llamarlos sin montar un `DndContext`. **Ambos modifiers devuelven `{ ...transform, x, y }`** para preservar `scaleX`/`scaleY` (omitirlos colapsa el elemento mid-drag).

- [ ] **Step 1: Agregar los tests que fallan (modifiers)**

Editar `tests/lib/floor-plan-grid.test.ts`. Reemplazar la línea de import para sumar los dos modifiers, y agregar al final del archivo los dos nuevos `describe`.

Cambiar el bloque de import de:
```ts
import {
  clampToArea,
  ELEMENT_DEFAULTS,
  GRID,
  RESIZE_MIN,
  snapToGrid,
} from '@/lib/floor-plan/grid'
```
a:
```ts
import type { Transform } from '@dnd-kit/utilities'
import {
  clampToArea,
  createSnapModifier,
  ELEMENT_DEFAULTS,
  GRID,
  restrictToParent,
  RESIZE_MIN,
  snapToGrid,
} from '@/lib/floor-plan/grid'

// ClientRect de dnd-kit: { width, height, top, left, right, bottom }.
type RectLike = {
  width: number
  height: number
  top: number
  left: number
  right: number
  bottom: number
}

function rect(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function transform(x: number, y: number, scaleX = 1, scaleY = 1): Transform {
  return { x, y, scaleX, scaleY }
}

// Llama un Modifier construyendo el subconjunto de args que usa (transform +
// los dos rects). El resto de campos del ModifierArguments no se leen en
// nuestros modifiers, así que casteamos la función a la firma mínima.
function callModifier(
  modifier: ReturnType<typeof createSnapModifier>,
  args: {
    transform: Transform
    draggingNodeRect?: RectLike | null
    containerNodeRect?: RectLike | null
  },
): Transform {
  const fn = modifier as unknown as (a: {
    transform: Transform
    draggingNodeRect: RectLike | null
    containerNodeRect: RectLike | null
  }) => Transform
  return fn({
    transform: args.transform,
    draggingNodeRect: args.draggingNodeRect ?? null,
    containerNodeRect: args.containerNodeRect ?? null,
  })
}
```

Agregar al final del archivo:
```ts
describe('createSnapModifier', () => {
  it('a scale=1 snapea x/y al grid lógico (= px pantalla)', () => {
    const m = createSnapModifier(GRID, () => 1)
    // 23 px → round(23/1/20)*20*1 = round(1.15)*20 = 20
    const out = callModifier(m, { transform: transform(23, 9) })
    expect(out.x).toBe(20)
    expect(out.y).toBe(0) // round(9/20)=0
  })

  it('a scale=2 snapea en espacio lógico y devuelve px de pantalla', () => {
    const m = createSnapModifier(GRID, () => 2)
    // x pantalla 50 → lógico 25 → round(25/20)=1 → lógico 20 → pantalla 40
    const out = callModifier(m, { transform: transform(50, 86) })
    expect(out.x).toBe(40)
    // y pantalla 86 → lógico 43 → round(43/20)=2 → lógico 40 → pantalla 80
    expect(out.y).toBe(80)
  })

  it('preserva scaleX/scaleY (return { ...transform, x, y })', () => {
    const m = createSnapModifier(GRID, () => 1)
    const out = callModifier(m, { transform: transform(23, 9, 1, 1) })
    expect(out.scaleX).toBe(1)
    expect(out.scaleY).toBe(1)
  })

  it('lee el scale vigente desde getScale en cada llamada (closure)', () => {
    let scale = 1
    const m = createSnapModifier(GRID, () => scale)
    expect(callModifier(m, { transform: transform(50, 0) }).x).toBe(60) // lógico 50→40? -> ver abajo
    // a scale=1: x=50 → round(50/20)=3 (2.5→3) → 60
    scale = 2
    // a scale=2: x=50 → lógico 25 → round(1.25)=1 → lógico 20 → pantalla 40
    expect(callModifier(m, { transform: transform(50, 0) }).x).toBe(40)
  })
})

describe('restrictToParent', () => {
  it('sin rects devuelve el transform sin tocar (no puede clampear)', () => {
    const m = restrictToParent(() => 1)
    const out = callModifier(m, { transform: transform(123, 45) })
    expect(out.x).toBe(123)
    expect(out.y).toBe(45)
    expect(out.scaleX).toBe(1)
  })

  it('a scale=1 clampea para que el elemento no se salga del contenedor', () => {
    const m = restrictToParent(() => 1)
    // contenedor (viewport): left 0, top 0, 1000×600
    const container = rect(0, 0, 1000, 600)
    // elemento arrastrado: actualmente en left 900, top 500, 80×80
    const dragging = rect(900, 500, 80, 80)
    // empuje +200/+200 → saldría a 1100/700 (right 1180, bottom 780) fuera del contenedor.
    // máx x permitido = 1000 - (900+80) = 20 ; máx y = 600 - (500+80) = 20
    const out = callModifier(m, {
      transform: transform(200, 200),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.x).toBe(20)
    expect(out.y).toBe(20)
  })

  it('a scale=1 clampea por el borde mínimo (no dejar pasar el top/left del contenedor)', () => {
    const m = restrictToParent(() => 1)
    const container = rect(0, 0, 1000, 600)
    const dragging = rect(100, 80, 80, 80)
    // empuje -300/-300 → left -200, top -220 (fuera por arriba/izq)
    // mín x = 0 - 100 = -100 ; mín y = 0 - 80 = -80
    const out = callModifier(m, {
      transform: transform(-300, -300),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.x).toBe(-100)
    expect(out.y).toBe(-80)
  })

  it('a scale=2 clampea en espacio lógico (divide los rects por scale)', () => {
    const m = restrictToParent(() => 2)
    // rects en px PANTALLA (lo que reporta dnd-kit bajo transform: scale(2))
    // contenedor pantalla 0,0,2000×1200 → lógico 0,0,1000×600
    const container = rect(0, 0, 2000, 1200)
    // elemento pantalla en left 1800, top 1000, 160×160 → lógico left 900, top 500, 80×80
    const dragging = rect(1800, 1000, 160, 160)
    // transform en px PANTALLA: +400/+400 → lógico +200/+200
    // en lógico: máx x = 1000 - (900+80) = 20 ; clamp lógico 200→20 → pantalla 40
    const out = callModifier(m, {
      transform: transform(400, 400),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.x).toBe(40) // 20 lógico * 2
    expect(out.y).toBe(40)
  })

  it('preserva scaleX/scaleY al clampear', () => {
    const m = restrictToParent(() => 1)
    const container = rect(0, 0, 1000, 600)
    const dragging = rect(900, 500, 80, 80)
    const out = callModifier(m, {
      transform: transform(200, 200, 1, 1),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.scaleX).toBe(1)
    expect(out.scaleY).toBe(1)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run:
```bash
npx vitest run tests/lib/floor-plan-grid.test.ts
```
Expected output: falla en la importación de `createSnapModifier` / `restrictToParent` (`is not exported by`/`undefined`) — esos dos símbolos aún no existen en `grid.ts`. NO debe pasar en verde.

- [ ] **Step 3: Implementar los modifiers en `grid.ts`**

Editar `lib/floor-plan/grid.ts`. Agregar el import de tipo al tope del archivo (justo después del comentario de cabecera, antes de `export const GRID`):

```ts
import type { Modifier } from '@dnd-kit/core'
```

Y agregar al final del archivo (después de `clampToArea`):

```ts
/**
 * Modifier v6 de snap-a-grilla en espacio lógico.
 *
 * Bajo `transform: scale(s)` en el stage, dnd-kit reporta `transform` en px de
 * PANTALLA. Snapeamos en px LÓGICOS (`/ scale`) y devolvemos px de pantalla
 * (`* scale`) para que el preview coincida con el commit en `onDragEnd`.
 * `getScale` cierra sobre el scale vigente (re-`useMemo` keyed en `scale` en
 * el editor). Devuelve `{ ...transform, x, y }` para preservar `scaleX/scaleY`.
 */
export function createSnapModifier(grid: number, getScale: () => number): Modifier {
  return ({ transform }) => {
    const scale = getScale()
    const x = Math.round(transform.x / scale / grid) * grid * scale
    const y = Math.round(transform.y / scale / grid) * grid * scale
    return { ...transform, x, y }
  }
}

/**
 * Modifier v6 que restringe el arrastre al contenedor (viewport) en espacio
 * lógico. Bajo `scale`, los rects que reporta dnd-kit están en px de PANTALLA;
 * dividimos por `scale` para acotar en lógico y multiplicamos de vuelta para
 * devolver px de pantalla. Sin rects (no medible) devuelve el transform tal cual.
 * Devuelve `{ ...transform, x, y }` para preservar `scaleX/scaleY`.
 *
 * Acotación: el elemento puede moverse `transform.x` de modo que su borde
 * izquierdo no pase el `left` del contenedor ni su borde derecho pase el
 * `right`. En lógico:
 *   minX = container.left - dragging.left
 *   maxX = container.right - dragging.right
 * (idem Y). Se clampea `transform.x/scale` a `[minX, maxX]` y se reescala.
 */
export function restrictToParent(getScale: () => number): Modifier {
  return ({ transform, draggingNodeRect, containerNodeRect }) => {
    if (!draggingNodeRect || !containerNodeRect) {
      return transform
    }
    const scale = getScale()
    // Rects a espacio lógico.
    const cLeft = containerNodeRect.left / scale
    const cTop = containerNodeRect.top / scale
    const cRight = containerNodeRect.right / scale
    const cBottom = containerNodeRect.bottom / scale
    const dLeft = draggingNodeRect.left / scale
    const dTop = draggingNodeRect.top / scale
    const dRight = draggingNodeRect.right / scale
    const dBottom = draggingNodeRect.bottom / scale

    const minX = cLeft - dLeft
    const maxX = cRight - dRight
    const minY = cTop - dTop
    const maxY = cBottom - dBottom

    const logicalX = transform.x / scale
    const logicalY = transform.y / scale

    const clampedX = Math.max(minX, Math.min(logicalX, maxX))
    const clampedY = Math.max(minY, Math.min(logicalY, maxY))

    return { ...transform, x: clampedX * scale, y: clampedY * scale }
  }
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run:
```bash
npx vitest run tests/lib/floor-plan-grid.test.ts
```
Expected output: `Test Files  1 passed (1)`, todos los `it` en verde incluyendo los dos nuevos `describe` (`createSnapModifier` × 4, `restrictToParent` × 5). Confirmar `0 failed`.

- [ ] **Step 5: Typecheck y lint del módulo nuevo**

Run:
```bash
npm run typecheck && npx biome check lib/floor-plan/grid.ts lib/floor-plan/numbering.ts tests/lib/floor-plan-grid.test.ts tests/lib/floor-plan-numbering.test.ts
```
Expected output: `tsc --noEmit` sin errores; Biome reporta `Checked N files` sin diagnostics (o `No fixes applied`). Si Biome sugiere fixes de formato, correr `npx biome check --write` sobre esos paths y re-verificar.

- [ ] **Step 6: Commit**

Run:
```bash
git add lib/floor-plan/grid.ts tests/lib/floor-plan-grid.test.ts
git commit -m "feat(floor-plan): modifiers v6 createSnapModifier + restrictToParent (snap/clamp en espacio lógico) con tests"
```

---

## Phase 4: Schemas (zod) + errores + cambios en `lib/tables`

> **CONTRACT ADDITIONS:**
> - El test de `errors.ts` asume que `mapPgError` devuelve, para un `error.message` que no contiene ninguna key conocida, el genérico **`'No se pudo completar la acción. Probá de nuevo.'`**. Este string genérico no estaba literal en los Contracts (que solo dicen "o un genérico"); se fija acá para que el assembler lo use consistentemente en `actions.ts` (Phase 5).
> - El test de `schemas.ts` para `addDecorSchema` ejercita el `regex` de `color` con `#abc` (rechazado) y `#aabbcc` (aceptado), y `kind: 'table'` (rechazado: el enum de decor es `['wall','pillar','island','bar']`), todo derivado de los Contracts sin agregar campos nuevos.

### Task 4.1: `lib/floor-plan/schemas.ts` — zod de todos los inputs (TDD)

**Files:**
- Create: `tests/lib/floor-plan-schemas.test.ts`
- Create: `lib/floor-plan/schemas.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/lib/floor-plan-schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  addDecorSchema,
  areaCanvasSchema,
  areaCreateSchema,
  areaRenameSchema,
  areaReorderSchema,
  createTableInPlanSchema,
  elementGeometrySchema,
  geometryBatchSchema,
  mergeTablesSchema,
  placeTableSchema,
  setTableActiveSchema,
  splitTableSchema,
  updateDecorSchema,
} from '@/lib/floor-plan/schemas'

const UUID = '00000000-0000-0000-0000-000000000000'

describe('createTableInPlanSchema', () => {
  it('acepta capacity null', () => {
    const r = createTableInPlanSchema.safeParse({
      area_id: UUID,
      label: 'Mesa 1',
      capacity: null,
      shape: 'rect',
      x: 0,
      y: 0,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.capacity).toBeNull()
  })

  it('aplica default shape=rect cuando falta', () => {
    const r = createTableInPlanSchema.safeParse({
      area_id: UUID,
      label: 'Mesa 1',
      capacity: 4,
      x: 0,
      y: 0,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.shape).toBe('rect')
  })

  it('rechaza capacity 0 y 51', () => {
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 0,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 51,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
  })

  it('acepta capacity 1 y 50 (bordes)', () => {
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 1,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(true)
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 50,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(true)
  })

  it('trimea el label y rechaza label vacío o >40', () => {
    const ok = createTableInPlanSchema.safeParse({
      area_id: UUID,
      label: '  Mesa 7  ',
      capacity: null,
      shape: 'rect',
      x: 0,
      y: 0,
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.label).toBe('Mesa 7')

    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: '   ',
        capacity: null,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'a'.repeat(41),
        capacity: null,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
  })

  it('rechaza area_id no-uuid', () => {
    expect(
      createTableInPlanSchema.safeParse({
        area_id: 'nope',
        label: 'M',
        capacity: null,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
  })
})

describe('areaCreateSchema', () => {
  it('aplica default number_start=1', () => {
    const r = areaCreateSchema.safeParse({ name: 'Salón' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.number_start).toBe(1)
  })

  it('rechaza name vacío y >40', () => {
    expect(areaCreateSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(areaCreateSchema.safeParse({ name: 'a'.repeat(41) }).success).toBe(false)
  })
})

describe('areaRenameSchema', () => {
  it('exige id uuid + name', () => {
    expect(areaRenameSchema.safeParse({ id: UUID, name: 'PB' }).success).toBe(true)
    expect(areaRenameSchema.safeParse({ id: 'x', name: 'PB' }).success).toBe(false)
  })
})

describe('areaCanvasSchema', () => {
  it('acepta width/height/number_start dentro de límites', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 800, number_start: 1 }).success,
    ).toBe(true)
  })

  it('acepta los bordes 200 y 6000', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 200, height: 6000, number_start: 0 }).success,
    ).toBe(true)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 6000, height: 200, number_start: 100000 })
        .success,
    ).toBe(true)
  })

  it('rechaza width < 200 o > 6000', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 199, height: 800, number_start: 1 }).success,
    ).toBe(false)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 6001, height: 800, number_start: 1 }).success,
    ).toBe(false)
  })

  it('rechaza height fuera de [200,6000]', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 199, number_start: 1 }).success,
    ).toBe(false)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 6001, number_start: 1 }).success,
    ).toBe(false)
  })

  it('rechaza number_start fuera de [0,100000]', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 800, number_start: -1 }).success,
    ).toBe(false)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 800, number_start: 100001 })
        .success,
    ).toBe(false)
  })
})

describe('areaReorderSchema', () => {
  it('exige al menos un uuid', () => {
    expect(areaReorderSchema.safeParse({ ids: [UUID] }).success).toBe(true)
    expect(areaReorderSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(areaReorderSchema.safeParse({ ids: ['nope'] }).success).toBe(false)
  })
})

describe('elementGeometrySchema', () => {
  it('acepta una geometría válida', () => {
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: 100,
        y: 200,
        width: 80,
        height: 80,
        z_index: 10,
      }).success,
    ).toBe(true)
  })

  it('acepta x/y en los bordes ±10000', () => {
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: -10000,
        y: 10000,
        width: 80,
        height: 80,
        z_index: 0,
      }).success,
    ).toBe(true)
  })

  it('rechaza x/y fuera de ±10000', () => {
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: -10001,
        y: 0,
        width: 80,
        height: 80,
        z_index: 0,
      }).success,
    ).toBe(false)
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: 0,
        y: 10001,
        width: 80,
        height: 80,
        z_index: 0,
      }).success,
    ).toBe(false)
  })

  it('rechaza width/height fuera de [8,6000]', () => {
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: 0,
        y: 0,
        width: 7,
        height: 80,
        z_index: 0,
      }).success,
    ).toBe(false)
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: 0,
        y: 0,
        width: 80,
        height: 6001,
        z_index: 0,
      }).success,
    ).toBe(false)
  })

  it('rechaza x no-entero', () => {
    expect(
      elementGeometrySchema.safeParse({
        id: UUID,
        x: 1.5,
        y: 0,
        width: 80,
        height: 80,
        z_index: 0,
      }).success,
    ).toBe(false)
  })
})

describe('geometryBatchSchema', () => {
  const geom = { id: UUID, x: 0, y: 0, width: 80, height: 80, z_index: 0 }

  it('acepta entre 1 y 500 items', () => {
    expect(geometryBatchSchema.safeParse({ items: [geom] }).success).toBe(true)
    expect(
      geometryBatchSchema.safeParse({ items: Array.from({ length: 500 }, () => geom) }).success,
    ).toBe(true)
  })

  it('rechaza lista vacía', () => {
    expect(geometryBatchSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rechaza más de 500 items', () => {
    expect(
      geometryBatchSchema.safeParse({ items: Array.from({ length: 501 }, () => geom) }).success,
    ).toBe(false)
  })
})

describe('addDecorSchema', () => {
  const base = {
    area_id: UUID,
    kind: 'wall' as const,
    shape: 'rect' as const,
    x: 0,
    y: 0,
    width: 200,
    height: 16,
  }

  it('acepta decor válida sin label/color', () => {
    expect(addDecorSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza kind=table (decor enum no lo incluye)', () => {
    expect(addDecorSchema.safeParse({ ...base, kind: 'table' }).success).toBe(false)
  })

  it('rechaza color con regex inválida (#abc)', () => {
    expect(addDecorSchema.safeParse({ ...base, color: '#abc' }).success).toBe(false)
  })

  it('acepta color de 6 dígitos (#aabbcc)', () => {
    const r = addDecorSchema.safeParse({ ...base, color: '#aabbcc' })
    expect(r.success).toBe(true)
  })

  it('acepta color null', () => {
    expect(addDecorSchema.safeParse({ ...base, color: null }).success).toBe(true)
  })

  it('rechaza width/height fuera de [8,6000]', () => {
    expect(addDecorSchema.safeParse({ ...base, width: 7 }).success).toBe(false)
    expect(addDecorSchema.safeParse({ ...base, height: 6001 }).success).toBe(false)
  })
})

describe('updateDecorSchema', () => {
  it('acepta solo id (label/color opcionales)', () => {
    expect(updateDecorSchema.safeParse({ id: UUID }).success).toBe(true)
  })

  it('rechaza color inválido', () => {
    expect(updateDecorSchema.safeParse({ id: UUID, color: '#abc' }).success).toBe(false)
  })
})

describe('placeTableSchema / splitTableSchema / mergeTablesSchema / setTableActiveSchema', () => {
  it('placeTableSchema valida ids enteros', () => {
    expect(
      placeTableSchema.safeParse({ table_id: UUID, area_id: UUID, x: 10, y: 20 }).success,
    ).toBe(true)
    expect(
      placeTableSchema.safeParse({ table_id: UUID, area_id: UUID, x: 1.2, y: 0 }).success,
    ).toBe(false)
  })

  it('splitTableSchema exige source_element_id uuid', () => {
    expect(splitTableSchema.safeParse({ source_element_id: UUID }).success).toBe(true)
    expect(splitTableSchema.safeParse({ source_element_id: 'x' }).success).toBe(false)
  })

  it('mergeTablesSchema exige ambos ids', () => {
    expect(
      mergeTablesSchema.safeParse({ survivor_table_id: UUID, absorbed_table_id: UUID }).success,
    ).toBe(true)
    expect(mergeTablesSchema.safeParse({ survivor_table_id: UUID }).success).toBe(false)
  })

  it('setTableActiveSchema exige boolean', () => {
    expect(setTableActiveSchema.safeParse({ table_id: UUID, active: true }).success).toBe(true)
    expect(setTableActiveSchema.safeParse({ table_id: UUID, active: 'x' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run:
```bash
npx vitest run tests/lib/floor-plan-schemas.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/floor-plan/schemas'` (el módulo todavía no existe).

- [ ] **Step 3: Implementar los schemas exactamente según Contracts**

Create `lib/floor-plan/schemas.ts`:
```ts
import { z } from 'zod'

export const KIND = z.enum(['table', 'wall', 'pillar', 'island', 'bar'])
export const SHAPE = z.enum(['rect', 'circle'])

export const areaCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  number_start: z.coerce.number().int().min(0).max(100000).default(1),
})

export const areaRenameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
})

export const areaCanvasSchema = z.object({
  id: z.string().uuid(),
  width: z.coerce.number().int().min(200).max(6000),
  height: z.coerce.number().int().min(200).max(6000),
  number_start: z.coerce.number().int().min(0).max(100000),
})

export const areaReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
})

export const elementGeometrySchema = z.object({
  id: z.string().uuid(),
  x: z.number().int().min(-10000).max(10000),
  y: z.number().int().min(-10000).max(10000),
  width: z.number().int().min(8).max(6000),
  height: z.number().int().min(8).max(6000),
  z_index: z.number().int(),
})

export const geometryBatchSchema = z.object({
  items: z.array(elementGeometrySchema).min(1).max(500),
})

export const createTableInPlanSchema = z.object({
  area_id: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  capacity: z.coerce.number().int().min(1).max(50).nullable(),
  shape: SHAPE.default('rect'),
  x: z.number().int(),
  y: z.number().int(),
})

export const placeTableSchema = z.object({
  table_id: z.string().uuid(),
  area_id: z.string().uuid(),
  x: z.number().int(),
  y: z.number().int(),
})

export const splitTableSchema = z.object({
  source_element_id: z.string().uuid(),
})

export const mergeTablesSchema = z.object({
  survivor_table_id: z.string().uuid(),
  absorbed_table_id: z.string().uuid(),
})

export const setTableActiveSchema = z.object({
  table_id: z.string().uuid(),
  active: z.boolean(),
})

export const addDecorSchema = z.object({
  area_id: z.string().uuid(),
  kind: z.enum(['wall', 'pillar', 'island', 'bar']),
  shape: SHAPE,
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(8).max(6000),
  height: z.number().int().min(8).max(6000),
  label: z.string().max(40).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

export const updateDecorSchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(40).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

export const elementIdSchema = z.object({
  id: z.string().uuid(),
})

export const setZIndexSchema = z.object({
  id: z.string().uuid(),
  z_index: z.number().int(),
})

export type CreateTableInPlanInput = z.infer<typeof createTableInPlanSchema>
export type ElementGeometry = z.infer<typeof elementGeometrySchema>
export type AddDecorInput = z.infer<typeof addDecorSchema>
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run:
```bash
npx vitest run tests/lib/floor-plan-schemas.test.ts
```
Expected: PASS (todos los `describe` verdes; ~30 assertions).

- [ ] **Step 5: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS, sin errores TS ni warnings de Biome sobre `lib/floor-plan/schemas.ts` ni el test.

- [ ] **Step 6: Commit**

```bash
git add lib/floor-plan/schemas.ts tests/lib/floor-plan-schemas.test.ts
git commit -m "feat(floor-plan): zod schemas de área/geometría/decor/mesa con tests"
```

---

### Task 4.2: `lib/floor-plan/errors.ts` — mapa de errores Postgres → es-AR (TDD)

**Files:**
- Create: `tests/lib/floor-plan-errors.test.ts`
- Create: `lib/floor-plan/errors.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `tests/lib/floor-plan-errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { mapPgError, PG_ERROR_MESSAGES } from '@/lib/floor-plan/errors'

describe('mapPgError', () => {
  it('mapea table_has_open_session a su mensaje accionable', () => {
    expect(mapPgError({ message: 'table_has_open_session' })).toBe(
      PG_ERROR_MESSAGES.table_has_open_session,
    )
    expect(mapPgError({ message: 'table_has_open_session' })).toContain('sesión abierta')
  })

  it('mapea table_has_history', () => {
    expect(mapPgError({ message: 'P0001: table_has_history' })).toBe(
      PG_ERROR_MESSAGES.table_has_history,
    )
  })

  it('mapea area_has_active_tables', () => {
    expect(mapPgError({ message: 'area_has_active_tables' })).toBe(
      PG_ERROR_MESSAGES.area_has_active_tables,
    )
  })

  it('mapea cannot_delete_last_area', () => {
    expect(mapPgError({ message: 'cannot_delete_last_area' })).toBe(
      PG_ERROR_MESSAGES.cannot_delete_last_area,
    )
  })

  it('mapea cross_tenant_merge', () => {
    expect(mapPgError({ message: 'cross_tenant_merge' })).toBe(PG_ERROR_MESSAGES.cross_tenant_merge)
  })

  it('mapea fp_table_inactive', () => {
    expect(mapPgError({ message: 'fp_table_inactive' })).toBe(PG_ERROR_MESSAGES.fp_table_inactive)
  })

  it('mapea owner_required', () => {
    expect(mapPgError({ message: 'owner_required' })).toBe(PG_ERROR_MESSAGES.owner_required)
  })

  it('encuentra la key aunque esté embebida en un mensaje más largo de Postgres', () => {
    expect(
      mapPgError({
        message:
          'new row violates check constraint, P0001: table_has_open_session at character 12',
      }),
    ).toBe(PG_ERROR_MESSAGES.table_has_open_session)
  })

  it('caso especial: violación del índice único floor_plan_elements_pt_uidx', () => {
    expect(
      mapPgError({
        message:
          'duplicate key value violates unique constraint "floor_plan_elements_pt_uidx"',
      }),
    ).toBe('La mesa ya está ubicada en el plano.')
  })

  it('mensaje desconocido devuelve el genérico', () => {
    expect(mapPgError({ message: 'algo totalmente distinto' })).toBe(
      'No se pudo completar la acción. Probá de nuevo.',
    )
  })

  it('error null/undefined devuelve el genérico', () => {
    expect(mapPgError(null)).toBe('No se pudo completar la acción. Probá de nuevo.')
    expect(mapPgError(undefined)).toBe('No se pudo completar la acción. Probá de nuevo.')
    expect(mapPgError({})).toBe('No se pudo completar la acción. Probá de nuevo.')
  })
})
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run:
```bash
npx vitest run tests/lib/floor-plan-errors.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/floor-plan/errors'`.

- [ ] **Step 3: Implementar el mapa de errores exactamente según Contracts**

Create `lib/floor-plan/errors.ts`:
```ts
// Mapa de errores Postgres (raise exception de los RPC fp_* + violaciones de
// constraint) → mensajes accionables en es-AR. Se usa en lib/floor-plan/actions.ts
// tras cada RPC/write fallido. No expone PII ni el message crudo al usuario.

export const PG_ERROR_MESSAGES: Record<string, string> = {
  table_has_open_session:
    'La mesa tiene una sesión abierta. Cerrá o cobrá la sesión antes de continuar.',
  table_has_history: 'La mesa tiene historial. Desactivala en vez de borrarla.',
  area_has_active_tables:
    'El área tiene mesas activas. Movélas o desactivalas antes de borrar el área.',
  cannot_delete_last_area: 'No podés borrar la única área. Creá otra antes.',
  cross_tenant_merge: 'No se pueden combinar mesas de locales distintos.',
  fp_table_inactive: 'La mesa está inactiva.',
  owner_required: 'No tenés permiso para esta acción.',
}

const GENERIC = 'No se pudo completar la acción. Probá de nuevo.'

export function mapPgError(error: { message?: string } | null | undefined): string {
  const message = error?.message
  if (!message) return GENERIC

  // Caso especial: una mesa solo puede tener un elemento (índice 1:1).
  if (message.includes('floor_plan_elements_pt_uidx')) {
    return 'La mesa ya está ubicada en el plano.'
  }

  for (const key of Object.keys(PG_ERROR_MESSAGES)) {
    if (message.includes(key)) {
      return PG_ERROR_MESSAGES[key]
    }
  }

  return GENERIC
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run:
```bash
npx vitest run tests/lib/floor-plan-errors.test.ts
```
Expected: PASS (12 assertions verdes, incluido el caso `floor_plan_elements_pt_uidx` y el genérico).

- [ ] **Step 5: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/floor-plan/errors.ts tests/lib/floor-plan-errors.test.ts
git commit -m "feat(floor-plan): mapPgError con mensajes es-AR y caso pt_uidx"
```

---

### Task 4.3: `lib/tables` — sacar `active` de `updateTable` / `updateTableSchema`

> Contexto verificado: el único caller de `updateTable`/`updateTableSchema` que dependía de `active` es `app/(manager)/[tenantSlug]/configuracion/mesas/_components/edit-table-dialog.tsx`, que se **elimina en Phase 9**. `tables-list.tsx` lee `t.active` solo para un `Badge` (no llama `updateTable`). A partir de este cambio, `active` es **RPC-only** (vía `fp_set_table_active`, Phase 2/5); reusar `updateTable` para editar nombre/capacidad ya no puede reactivar una mesa desactivada (footgun del default `true` resuelto).

**Files:**
- Modify: `lib/tables/schemas.ts`
- Modify: `lib/tables/actions.ts`

- [ ] **Step 1: Confirmar que ningún otro caller depende de `active` vía `updateTable`/`updateTableSchema`**

Run:
```bash
grep -rn "updateTable\b\|updateTableSchema\|\.bind(null" --include="*.ts" --include="*.tsx" . \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -i "updateTable" | grep -v "lib/tables/actions.ts" | grep -v "lib/tables/schemas.ts"
```
Expected: exactamente una línea, en `app/(manager)/[tenantSlug]/configuracion/mesas/_components/edit-table-dialog.tsx` (el `useActionState` que liga `updateTable`). Ese archivo se borra en Phase 9. Si aparece **cualquier otro** archivo, detené el plan y avisá: hay un caller que depende de `active` y este cambio lo rompería.

- [ ] **Step 2: Quitar `active` de `updateTableSchema`**

En `lib/tables/schemas.ts`, el bloque actual es:
```ts
export const updateTableSchema = z.object({
  id: z.string().uuid(),
  label: labelField,
  capacity: capacityField,
  active: z.coerce.boolean().default(true),
})
```
Reemplazalo (quitando la línea `active`) por:
```ts
export const updateTableSchema = z.object({
  id: z.string().uuid(),
  label: labelField,
  capacity: capacityField,
})
```

- [ ] **Step 3: `updateTable` deja de leer/escribir `active` (3 ediciones precisas)**

En `lib/tables/actions.ts`:

(a) El `safeParse` actual incluye `active`:
```ts
  const parsed = updateTableSchema.safeParse({
    id: formData.get('id'),
    label: formData.get('label'),
    capacity: formData.get('capacity'),
    active: formData.get('active') === 'on',
  })
```
Reemplazalo por (sin la línea `active`):
```ts
  const parsed = updateTableSchema.safeParse({
    id: formData.get('id'),
    label: formData.get('label'),
    capacity: formData.get('capacity'),
  })
```

(b) El `.update(...)` actual escribe la columna `active`:
```ts
  const { error } = await supabase
    .from('physical_tables')
    .update({
      label: parsed.data.label,
      capacity: parsed.data.capacity,
      active: parsed.data.active,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
```
Reemplazalo por (sin tocar `active` — la activación es RPC-only vía `fp_set_table_active`):
```ts
  const { error } = await supabase
    .from('physical_tables')
    .update({
      label: parsed.data.label,
      capacity: parsed.data.capacity,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
```

(c) El `logAudit` actual referencia `parsed.data.active`:
```ts
  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'update',
    entity: 'physical_table',
    entityId: parsed.data.id,
    payload: { label: parsed.data.label, active: parsed.data.active },
  })
```
Reemplazalo por (payload sin `active`):
```ts
  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'update',
    entity: 'physical_table',
    entityId: parsed.data.id,
    payload: { label: parsed.data.label, capacity: parsed.data.capacity },
  })
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: FALLA con un único error en `app/(manager)/[tenantSlug]/configuracion/mesas/_components/edit-table-dialog.tsx` — el form usa `name="active"` / `table.active` contra el schema que ya no lo acepta. Ese archivo se **elimina en Phase 9**; el error es esperado y se resuelve allí. Confirmá que es el **único** archivo con error. Si hay errores en cualquier otro archivo, revisá Step 1.

> Nota para el ejecutor: como este typecheck queda rojo hasta Phase 9, el pre-commit hook (`typecheck && lint && test:ci`) abortaría el commit. **No** uses `--no-verify`. Hacé el commit de esta tarea **después** de que Phase 9 elimine `edit-table-dialog.tsx` (junto con `tables-list.tsx` y `new-table-dialog.tsx`), o reordená la ejecución para que la eliminación de esos archivos preceda a este commit. La regla de oro de CLAUDE.md (sin `--no-verify`, arreglar la causa) manda: la causa es el archivo legacy, que ya está planificado para borrarse.

- [ ] **Step 5: Verificar el test de `lib/tables` (si existe) sigue verde sin `active`**

Run:
```bash
npx vitest run tests/lib --reporter=dot 2>&1 | tail -20
```
Expected: la suite de schemas/actions de tables (si la hay) no falla por `active`. Si algún test referenciaba `updateTableSchema(...).active`, ajustalo para no esperar ese campo (no agregues tests nuevos: este cambio es una sustracción de campo, cubierta por el typecheck).

- [ ] **Step 6: Commit (ejecutar tras la eliminación de `edit-table-dialog.tsx` en Phase 9)**

```bash
git add lib/tables/schemas.ts lib/tables/actions.ts
git commit -m "refactor(tables): updateTable deja de manejar active (RPC-only via fp_set_table_active)"
```

---

## Phase 5: queries.ts (getFloorPlan) + actions.ts (Server Actions)

CONTRACT ADDITIONS:
- `actions.ts` defines a private `authorize(slug)` helper (mirrors `lib/tables/actions.ts`) returning `{ tenant, role, userId } | null`. Not in Contracts but needed by every action; it folds `requireTenantAccess` + `requireRole(['owner'])` + `supabase.auth.getUser()`. The Contracts' per-action pattern is preserved.
- `actions.ts` defines a private `flattenIssues(error)` helper (identical to `lib/tables/actions.ts`) to populate `fieldErrors` from a `ZodError`. Not in Contracts but used by zod-validated actions.
- `logAudit` `action`/`entity` string values used below: entities `floor_plan_area`, `floor_plan_element`, `physical_table`; actions `create`/`rename`/`update`/`reorder`/`delete`/`split`/`merge`/`deactivate`/`reactivate`/`delete_permanent`/`place`/`remove_from_plan`. These are free-form strings (`logAudit` takes `action: string`, `entity: string`), consistent with `lib/tables/actions.ts`.

### Task 5.1: `lib/floor-plan/queries.ts` — `getFloorPlan(tenantId)`

**Files:**
- Create: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/queries.ts`

- [ ] **Step 1: Write `queries.ts` with the three reads and full row mapping**

This is `server-only` and uses the server supabase client (same pattern as `lib/tables/queries.ts`). RLS already scopes rows to the caller's tenant; we still filter `tenant_id` explicitly per CLAUDE.md §4. The three reads:
1. `areas` — `floor_plan_areas` ordered `position, created_at, id`.
2. `elements` — `floor_plan_elements` ordered `z_index, created_at, id`, joined to `physical_tables` so `kind='table'` rows carry `FloorTableMeta`.
3. `unplacedTables` — active `physical_tables` with NO row in `floor_plan_elements` (anti-join on `physical_table_id`).

Create `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/queries.ts`:

```ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type AreaRow = {
  id: string
  name: string
  position: number
  width: number
  height: number
  number_start: number
}

export type FloorTableMeta = {
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
}

export type ElementRow = {
  id: string
  area_id: string
  kind: 'table' | 'wall' | 'pillar' | 'island' | 'bar'
  shape: 'rect' | 'circle'
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z_index: number
  label: string | null
  color: string | null
  table: FloorTableMeta | null
}

export type UnplacedTable = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
}

export type FloorPlanData = {
  areas: AreaRow[]
  elements: ElementRow[]
  unplacedTables: UnplacedTable[]
}

// Forma cruda de la fila de elemento con el join embebido a physical_tables.
type RawElementRow = {
  id: string
  area_id: string
  kind: ElementRow['kind']
  shape: ElementRow['shape']
  physical_table_id: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z_index: number
  label: string | null
  color: string | null
  // Supabase devuelve el join como objeto o null (relación to-one por la FK).
  physical_tables:
    | { label: string; capacity: number | null; qr_token: string; active: boolean }
    | null
}

const EMPTY: FloorPlanData = { areas: [], elements: [], unplacedTables: [] }

export async function getFloorPlan(tenantId: string): Promise<FloorPlanData> {
  const supabase = await createClient()

  // 1) Áreas del tenant, orden canónico.
  const { data: areasData, error: areasError } = await supabase
    .from('floor_plan_areas')
    .select('id, name, position, width, height, number_start')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (areasError) {
    console.error('[floor-plan.getFloorPlan] areas', areasError.message)
    return EMPTY
  }

  // 2) Elementos del tenant + join a physical_tables (solo poblado en kind='table').
  const { data: elementsData, error: elementsError } = await supabase
    .from('floor_plan_elements')
    .select(
      'id, area_id, kind, shape, physical_table_id, x, y, width, height, rotation, z_index, label, color, physical_tables(label, capacity, qr_token, active)',
    )
    .eq('tenant_id', tenantId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (elementsError) {
    console.error('[floor-plan.getFloorPlan] elements', elementsError.message)
    return EMPTY
  }

  // 3) Mesas activas sin elemento (anti-join). PostgREST no soporta NOT EXISTS
  // declarativo, así que traemos las activas y restamos las ya ubicadas.
  const { data: tablesData, error: tablesError } = await supabase
    .from('physical_tables')
    .select('id, label, capacity, qr_token')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('label', { ascending: true })

  if (tablesError) {
    console.error('[floor-plan.getFloorPlan] tables', tablesError.message)
    return EMPTY
  }

  const rawElements = (elementsData ?? []) as unknown as RawElementRow[]

  const elements: ElementRow[] = rawElements.map((row) => ({
    id: row.id,
    area_id: row.area_id,
    kind: row.kind,
    shape: row.shape,
    physical_table_id: row.physical_table_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    z_index: row.z_index,
    label: row.label,
    color: row.color,
    table:
      row.kind === 'table' && row.physical_tables
        ? {
            label: row.physical_tables.label,
            capacity: row.physical_tables.capacity,
            qr_token: row.physical_tables.qr_token,
            active: row.physical_tables.active,
          }
        : null,
  }))

  // Ids de mesas ya ubicadas (tienen elemento).
  const placedTableIds = new Set(
    rawElements.map((row) => row.physical_table_id).filter((id): id is string => id !== null),
  )

  const unplacedTables: UnplacedTable[] = (tablesData ?? [])
    .filter((t) => !placedTableIds.has(t.id))
    .map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      qr_token: t.qr_token,
    }))

  const areas: AreaRow[] = (areasData ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    position: a.position,
    width: a.width,
    height: a.height,
    number_start: a.number_start,
  }))

  return { areas, elements, unplacedTables }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck
```
Expected output: no errors (exit 0). `getFloorPlan`, `AreaRow`, `ElementRow`, `FloorTableMeta`, `UnplacedTable`, `FloorPlanData` resolve against the generated `types/database.ts` (the floor-plan tables exist from Phase 1). If the join select string errors against generated types, the embedded relation `physical_tables(...)` is cast through `unknown as RawElementRow[]` so it stays sound.

- [ ] **Step 3: Lint**

Run:
```bash
npm run lint
```
Expected output: `Checked N files ... No fixes applied` (exit 0), no errors on `lib/floor-plan/queries.ts`.

- [ ] **Step 4: Commit**

Run:
```bash
git add lib/floor-plan/queries.ts && git commit -m "feat(floor-plan): getFloorPlan query (areas + elements join + unplaced anti-join)"
```

---

### Task 5.2: `lib/floor-plan/actions.ts` — área actions (createArea/rename/updateCanvas/reorder/deleteArea)

**Files:**
- Create: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts`

- [ ] **Step 1: Write the file header, shared helpers, and the five area actions**

Create `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts` with the full header (imports, `FloorPlanActionState`, `authorize`, `flattenIssues`) and the area actions. `createArea` computes a dense `position` as the current area count; `reorderAreas` reassigns dense positions `0..n-1`; `deleteArea`/area writes go through `rpc('fp_delete_area', ...)` and `mapPgError`. Audit only the structural mutations (`createArea`, `deleteArea`) per spec §6.4.

```ts
'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { mapPgError } from './errors'
import { ELEMENT_DEFAULTS, GRID } from './grid'
import { suggestNextLabel } from './numbering'
import {
  addDecorSchema,
  areaCanvasSchema,
  areaCreateSchema,
  areaRenameSchema,
  areaReorderSchema,
  createTableInPlanSchema,
  elementIdSchema,
  geometryBatchSchema,
  mergeTablesSchema,
  placeTableSchema,
  setTableActiveSchema,
  setZIndexSchema,
  splitTableSchema,
  updateDecorSchema,
} from './schemas'
import type { AddDecorInput, CreateTableInPlanInput, ElementGeometry } from './schemas'

export type FloorPlanActionState =
  | { ok: true; data?: unknown }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(
  slug: string,
): Promise<{ tenant: { id: string }; role: string; userId: string } | null> {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    return { tenant, role, userId: user.id }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

const NO_ACCESS: FloorPlanActionState = { ok: false, message: 'No tenés permiso.' }

// ────────────────────────────────────────────────────────────
// Áreas
// ────────────────────────────────────────────────────────────

export async function createAreaAction(
  slug: string,
  input: { name: string; number_start?: number },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()

  // Posición densa: al final de las áreas existentes.
  const { count, error: countError } = await supabase
    .from('floor_plan_areas')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', access.tenant.id)
  if (countError) {
    console.error('[floor-plan.createArea] count', countError.message)
    return { ok: false, message: 'No se pudo crear el área.' }
  }

  const { data, error } = await supabase
    .from('floor_plan_areas')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      number_start: parsed.data.number_start,
      position: count ?? 0,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.createArea]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'create',
    entity: 'floor_plan_area',
    entityId: data.id,
    payload: { name: parsed.data.name, number_start: parsed.data.number_start },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, data: { id: data.id } }
}

export async function renameAreaAction(
  slug: string,
  input: { id: string; name: string },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaRenameSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_areas')
    .update({ name: parsed.data.name })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[floor-plan.renameArea]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function updateAreaCanvasAction(
  slug: string,
  input: { id: string; width: number; height: number; number_start: number },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaCanvasSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_areas')
    .update({
      width: parsed.data.width,
      height: parsed.data.height,
      number_start: parsed.data.number_start,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[floor-plan.updateAreaCanvas]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function reorderAreasAction(
  slug: string,
  ids: string[],
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = areaReorderSchema.safeParse({ ids })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Posiciones densas 0..n-1 según el orden recibido. Cada update filtra por
  // tenant_id, así que un id de otro tenant no afecta filas (RLS + eq).
  for (let i = 0; i < parsed.data.ids.length; i++) {
    const id = parsed.data.ids[i]
    if (!id) continue
    const { error } = await supabase
      .from('floor_plan_areas')
      .update({ position: i })
      .eq('id', id)
      .eq('tenant_id', access.tenant.id)
    if (error) {
      console.error('[floor-plan.reorderAreas]', error.message)
      return { ok: false, message: mapPgError(error) }
    }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function deleteAreaAction(
  slug: string,
  areaId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: areaId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_delete_area', { p_area_id: parsed.data.id })

  if (error) {
    console.error('[floor-plan.deleteArea]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'delete',
    entity: 'floor_plan_area',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck
```
Expected output: no errors (exit 0). `rpc('fp_delete_area', ...)` resolves against the regenerated `types/database.ts` (RPCs created in Phase 2). The unused imports (`addDecorSchema`, `geometryBatchSchema`, `createTableInPlanSchema`, etc.) are consumed by Tasks 5.3–5.4 below, added in the same file; if you run typecheck/lint between tasks Biome will flag them as unused — that is expected and resolved by Task 5.4. To keep this task green in isolation, complete Steps 1 of 5.3 and 5.4 before running lint (they all live in one file).

- [ ] **Step 3: Commit**

Run:
```bash
git add lib/floor-plan/actions.ts && git commit -m "feat(floor-plan): area Server Actions (create/rename/canvas/reorder/delete)"
```

---

### Task 5.3: `lib/floor-plan/actions.ts` — geometry + table-structure actions

**Files:**
- Modify: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts`

- [ ] **Step 1: Append geometry + table-structure actions**

Append to `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts` (after `deleteAreaAction`). `saveGeometry` updates only `x,y,width,height,z_index` per element (never `area_id`/`tenant_id`/`kind`/`physical_table_id`). `createTableInPlan`/`splitTable` call `rpc('fp_create_table', ...)`; `splitTable` first reads the source element (geometry + area + the joined table's capacity + shape), computes the offset `(source.x+source.width+GRID, source.y)` clamped via `clampToArea` against the area's width/height, derives the next label with `suggestNextLabel` from the labels already in that area, then calls the RPC. `placeTable` inserts a `kind='table'` element; `removeFromPlan` deletes the element; `mergeTables`/`setTableActive`/`deleteTablePermanently` call their RPCs.

```ts

// ────────────────────────────────────────────────────────────
// Geometría
// ────────────────────────────────────────────────────────────

export async function saveGeometryAction(
  slug: string,
  items: ElementGeometry[],
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = geometryBatchSchema.safeParse({ items })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Update por elemento: SOLO x,y,width,height,z_index. Nunca area_id/tenant_id/
  // kind/physical_table_id. Cada update filtra por tenant_id (RLS + eq).
  for (const item of parsed.data.items) {
    const { error } = await supabase
      .from('floor_plan_elements')
      .update({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        z_index: item.z_index,
      })
      .eq('id', item.id)
      .eq('tenant_id', access.tenant.id)
    if (error) {
      console.error('[floor-plan.saveGeometry]', error.message)
      return { ok: false, message: mapPgError(error) }
    }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Estructura mesa-QR
// ────────────────────────────────────────────────────────────

export async function createTableInPlanAction(
  slug: string,
  input: CreateTableInPlanInput,
): Promise<
  | { ok: true; tableId: string; elementId: string; qrToken: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }
> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createTableInPlanSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fp_create_table', {
    p_area_id: parsed.data.area_id,
    p_label: parsed.data.label,
    p_capacity: parsed.data.capacity,
    p_shape: parsed.data.shape,
    p_x: parsed.data.x,
    p_y: parsed.data.y,
  })

  if (error || !data) {
    console.error('[floor-plan.createTableInPlan]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  const result = data as { table_id: string; element_id: string; qr_token: string }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'create',
    entity: 'physical_table',
    entityId: result.table_id,
    payload: { label: parsed.data.label, area_id: parsed.data.area_id },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return {
    ok: true,
    tableId: result.table_id,
    elementId: result.element_id,
    qrToken: result.qr_token,
  }
}

export async function splitTableAction(
  slug: string,
  sourceElementId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = splitTableSchema.safeParse({ source_element_id: sourceElementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()

  // 1) Leer el elemento source: geometría + área + capacidad/shape de la mesa.
  const { data: source, error: sourceError } = await supabase
    .from('floor_plan_elements')
    .select(
      'area_id, x, y, width, height, shape, physical_tables(capacity)',
    )
    .eq('id', parsed.data.source_element_id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')
    .single()

  if (sourceError || !source) {
    console.error('[floor-plan.splitTable] source', sourceError?.message)
    return { ok: false, message: 'No se pudo leer la mesa de origen.' }
  }

  const src = source as unknown as {
    area_id: string
    x: number
    y: number
    width: number
    height: number
    shape: 'rect' | 'circle'
    physical_tables: { capacity: number | null } | null
  }

  // 2) Leer el área para sus dimensiones (clamp) + las labels ya en el área.
  const { data: area, error: areaError } = await supabase
    .from('floor_plan_areas')
    .select('width, height, number_start')
    .eq('id', src.area_id)
    .eq('tenant_id', access.tenant.id)
    .single()

  if (areaError || !area) {
    console.error('[floor-plan.splitTable] area', areaError?.message)
    return { ok: false, message: 'No se pudo leer el área.' }
  }

  // Labels existentes en el área (para suggestNextLabel).
  const { data: siblings, error: siblingsError } = await supabase
    .from('floor_plan_elements')
    .select('physical_tables(label)')
    .eq('area_id', src.area_id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')

  if (siblingsError) {
    console.error('[floor-plan.splitTable] siblings', siblingsError.message)
    return { ok: false, message: 'No se pudo calcular el nombre.' }
  }

  const existingLabels = (
    (siblings ?? []) as unknown as { physical_tables: { label: string } | null }[]
  )
    .map((s) => s.physical_tables?.label)
    .filter((l): l is string => typeof l === 'string')

  const newLabel = suggestNextLabel(area.number_start, existingLabels)

  // 3) Offset: a la derecha del source, mismo y; clampeado al área.
  const offset = clampToArea(
    src.x + src.width + GRID,
    src.y,
    ELEMENT_DEFAULTS.table.width,
    ELEMENT_DEFAULTS.table.height,
    area.width,
    area.height,
  )

  // 4) Crear la mesa vía RPC (hereda área, capacidad y shape del source).
  const { data, error } = await supabase.rpc('fp_create_table', {
    p_area_id: src.area_id,
    p_label: newLabel,
    p_capacity: src.physical_tables?.capacity ?? null,
    p_shape: src.shape,
    p_x: offset.x,
    p_y: offset.y,
  })

  if (error || !data) {
    console.error('[floor-plan.splitTable]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  const result = data as { table_id: string; element_id: string; qr_token: string }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'split',
    entity: 'physical_table',
    entityId: result.table_id,
    payload: { source_element_id: parsed.data.source_element_id, label: newLabel },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, data: { tableId: result.table_id, elementId: result.element_id } }
}

export async function placeTableAction(
  slug: string,
  input: { table_id: string; area_id: string; x: number; y: number },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = placeTableSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  // El trigger fp_elements_integrity rechaza mesa inactiva / cross-tenant.
  const { data, error } = await supabase
    .from('floor_plan_elements')
    .insert({
      tenant_id: access.tenant.id,
      area_id: parsed.data.area_id,
      kind: 'table',
      shape: ELEMENT_DEFAULTS.table.shape,
      physical_table_id: parsed.data.table_id,
      x: parsed.data.x,
      y: parsed.data.y,
      width: ELEMENT_DEFAULTS.table.width,
      height: ELEMENT_DEFAULTS.table.height,
      z_index: 10,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.placeTable]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'place',
    entity: 'floor_plan_element',
    entityId: data.id,
    payload: { table_id: parsed.data.table_id, area_id: parsed.data.area_id },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, data: { id: data.id } }
}

export async function removeFromPlanAction(
  slug: string,
  elementId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: elementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  // Borra solo el elemento visual; la mesa sigue activa y vuelve a la bandeja.
  const { error } = await supabase
    .from('floor_plan_elements')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .eq('kind', 'table')

  if (error) {
    console.error('[floor-plan.removeFromPlan]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'remove_from_plan',
    entity: 'floor_plan_element',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function mergeTablesAction(
  slug: string,
  survivorTableId: string,
  absorbedTableId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = mergeTablesSchema.safeParse({
    survivor_table_id: survivorTableId,
    absorbed_table_id: absorbedTableId,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_merge_tables', {
    p_survivor_table_id: parsed.data.survivor_table_id,
    p_absorbed_table_id: parsed.data.absorbed_table_id,
  })

  if (error) {
    console.error('[floor-plan.mergeTables]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'merge',
    entity: 'physical_table',
    entityId: parsed.data.survivor_table_id,
    payload: { absorbed_table_id: parsed.data.absorbed_table_id },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function setTableActiveAction(
  slug: string,
  tableId: string,
  active: boolean,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = setTableActiveSchema.safeParse({ table_id: tableId, active })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_set_table_active', {
    p_table_id: parsed.data.table_id,
    p_active: parsed.data.active,
  })

  if (error) {
    console.error('[floor-plan.setTableActive]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: parsed.data.active ? 'reactivate' : 'deactivate',
    entity: 'physical_table',
    entityId: parsed.data.table_id,
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function deleteTablePermanentlyAction(
  slug: string,
  tableId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: tableId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fp_delete_table', { p_table_id: parsed.data.id })

  if (error) {
    console.error('[floor-plan.deleteTablePermanently]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: access.userId,
    action: 'delete_permanent',
    entity: 'physical_table',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}
```

- [ ] **Step 2: Add the `clampToArea` import**

`splitTableAction` uses `clampToArea`. Extend the existing `grid` import line. Open the file and replace the import added in Task 5.2:

```ts
import { ELEMENT_DEFAULTS, GRID } from './grid'
```
with:
```ts
import { clampToArea, ELEMENT_DEFAULTS, GRID } from './grid'
```

- [ ] **Step 3: Commit (deferred verification)**

Verification (typecheck/lint) runs at the end of Task 5.4 since all decor actions land in the same file and remove the last unused imports. Commit this logical group now:

Run:
```bash
git add lib/floor-plan/actions.ts && git commit -m "feat(floor-plan): geometry + table-structure Server Actions (save/create/split/place/remove/merge/active/delete)"
```

---

### Task 5.4: `lib/floor-plan/actions.ts` — decor actions + z-index

**Files:**
- Modify: `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts`

- [ ] **Step 1: Append decor actions and `setElementZIndex`**

Append to `/mnt/c/Users/Agust/Hub_main/lib/floor-plan/actions.ts` (after `deleteTablePermanentlyAction`). `addDecor` inserts a decor element (`kind in wall/pillar/island/bar`, `physical_table_id=null`); `updateDecor` patches `label`/`color`; `deleteDecor` deletes the element; `setElementZIndex` patches `z_index`. Decor mutations are low-risk/high-volume → no `logAudit` (spec §6.4).

```ts

// ────────────────────────────────────────────────────────────
// Decoración + z-index
// ────────────────────────────────────────────────────────────

export async function addDecorAction(
  slug: string,
  input: AddDecorInput,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = addDecorSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('floor_plan_elements')
    .insert({
      tenant_id: access.tenant.id,
      area_id: parsed.data.area_id,
      kind: parsed.data.kind,
      shape: parsed.data.shape,
      physical_table_id: null,
      x: parsed.data.x,
      y: parsed.data.y,
      width: parsed.data.width,
      height: parsed.data.height,
      label: parsed.data.label ?? null,
      color: parsed.data.color ?? null,
      z_index: 0,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[floor-plan.addDecor]', error?.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, data: { id: data.id } }
}

export async function updateDecorAction(
  slug: string,
  input: { id: string; label?: string | null; color?: string | null },
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = updateDecorSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  // Solo escribimos las keys presentes (label/color son opcionales).
  const patch: { label?: string | null; color?: string | null } = {}
  if ('label' in parsed.data) patch.label = parsed.data.label ?? null
  if ('color' in parsed.data) patch.color = parsed.data.color ?? null

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_elements')
    .update(patch)
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .neq('kind', 'table')

  if (error) {
    console.error('[floor-plan.updateDecor]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function deleteDecorAction(
  slug: string,
  elementId: string,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = elementIdSchema.safeParse({ id: elementId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_elements')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .neq('kind', 'table')

  if (error) {
    console.error('[floor-plan.deleteDecor]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}

export async function setElementZIndexAction(
  slug: string,
  elementId: string,
  zIndex: number,
): Promise<FloorPlanActionState> {
  const access = await authorize(slug)
  if (!access) return NO_ACCESS

  const parsed = setZIndexSchema.safeParse({ id: elementId, z_index: zIndex })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('floor_plan_elements')
    .update({ z_index: parsed.data.z_index })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[floor-plan.setElementZIndex]', error.message)
    return { ok: false, message: mapPgError(error) }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck the complete file**

Run:
```bash
npm run typecheck
```
Expected output: no errors (exit 0). Every imported schema (`addDecorSchema`, `geometryBatchSchema`, `createTableInPlanSchema`, `splitTableSchema`, `placeTableSchema`, `mergeTablesSchema`, `setTableActiveSchema`, `setZIndexSchema`, `updateDecorSchema`, `areaCreateSchema`, `areaRenameSchema`, `areaCanvasSchema`, `areaReorderSchema`, `elementIdSchema`) and helper (`mapPgError`, `suggestNextLabel`, `clampToArea`, `ELEMENT_DEFAULTS`, `GRID`) is now used, and all four `rpc(...)` calls (`fp_create_table`, `fp_merge_tables`, `fp_set_table_active`, `fp_delete_table`, `fp_delete_area`) resolve against `types/database.ts`.

- [ ] **Step 3: Lint the complete file**

Run:
```bash
npm run lint
```
Expected output: `Checked N files ... No fixes applied` (exit 0), no unused-import or other warnings on `lib/floor-plan/actions.ts`. If Biome reports an unused import, it means a schema isn't referenced — re-check the matching action body.

- [ ] **Step 4: Manual smoke note (deferred to Phase with UI wiring)**

These are server-only and have no UI yet. Functional verification of the actions happens via the RLS/integration tests in Phase 10 (`tests/rls/floor-plan.test.ts`: `fp_merge_tables`/`fp_set_table_active(false)` raise `table_has_open_session`; cashier/waiter get `owner_required`; cross-tenant insert fails). No Vitest unit tests are added here — the pure logic (`suggestNextLabel`, `clampToArea`, schemas) is covered by its own `tests/lib/*` in earlier phases.

- [ ] **Step 5: Commit**

Run:
```bash
git add lib/floor-plan/actions.ts && git commit -m "feat(floor-plan): decor + z-index Server Actions (addDecor/updateDecor/deleteDecor/setElementZIndex)"
```

---

## Phase 7: Frontend — floor-element, resize-handles, palette

CONTRACT ADDITIONS:
- None to the type/function signatures. Two presentational helpers are introduced locally inside `floor-element.tsx` and are NOT exported / not part of the public Contracts: `KIND_LABELS: Record<'table'|'wall'|'pillar'|'island'|'bar', string>` (es-AR labels for `aria-label` of decor) and a `decorFillVar` neutral token (`--muted`) used when `element.color` is `null`. These are implementation details, consistent with the spec §8 ("render neutral (token) cuando `color is null`") and the Contracts' `FloorElementProps`.
- The palette→editor wiring described in the phase brief (`onAddTable` opens a create dialog → `createTableInPlanAction`; `onAddDecor` → `addDecorAction` at canvas center) lives in `floor-plan-editor.tsx`, authored in a later phase. Phase 7 builds only the three leaf components with the exact `FloorElementProps` / `ResizeHandlesProps` / `ElementPaletteProps` from the Contracts; the editor supplies those callbacks. No new prop names are invented here.

> These three are leaf client components with no business logic and no E2E in MVP. Per the plan guidance there are **no component unit tests**; each task ends with `typecheck` + `lint` and a noted manual smoke. They depend on `lib/floor-plan/grid.ts` (`GRID`, `RESIZE_MIN`, `snapToGrid`, `ELEMENT_DEFAULTS`) and `lib/floor-plan/queries.ts` (`ElementRow`), which are authored in earlier phases and are assumed present.

### Task 7.1: `resize-handles.tsx` — handles propios con pointer capture

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/resize-handles.tsx`

- [ ] **Step 1: Implementar el componente completo**

`ResizeHandles` dibuja un handle de esquina (`se`) y dos handles de borde (`e`, `s`) como divs pequeños sobre el elemento seleccionado. Cada handle: en `onPointerDown` hace `e.stopPropagation()` (para que el drag de dnd-kit, cuyo activator vive en el body del elemento, no se dispare) + `setPointerCapture(e.pointerId)`. Mientras el puntero se mueve, calcula `width/height = max(RESIZE_MIN, snapToGrid(start + d/scale))` (la división por `scale` convierte el delta de px de pantalla a px lógicos), llama `onResize(size)` en vivo, y en `pointerup`/`pointercancel` llama `onResizeEnd(size)` y suelta la captura. Las props son EXACTAMENTE las del Contracts (`ResizeHandlesProps`).

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/resize-handles.tsx`:
```tsx
'use client'

import { useRef } from 'react'
import { RESIZE_MIN, snapToGrid } from '@/lib/floor-plan/grid'
import { cn } from '@/lib/utils'

type ResizeHandlesProps = {
  width: number
  height: number
  scale: number
  onResize: (size: { width: number; height: number }) => void
  onResizeEnd: (size: { width: number; height: number }) => void
}

type Axis = 'se' | 'e' | 's'

// Estado vivo del gesto de resize (refs, no state: no re-render por move).
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
  scale,
  onResize,
  onResizeEnd,
}: ResizeHandlesProps) {
  const drag = useRef<DragState | null>(null)

  function compute(state: DragState, e: PointerEvent | React.PointerEvent): {
    width: number
    height: number
  } {
    // Delta en px de pantalla → px lógicos dividiendo por scale.
    const dxLogical = (e.clientX - state.startX) / scale
    const dyLogical = (e.clientY - state.startY) / scale
    const nextW =
      state.axis === 's'
        ? state.startW
        : Math.max(RESIZE_MIN, snapToGrid(state.startW + dxLogical))
    const nextH =
      state.axis === 'e'
        ? state.startH
        : Math.max(RESIZE_MIN, snapToGrid(state.startH + dyLogical))
    return { width: nextW, height: nextH }
  }

  function handlePointerMove(e: PointerEvent) {
    const state = drag.current
    if (!state) return
    const size = compute(state, e)
    state.last = size
    onResize(size)
  }

  function handlePointerUpOrCancel(e: PointerEvent) {
    const state = drag.current
    if (!state) return
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUpOrCancel)
    window.removeEventListener('pointercancel', handlePointerUpOrCancel)
    const target = e.target as Element
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }
    drag.current = null
    onResizeEnd(state.last)
  }

  function startResize(axis: Axis) {
    return (e: React.PointerEvent) => {
      // CLAVE: detener la propagación para que el activator del drag (en el body
      // del FloorElement) no se dispare; el resize es un gesto independiente.
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
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUpOrCancel)
      window.addEventListener('pointercancel', handlePointerUpOrCancel)
    }
  }

  const base =
    'absolute z-20 rounded-sm border border-primary bg-background shadow-sm'

  return (
    <>
      {/* Esquina inferior-derecha (redimensiona ancho + alto) */}
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
        className={cn(
          base,
          'h-3 w-2.5 top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize',
        )}
        style={{ touchAction: 'none' }}
      />
      {/* Borde inferior (solo alto) */}
      <div
        role="presentation"
        aria-hidden
        onPointerDown={startResize('s')}
        className={cn(
          base,
          'h-2.5 w-3 left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize',
        )}
        style={{ touchAction: 'none' }}
      />
    </>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. (`RESIZE_MIN` y `snapToGrid` ya existen en `lib/floor-plan/grid.ts` de una fase previa; `cn` viene de `@/lib/utils`.) Si el lint marca el orden de los `addEventListener`/`removeEventListener` por referencias de funciones recreadas, está bien: `handlePointerMove`/`handlePointerUpOrCancel` se definen en el cierre del componente y comparten el `drag` ref, así que el `removeEventListener` desengancha la misma instancia dentro de un mismo render.

- [ ] **Step 3: Smoke manual (anotado, sin canvas aún)**

No hay smoke independiente posible en esta task (el componente sólo se ve montado dentro de `FloorElement` seleccionado, que se cablea en Task 7.2 y se monta en el canvas en una fase posterior). Anotar para el smoke integrado de la fase del editor: **arrastrar el handle `se` redimensiona ancho+alto con snap a 20px y mínimo 24px; arrastrar un handle NO mueve el elemento (no se dispara el drag de dnd-kit); a scale=2 el tamaño cambia 1 celda lógica por celda lógica recorrida en pantalla.**

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/resize-handles.tsx"
git commit -m "feat(floor-plan): resize-handles con pointer capture (stopPropagation vs dnd-kit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7.2: `floor-element.tsx` — div arrastrable (activator en el body)

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-element.tsx`

- [ ] **Step 1: Implementar el componente completo**

`FloorElement` posiciona un `<div>` absoluto en `left/top = element.x/element.y` (px **lógicos**) dentro del stage escalado, y le aplica el `transform` de dnd-kit (`CSS.Translate.toString(transform)`) durante el drag para el preview en vivo. El **activator del drag es solo el body interno**: `{...listeners}{...attributes}` + `setActivatorNodeRef` van en un div interno, NUNCA en los handles (los handles cortan la propagación en Task 7.1). El click sin drag (la `activationConstraint:{distance:8}` del `PointerSensor` lo garantiza) llama `onSelect(id)` vía `onClick` del body. Cuando `selected`, renderiza `<ResizeHandles>` y aplica un anillo + bump visual de z-index. El estilo por `kind`/`shape`: `circle`→`rounded-full`, `rect`→`rounded-md`; las mesas usan estilo card/forest y muestran label + capacidad; la decoración usa un fill de token neutro (`--muted`) cuando `color` es `null`, o el hex si está seteado, con `aria-label` = `kind + label`.

Props EXACTAS del Contracts (`FloorElementProps`). `scale` se usa solo para el `aria` y para pasar a `ResizeHandles`; el `left/top` queda en px lógicos porque el stage ya está escalado.

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-element.tsx`:
```tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties } from 'react'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { cn } from '@/lib/utils'
import { ResizeHandles } from './resize-handles'

type FloorElementProps = {
  element: ElementRow
  selected: boolean
  scale: number
  onSelect: (id: string) => void
  onResizeEnd: (id: string, size: { width: number; height: number }) => void
}

// Etiquetas es-AR por tipo (para aria-label de decoración). No exportado: detalle de UI.
const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
}

export function FloorElement({
  element,
  selected,
  scale,
  onSelect,
  onResizeEnd,
}: FloorElementProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: element.id })

  const isTable = element.kind === 'table'
  const isCircle = element.shape === 'circle'

  // El stage está escalado; el elemento se posiciona en px lógicos. El transform
  // de dnd-kit es para el preview en vivo del drag (se descarta en dragEnd y el
  // editor re-aplica la geometría committeada).
  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    transform: CSS.Translate.toString(transform),
    zIndex: selected ? element.z_index + 1000 : element.z_index,
    touchAction: 'none',
  }

  // Fill de decoración: hex del dueño, o token neutro si color is null (dark-mode safe).
  const decorStyle: CSSProperties | undefined = isTable
    ? undefined
    : { backgroundColor: element.color ?? 'var(--muted)' }

  const ariaLabel = isTable
    ? `Mesa ${element.table?.label ?? element.label ?? ''}`.trim()
    : `${KIND_LABELS[element.kind]}${element.label ? ` ${element.label}` : ''}`

  return (
    <div ref={setNodeRef} style={wrapperStyle}>
      {/* Body = activator del drag (NO los handles). Click sin drag selecciona. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={ariaLabel}
        aria-roledescription={isTable ? 'mesa arrastrable' : 'elemento decorativo arrastrable'}
        aria-pressed={selected}
        onClick={() => onSelect(element.id)}
        {...listeners}
        {...attributes}
        style={decorStyle}
        className={cn(
          'relative flex h-full w-full cursor-grab items-center justify-center overflow-hidden border text-center transition-shadow active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isCircle ? 'rounded-full' : 'rounded-md',
          isTable
            ? 'border-primary/40 bg-card text-card-foreground shadow-sm'
            : 'border-border/70 text-muted-foreground',
          selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
          isDragging && 'opacity-70 shadow-lg',
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
          width={element.width}
          height={element.height}
          scale={scale}
          onResize={() => {
            // Preview live: el editor maneja la geometría transitoria; acá no
            // re-renderizamos width/height locales para no pelear con el stage.
            // (El editor pasa onResizeEnd para committear; el live preview de
            // tamaño lo aplica el editor sobre el element prop.)
          }}
          onResizeEnd={(size) => onResizeEnd(element.id, size)}
        />
      )}
    </div>
  )
}
```

> Nota de wiring: el `onResize` (live) se deja como no-op a nivel `FloorElement` porque la geometría transitoria de tamaño la administra el editor (dueño del estado, Contracts `FloorPlanEditorProps`); `onResizeEnd` sí sube por `onResizeEnd(id, size)` al editor para encolar la persistencia. Esto es coherente con el spec §5 ("Estado transitorio … sube a editor en `dragEnd`/`pointerUp`"). Si en la fase del editor se quiere preview de tamaño en vivo, el editor reemplazará el `element.width/height` que recibe esta hoja; no hay cambio de firma.

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. (`useDraggable` viene de `@dnd-kit/core@^6.3.1`, `CSS` de `@dnd-kit/utilities@^3.2.2` — ambos ya instalados; `ElementRow` existe en `lib/floor-plan/queries.ts`; `ResizeHandles` de Task 7.1.) Si Biome marca el `onResize` vacío como `noEmptyBlockStatements`, dejá el comentario dentro del cuerpo (ya está) — eso lo satisface; si igual molesta, cambialo por `onResize={() => undefined}`.

- [ ] **Step 3: Smoke manual (anotado, integrado)**

Anotar para el smoke de la fase del editor: **el elemento se posiciona en `x/y` lógicos; arrastrar el body lo mueve (preview con transform); click <8px lo selecciona y abre inspector; seleccionado muestra los 3 handles; una mesa muestra label + capacidad; un decor sin color usa fill neutro y se ve bien en dark mode; el `aria-label` de un decor dice "Pared"/"Columna"/etc.**

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-element.tsx"
git commit -m "feat(floor-plan): floor-element arrastrable con activator en el body

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7.3: `element-palette.tsx` — botonera "agregar"

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/element-palette.tsx`

- [ ] **Step 1: Implementar el componente completo**

`ElementPalette` es una botonera con 5 botones — "Mesa", "Pared", "Columna", "Isla", "Barra" — usando íconos de `lucide-react` y el `Button` de shadcn (`variant="outline"`, `size="sm"`). "Mesa" llama `onAddTable()`; los otros cuatro llaman `onAddDecor(kind)` con el kind correspondiente. Props EXACTAS del Contracts (`ElementPaletteProps`). El editor (fase posterior) cablea `onAddTable` → diálogo de creación (label autosugerido vía `suggestNextLabel` + shape rect/circle + capacidad) → `createTableInPlanAction`, y `onAddDecor` → `addDecorAction` con `ELEMENT_DEFAULTS[kind]` al centro del canvas; esta hoja sólo dispara los callbacks.

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/element-palette.tsx`:
```tsx
'use client'

import { Box, Columns3, Square, Table2, Wine } from 'lucide-react'
import { Button } from '@/components/ui/button'

type DecorKind = 'wall' | 'pillar' | 'island' | 'bar'

type ElementPaletteProps = {
  onAddTable: () => void
  onAddDecor: (kind: DecorKind) => void
}

// Decoración: kind + label es-AR + ícono. Orden estable (pared, columna, isla, barra).
const DECOR: { kind: DecorKind; label: string; Icon: typeof Box }[] = [
  { kind: 'wall', label: 'Pared', Icon: Columns3 },
  { kind: 'pillar', label: 'Columna', Icon: Box },
  { kind: 'island', label: 'Isla', Icon: Square },
  { kind: 'bar', label: 'Barra', Icon: Wine },
]

export function ElementPalette({ onAddTable, onAddDecor }: ElementPaletteProps) {
  return (
    <div
      role="group"
      aria-label="Agregar elementos al plano"
      className="flex flex-wrap items-center gap-2"
    >
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={onAddTable}
        className="gap-1.5"
      >
        <Table2 className="size-4" aria-hidden />
        Mesa
      </Button>
      {DECOR.map(({ kind, label, Icon }) => (
        <Button
          key={kind}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAddDecor(kind)}
          className="gap-1.5"
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. (Los íconos `Box`, `Columns3`, `Square`, `Table2`, `Wine` existen en `lucide-react`; `Button` ya está en `components/ui/button.tsx` con `variant`/`size`.) El tipo `DecorKind` coincide con el literal `'wall'|'pillar'|'island'|'bar'` del Contracts `ElementPaletteProps`, así que el editor puede pasar su `onAddDecor` sin cast.

- [ ] **Step 3: Smoke manual (anotado, integrado)**

Anotar para el smoke de la fase del editor: **la botonera muestra Mesa/Pared/Columna/Isla/Barra; "Mesa" abre el diálogo de creación; cada botón de decoración agrega el elemento con su default (`ELEMENT_DEFAULTS[kind]`) al centro del canvas; navegable por teclado (Tab + Enter dispara el callback).**

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/element-palette.tsx"
git commit -m "feat(floor-plan): element-palette (mesa + decoración) con callbacks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8: Frontend — inspectors, area-manager, tray

CONTRACT ADDITIONS:
- `table-inspector.tsx` needs `regenerateQrToken` and `updateTable` from `@/lib/tables/actions` — these exist (Phase that modifies `lib/tables` strips `active` from `updateTable`'s FormData handling; the inspector's `<form>` only ever sends `id`, `label`, `capacity`, never `active`). No new signatures invented.
- `deleteTablePermanentlyAction(slug, tableId)` (already in Contracts) is wired into the table inspector's "QUITAR DEL PLANO" sibling control set as an optional "Borrar definitivamente" only when the table has no element/history is unknown client-side; per spec the RPC is the real guard, so the inspector surfaces its mapped error (`table_has_history`). It is included as an action call but the primary destructive control in this phase is "Quitar del plano" + "Desactivar".
- The inspectors call action results' `.message` directly (actions already map PG errors via `mapPgError`); a local `mapPgError` import is used only as a defensive fallback for a raw client-side Supabase error string, which does not occur here, so it is NOT imported in these components.

---

### Task 8.1: `table-inspector.tsx` — panel lateral de la mesa seleccionada

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/table-inspector.tsx`
- (reuse, no change) `app/(manager)/[tenantSlug]/configuracion/mesas/_components/print-qr-button.tsx`

- [ ] **Step 1: Implementar el inspector de mesa**

Este panel recibe `TableInspectorProps` (Contracts): `{ slug, element, allTables, onChanged, onClose }`. `element.table` está poblado (es `kind='table'`). Edita nombre/capacidad con `updateTable` (FormData `id,label,capacity` — NUNCA `active`), expone `PrintQrButton(element.table.qr_token)`, regenera token (`regenerateQrToken(slug, element.physical_table_id)`) con `AlertDialog`, activa/desactiva con `Switch` controlado + input oculto (patrón `capture-prompt-form`) → `setTableActiveAction(slug, tableId, active)`, DIVIDIR (`splitTableAction`), COMBINAR (`<Select>` de `allTables` + `AlertDialog` → `mergeTablesAction`), QUITAR DEL PLANO (`removeFromPlanAction`, deshabilitado si `element.table` tiene sesión abierta — best-effort, el RPC/acción es la guarda real; acá no tenemos el flag de sesión, así que el control queda siempre habilitado y la acción devuelve el error mapeado), al frente/al fondo (`setElementZIndexAction`). Muestra `qr_token`. En cualquier éxito llama `onChanged()`. Usa `sonner` con los mensajes `result.message` que ya vienen mapeados por la acción.

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/table-inspector.tsx`:
```tsx
'use client'

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  mergeTablesAction,
  removeFromPlanAction,
  setElementZIndexAction,
  setTableActiveAction,
  splitTableAction,
} from '@/lib/floor-plan/actions'
import type { ElementRow } from '@/lib/floor-plan/queries'
import { regenerateQrToken, updateTable } from '@/lib/tables/actions'
import { PrintQrButton } from './print-qr-button'

type TableInspectorProps = {
  slug: string
  element: ElementRow
  allTables: { id: string; label: string }[]
  onChanged: () => void
  onClose: () => void
}

const initialUpdate = { ok: false as const, message: '' }

export function TableInspector({
  slug,
  element,
  allTables,
  onChanged,
  onClose,
}: TableInspectorProps) {
  const tableId = element.physical_table_id as string
  const meta = element.table
  const [active, setActive] = useState(meta?.active ?? true)
  const [mergeTarget, setMergeTarget] = useState<string>('')
  const [pending, start] = useTransition()

  // Editar nombre/capacidad → updateTable (FormData id,label,capacity; NUNCA active).
  const [updateState, updateAction, updatePending] = useActionState(
    (prev: Awaited<ReturnType<typeof updateTable>>, fd: FormData) =>
      updateTable(slug, prev, fd),
    initialUpdate,
  )

  useEffect(() => {
    if (updateState.ok && updateState.tableId) {
      toast.success('Mesa actualizada.')
      onChanged()
    } else if (!updateState.ok && updateState.message) {
      toast.error(updateState.message)
    }
  }, [updateState, onChanged])

  // Sincroniza el switch local si cambia la mesa seleccionada.
  useEffect(() => {
    setActive(meta?.active ?? true)
  }, [meta?.active])

  const onToggleActive = (next: boolean) => {
    const prev = active
    setActive(next)
    start(async () => {
      const r = await setTableActiveAction(slug, tableId, next)
      if (r.ok) {
        toast.success(next ? 'Mesa activada.' : 'Mesa desactivada.')
        onChanged()
      } else {
        setActive(prev)
        toast.error(r.message)
      }
    })
  }

  const onRegenerate = () => {
    start(async () => {
      const r = await regenerateQrToken(slug, tableId)
      if (r.ok) {
        toast.success('QR regenerado.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onSplit = () => {
    start(async () => {
      const r = await splitTableAction(slug, element.id)
      if (r.ok) {
        toast.success('Mesa dividida.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onMerge = () => {
    if (!mergeTarget) return
    start(async () => {
      const r = await mergeTablesAction(slug, tableId, mergeTarget)
      if (r.ok) {
        toast.success('Mesas combinadas.')
        setMergeTarget('')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onRemove = () => {
    start(async () => {
      const r = await removeFromPlanAction(slug, element.id)
      if (r.ok) {
        toast.success('Mesa quitada del plano.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onZIndex = (zIndex: number) => {
    start(async () => {
      const r = await setElementZIndexAction(slug, element.id, zIndex)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const busy = pending || updatePending
  const mergeOptions = allTables.filter((t) => t.id !== tableId)

  return (
    <aside
      aria-label="Panel de mesa"
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">Mesa</h2>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar panel">
          <X className="size-4" />
        </Button>
      </div>

      {/* Editar nombre / capacidad */}
      <form action={updateAction} className="grid gap-3">
        <input type="hidden" name="id" value={tableId} />
        <div className="grid gap-1.5">
          <Label htmlFor="ti-label">Nombre</Label>
          <Input
            id="ti-label"
            name="label"
            required
            maxLength={40}
            defaultValue={meta?.label ?? ''}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ti-capacity">Capacidad</Label>
          <Input
            id="ti-capacity"
            name="capacity"
            type="number"
            min={1}
            max={50}
            defaultValue={meta?.capacity ?? ''}
            placeholder="Sin definir"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {updatePending ? 'Guardando…' : 'Guardar'}
        </Button>
      </form>

      <Separator />

      {/* QR */}
      <div className="grid gap-2">
        <Label>Código QR</Label>
        <code className="block truncate rounded-md bg-muted px-2 py-1 text-xs">
          {meta?.qr_token}
        </code>
        <div className="flex items-center gap-1">
          <PrintQrButton qrToken={meta?.qr_token ?? ''} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy}>
                <RefreshCw className="size-3.5" />
                Regenerar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Regenerar el QR?</AlertDialogTitle>
                <AlertDialogDescription>
                  El QR impreso anterior dejará de funcionar. Vas a tener que imprimir y
                  pegar el nuevo en la mesa.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onRegenerate}>Regenerar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Separator />

      {/* Activar / desactivar (RPC-only, NUNCA updateTable) */}
      <div className="flex items-center justify-between">
        <Label htmlFor="ti-active">Mesa activa</Label>
        <Switch
          id="ti-active"
          checked={active}
          onCheckedChange={onToggleActive}
          disabled={busy}
        />
      </div>

      <Separator />

      {/* Dividir / combinar */}
      <div className="grid gap-2">
        <Button size="sm" variant="outline" onClick={onSplit} disabled={busy}>
          <Copy className="size-3.5" />
          Dividir
        </Button>

        {mergeOptions.length > 0 ? (
          <div className="grid gap-2">
            <Select value={mergeTarget} onValueChange={setMergeTarget} disabled={busy}>
              <SelectTrigger aria-label="Mesa a absorber">
                <SelectValue placeholder="Combinar con…" />
              </SelectTrigger>
              <SelectContent>
                {mergeOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy || !mergeTarget}>
                  Combinar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Combinar las mesas?</AlertDialogTitle>
                  <AlertDialogDescription>
                    La mesa seleccionada absorbe a la otra. El QR de la mesa absorbida se
                    desactiva (no se pierde el historial). Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onMerge}>Combinar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>

      <Separator />

      {/* z-index */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index + 1)}
          disabled={busy}
        >
          <ArrowUpToLine className="size-3.5" />
          Al frente
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index - 1)}
          disabled={busy}
        >
          <ArrowDownToLine className="size-3.5" />
          Al fondo
        </Button>
      </div>

      <Separator />

      {/* Quitar del plano (la mesa sigue activa; vuelve a la bandeja) */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={busy}>
            <Trash2 className="size-3.5" />
            Quitar del plano
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar la mesa del plano?</AlertDialogTitle>
            <AlertDialogDescription>
              La mesa sigue activa y se puede volver a colocar desde la bandeja. Si tiene una
              sesión abierta no se podrá quitar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onRemove}>Quitar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS. (Depende de que `lib/floor-plan/actions.ts`, `lib/floor-plan/queries.ts` y la versión sin-`active` de `lib/tables/actions.ts` ya existan de fases previas. Si `updateTable` aún exporta el campo `active`, el `<form>` igualmente no lo envía — sigue compilando.)

- [ ] **Step 3: Lint**

Run:
```bash
npm run lint
```
Expected: PASS (Biome sin warnings).

- [ ] **Step 4: Smoke manual (anotado, sin E2E en MVP)**

Se valida en el smoke integral de la fase de wiring del editor (Task que monta `floor-plan-editor.tsx`): seleccionar una mesa abre este panel; editar nombre/capacidad y guardar persiste; el `Switch` desactiva/activa vía RPC; Dividir crea otra mesa+QR; Combinar con `Select` + confirmación absorbe la otra; Regenerar cambia el `qr_token`; Imprimir abre `/print/qr/<token>`; Quitar del plano la manda a la bandeja; con sesión abierta, Combinar/Quitar/Desactivar muestran el toast mapeado (`table_has_open_session`). Anotar en el PR con screenshots.

- [ ] **Step 5: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/table-inspector.tsx"
git commit -m "feat(floor-plan): table-inspector con edición/QR/activar/dividir/combinar/quitar"
```

---

### Task 8.2: `decor-inspector.tsx` — panel de un elemento de decoración

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/decor-inspector.tsx`

- [ ] **Step 1: Implementar el inspector de decoración**

Recibe `DecorInspectorProps` (Contracts): `{ slug, element, onChanged, onClose }`. Edita `label` (input, ≤40) y `color` (hex 6 dígitos opcional) vía `updateDecorAction(slug, { id, label, color })`; al frente/al fondo vía `setElementZIndexAction(slug, elementId, zIndex)`; borrar vía `deleteDecorAction(slug, elementId)` con `AlertDialog`. El tamaño se ajusta con los handles de resize en el canvas (se anota, no hay UI de tamaño acá). `onChanged()` tras cada éxito.

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/decor-inspector.tsx`:
```tsx
'use client'

import { ArrowDownToLine, ArrowUpToLine, Trash2, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  deleteDecorAction,
  setElementZIndexAction,
  updateDecorAction,
} from '@/lib/floor-plan/actions'
import type { ElementRow } from '@/lib/floor-plan/queries'

type DecorInspectorProps = {
  slug: string
  element: ElementRow
  onChanged: () => void
  onClose: () => void
}

const KIND_LABELS: Record<ElementRow['kind'], string> = {
  table: 'Mesa',
  wall: 'Pared',
  pillar: 'Columna',
  island: 'Isla',
  bar: 'Barra',
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function DecorInspector({ slug, element, onChanged, onClose }: DecorInspectorProps) {
  const [label, setLabel] = useState(element.label ?? '')
  const [color, setColor] = useState(element.color ?? '')
  const [pending, start] = useTransition()

  // Re-sincroniza si cambia el elemento seleccionado.
  useEffect(() => {
    setLabel(element.label ?? '')
    setColor(element.color ?? '')
  }, [element.id, element.label, element.color])

  const colorInvalid = color.trim().length > 0 && !HEX_RE.test(color.trim())

  const onSave = () => {
    if (colorInvalid) {
      toast.error('El color debe ser un hex de 6 dígitos (ej. #4f7d58).')
      return
    }
    start(async () => {
      const r = await updateDecorAction(slug, {
        id: element.id,
        label: label.trim().length > 0 ? label.trim() : null,
        color: color.trim().length > 0 ? color.trim() : null,
      })
      if (r.ok) {
        toast.success('Decoración actualizada.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onZIndex = (zIndex: number) => {
    start(async () => {
      const r = await setElementZIndexAction(slug, element.id, zIndex)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const onDelete = () => {
    start(async () => {
      const r = await deleteDecorAction(slug, element.id)
      if (r.ok) {
        toast.success('Decoración borrada.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <aside
      aria-label="Panel de decoración"
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">{KIND_LABELS[element.kind]}</h2>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar panel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="di-label">Etiqueta</Label>
        <Input
          id="di-label"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Opcional"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="di-color">Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Selector de color"
            className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            value={HEX_RE.test(color.trim()) ? color.trim() : '#888888'}
            onChange={(e) => setColor(e.target.value)}
          />
          <Input
            id="di-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#4f7d58 (opcional)"
            aria-invalid={colorInvalid}
          />
        </div>
        {colorInvalid ? (
          <p className="text-xs text-destructive">Usá un hex de 6 dígitos, ej. #4f7d58.</p>
        ) : null}
      </div>

      <Button size="sm" onClick={onSave} disabled={pending || colorInvalid}>
        {pending ? 'Guardando…' : 'Guardar'}
      </Button>

      <p className="text-xs text-muted-foreground">
        El tamaño se ajusta arrastrando los controladores del elemento en el plano.
      </p>

      <Separator />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index + 1)}
          disabled={pending}
        >
          <ArrowUpToLine className="size-3.5" />
          Al frente
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onZIndex(element.z_index - 1)}
          disabled={pending}
        >
          <ArrowDownToLine className="size-3.5" />
          Al fondo
        </Button>
      </div>

      <Separator />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            <Trash2 className="size-3.5" />
            Borrar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la decoración?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina del plano. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS.

- [ ] **Step 3: Smoke manual (anotado)**

En el smoke del editor: seleccionar una pared/columna/isla/barra abre este panel; cambiar etiqueta y color (vía picker o texto hex) y guardar persiste; un hex inválido bloquea el guardado con mensaje; al frente/al fondo reordena; borrar (con confirmación) lo saca del plano. El tamaño se confirma con los handles de resize. Anotar en el PR.

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/decor-inspector.tsx"
git commit -m "feat(floor-plan): decor-inspector con etiqueta/color/z-index/borrar"
```

---

### Task 8.3: `area-manager.tsx` — CRUD de áreas

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/area-manager.tsx`

- [ ] **Step 1: Implementar el gestor de áreas**

Recibe `AreaManagerProps` (Contracts): `{ slug, areas, activeAreaId, onActiveAreaChange, onChanged }`. Lista de áreas con la activa resaltada (click → `onActiveAreaChange(id)`); crear área (`createAreaAction(slug, { name, number_start })`); renombrar (`renameAreaAction(slug, { id, name })`); editar lienzo `width`/`height`/`number_start` (`updateAreaCanvasAction(slug, { id, width, height, number_start })`); reordenar con botones subir/bajar (`reorderAreasAction(slug, ids)` con los ids reordenados); borrar (`deleteAreaAction(slug, areaId)` con `AlertDialog`; muestra los mensajes mapeados `area_has_active_tables` / `cannot_delete_last_area`). `onChanged()` tras cada éxito.

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/area-manager.tsx`:
```tsx
'use client'

import { ChevronDown, ChevronUp, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  createAreaAction,
  deleteAreaAction,
  renameAreaAction,
  reorderAreasAction,
  updateAreaCanvasAction,
} from '@/lib/floor-plan/actions'
import type { AreaRow } from '@/lib/floor-plan/queries'

type AreaManagerProps = {
  slug: string
  areas: AreaRow[]
  activeAreaId: string
  onActiveAreaChange: (id: string) => void
  onChanged: () => void
}

export function AreaManager({
  slug,
  areas,
  activeAreaId,
  onActiveAreaChange,
  onChanged,
}: AreaManagerProps) {
  const [pending, start] = useTransition()
  // Estado de "agregar área"
  const [newName, setNewName] = useState('')
  const [newStart, setNewStart] = useState('1')
  // Edición inline por área (renombrar + lienzo)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editWidth, setEditWidth] = useState('')
  const [editHeight, setEditHeight] = useState('')
  const [editStart, setEditStart] = useState('')

  const onCreate = () => {
    const name = newName.trim()
    if (name.length === 0) {
      toast.error('Poné un nombre para el área.')
      return
    }
    start(async () => {
      const r = await createAreaAction(slug, {
        name,
        number_start: Number(newStart) || 0,
      })
      if (r.ok) {
        toast.success('Área creada.')
        setNewName('')
        setNewStart('1')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const openEditor = (area: AreaRow) => {
    setEditingId(area.id)
    setEditName(area.name)
    setEditWidth(String(area.width))
    setEditHeight(String(area.height))
    setEditStart(String(area.number_start))
  }

  const onRename = (id: string) => {
    const name = editName.trim()
    if (name.length === 0) {
      toast.error('El nombre no puede estar vacío.')
      return
    }
    start(async () => {
      const r = await renameAreaAction(slug, { id, name })
      if (r.ok) {
        toast.success('Área renombrada.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onSaveCanvas = (id: string) => {
    start(async () => {
      const r = await updateAreaCanvasAction(slug, {
        id,
        width: Number(editWidth) || 0,
        height: Number(editHeight) || 0,
        number_start: Number(editStart) || 0,
      })
      if (r.ok) {
        toast.success('Lienzo actualizado.')
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onReorder = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= areas.length) return
    const ids = areas.map((a) => a.id)
    const [moved] = ids.splice(index, 1)
    if (!moved) return
    ids.splice(target, 0, moved)
    start(async () => {
      const r = await reorderAreasAction(slug, ids)
      if (r.ok) onChanged()
      else toast.error(r.message)
    })
  }

  const onDelete = (id: string) => {
    start(async () => {
      const r = await deleteAreaAction(slug, id)
      if (r.ok) {
        toast.success('Área borrada.')
        if (id === activeAreaId) {
          const next = areas.find((a) => a.id !== id)
          if (next) onActiveAreaChange(next.id)
        }
        onChanged()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <section
      aria-label="Áreas del plano"
      className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-card p-4"
    >
      <h2 className="font-display text-sm font-semibold">Áreas</h2>

      <ul className="grid gap-1.5">
        {areas.map((area, index) => {
          const isActive = area.id === activeAreaId
          const isEditing = editingId === area.id
          return (
            <li key={area.id} className="rounded-lg border">
              <div
                className={`flex items-center gap-1 rounded-t-lg px-2 py-1.5 ${
                  isActive ? 'bg-primary/10' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onActiveAreaChange(area.id)}
                  className={`flex-1 truncate text-left text-sm ${
                    isActive ? 'font-semibold' : ''
                  }`}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {area.name}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending || index === 0}
                  onClick={() => onReorder(index, -1)}
                  aria-label={`Subir ${area.name}`}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending || index === areas.length - 1}
                  onClick={() => onReorder(index, 1)}
                  aria-label={`Bajar ${area.name}`}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending}
                  onClick={() => (isEditing ? setEditingId(null) : openEditor(area))}
                  aria-label={`Editar ${area.name}`}
                >
                  <Settings2 className="size-3.5" />
                </Button>
              </div>

              {isEditing ? (
                <div className="grid gap-2 border-t p-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`area-name-${area.id}`} className="text-xs">
                      Nombre
                    </Label>
                    <div className="flex gap-1">
                      <Input
                        id={`area-name-${area.id}`}
                        value={editName}
                        maxLength={40}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-8 shrink-0"
                        disabled={pending}
                        onClick={() => onRename(area.id)}
                        aria-label="Guardar nombre"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1">
                    <div className="grid gap-1">
                      <Label htmlFor={`area-w-${area.id}`} className="text-xs">
                        Ancho
                      </Label>
                      <Input
                        id={`area-w-${area.id}`}
                        type="number"
                        min={200}
                        max={6000}
                        value={editWidth}
                        onChange={(e) => setEditWidth(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`area-h-${area.id}`} className="text-xs">
                        Alto
                      </Label>
                      <Input
                        id={`area-h-${area.id}`}
                        type="number"
                        min={200}
                        max={6000}
                        value={editHeight}
                        onChange={(e) => setEditHeight(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`area-n-${area.id}`} className="text-xs">
                        Desde N°
                      </Label>
                      <Input
                        id={`area-n-${area.id}`}
                        type="number"
                        min={0}
                        max={100000}
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        className="h-8"
                      />
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onSaveCanvas(area.id)}
                  >
                    Guardar lienzo
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={pending}>
                        <Trash2 className="size-3.5" />
                        Borrar área
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Borrar el área “{area.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se borran sus elementos de decoración. No se puede borrar si tiene
                          mesas activas ubicadas, ni si es la única área.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(area.id)}>
                          Borrar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <Separator />

      {/* Crear área */}
      <div className="grid gap-2">
        <Label htmlFor="new-area-name" className="text-xs">
          Nueva área
        </Label>
        <Input
          id="new-area-name"
          value={newName}
          maxLength={40}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Planta Baja, Terraza…"
          className="h-8"
        />
        <div className="grid gap-1">
          <Label htmlFor="new-area-start" className="text-xs">
            Numerar desde
          </Label>
          <Input
            id="new-area-start"
            type="number"
            min={0}
            max={100000}
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            className="h-8"
          />
        </div>
        <Button size="sm" onClick={onCreate} disabled={pending}>
          <Plus className="size-3.5" />
          Crear área
        </Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS.

- [ ] **Step 3: Smoke manual (anotado)**

En el smoke del editor: crear un área (con `number_start`), renombrarla, editar ancho/alto/desde-N°, reordenar con subir/bajar, cambiar el área activa al clickear; intentar borrar la única área → toast `cannot_delete_last_area`; intentar borrar un área con mesas activas ubicadas → toast `area_has_active_tables`; borrar un área vacía la elimina y reapunta la activa. Anotar en el PR.

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/area-manager.tsx"
git commit -m "feat(floor-plan): area-manager (crear/renombrar/lienzo/reordenar/borrar)"
```

---

### Task 8.4: `unplaced-tray.tsx` — bandeja de mesas no ubicadas

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/unplaced-tray.tsx`

- [ ] **Step 1: Implementar la bandeja de no ubicadas**

Recibe `UnplacedTrayProps` (Contracts): `{ tables, onPlace }`. Lista de chips de `UnplacedTable` (`{ id, label, capacity, qr_token }`); cada chip es arrastrable al canvas (via `useDraggable` de dnd-kit, sin transform visual propio — el `DndContext` lo provee el editor; el `id` del draggable se prefija `tray:` para que el editor lo distinga de los elementos del plano) **y** tiene un botón "Colocar" que llama `onPlace(tableId)` (el editor coloca en el centro del canvas vía `placeTableAction`). Muestra label/capacidad/qr.

> El `useDraggable` se monta dentro del `DndContext` del editor (la bandeja se renderiza como hija del editor). Si la mesa se arrastra, el editor resuelve el drop con su handler `onDragEnd` y llama `placeTableAction` con las coordenadas; el botón "Colocar" es el camino accesible/no-drag equivalente.

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/unplaced-tray.tsx`:
```tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UnplacedTable } from '@/lib/floor-plan/queries'

type UnplacedTrayProps = {
  tables: UnplacedTable[]
  onPlace: (tableId: string) => void
}

// id de draggable de bandeja, distinguible de los elementos del plano por el prefijo.
export const TRAY_DRAG_PREFIX = 'tray:'

function TrayChip({
  table,
  onPlace,
}: {
  table: UnplacedTable
  onPlace: (tableId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${TRAY_DRAG_PREFIX}${table.id}`,
    data: { kind: 'tray-table', tableId: table.id },
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), touchAction: 'none' }}
      className={`flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground"
        aria-label={`Arrastrar mesa ${table.label} al plano`}
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{table.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {table.capacity != null ? `${table.capacity} pers.` : 'Sin capacidad'} ·{' '}
          <code>{table.qr_token}</code>
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => onPlace(table.id)}
      >
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
        <p className="text-xs text-muted-foreground">
          No hay mesas activas pendientes de ubicar.
        </p>
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

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. (`@dnd-kit/core` y `@dnd-kit/utilities` ya están instalados por la fase de dependencias/canvas; `useDraggable` y `CSS.Translate` son API v6.)

- [ ] **Step 3: Smoke manual (anotado)**

En el smoke del editor: una mesa desactivada→reactivada o una mesa de un área borrada aparece en la bandeja; el botón "Colocar" la ubica en el centro del canvas del área activa (vía `placeTableAction`); arrastrarla al canvas la coloca en la posición soltada. Muestra label, capacidad y qr_token. Anotar en el PR.

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/unplaced-tray.tsx"
git commit -m "feat(floor-plan): unplaced-tray con chips arrastrables + colocar"
```

---

## Phase 9: Frontend — integración (page, editor, canvas, a11y, fallback, cola, borrado UI vieja)

CONTRACT ADDITIONS (fold into the plan's `## Contracts` section — every item below is used by this phase and is NOT yet literally in the Contracts):

- **`lib/floor-plan/a11y.ts`** (`'use client'`-safe puro, no React): exporta los objetos que consume `DndContext` en español rioplatense.
  ```ts
  import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core'
  export const floorPlanScreenReaderInstructions: ScreenReaderInstructions
  export const floorPlanAnnouncements: Announcements
  // Keymap (JSDoc): click/Enter = seleccionar + abrir inspector; Space = levantar (modo teclado);
  // flechas = mover 1 celda de grilla; Esc = cancelar.
  ```
- **`_components/floor-plan-error-boundary.tsx`** (`'use client'`): class component.
  ```ts
  type FloorPlanErrorBoundaryProps = { fallback: React.ReactNode; children: React.ReactNode }
  export class FloorPlanErrorBoundary extends Component<FloorPlanErrorBoundaryProps, { hasError: boolean }>
  ```
- **`_components/use-geometry-queue.ts`**: `GEOMETRY_FLUSH_MS = 600` (los Contracts dicen "e.g. 600ms"; fijado a 600). Firma EXACTA del Contracts: `useGeometryQueue(slug, onError): { enqueue; flushNow }`.
- **`FloorCanvasProps`**: agrego tres handlers opcionales `onZoomIn?: () => void; onZoomOut?: () => void; onFit?: () => void` a la firma del Contracts (el editor es dueño de `{scale,pan}` y baja los setters). El resto de `FloorCanvasProps` queda idéntico al Contracts.
- **`_components/create-table-dialog.tsx`** (`'use client'`): nuevo, abierto por el editor cuando se clickea "Mesa" en la paleta.
  ```ts
  type CreateTableDialogProps = {
    slug: string
    areaId: string
    areaNumberStart: number
    existingLabels: string[]
    centerX: number
    centerY: number
    open: boolean
    onOpenChange: (o: boolean) => void
    onCreated: () => void
  }
  ```
- **`_components/zero-area-cta.tsx`** (`'use client'`): `type ZeroAreaCtaProps = { slug: string }` — botón que llama `createAreaAction(slug, { name: 'Salón' })`.
- **`TRAY_DRAG_PREFIX`** (`'tray:'`) ya lo exporta `unplaced-tray.tsx` (Phase 8). El editor lo importa para distinguir, en `onDragEnd`, un drop de bandeja (`placeTableAction`) de un move de elemento del plano (`saveGeometryAction` vía cola).

> Esta fase **es la orquestación**: reemplaza los dos borradores que se solapaban (el "shell" con stubs de `onAddTable`/`onAddDecor`/`onPlace`, y el "wiring de a11y/tabs/borrado"). Todo se cablea acá; no quedan stubs. Importa contra las firmas EXACTAS del Contracts las hojas ya autoradas en fases previas (`floor-element`, `resize-handles`, `element-palette`, `table-inspector`, `decor-inspector`, `area-manager`, `unplaced-tray`, `print-qr-button`) y la lib (`grid`, `queries`, `schemas`, `actions`, `errors`, `numbering`, y `lib/tables`).
>
> **Pre-requisitos de merge** (de fases previas): `lib/floor-plan/{grid,queries,schemas,actions,errors,numbering}.ts`; `lib/tables/actions.ts` con `updateTable` sin `active`; y las hojas `_components/{floor-element,resize-handles,element-palette,table-inspector,decor-inspector,area-manager,unplaced-tray}.tsx` + `print-qr-button.tsx`. Si un módulo de esas fases falta, el typecheck lo dirá con "Cannot find module …" — reordená el merge; cualquier otro error TS es bug de esta fase.
>
> Todas las hojas son componentes cliente sin lógica de negocio y **no hay E2E en MVP**: cada task cierra con `typecheck` + `lint` y un smoke manual anotado. Cada task termina con un Conventional Commit (los mensajes de commit cierran con la línea `Co-Authored-By`).

---

### Task 9.1: `lib/floor-plan/a11y.ts` — announcements + screen reader es-AR

**Files:**
- Create: `lib/floor-plan/a11y.ts`

- [ ] **Step 1: Escribir el módulo completo**

Las firmas `Announcements` y `ScreenReaderInstructions` vienen de `@dnd-kit/core@^6.3.1` (`Announcements` = `{ onDragStart({active}), onDragOver({active,over}), onDragEnd({active,over}), onDragCancel({active,over}) }`, todos devuelven `string | undefined`; `ScreenReaderInstructions = { draggable: string }`). `active.id`/`over.id` son `UniqueIdentifier` (en nuestro caso, el id del elemento como string).

Create `lib/floor-plan/a11y.ts`:
```ts
import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core'

/**
 * Accesibilidad del editor de plano (CLAUDE.md §7: keyboard nav + ARIA, es-AR).
 *
 * KEYMAP CANÓNICO (documentado para que el comportamiento sea predecible y no
 * choque "abrir inspector" con "levantar para arrastrar"):
 *   - Click / Enter sobre un elemento  → lo SELECCIONA y abre su inspector.
 *   - Barra espaciadora (Space)        → LEVANTA el elemento para arrastre por teclado.
 *   - Flechas (↑ ↓ ← →)                → mueven el elemento levantado 1 celda de grilla.
 *   - Barra espaciadora (de nuevo)     → SUELTA el elemento en la posición nueva.
 *   - Escape (Esc)                     → CANCELA el arrastre y vuelve a la posición original.
 *
 * El paso por flecha equivale a `GRID * scale` px de pantalla (= 1 celda lógica);
 * lo configura el `coordinateGetter` del `KeyboardSensor` en floor-plan-editor.tsx.
 *
 * Estas cadenas las lee
 * `<DndContext accessibility={{ announcements, screenReaderInstructions }}>`.
 */
export const floorPlanScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'Para mover un elemento del plano con el teclado, presioná la barra espaciadora para levantarlo. ' +
    'Mientras lo movés, usá las flechas del teclado para desplazarlo de a una celda. ' +
    'Presioná la barra espaciadora de nuevo para soltarlo en la posición nueva, o Escape para cancelar. ' +
    'Para editar un elemento sin moverlo, presioná Enter: se selecciona y se abre su panel.',
}

export const floorPlanAnnouncements: Announcements = {
  onDragStart({ active }) {
    return `Levantaste el elemento ${active.id}. Usá las flechas para moverlo.`
  },
  onDragOver({ active, over }) {
    if (over) {
      return `El elemento ${active.id} está sobre el área ${over.id}.`
    }
    return `El elemento ${active.id} ya no está sobre un área.`
  },
  onDragEnd({ active, over }) {
    if (over) {
      return `Soltaste el elemento ${active.id} en el área ${over.id}.`
    }
    return `Soltaste el elemento ${active.id} en su nueva posición.`
  },
  onDragCancel({ active }) {
    return `Cancelaste el movimiento. El elemento ${active.id} volvió a su posición original.`
  },
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS — los objetos satisfacen `Announcements` / `ScreenReaderInstructions` de `@dnd-kit/core`. Sin errores TS, sin warnings de Biome.

- [ ] **Step 3: Commit**

```bash
git add lib/floor-plan/a11y.ts
git commit -m "feat(floor-plan): announcements + screen-reader instructions es-AR para dnd-kit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.2: `_components/floor-plan-error-boundary.tsx` — boundary con banner + fallback

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-plan-error-boundary.tsx`

> No hay `react-error-boundary` instalado (verificado en `package.json`). Se implementa con `React.Component` (la única forma de capturar errores de render en React 19). En error, muestra un banner `role="alert"` visible (tokens `warning`) + `this.props.fallback` (típicamente `<TablesListFallback/>`).

- [ ] **Step 1: Escribir el ErrorBoundary completo**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-plan-error-boundary.tsx`:
```tsx
'use client'

import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

type FloorPlanErrorBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type FloorPlanErrorBoundaryState = {
  hasError: boolean
}

/**
 * Si el editor visual de plano falla en render (p. ej. dnd-kit / geometría rara),
 * degradamos a la lista accesible en vez de romper toda la pantalla de mesas.
 * Sin react-error-boundary en el repo → class component con React.Component.
 */
export class FloorPlanErrorBoundary extends Component<
  FloorPlanErrorBoundaryProps,
  FloorPlanErrorBoundaryState
> {
  state: FloorPlanErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): FloorPlanErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Sin PII: el editor no maneja datos de cliente. Solo el mensaje + el component stack.
    console.error('[floor-plan.editor] render error', error.message, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>
              No pudimos cargar el editor visual de plano. Te mostramos la lista de mesas, donde
              podés hacer todo igual. Probá recargar la página para volver al editor.
            </p>
          </div>
          {this.props.fallback}
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS — componente nuevo, sin consumers todavía. Sin errores TS ni warnings.

- [ ] **Step 3: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-plan-error-boundary.tsx"
git commit -m "feat(floor-plan): error boundary cliente con banner y fallback a lista accesible

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.3: `_components/use-geometry-queue.ts` — cola de persistencia (debounce + rollback)

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/use-geometry-queue.ts`

> Una **única** cola `Map<id, ElementGeometry>` (last-write-wins por id). `enqueue` mete/reemplaza, programa un flush debounced (`GEOMETRY_FLUSH_MS = 600`) **y** registra un flush en `beforeunload`. `flushNow` vacía inmediatamente (lo usa `beforeunload`). En éxito limpia los ids enviados; en fallo (`ok:false` o throw) llama `onError(ids del batch)` para que el editor revierta el optimista + toast. drag-end y resize-end encolan acá: nunca dos escritores en paralelo. Firma EXACTA del Contracts (`useGeometryQueue(slug, onError): { enqueue, flushNow }`).

- [ ] **Step 1: Implementar el hook**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/use-geometry-queue.ts`:
```ts
'use client'

import { useCallback, useEffect, useRef } from 'react'
import { saveGeometryAction } from '@/lib/floor-plan/actions'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'

const GEOMETRY_FLUSH_MS = 600

export type GeometryQueue = {
  enqueue: (geom: ElementGeometry) => void
  flushNow: () => Promise<void>
}

/**
 * Cola única de persistencia de geometría. drag-end y resize-end encolan acá
 * (nunca dos escritores en paralelo). Flush por debounce (600ms) y en
 * beforeunload. Si el flush falla, onError(ids) deja que el editor revierta el
 * estado optimista de esos ids y muestre un toast.
 */
export function useGeometryQueue(
  slug: string,
  onError: (ids: string[]) => void,
): GeometryQueue {
  // Cola viva entre renders.
  const queueRef = useRef<Map<string, ElementGeometry>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onError fresco sin re-suscribir el beforeunload ni recrear flushNow.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const flushNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const queue = queueRef.current
    if (queue.size === 0) return
    // Snapshot + vaciado: si llegan nuevos encolados durante el await, se
    // persisten en el próximo flush.
    const items = Array.from(queue.values())
    const ids = items.map((it) => it.id)
    queue.clear()
    try {
      const result = await saveGeometryAction(slug, items)
      if (!result.ok) onErrorRef.current(ids)
    } catch {
      onErrorRef.current(ids)
    }
  }, [slug])

  const enqueue = useCallback(
    (geom: ElementGeometry) => {
      queueRef.current.set(geom.id, geom)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void flushNow()
      }, GEOMETRY_FLUSH_MS)
    },
    [flushNow],
  )

  // Flush best-effort al salir / esconder la pestaña.
  useEffect(() => {
    const handler = () => {
      void flushNow()
    }
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [flushNow])

  return { enqueue, flushNow }
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS — `saveGeometryAction` y `ElementGeometry` existen (fases de lib). Si falla con "Module has no exported member 'saveGeometryAction'", la fase de `lib/floor-plan/actions.ts` debe estar mergeada antes.

- [ ] **Step 3: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/use-geometry-queue.ts"
git commit -m "feat(floor-plan): hook de cola de persistencia de geometría (debounce + rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.4: `_components/floor-canvas.tsx` — viewport + stage (3 capas) + zoom/pan

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-canvas.tsx`

> DOM de 3 capas (clave para zoom/pan + dnd-kit):
> 1. **viewport** (`overflow:hidden`, `position:relative`, alto fijo `h-[70vh]`, **SIN transform**) — es el límite de medición del `DndContext` y el `offsetParent` del `restrictToParent`.
> 2. **stage** (`position:relative`, `width/height = area.width/area.height` lógicos, `transform: translate(panX,panY) scale(s)`, `transform-origin: 0 0`, grilla CSS de `GRID`px).
> 3. **FloorElement** (`position:absolute`, `left/top` en px lógicos).
>
> Click en el stage vacío → `onSelectElement(null)`. Controles `+`/`−`/`fit` (lucide) que llaman los handlers que sube el editor.

- [ ] **Step 1: Implementar el canvas de 3 capas**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-canvas.tsx`:
```tsx
'use client'

import { Maximize2, Minus, Plus } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { GRID } from '@/lib/floor-plan/grid'
import type { AreaRow, ElementRow } from '@/lib/floor-plan/queries'
import { FloorElement } from './floor-element'

export type FloorCanvasProps = {
  area: AreaRow
  elements: ElementRow[]
  scale: number
  pan: { x: number; y: number }
  selectedId: string | null
  onSelectElement: (id: string | null) => void
  onResizeEnd: (id: string, geom: { width: number; height: number }) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFit?: () => void
}

export function FloorCanvas({
  area,
  elements,
  scale,
  pan,
  selectedId,
  onSelectElement,
  onResizeEnd,
  onZoomIn,
  onZoomOut,
  onFit,
}: FloorCanvasProps) {
  // Capa 1: viewport. SIN transform → límite de medición de DndContext y
  // offsetParent del restrictToParent.
  const viewportRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative w-full">
      <div
        ref={viewportRef}
        className="card-hairline relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm"
      >
        {/* Capa 2: stage. transform translate+scale; tamaño = área lógica. */}
        <div
          className="absolute left-0 top-0"
          style={{
            width: area.width,
            height: area.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            // Grilla lógica en px del área (se escala con el stage).
            backgroundImage:
              'linear-gradient(to right, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.5 0.02 165 / 0.10) 1px, transparent 1px)',
            backgroundSize: `${GRID}px ${GRID}px`,
          }}
          // Click en el stage vacío deselecciona. Si el click vino de un elemento,
          // su body hace stopPropagation / el target no es el stage.
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelectElement(null)
          }}
        >
          {/* Capa 3: elementos en px lógicos (el stage ya está escalado). */}
          {elements.map((element) => (
            <FloorElement
              key={element.id}
              element={element}
              selected={element.id === selectedId}
              scale={scale}
              onSelect={onSelectElement}
              onResizeEnd={onResizeEnd}
            />
          ))}
        </div>
      </div>

      {/* Controles de zoom/pan (fuera del stage → no se escalan). */}
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
        <span
          className="text-center text-[10px] font-medium tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {Math.round(scale * 100)}%
        </span>
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
```

> Nota: `FloorElement` (con su `setActivatorNodeRef`/`stopPropagation` en el body) lo provee su fase. Este canvas solo lo monta dentro del stage y le pasa `scale`. El `DndContext` lo provee el editor (Task 9.6) por encima del canvas; el viewport es el límite de medición porque no lleva transform. `onSelectElement(null)` solo se dispara cuando el `pointerdown` cae directo en el stage (grilla vacía).

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. Si falla con "Cannot find module './floor-element'", la fase de `floor-element.tsx` debe estar mergeada antes (dependencia de render). Confirmá que ese es el único error y reordená el merge si es así.

- [ ] **Step 3: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-canvas.tsx"
git commit -m "feat(floor-plan): FloorCanvas de 3 capas (viewport/stage/elementos) + zoom/pan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.5: `_components/create-table-dialog.tsx` — diálogo de alta de mesa

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/create-table-dialog.tsx`

> Diálogo shadcn que abre el editor al clickear "Mesa" en la paleta. Campos: **label** (precargado con `suggestNextLabel(areaNumberStart, existingLabels)`; editable), **shape** (`Select` rect/circle — no hay `radio-group` en el repo), **capacity** (opcional 1-50). Al enviar llama `createTableInPlanAction(slug, { area_id, label, capacity, shape, x: centerX, y: centerY })`. En `ok` cierra + `onCreated()`; en error, toast con `result.message` (ya mapeado por la action). Props EXACTAS de CONTRACT ADDITIONS.

- [ ] **Step 1: Implementar el diálogo**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/create-table-dialog.tsx`:
```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createTableInPlanAction } from '@/lib/floor-plan/actions'
import { suggestNextLabel } from '@/lib/floor-plan/numbering'

type CreateTableDialogProps = {
  slug: string
  areaId: string
  areaNumberStart: number
  existingLabels: string[]
  centerX: number
  centerY: number
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}

export function CreateTableDialog({
  slug,
  areaId,
  areaNumberStart,
  existingLabels,
  centerX,
  centerY,
  open,
  onOpenChange,
  onCreated,
}: CreateTableDialogProps) {
  const [label, setLabel] = useState('')
  const [shape, setShape] = useState<'rect' | 'circle'>('rect')
  const [capacity, setCapacity] = useState('')
  const [pending, start] = useTransition()

  // Al abrir, autosugerimos el próximo número libre del área (editable).
  useEffect(() => {
    if (open) {
      setLabel(suggestNextLabel(areaNumberStart, existingLabels))
      setShape('rect')
      setCapacity('')
    }
  }, [open, areaNumberStart, existingLabels])

  const onSubmit = () => {
    const name = label.trim()
    if (name.length === 0) {
      toast.error('Poné un nombre para la mesa.')
      return
    }
    const cap = capacity.trim().length > 0 ? Number(capacity) : null
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 50)) {
      toast.error('La capacidad debe ser un número entre 1 y 50.')
      return
    }
    start(async () => {
      const result = await createTableInPlanAction(slug, {
        area_id: areaId,
        label: name,
        capacity: cap,
        shape,
        x: centerX,
        y: centerY,
      })
      if (result.ok) {
        toast.success('Mesa creada.')
        onOpenChange(false)
        onCreated()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva mesa</DialogTitle>
          <DialogDescription>
            Se crea una mesa con su QR y se ubica en el centro del área activa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ct-label">Nombre / número</Label>
            <Input
              id="ct-label"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="1, 2, Barra 1…"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ct-shape">Forma</Label>
            <Select value={shape} onValueChange={(v) => setShape(v as 'rect' | 'circle')}>
              <SelectTrigger id="ct-shape" aria-label="Forma de la mesa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rectangular</SelectItem>
                <SelectItem value="circle">Redonda</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ct-capacity">Capacidad (opcional)</Label>
            <Input
              id="ct-capacity"
              type="number"
              min={1}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Sin definir"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={pending || label.trim().length === 0}>
            {pending ? 'Creando…' : 'Crear mesa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. `createTableInPlanAction` devuelve `{ ok: true; tableId; elementId; qrToken } | { ok: false; message; fieldErrors? }` (Contracts) — solo leemos `result.ok` y `result.message`, así que tipa bien. `suggestNextLabel(numberStart, existingLabels)` matchea el Contracts. El `Select` de shadcn (rect/circle) reemplaza al radio (no hay `radio-group` en el repo).

- [ ] **Step 3: Smoke manual (anotado, integrado)**

Anotar para el smoke del editor: **clickear "Mesa" en la paleta abre este diálogo con el próximo número libre precargado; cambiar a "Redonda" crea una mesa `circle`; capacidad fuera de 1-50 muestra error y no envía; al crear, el diálogo cierra y la mesa aparece en el centro del área activa con su QR.**

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/create-table-dialog.tsx"
git commit -m "feat(floor-plan): create-table-dialog (label autosugerido + shape + capacidad)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.6: `_components/floor-plan-editor.tsx` — orquestador (estado, DndContext, wiring completo, Tabs)

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-plan-editor.tsx`

> Dueño del estado: `elements` (semilla de `initial.elements`), `selectedId`, `{scale, pan:{x,y}}`, `activeAreaId` (default primera área); las listas `areas`/`unplacedTables` se siembran de `initial` y se re-siembran por `router.refresh()` tras cualquier mutación estructural. Provee `DndContext` con `PointerSensor` (distance 8) + `KeyboardSensor` (paso `GRID*scale`), `modifiers = useMemo([createSnapModifier(GRID, getScale), restrictToParent(getScale)], [scale])`, `autoScroll={false}`, `accessibility` de `@/lib/floor-plan/a11y`.
>
> `handleDragEnd` distingue dos tipos de drag por el `active.id`:
> - prefijo `TRAY_DRAG_PREFIX` → mesa de la bandeja → `placeTableAction` en el centro del área (luego `onChanged`).
> - id de elemento del plano → pipeline canónica (`snapToGrid(stored + delta/scale)` → `clampToArea`) → optimista + `queue.enqueue`.
>
> Wiring SIN stubs: paleta → `CreateTableDialog` (mesa) / `addDecorAction` (decor); bandeja → `placeTableAction`; inspectores reciben `onChanged`. Layout en `Tabs` ("Plano" / "Lista" siempre alcanzable). El error boundary lo pone la page (no acá).

- [ ] **Step 1: Implementar el editor completo**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-plan-editor.tsx`:
```tsx
'use client'

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  addDecorAction,
  placeTableAction,
} from '@/lib/floor-plan/actions'
import {
  floorPlanAnnouncements,
  floorPlanScreenReaderInstructions,
} from '@/lib/floor-plan/a11y'
import {
  clampToArea,
  createSnapModifier,
  ELEMENT_DEFAULTS,
  GRID,
  restrictToParent,
  snapToGrid,
} from '@/lib/floor-plan/grid'
import type { ElementRow, FloorPlanData } from '@/lib/floor-plan/queries'
import type { ElementGeometry } from '@/lib/floor-plan/schemas'
import { AreaManager } from './area-manager'
import { CreateTableDialog } from './create-table-dialog'
import { DecorInspector } from './decor-inspector'
import { ElementPalette } from './element-palette'
import { FloorCanvas } from './floor-canvas'
import { TableInspector } from './table-inspector'
import { TablesListFallback } from './tables-list-fallback'
import { TRAY_DRAG_PREFIX, UnplacedTray } from './unplaced-tray'
import { useGeometryQueue } from './use-geometry-queue'

export type FloorPlanEditorProps = {
  slug: string
  tenantId: string
  initial: FloorPlanData
}

const MIN_SCALE = 0.25
const MAX_SCALE = 2
const ZOOM_STEP = 0.2

type DecorKind = 'wall' | 'pillar' | 'island' | 'bar'

export function FloorPlanEditor({ slug, initial }: FloorPlanEditorProps) {
  const router = useRouter()

  const [areas] = useState(initial.areas)
  const [elements, setElements] = useState<ElementRow[]>(initial.elements)
  const [unplaced] = useState(initial.unplacedTables)
  const [activeAreaId, setActiveAreaId] = useState<string>(initial.areas[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [createOpen, setCreateOpen] = useState(false)

  // Snapshot de geometría previa por id, para revertir si el flush falla.
  const prevGeomRef = useRef<Map<string, ElementGeometry>>(new Map())

  const onQueueError = useCallback((ids: string[]) => {
    setElements((current) => {
      const snap = prevGeomRef.current
      return current.map((el) => {
        const prev = snap.get(el.id)
        if (!prev) return el
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

  // Modifiers re-creados cuando cambia scale (cierran sobre el scale vigente).
  const getScale = useCallback(() => scale, [scale])
  const modifiers = useMemo(
    () => [createSnapModifier(GRID, getScale), restrictToParent(getScale)],
    [getScale],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, { currentCoordinates }) => {
        const step = GRID * scale
        switch (event.code) {
          case 'ArrowRight':
            return { ...currentCoordinates, x: currentCoordinates.x + step }
          case 'ArrowLeft':
            return { ...currentCoordinates, x: currentCoordinates.x - step }
          case 'ArrowDown':
            return { ...currentCoordinates, y: currentCoordinates.y + step }
          case 'ArrowUp':
            return { ...currentCoordinates, y: currentCoordinates.y - step }
          default:
            return undefined
        }
      },
    }),
  )

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null
  const areaElements = useMemo(
    () => (activeArea ? elements.filter((el) => el.area_id === activeArea.id) : []),
    [elements, activeArea],
  )
  const selectedElement = elements.find((el) => el.id === selectedId) ?? null

  // Tras mutaciones estructurales: deseleccionar + recargar el RSC (re-siembra initial).
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
      prevGeomRef.current.set(el.id, {
        id: el.id,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        z_index: el.z_index,
      })
      setElements((current) => current.map((e) => (e.id === el.id ? { ...e, ...next } : e)))
      queue.enqueue({ id: el.id, ...next })
    },
    [queue],
  )

  // Centro lógico del área activa (para alta de mesa/decor y colocar de bandeja).
  const areaCenter = useCallback(
    (w: number, h: number) => {
      if (!activeArea) return { x: 0, y: 0 }
      return clampToArea(
        snapToGrid(activeArea.width / 2 - w / 2, GRID),
        snapToGrid(activeArea.height / 2 - h / 2, GRID),
        w,
        h,
        activeArea.width,
        activeArea.height,
      )
    },
    [activeArea],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!activeArea) return
      const rawId = String(event.active.id)

      // Drag desde la bandeja → colocar mesa en el centro del área activa.
      if (rawId.startsWith(TRAY_DRAG_PREFIX)) {
        const tableId = rawId.slice(TRAY_DRAG_PREFIX.length)
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
        return
      }

      // Drag de un elemento del plano → pipeline canónica (snap lógico + clamp).
      const el = elements.find((e) => e.id === rawId)
      if (!el) return
      const logicalX = snapToGrid(el.x + event.delta.x / scale, GRID)
      const logicalY = snapToGrid(el.y + event.delta.y / scale, GRID)
      const clamped = clampToArea(
        logicalX,
        logicalY,
        el.width,
        el.height,
        activeArea.width,
        activeArea.height,
      )
      if (clamped.x === el.x && clamped.y === el.y) return
      commitGeometry(el, {
        x: clamped.x,
        y: clamped.y,
        width: el.width,
        height: el.height,
        z_index: el.z_index,
      })
    },
    [activeArea, elements, scale, areaCenter, slug, onChanged, commitGeometry],
  )

  const handleResizeEnd = useCallback(
    (id: string, size: { width: number; height: number }) => {
      if (!activeArea) return
      const el = elements.find((e) => e.id === id)
      if (!el) return
      const width = snapToGrid(size.width, GRID)
      const height = snapToGrid(size.height, GRID)
      const clamped = clampToArea(el.x, el.y, width, height, activeArea.width, activeArea.height)
      commitGeometry(el, {
        x: clamped.x,
        y: clamped.y,
        width,
        height,
        z_index: el.z_index,
      })
    },
    [activeArea, elements, commitGeometry],
  )

  // Zoom/pan: estado en el editor, controles en el canvas.
  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, Math.round((s + ZOOM_STEP) * 100) / 100)),
    [],
  )
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, Math.round((s - ZOOM_STEP) * 100) / 100)),
    [],
  )
  const fit = useCallback(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Paleta: "Mesa" abre el diálogo; decoración inserta el elemento en el centro.
  const onAddTable = useCallback(() => setCreateOpen(true), [])
  const onAddDecor = useCallback(
    (kind: DecorKind) => {
      if (!activeArea) return
      const def = ELEMENT_DEFAULTS[kind]
      const center = areaCenter(def.width, def.height)
      void (async () => {
        const r = await addDecorAction(slug, {
          area_id: activeArea.id,
          kind,
          shape: def.shape,
          x: center.x,
          y: center.y,
          width: def.width,
          height: def.height,
          label: null,
          color: null,
        })
        if (r.ok) onChanged()
        else toast.error(r.message)
      })()
    },
    [activeArea, areaCenter, slug, onChanged],
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

  // Para el merge-select del inspector: mesas (activas) ubicadas en el plano.
  const allTables = useMemo(
    () =>
      elements
        .filter((el) => el.kind === 'table' && el.physical_table_id && el.table)
        .map((el) => ({ id: el.physical_table_id as string, label: el.table?.label ?? '' })),
    [elements],
  )

  // Labels de mesas del área activa, para autosugerir el alta.
  const areaTableLabels = useMemo(
    () =>
      areaElements
        .filter((el) => el.kind === 'table' && el.table)
        .map((el) => el.table?.label ?? '')
        .filter((l) => l.length > 0),
    [areaElements],
  )

  // Lista accesible canónica: ubicadas (elemento kind='table') + bandeja.
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

  const tableCenter = areaCenter(ELEMENT_DEFAULTS.table.width, ELEMENT_DEFAULTS.table.height)

  return (
    <Tabs defaultValue="plano" className="gap-4">
      <TabsList>
        <TabsTrigger value="plano">Plano</TabsTrigger>
        <TabsTrigger value="lista">Lista</TabsTrigger>
      </TabsList>

      <TabsContent value="plano">
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

          <DndContext
            sensors={sensors}
            modifiers={modifiers}
            autoScroll={false}
            onDragEnd={handleDragEnd}
            accessibility={{
              announcements: floorPlanAnnouncements,
              screenReaderInstructions: floorPlanScreenReaderInstructions,
            }}
          >
            <div className="space-y-3">
              <ElementPalette onAddTable={onAddTable} onAddDecor={onAddDecor} />
              <FloorCanvas
                area={activeArea}
                elements={areaElements}
                scale={scale}
                pan={pan}
                selectedId={selectedId}
                onSelectElement={setSelectedId}
                onResizeEnd={handleResizeEnd}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onFit={fit}
              />
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
          </DndContext>
        </div>

        <CreateTableDialog
          slug={slug}
          areaId={activeArea.id}
          areaNumberStart={activeArea.number_start}
          existingLabels={areaTableLabels}
          centerX={tableCenter.x}
          centerY={tableCenter.y}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={onChanged}
        />
      </TabsContent>

      <TabsContent value="lista">
        <TablesListFallback slug={slug} tables={fallbackTables} />
      </TabsContent>
    </Tabs>
  )
}
```

> Notas de orquestación (sin stubs):
> - **Drag desde la bandeja**: `UnplacedTray` rinde sus chips con `useDraggable` id = `tray:<tableId>`; el chip se monta **dentro** del `DndContext` del editor (la bandeja es hija del `DndContext`). `handleDragEnd` detecta el prefijo `TRAY_DRAG_PREFIX` y llama `placeTableAction` en el centro del área (el botón "Colocar" hace lo mismo por el camino no-drag).
> - **a11y keymap**: Enter/click selecciona y abre el inspector (lo maneja `FloorElement` vía `onSelect`); el drag por teclado es modo aparte (Space levanta, flechas mueven `GRID*scale`, Esc cancela), documentado en `lib/floor-plan/a11y.ts`.
> - **Tab "Lista"**: el `DndContext` queda **dentro** de `TabsContent value="plano"`; la lista no monta el contexto de drag y usa sus propias actions.
> - **Geometría vs estructura**: drag/resize van por la cola optimista (sin `router.refresh()`); altas/bajas/merge/áreas/colocar van por `onChanged` (`router.refresh()` re-siembra `initial`).

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS. Dependencias que deben estar mergeadas: `lib/floor-plan/{grid,queries,schemas,actions,numbering,a11y}.ts` y las hojas `area-manager`, `element-palette`, `table-inspector`, `decor-inspector`, `unplaced-tray` (exporta `TRAY_DRAG_PREFIX`), `floor-element` (vía `floor-canvas`), `create-table-dialog`, `tables-list-fallback`, `use-geometry-queue`, `floor-canvas`. Si falla solo por módulos de esas fases, reordená el merge; cualquier otro error TS es bug de esta tarea.

- [ ] **Step 3: Smoke manual (anotado, integrado en Task 9.8)**

Anotar para el smoke integral: **seleccionar un elemento abre su inspector; "Mesa" abre el diálogo y crea la mesa centrada; cada botón de decoración la agrega centrada; arrastrar un chip de la bandeja al canvas la coloca (igual que "Colocar"); arrastrar una mesa snapea y persiste con una sola llamada ~600ms después; zoom +/−/fit mantiene el snap alineado; la tab "Lista" siempre está disponible.**

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/floor-plan-editor.tsx"
git commit -m "feat(floor-plan): editor cliente — estado, DndContext (a11y es), wiring paleta/bandeja/tabs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.7: `_components/tables-list-fallback.tsx` — lista accesible canónica

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/tables-list-fallback.tsx`

> Ata a Contracts: `TablesListFallbackProps = { slug; tables: { id; label; capacity: number|null; qr_token; active }[] }`. Acciones por mesa: imprimir (`PrintQrButton`), regenerar token (`regenerateQrToken` de `lib/tables/actions`, con `AlertDialog`), activar/desactivar (`setTableActiveAction` de `lib/floor-plan/actions` — **nunca** `updateTable`), borrar definitivo (`deleteTablePermanentlyAction` de `lib/floor-plan/actions` con `AlertDialog`; si la mesa tiene historial el RPC devuelve `table_has_history` y la action lo expone mapeado). `<table>` real con `th scope="col"`, operable por teclado.

- [ ] **Step 1: Escribir el componente completo**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/tables-list-fallback.tsx`:
```tsx
'use client'

import { Power, RefreshCw, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  deleteTablePermanentlyAction,
  setTableActiveAction,
} from '@/lib/floor-plan/actions'
import { regenerateQrToken } from '@/lib/tables/actions'
import { PrintQrButton } from './print-qr-button'

type FallbackTable = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
}

type TablesListFallbackProps = {
  slug: string
  tables: FallbackTable[]
}

/**
 * Camino accesible canónico (no solo respaldo del ErrorBoundary): una <table>
 * HTML real con todas las acciones por mesa, sin canvas ni drag. Se monta SIEMPRE
 * como tab secundaria del editor y como fallback de render.
 */
export function TablesListFallback({ slug, tables }: TablesListFallbackProps) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleToggleActive = (table: FallbackTable) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await setTableActiveAction(slug, table.id, !table.active)
      if (result.ok) {
        toast.success(
          table.active
            ? `Mesa "${table.label}" desactivada`
            : `Mesa "${table.label}" activada`,
        )
      } else {
        toast.error(result.message)
      }
      setBusyId(null)
    })
  }

  const handleRegenerate = (table: FallbackTable) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await regenerateQrToken(slug, table.id)
      if (result.ok) toast.success(`QR de "${table.label}" regenerado`)
      else toast.error(result.message)
      setBusyId(null)
    })
  }

  const handleDeletePermanently = (table: FallbackTable) => {
    setBusyId(table.id)
    startTransition(async () => {
      const result = await deleteTablePermanentlyAction(slug, table.id)
      if (result.ok) toast.success(`Mesa "${table.label}" eliminada`)
      else toast.error(result.message)
      setBusyId(null)
    })
  }

  if (tables.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay mesas"
        description="Creá la primera mesa desde el editor de plano para imprimir su QR y empezar a recibir pedidos."
      />
    )
  }

  return (
    <Table>
      <TableCaption>
        Lista accesible de todas las mesas físicas. Cada mesa conserva su QR y sus acciones.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Mesa</TableHead>
          <TableHead scope="col">Capacidad</TableHead>
          <TableHead scope="col">QR</TableHead>
          <TableHead scope="col">Estado</TableHead>
          <TableHead scope="col" className="text-right">
            Acciones
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tables.map((table) => {
          const rowBusy = pending && busyId === table.id
          return (
            <TableRow key={table.id}>
              <TableCell className="font-medium">{table.label}</TableCell>
              <TableCell className="text-muted-foreground">
                {table.capacity ?? 'sin definir'}
              </TableCell>
              <TableCell>
                <code className="block max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {table.qr_token}
                </code>
              </TableCell>
              <TableCell>
                {table.active ? (
                  <Badge variant="success">Activa</Badge>
                ) : (
                  <Badge variant="secondary">Inactiva</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1.5">
                  <PrintQrButton qrToken={table.qr_token} />

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rowBusy}
                        aria-label={`Regenerar QR de ${table.label}`}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Regenerar QR de "{table.label}"</AlertDialogTitle>
                        <AlertDialogDescription>
                          El QR actual queda inservible. Tenés que reimprimir y reemplazar el QR
                          físico de la mesa. Las sesiones abiertas siguen funcionando para los
                          celulares ya conectados.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRegenerate(table)}>
                          Sí, regenerar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={table.active}
                      disabled={rowBusy}
                      onCheckedChange={() => handleToggleActive(table)}
                      aria-label={
                        table.active
                          ? `Desactivar mesa ${table.label}`
                          : `Activar mesa ${table.label}`
                      }
                    />
                    <Power className="size-3.5 text-muted-foreground" aria-hidden />
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rowBusy}
                        aria-label={`Eliminar permanentemente la mesa ${table.label}`}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar "{table.label}"</AlertDialogTitle>
                        <AlertDialogDescription>
                          Solo se puede borrar definitivamente una mesa sin historial de sesiones.
                          Si la mesa tiene historial, la acción se bloquea y conviene desactivarla
                          con el interruptor.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeletePermanently(table)}>
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS — `setTableActiveAction(slug, tableId, active)` / `deleteTablePermanentlyAction(slug, tableId)` existen en `lib/floor-plan/actions.ts` (devuelven `FloorPlanActionState`); `regenerateQrToken(slug, id)` existe en `lib/tables/actions.ts` (devuelve `{ ok: true; … } | { ok: false; message }`); `PrintQrButton({ qrToken })` existe; `Badge` tiene `success`/`secondary`. Sin errores TS ni warnings.

- [ ] **Step 3: Smoke manual (anotado, integrado en Task 9.8)**

Anotar: **la tab "Lista" muestra una tabla con todas las mesas (ubicadas + bandeja); imprimir abre `/print/qr/<token>`; regenerar (con confirmación) cambia el `qr_token`; el `Switch` activa/desactiva vía RPC; eliminar una mesa sin historial la borra; eliminar una con historial muestra el toast mapeado `table_has_history`. Navegable por teclado (Tab por celdas/acciones).**

- [ ] **Step 4: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/_components/tables-list-fallback.tsx"
git commit -m "feat(floor-plan): lista accesible de mesas (fallback canónico) con acciones RPC

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.8: `_components/zero-area-cta.tsx` + `page.tsx` (RSC reescrita) + borrado UI vieja

**Files:**
- Create: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/zero-area-cta.tsx`
- Rewrite: `app/(manager)/[tenantSlug]/configuracion/mesas/page.tsx`
- Delete: `app/(manager)/[tenantSlug]/configuracion/mesas/_components/{tables-list.tsx,new-table-dialog.tsx,edit-table-dialog.tsx}`
- Keep (sin cambios): `app/(manager)/[tenantSlug]/configuracion/mesas/_components/print-qr-button.tsx`

- [ ] **Step 1: CTA del empty-state (client) que llama `createAreaAction`**

Create `app/(manager)/[tenantSlug]/configuracion/mesas/_components/zero-area-cta.tsx`:
```tsx
'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createAreaAction } from '@/lib/floor-plan/actions'

export function ZeroAreaCta({ slug }: { slug: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const onClick = () => {
    start(async () => {
      const result = await createAreaAction(slug, { name: 'Salón' })
      if (result.ok) {
        toast.success('Área creada.')
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Button type="button" onClick={onClick} disabled={pending} className="gap-1.5">
      <Plus className="size-4" aria-hidden />
      {pending ? 'Creando…' : 'Crear primera área'}
    </Button>
  )
}
```

- [ ] **Step 2: Reescribir la page como RSC del editor**

`requireTenantAccess` + guard `owner` (`notFound()` si no); `getFloorPlan(tenant.id)`. Si `areas.length === 0` → `EmptyState` con `<ZeroAreaCta slug/>`. Si no, deriva `fallbackTables` en el server (elementos `kind='table'` + `unplacedTables`) y monta `<FloorPlanEditor/>` envuelto en `<FloorPlanErrorBoundary fallback={<TablesListFallback …/>}>`.

Reemplazá **todo** el contenido de `app/(manager)/[tenantSlug]/configuracion/mesas/page.tsx`:
```tsx
import { LayoutGrid } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { getFloorPlan } from '@/lib/floor-plan/queries'
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
        description="Dibujá la distribución real del local: arrastrá mesas, agregá decoración y gestioná cada QR."
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
          <FloorPlanEditor slug={tenantSlug} tenantId={tenant.id} initial={data} />
        </FloorPlanErrorBoundary>
      )}
    </main>
  )
}
```

> `FloorPlanErrorBoundary` es un client component que acepta `children` server-rendered y un `fallback` (también client) como prop `ReactNode`: patrón válido en RSC. El fallback usa el mismo `getFloorPlan` ya cargado (sin re-fetch).

- [ ] **Step 3: Confirmar que nada importa los tres archivos legacy (excepto entre ellos)**

Run:
```bash
grep -rn "tables-list'\|tables-list\"\|new-table-dialog\|edit-table-dialog\|NewTableDialog\|EditTableDialog\|\bTablesList\b" \
  --include="*.tsx" --include="*.ts" app/ components/ lib/
```
Expected: **0 referencias externas**. La page reescrita ya no importa `TablesList`/`NewTableDialog`. Solo puede aparecer `tables-list.tsx` importando `edit-table-dialog` (importación interna entre archivos que se borran juntos). Si aparece `import { TablesList }`/`NewTableDialog`/`EditTableDialog` en cualquier otro archivo, **frená y arreglá ese consumidor antes de borrar**.

- [ ] **Step 4: `git rm` los tres archivos legacy**

Run:
```bash
git rm "app/(manager)/[tenantSlug]/configuracion/mesas/_components/tables-list.tsx" \
       "app/(manager)/[tenantSlug]/configuracion/mesas/_components/new-table-dialog.tsx" \
       "app/(manager)/[tenantSlug]/configuracion/mesas/_components/edit-table-dialog.tsx"
```
Expected: `rm '…/tables-list.tsx'`, `rm '…/new-table-dialog.tsx'`, `rm '…/edit-table-dialog.tsx'` — tres archivos staged como deleted.

- [ ] **Step 5: Confirmar que `print-qr-button.tsx` sigue presente**

Run:
```bash
ls "app/(manager)/[tenantSlug]/configuracion/mesas/_components/print-qr-button.tsx"
```
Expected: el path existe (no se borró; lo reusan el inspector y la lista).

- [ ] **Step 6: Typecheck + lint final de la fase**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS — ningún módulo cuelga referencias a los archivos borrados (verificado en Step 3); `fallbackTables` matchea `TablesListFallbackProps['tables']`; el `ErrorBoundary` acepta `fallback`/`children`; `ZeroAreaCta` tipa contra `createAreaAction`. Sin errores TS, sin warnings de Biome.

- [ ] **Step 7: Smoke manual integral (documentar en el PR)**

Run `npm run dev`. Como owner en `/{slug}/configuracion/mesas`:
1. **Tenant con áreas (HUB)**: se renderiza el editor — `AreaManager` (izquierda), `ElementPalette` + canvas con grilla y zoom/pan (centro), `UnplacedTray` (derecha). Seleccioná un elemento (click) → abre el inspector. Arrastrá una mesa: snapea a la grilla y persiste (Network: una sola `saveGeometryAction` ~600ms después). Zoom `+`/`−`/`fit` y rearrastrá: el snap sigue alineado bajo escala.
2. **Alta de mesa**: "Mesa" abre `CreateTableDialog` con el próximo número libre precargado → crea la mesa con QR en el centro. Decoración: "Pared"/"Columna"/"Isla"/"Barra" agregan el elemento con su default centrado.
3. **Bandeja**: una mesa reactivada o de un área borrada aparece en `UnplacedTray`; "Colocar" y arrastrar-al-canvas la ubican en el centro del área activa.
4. **Tab "Lista"**: tabla accesible con todas las mesas; imprimir QR, regenerar token, `Switch` activar/desactivar, eliminar (mesa con historial → toast `table_has_history`).
5. **Teclado/a11y**: Tab selecciona + abre inspector con Enter; Space + flechas mueven por teclado; el live region anuncia en español ("Levantaste el elemento …", "Soltaste el elemento …").
6. **Tenant sin áreas**: empty-state "Todavía no hay áreas" + botón "Crear primera área" → crea `Salón` y recarga al editor.
7. **Fallback de error**: temporalmente `throw new Error('smoke')` al tope del render de `floor-plan-editor.tsx` → aparece el banner "No pudimos cargar el editor visual…" + la tabla accesible. **Quitá el `throw`** (no commitear).
8. **Persistencia con fallo**: cortá la red en DevTools y arrastrá → toast de error + la mesa vuelve a su posición previa (rollback).
9. **Dark mode**: togglealo; canvas, grilla, banner y controles conservan contraste AA.

Anotá pasos + resultado + screenshots en el PR.

- [ ] **Step 8: Commit**

```bash
git add "app/(manager)/[tenantSlug]/configuracion/mesas/page.tsx" \
        "app/(manager)/[tenantSlug]/configuracion/mesas/_components/zero-area-cta.tsx"
git commit -m "feat(floor-plan): page RSC del editor (guard owner, empty-state, error boundary) + baja UI vieja

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9.9: README de la feature (a11y + fallback + keymap) + verificación final

**Files:**
- Modify (o create si no existe): `docs/floor-plan-mesas.md`

> Cierra el DoD §9 (README de la feature actualizado) con la sección de accesibilidad, fallback y keymap. Si el archivo aún no existe cuando corra esta tarea (debería haberlo creado una fase previa), creálo con esta sección como base.

- [ ] **Step 1: Agregar la sección de accesibilidad, fallback y keymap**

Agregá (o creá) al final de `docs/floor-plan-mesas.md`:
```md
## Accesibilidad y fallback

El editor de plano es desktop-first y visual, pero el camino accesible es de
primera clase, no un respaldo de segunda:

- **Tab "Lista" (siempre presente):** dentro del editor, la tab secundaria "Lista"
  renderiza `TablesListFallback` — una `<table>` HTML real con todas las mesas y
  sus acciones (imprimir QR, regenerar token, activar/desactivar con un `Switch`,
  eliminar definitivamente solo si la mesa no tiene historial). No depende de
  `DndContext` ni del canvas.
- **Fallback de error:** el editor cliente se monta dentro de
  `FloorPlanErrorBoundary` (en `page.tsx`). Si revienta en render, la pantalla
  degrada a un banner `role="alert"` + `TablesListFallback`, sin perder la
  gestión de mesas.
- **dnd-kit en español:** `DndContext` recibe `floorPlanAnnouncements` y
  `floorPlanScreenReaderInstructions` (`lib/floor-plan/a11y.ts`) en es-AR; el
  live region anuncia levantar/mover/soltar/cancelar.

### Keymap del canvas

| Tecla | Acción |
|---|---|
| Click / Enter | Selecciona el elemento y abre su inspector |
| Barra espaciadora | Levanta el elemento para arrastre por teclado |
| Flechas ↑ ↓ ← → | Mueven el elemento levantado 1 celda de grilla (`GRID * scale` px) |
| Barra espaciadora (de nuevo) | Suelta el elemento en la posición nueva |
| Escape | Cancela el arrastre y vuelve a la posición original |

Los elementos decorativos llevan `aria-label` (kind + etiqueta) y el body es el
único activador del drag (los handles de resize cortan la propagación), de modo
que no quedan tab-stops mudos ni pelean drag y resize.
```

- [ ] **Step 2: Verificación final de la fase (typecheck + lint + tests)**

Run:
```bash
npm run typecheck && npm run lint && npm run test:ci
```
Expected: PASS en los tres — sin errores TS, sin warnings de Biome, suite Vitest verde. Esta fase no agrega tests unit nuevos (son componentes cliente sin lógica de negocio, sin E2E en MVP); la corrida valida que el wiring y las deleciones no rompieron los tests existentes (`numbering`, `grid`, `schemas`).

- [ ] **Step 3: Commit**

```bash
git add docs/floor-plan-mesas.md
git commit -m "docs(floor-plan): accesibilidad, fallback de lista y keymap del canvas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 10: Tests RLS/integración + README + smoke

> Cierre de la feature: test de integración RLS contra Supabase local (aislamiento, owner-only, guardas atómicas, índice 1:1, triggers de integridad, borrado de áreas), README de la feature y checklist de smoke manual runnable. Las migraciones de las fases 1–2 ya fueron aplicadas vía Supabase MCP (`apply_migration`, proyecto `ogplsevtrclzxvyejlns`) y `types/database.ts` ya está regenerado; este phase **no** crea migraciones. Los tests de `tests/rls` corren en CI contra Supabase local (`describe.skip` si faltan las envs).

### Task 10.1: Test de integración RLS — `tests/rls/floor-plan.test.ts`

**Files:**
- Create: `tests/rls/floor-plan.test.ts`
- Test: `tests/rls/floor-plan.test.ts` (corre vía `npx vitest run tests/rls/floor-plan.test.ts` con Supabase local + envs)

- [ ] **Step 1: Escribir el test de RLS/integración completo**

Sigue el harness de `tests/rls/setup.ts` (`createUserClient` / `createTenant` / `uniqueEmail` / `uniqueSlug` / `getServiceClient` / `RLS_TESTS_ENABLED`). Usa el `service_role` para sembrar filas que el caller no podría crear por RLS (mesas, sesión abierta, elementos cross-tenant), y los clientes con sesión (`ownerA`, `ownerB`, `cashierA`, `waiterA`) para verificar el aislamiento y las guardas de rol/sesión. Cada caso del spec §10 está cubierto: (a) aislamiento SELECT/INSERT entre tenants; (b) cashier/waiter no pueden `fp_create_table`/`fp_set_table_active` (`owner_required`); (c) `fp_set_table_active(false)` y `fp_merge_tables` levantan `table_has_open_session`; (d) segundo elemento por mesa falla (`floor_plan_elements_pt_uidx`); (e) elemento con `area_id`/`physical_table_id` de otro tenant falla (`fp_tenant_mismatch_*`); (f) elemento de mesa inactiva falla (`fp_table_inactive`); (g) `fp_delete_area` bloquea con mesa activa ubicada (`area_has_active_tables`) y en la última área (`cannot_delete_last_area`).

Create `tests/rls/floor-plan.test.ts`:

```ts
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
 * Floor plan editor — aislamiento RLS, owner-only en los RPC `fp_*`,
 * guardas atómicas de sesión abierta, índice 1:1 mesa↔elemento,
 * triggers de integridad cross-tenant / mesa-inactiva, y borrado de áreas.
 *
 * Las filas que el caller no podría crear por RLS (mesas, sesión abierta,
 * elementos cross-tenant) se siembran con `service_role`; los chequeos se
 * hacen siempre con el cliente con sesión correspondiente.
 */
describeIfRls('RLS — floor plan editor', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  // Sembrado con service_role en beforeAll.
  let areaA1: { id: string } // primera área de A
  let areaA2: { id: string } // segunda área de A (para poder borrar áreas sin caer en "última")
  let areaB1: { id: string } // área de B (para el caso cross-tenant)
  let tableA1: { id: string } // mesa activa de A, ubicada en areaA1
  let tableB1: { id: string } // mesa activa de B
  let inactiveTableA: { id: string } // mesa inactiva de A

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('fpA') })
    ownerB = await createUserClient({ email: uniqueEmail('fpB') })
    cashierA = await createUserClient({ email: uniqueEmail('fpCash') })
    waiterA = await createUserClient({ email: uniqueEmail('fpWait') })

    tenantA = await createTenant({
      name: 'FP Bar A',
      slug: uniqueSlug('fp-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'FP Bar B',
      slug: uniqueSlug('fp-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    // Staff de A (no-owner) para los chequeos de owner_required.
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])

    // Áreas (A tiene 2 para no chocar con "no se puede borrar la última").
    const { data: aAreas, error: aAreasErr } = await service
      .from('floor_plan_areas')
      .insert([
        { tenant_id: tenantA.id, name: 'Planta Baja', position: 0, number_start: 1 },
        { tenant_id: tenantA.id, name: 'Planta Alta', position: 1, number_start: 101 },
      ])
      .select('id')
    if (aAreasErr || !aAreas || aAreas.length !== 2) {
      throw new Error(`seed areas A failed: ${aAreasErr?.message}`)
    }
    areaA1 = aAreas[0] as { id: string }
    areaA2 = aAreas[1] as { id: string }

    const { data: bArea, error: bAreaErr } = await service
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantB.id, name: 'Salón', position: 0, number_start: 1 })
      .select('id')
      .single()
    if (bAreaErr || !bArea) throw new Error(`seed area B failed: ${bAreaErr?.message}`)
    areaB1 = bArea

    // Mesas activas.
    const { data: ptA, error: ptAErr } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '1' })
      .select('id')
      .single()
    if (ptAErr || !ptA) throw new Error(`seed table A failed: ${ptAErr?.message}`)
    tableA1 = ptA

    const { data: ptB, error: ptBErr } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantB.id, label: '1' })
      .select('id')
      .single()
    if (ptBErr || !ptB) throw new Error(`seed table B failed: ${ptBErr?.message}`)
    tableB1 = ptB

    // Mesa inactiva de A (para el trigger fp_table_inactive).
    const { data: ptInactive, error: ptInactiveErr } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: '99', active: false })
      .select('id')
      .single()
    if (ptInactiveErr || !ptInactive) {
      throw new Error(`seed inactive table A failed: ${ptInactiveErr?.message}`)
    }
    inactiveTableA = ptInactive

    // Elemento de tableA1 ubicado en areaA1 (mesa activa ubicada → base de varios casos).
    const { error: elErr } = await service.from('floor_plan_elements').insert({
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
    if (elErr) throw new Error(`seed element A failed: ${elErr.message}`)
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(waiterA.userId)
  })

  // ── (a) Aislamiento por tenant ─────────────────────────────────────────

  it('owner de B no ve áreas ni elementos de A (SELECT aislado)', async () => {
    const { data: areas } = await ownerB.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(areas?.length ?? 0).toBe(0)

    const { data: elements } = await ownerB.client
      .from('floor_plan_elements')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(elements?.length ?? 0).toBe(0)
  })

  it('owner de B no puede INSERT un área en el tenant de A', async () => {
    const { error } = await ownerB.client
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantA.id, name: 'Intrusa' })
    expect(error).not.toBeNull()
  })

  it('owner de B no puede INSERT un elemento decor en el tenant de A', async () => {
    const { error } = await ownerB.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA1.id,
      kind: 'wall',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 200,
      height: 16,
    })
    expect(error).not.toBeNull()
  })

  it('owner de A sí ve sus propias áreas', async () => {
    const { data, error } = await ownerA.client
      .from('floor_plan_areas')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(error).toBeNull()
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(areaA1.id)
    expect(ids).toContain(areaA2.id)
  })

  // ── (b) owner_required en los RPC fp_* ─────────────────────────────────

  it('cashier no puede llamar fp_create_table (owner_required)', async () => {
    const { error } = await cashierA.client.rpc('fp_create_table', {
      p_area_id: areaA1.id,
      p_label: '50',
      p_capacity: 4,
      p_shape: 'rect',
      p_x: 200,
      p_y: 200,
    })
    expect(error?.message).toContain('owner_required')
  })

  it('waiter no puede llamar fp_set_table_active (owner_required)', async () => {
    const { error } = await waiterA.client.rpc('fp_set_table_active', {
      p_table_id: tableA1.id,
      p_active: false,
    })
    expect(error?.message).toContain('owner_required')
  })

  it('owner sí puede llamar fp_create_table y devuelve qr_token', async () => {
    const { data, error } = await ownerA.client.rpc('fp_create_table', {
      p_area_id: areaA1.id,
      p_label: '2',
      p_capacity: 4,
      p_shape: 'rect',
      p_x: 300,
      p_y: 100,
    })
    expect(error).toBeNull()
    const result = data as { table_id: string; element_id: string; qr_token: string }
    expect(result.table_id).toBeTruthy()
    expect(result.element_id).toBeTruthy()
    expect(result.qr_token).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  // ── (c) Guarda atómica de sesión abierta ───────────────────────────────

  it('fp_set_table_active(false) y fp_merge_tables levantan table_has_open_session', async () => {
    const service = getServiceClient()

    // Sembrar una sesión abierta para tableA1 (status default = 'open').
    const { data: sess, error: sessErr } = await service
      .from('table_sessions')
      .insert({ tenant_id: tenantA.id, physical_table_id: tableA1.id })
      .select('id')
      .single()
    if (sessErr || !sess) throw new Error(`seed open session failed: ${sessErr?.message}`)

    try {
      // (c.1) Desactivar una mesa con sesión abierta → bloqueado.
      const { error: deactivateErr } = await ownerA.client.rpc('fp_set_table_active', {
        p_table_id: tableA1.id,
        p_active: false,
      })
      expect(deactivateErr?.message).toContain('table_has_open_session')

      // (c.2) Combinar absorbiendo una mesa con sesión abierta → bloqueado.
      // survivor = mesa libre nueva; absorbed = tableA1 (sesión abierta).
      const { data: survivor, error: survivorErr } = await service
        .from('physical_tables')
        .insert({ tenant_id: tenantA.id, label: '3' })
        .select('id')
        .single()
      if (survivorErr || !survivor) {
        throw new Error(`seed survivor failed: ${survivorErr?.message}`)
      }

      const { error: mergeErr } = await ownerA.client.rpc('fp_merge_tables', {
        p_survivor_table_id: survivor.id,
        p_absorbed_table_id: tableA1.id,
      })
      expect(mergeErr?.message).toContain('table_has_open_session')
    } finally {
      // Limpiar la sesión abierta para no contaminar otros casos.
      await service.from('table_sessions').delete().eq('id', sess.id)
    }
  })

  // ── (d) Índice 1:1 mesa↔elemento ───────────────────────────────────────

  it('insertar un 2º elemento para la misma mesa falla (floor_plan_elements_pt_uidx)', async () => {
    // tableA1 ya tiene su elemento (sembrado en beforeAll). Un segundo viola el unique.
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA2.id,
      kind: 'table',
      shape: 'rect',
      physical_table_id: tableA1.id,
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z_index: 10,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/floor_plan_elements_pt_uidx|duplicate key|unique/i)
  })

  // ── (e) Trigger de integridad cross-tenant ─────────────────────────────

  it('elemento con area_id de otro tenant falla (fp_tenant_mismatch_area)', async () => {
    // Decor de A apuntando a un área de B.
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaB1.id, // área de B
      kind: 'wall',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 200,
      height: 16,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('fp_tenant_mismatch_area')
  })

  it('elemento con physical_table_id de otro tenant falla (fp_tenant_mismatch_table)', async () => {
    // Mesa de A en área de A pero apuntando a una mesa de B.
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA2.id,
      kind: 'table',
      shape: 'rect',
      physical_table_id: tableB1.id, // mesa de B
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z_index: 10,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('fp_tenant_mismatch_table')
  })

  // ── (f) Mesa inactiva ──────────────────────────────────────────────────

  it('elemento para una mesa inactiva falla (fp_table_inactive)', async () => {
    const { error } = await ownerA.client.from('floor_plan_elements').insert({
      tenant_id: tenantA.id,
      area_id: areaA2.id,
      kind: 'table',
      shape: 'rect',
      physical_table_id: inactiveTableA.id, // mesa inactiva de A
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z_index: 10,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('fp_table_inactive')
  })

  // ── (g) Borrado de áreas ───────────────────────────────────────────────

  it('fp_delete_area bloquea si el área tiene una mesa activa ubicada (area_has_active_tables)', async () => {
    // areaA1 contiene el elemento de tableA1 (mesa activa).
    const { error } = await ownerA.client.rpc('fp_delete_area', { p_area_id: areaA1.id })
    expect(error?.message).toContain('area_has_active_tables')
  })

  it('fp_delete_area bloquea al intentar borrar la última área (cannot_delete_last_area)', async () => {
    const service = getServiceClient()

    // Tenant aislado con UNA sola área y sin mesas → única vía de probar la guarda.
    const ownerC = await createUserClient({ email: uniqueEmail('fpC') })
    try {
      const tenantC = await createTenant({
        name: 'FP Bar C',
        slug: uniqueSlug('fp-c'),
        ownerId: ownerC.userId,
      })
      const { data: areaC, error: areaCErr } = await service
        .from('floor_plan_areas')
        .insert({ tenant_id: tenantC.id, name: 'Salón', position: 0, number_start: 1 })
        .select('id')
        .single()
      if (areaCErr || !areaC) throw new Error(`seed area C failed: ${areaCErr?.message}`)

      const { error } = await ownerC.client.rpc('fp_delete_area', { p_area_id: areaC.id })
      expect(error?.message).toContain('cannot_delete_last_area')
    } finally {
      await deleteUser(ownerC.userId)
    }
  })

  it('fp_delete_area borra un área sin mesas activas cuando no es la última', async () => {
    const service = getServiceClient()

    // Área extra y vacía en A → borrable (A queda con ≥1 área).
    const { data: areaExtra, error: extraErr } = await service
      .from('floor_plan_areas')
      .insert({ tenant_id: tenantA.id, name: 'Terraza', position: 2, number_start: 201 })
      .select('id')
      .single()
    if (extraErr || !areaExtra) throw new Error(`seed extra area failed: ${extraErr?.message}`)

    const { data, error } = await ownerA.client.rpc('fp_delete_area', {
      p_area_id: areaExtra.id,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true })

    // Verificar que ya no existe.
    const { data: gone } = await ownerA.client
      .from('floor_plan_areas')
      .select('id')
      .eq('id', areaExtra.id)
    expect(gone?.length ?? 0).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test contra Supabase local (CI / entorno con Docker)**

Requiere Supabase local levantado + envs exportadas (CLAUDE.md §16: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Las migraciones de las fases 1–2 deben estar aplicadas en ese stack local (`npx supabase db reset` o `apply_migration`).

Run:
```bash
npx vitest run tests/rls/floor-plan.test.ts
```
Expected output (resumen): todos los casos en verde, p. ej.
```
 ✓ tests/rls/floor-plan.test.ts (13 tests) ...ms
   ✓ RLS — floor plan editor > owner de B no ve áreas ni elementos de A (SELECT aislado)
   ✓ RLS — floor plan editor > cashier no puede llamar fp_create_table (owner_required)
   ✓ RLS — floor plan editor > fp_set_table_active(false) y fp_merge_tables levantan table_has_open_session
   ✓ RLS — floor plan editor > insertar un 2º elemento para la misma mesa falla (floor_plan_elements_pt_uidx)
   ✓ RLS — floor plan editor > elemento para una mesa inactiva falla (fp_table_inactive)
   ✓ RLS — floor plan editor > fp_delete_area bloquea ... (cannot_delete_last_area)
 Test Files  1 passed (1)
      Tests  13 passed (13)
```
Si las envs no están seteadas, el `describe` se salta (`describeIfRls`) y el archivo reporta `skipped` — comportamiento esperado fuera de CI.

- [ ] **Step 3: Typecheck del test (sin envs)**

Run:
```bash
npm run typecheck
```
Expected: `tsc --noEmit` sin errores. (El archivo es estricto: nada de `any`; los `data` de RPC se castean a su shape de los Contracts.)

- [ ] **Step 4: Commit**

```bash
git add tests/rls/floor-plan.test.ts
git commit -m "test(floor-plan): RLS — aislamiento, owner-only, guardas de sesión, triggers e índice 1:1"
```

### Task 10.2: README de la feature — `docs/floor-plan-mesas.md`

**Files:**
- Create: `docs/floor-plan-mesas.md`

- [ ] **Step 1: Escribir el README de la feature**

Modelado sobre `docs/carta-comensal-captura.md` (TL;DR, modelo de datos, RPCs, componentes, seguridad/RLS, testing, decisiones, fuera de alcance). Todos los nombres (tablas, índices, RPC, error codes, props) se atan a los Contracts del plan y al spec.

Create `docs/floor-plan-mesas.md`:

````markdown
# Editor visual de plano de mesas (floor plan) — guía técnica

> Convierte la pantalla de mesas del dueño
> (`(manager)/[tenantSlug]/configuracion/mesas`) de una grilla de cards a un
> **editor visual de plano**: arrastrar/redimensionar mesas y decoración
> (paredes/columnas/islas/barra) sobre **áreas configurables** por tenant, con
> gestión mesa-QR (crear, dividir, combinar-soft, activar/desactivar, quitar del
> plano) desde un panel lateral. Solo el editor del dueño; la vista operativa en
> vivo del salón queda para entrega 2 sobre el mismo modelo.

---

## TL;DR

| Capa | Qué hay | Dónde |
|---|---|---|
| DB | 2 tablas (`floor_plan_areas`, `floor_plan_elements`) + enums + triggers de integridad + RLS owner-write + seed HUB | `supabase/migrations/20260605000100_floor_plan_editor.sql` |
| DB | RPCs `fp_*` SECURITY DEFINER con guarda de sesión abierta atómica | `supabase/migrations/20260605000200_floor_plan_rpcs.sql` |
| Tipos | tablas + enums `floor_element_kind` / `floor_element_shape` | `types/database.ts` |
| Lógica pura | autosugerencia de número, grid/snap/clamp + modifiers dnd-kit v6 custom, zod, mapa de errores | `lib/floor-plan/{numbering,grid,schemas,errors}.ts` |
| Server | query `getFloorPlan` + Server Actions owner-only (audit TS) | `lib/floor-plan/{queries,actions}.ts` |
| UI | editor cliente (canvas 3 capas, dnd-kit), inspectores, áreas, bandeja, fallback accesible | `app/(manager)/[tenantSlug]/configuracion/mesas/{page.tsx,_components/*}` |
| `lib/tables` | `updateTable` deja de tocar `active` (RPC-only) | `lib/tables/{schemas,actions}.ts` |
| Tests | unit (numbering/grid/schemas) + RLS/integración | `tests/lib/floor-plan-*.test.ts`, `tests/rls/floor-plan.test.ts` |

Eliminados: `_components/{tables-list,new-table-dialog,edit-table-dialog}.tsx`
(la grilla y los dialogs viejos). `print-qr-button.tsx` se **conserva** (lo reusa
el inspector de mesa).

---

## Modelo de datos

Dos tablas nuevas; **`physical_tables` queda intacto** (no se le agregan columnas —
el piso/área es un atributo del elemento donde está ubicada la mesa, no de la mesa).

### `floor_plan_areas` — áreas/pisos configurables (N por tenant)
```
id, tenant_id → tenants on delete cascade
name           text (1–40)
position       int default 0          -- orden canónico: (position, created_at, id)
width          int default 1200 (200–6000)
height         int default 800  (200–6000)
number_start   int default 1   (0–100000)   -- base de la autosugerencia de número
created_at, updated_at
```
Índices: `floor_plan_areas_tenant_name_uidx` UNIQUE `(tenant_id, lower(trim(name)))`
(backing del `on conflict` del seed; evita áreas duplicadas) y
`floor_plan_areas_tenant_pos_idx (tenant_id, position)`.

### `floor_plan_elements` — todo lo que vive en el canvas
```
id, tenant_id → tenants on delete cascade
area_id           → floor_plan_areas on delete cascade
kind              floor_element_kind  ('table'|'wall'|'pillar'|'island'|'bar')
shape             floor_element_shape ('rect'|'circle') default 'rect'
physical_table_id → physical_tables on delete cascade   -- solo kind='table'
x, y              int (−10000..10000) default 0
width, height     int (8..6000) default 80
rotation          int default 0      -- reservado v2, siempre 0 en v1 (sin UI)
z_index           int default 0      -- decor 0, mesa 10; render (z_index, created_at, id)
label             text (≤40, nullable)
color             text (^#[0-9a-fA-F]{6}$, nullable)
created_at, updated_at
```
- CHECK `fpe_table_has_pt`: `kind='table'` ⇔ `physical_table_id is not null`.
- `floor_plan_elements_pt_uidx` UNIQUE `(physical_table_id) where physical_table_id is not null`
  → **1 mesa ⇒ a lo sumo 1 elemento** (es el anti-join de la bandeja de no ubicadas).
- `floor_plan_elements_area_idx (area_id)`, `floor_plan_elements_tenant_idx (tenant_id)`.

### Invariantes y enforcement (trigger `fp_elements_integrity`, BEFORE INSERT/UPDATE)
- **Cross-tenant**: `element.tenant_id = area.tenant_id` (raise `fp_tenant_mismatch_area`,
  `42501`) y, si `kind='table'`, `= physical_table.tenant_id` (raise
  `fp_tenant_mismatch_table`, `42501`). RLS solo verifica que el caller sea owner de
  `element.tenant_id`, **no** que `area_id`/`physical_table_id` sean del mismo tenant — por
  eso el trigger.
- **Mesa activa**: un elemento `kind='table'` solo puede referenciar una mesa **activa**
  (raise `fp_table_inactive`, `P0001`). Desactivar/combinar **borra** el elemento;
  reactivar manda la mesa a la bandeja (sin elemento).
- **Geometría dentro del área**: NO se enforcea en DB (last-write-wins); el editor
  clampea. Los CHECK `x/y ±10000` solo evitan basura grosera de un caller no-UI.
- **No** hay trigger BEFORE DELETE en `physical_tables`: rompería el `on delete cascade`
  de `tenants`. El borrado seguro se controla en el RPC (ver abajo).

### Seed HUB (idempotente, solo-HUB)
Si existe el tenant slug `hub`, siembra `Planta Baja` (pos 0, `number_start` 1) y
`Planta Alta` (pos 1, `number_start` 101) con `on conflict (tenant_id, lower(trim(name)))
do nothing`. Todo tenant nuevo no-HUB arranca **sin áreas** → empty-state + CTA
"Crear primera área".

---

## RPCs (`fp_*`, SECURITY DEFINER, `set search_path=''`)

Convención (espejo de `regenerate_qr_token`): identificadores 100% schema-qualified,
resuelven `tenant_id` desde la fila, `public.user_role_in_tenant(v_tenant) = 'owner'`
(si no → `raise 'owner_required'` `42501`), y cierran con
`revoke all … from public; grant execute … to authenticated;`. Devuelven `jsonb`.
**Los RPC NO escriben `audit_log`** (`audit_log` no tiene GRANT de INSERT); la
auditoría se hace en la Server Action con `logAudit()` tras el RPC OK.

| RPC | Firma | Devuelve | Guarda |
|---|---|---|---|
| `fp_create_table` | `(p_area_id, p_label, p_capacity, p_shape, p_x, p_y)` | `{table_id, element_id, qr_token}` | inserta `physical_tables` (qr_token default) + su elemento `kind='table'` z=10 en una transacción |
| `fp_merge_tables` | `(p_survivor_table_id, p_absorbed_table_id)` | `{ok:true}` | `for update` sobre la absorbida; mismo-tenant (`cross_tenant_merge`); sesión abierta → `table_has_open_session`; `active=false` + borra su elemento |
| `fp_set_table_active` | `(p_table_id, p_active)` | `{ok:true}` | desactivar: `for update` + `table_has_open_session` + `active=false` + borra elemento; reactivar: `active=true` (vuelve a la bandeja) |
| `fp_delete_table` | `(p_table_id)` | `{ok:true}` | con `table_session` → `table_has_history`; si no, hard delete (elemento cae por cascade) |
| `fp_delete_area` | `(p_area_id)` | `{ok:true}` | mesa activa ubicada → `area_has_active_tables`; última área → `cannot_delete_last_area` |

Todos los códigos de raise son `P0001` salvo `owner_required` / `fp_tenant_mismatch_*` (`42501`).

### Server Actions (`lib/floor-plan/actions.ts`, `'use server'`, owner-only)
Patrón uniforme: `requireTenantAccess(slug)` → `requireRole(role, ['owner'])` → zod parse
→ RPC/write → en éxito `logAudit({...})` + `revalidatePath('/${slug}/configuracion/mesas')`;
errores Postgres → `mapPgError` (`lib/floor-plan/errors.ts`). Geometría/decor de alto
volumen **no** auditan. `removeFromPlanAction` es un `delete` simple del elemento (la mesa
sigue activa y ordenable por QR; sin guarda atómica porque no hay riesgo de datos).

### Query `getFloorPlan(tenantId)` (`server-only`)
- `areas`: `order by position, created_at, id`.
- `elements`: `order by z_index, created_at, id`; join a `physical_tables` para
  `label/capacity/qr_token/active` cuando `kind='table'`.
- `unplacedTables` (anti-join sobre `floor_plan_elements_pt_uidx`): mesas **activas** del
  tenant sin fila en `floor_plan_elements`. Mesas reactivadas o de áreas borradas (su
  elemento cayó por cascade) reaparecen acá.

---

## Componentes (cliente, `…/configuracion/mesas/_components/`)

- **`floor-plan-editor.tsx`** — orquestador. Dueño del estado: geometría committeada
  por elemento, `selectedId`, `{scale, panX, panY}`, área activa. Provee `DndContext`,
  paleta, inspectores y la cola de persistencia.
- **`floor-canvas.tsx`** — DOM de 3 capas: **viewport** (`overflow:hidden`, sin
  transform, límite de medición de `DndContext`), **stage** (`transform: translate(pan)
  scale(s)`, tamaño = área lógica), **FloorElement** (`position:absolute`, `left/top` en
  px lógicos). Grilla de fondo, zoom/pan transform-based (`autoScroll={false}`).
- **`floor-element.tsx`** — div arrastrable (`useDraggable`; activator **solo en el
  body** vía `setActivatorNodeRef`, no en los handles). Estado transitorio del drag;
  sube al editor en `dragEnd`.
- **`resize-handles.tsx`** — handles propios (dnd-kit no redimensiona): `onPointerDown`
  hace `stopPropagation()` + `setPointerCapture`, escribe w/h transitorio, sube en
  `pointerUp`.
- **`element-palette.tsx`** — botonera "agregar" (mesa / pared / columna / isla / barra),
  con los defaults `ELEMENT_DEFAULTS`.
- **`table-inspector.tsx`** — editar nombre/capacidad (reusa `updateTable`, **sin** tocar
  `active`), imprimir QR (`PrintQrButton`), regenerar token (`regenerateQrToken`),
  **activar/desactivar Switch → RPC `fp_set_table_active`** (nunca `updateTable`),
  dividir, combinar (`AlertDialog`), quitar del plano, al frente/al fondo (z-index).
- **`decor-inspector.tsx`** — tamaño, etiqueta, color, z-index, borrar (shape no editable).
- **`area-manager.tsx`** — crear/renombrar/reordenar/borrar áreas; editar
  `width/height/number_start`.
- **`unplaced-tray.tsx`** — bandeja de mesas activas sin elemento; arrastrar al canvas o
  botón "colocar".
- **`tables-list-fallback.tsx`** — lista accesible (camino accesible **canónico**, no solo
  respaldo); fallback del `ErrorBoundary` y tab secundaria siempre alcanzable.
- **`use-geometry-queue.ts`** — cola **única** `Map<elementId, geom>` debounced
  (drag-end y resize-end encolan en la misma cola; nunca dos escritores en paralelo) +
  flush en `beforeunload`. Si el flush falla → toast + revert optimista de los ids
  afectados.

### dnd-kit v6 (línea estable — no el rewrite next-gen 0.x)
`@dnd-kit/core ^6.3.1` + `@dnd-kit/sortable ^10` + `@dnd-kit/utilities ^3.2.2`.
**`@dnd-kit/modifiers` NO está instalado**: `createSnapModifier`/`restrictToParent` se
escriben custom en `lib/floor-plan/grid.ts` (firma v6 `({transform, draggingNodeRect,
containerNodeRect}) => Transform`). Todo modifier preserva `scaleX/scaleY`
(`return {...transform, x, y}`). Snap y restrict operan en **espacio lógico** (dividen por
`scale`). Commit canónico en `onDragEnd`: `snapToGrid(stored + delta/scale)` + clamp al
área. Sensores: `PointerSensor {activationConstraint:{distance:8}}` (click <8px
selecciona, no mueve) + `KeyboardSensor` (paso `grid*scale`).

---

## Multi-tenant / seguridad (LEY)

- Dos tablas nuevas con `tenant_id`, RLS (`*_select_member` para cualquier miembro
  vía `public.user_tenant_ids()`; `*_owner_insert/update/delete` vía
  `public.user_role_in_tenant(tenant_id)='owner'`), GRANTs `select,insert,update,delete`
  a `authenticated`. SELECT abierto a cualquier miembro (incl. `kitchen`) a propósito —
  lo consumirá la vista operativa de entrega 2; en v1 el editor es owner-only por la
  guarda de ruta/acción.
- RPCs `security definer set search_path=''`, schema-qualified, owner check + `revoke/grant`.
- Integridad cross-tenant por **trigger** (no por confianza en el cliente);
  `saveGeometryAction` jamás cambia `area_id`/`tenant_id` (solo `x,y,width,height,z_index`).
- Guarda de sesión abierta **atómica** (`for update` en el RPC); el TS delega en el RPC
  (un check JS sería TOCTOU-racy).
- `active` es **RPC-only**: `updateTable` ya no maneja `active` (se quitó de
  `updateTableSchema`) — así editar el nombre no reactiva silenciosamente una mesa
  desactivada.
- Sin PII en logs. Auditoría TS en mutaciones estructurales
  (`createTableInPlan`, `splitTable`, `mergeTables`, activar/desactivar, `deleteArea`,
  `deleteTablePermanently`). El comensal `anon` no se ve afectado.

---

## Testing

### Unit (Vitest, `tests/lib/`)
```bash
npx vitest run tests/lib/floor-plan-numbering.test.ts
npx vitest run tests/lib/floor-plan-grid.test.ts
npx vitest run tests/lib/floor-plan-schemas.test.ts
```
Cubren: `suggestNextLabel` (próximo libre desde `number_start`, huecos); `snapToGrid` +
`createSnapModifier`/`restrictToParent` a `scale=1` y `scale=2` preservando
`scaleX/scaleY`; zod de área/geometría/decor/merge (límites, color hex 6 dígitos,
capacity, bounds de x/y).

### RLS / integración (`tests/rls/`, CI contra Supabase local)
```bash
npx vitest run tests/rls/floor-plan.test.ts   # requiere Supabase local + envs (CLAUDE.md §16)
```
Cubre: aislamiento SELECT/INSERT entre tenants; cashier/waiter no pueden los `fp_*`
(`owner_required`); `fp_set_table_active(false)` y `fp_merge_tables` levantan
`table_has_open_session` con sesión abierta; 2º elemento por mesa falla
(`floor_plan_elements_pt_uidx`); elemento con `area_id`/`physical_table_id` de otro
tenant falla (`fp_tenant_mismatch_*`); elemento de mesa inactiva falla
(`fp_table_inactive`); `fp_delete_area` bloquea con mesa activa ubicada
(`area_has_active_tables`) y en la última área (`cannot_delete_last_area`).

> Sin Docker local → migraciones aplicadas vía Supabase MCP `apply_migration`
> (proyecto `ogplsevtrclzxvyejlns`); `tests/rls` corre en CI contra Supabase local.

### Smoke manual
Checklist runnable en `docs/superpowers/plans/2026-06-05-floor-plan-smoke.md` (pasos
exactos + resultado esperado).

---

## Decisiones de diseño (del brainstorming)

- **El plano absorbe la gestión**: el editor visual ES la pantalla de mesas; la grilla
  vieja se retira y queda la lista accesible como camino canónico + fallback.
- **Áreas configurables (N) por tenant**, independientes de las zonas de reservas
  (`salon_zone`) — dominios separados, sin FK ni join, no se unifican en v1.
- **Dividir/combinar operan sobre `physical_tables` (estructura)**, no sobre sesiones
  vivas — por eso el prefijo `fp_*` y `lib/floor-plan/` (distinto de los `merge_sessions`
  / `split_session` de `lib/sessions-waiter/`).
- **Combinar/quitar/borrar es soft (`active=false`)** salvo `deleteTablePermanently` para
  mesas sin historial: la FK `table_sessions.physical_table_id` es `on delete set null`,
  un hard delete destruiría el vínculo mesa↔sesión histórica.
- **Guarda de sesión abierta atómica en el RPC** (`for update`): cierra el gap real de
  que hoy nada impide desactivar/borrar una mesa con sesión abierta.
- **dnd-kit + divs posicionados** (no SVG/canvas); modifiers custom contra la API v6.
- **Numeración autosugerida editable** por área; piso = atributo explícito (vía área),
  no derivado del número.

---

## Fuera de alcance v1

Vista operativa en vivo del salón (tiempo real para staff) → entrega 2 (mismo modelo).
Editor **no realtime** (los cambios concurrentes se ven al recargar). Rotación libre
(queda la columna `rotation`). `shape` editable post-creación, undo/redo,
multiselección/mover en bloque, plantillas, alineación/guías, colisión/overlap, drag
cross-área (se mueve vía bandeja), imagen de fondo del plano, unificar `floor_plan_areas`
con `salon_zone`. No se toca puntos, reservas, carta ni KDS.
````

- [ ] **Step 2: Commit**

```bash
git add docs/floor-plan-mesas.md
git commit -m "docs(floor-plan): README de la feature (modelo, RPCs, componentes, seguridad)"
```

### Task 10.3: Checklist de smoke manual — `docs/superpowers/plans/2026-06-05-floor-plan-smoke.md`

**Files:**
- Create: `docs/superpowers/plans/2026-06-05-floor-plan-smoke.md`

- [ ] **Step 1: Escribir el doc de smoke manual runnable**

El §10 del spec convertido en checklist ejecutable: cada paso con **acción exacta** y
**resultado esperado**, modelado sobre las secciones de smoke de la carta. Se corre con la
app levantada (`npm run dev`), logueado como owner del tenant de prueba.

Create `docs/superpowers/plans/2026-06-05-floor-plan-smoke.md`:

````markdown
# Smoke manual — Editor visual de plano de mesas

> Happy path del floor plan editor (spec §10). Ejecutar con la app levantada y
> registrar resultado + screenshots en el PR. Sin E2E automatizado en MVP.

## Pre-requisitos

- [ ] Migraciones `20260605000100_floor_plan_editor.sql` y `20260605000200_floor_plan_rpcs.sql`
      aplicadas (vía Supabase MCP `apply_migration`, proyecto `ogplsevtrclzxvyejlns`) y
      `types/database.ts` regenerado (`npm run db:types`).
- [ ] `npm run typecheck && npm run lint && npm run test:ci` en verde.
- [ ] App corriendo: `npm run dev` → http://localhost:3000
- [ ] Logueado como **owner**. Para los pasos de zero-área usar un tenant nuevo (sin el
      seed de HUB). Ruta del editor: `/{slug}/configuracion/mesas`.

---

## A. Áreas

- [ ] **A1. Tenant zero-área → empty state.** Entrar al editor con un tenant **sin áreas**.
  - *Esperado:* empty-state con CTA **"Crear primera área"** (sin canvas, sin error).
- [ ] **A2. Crear primera área.** Click en "Crear primera área".
  - *Esperado:* se crea el área (default `Salón`, `number_start=1`); el editor monta el
    canvas vacío de esa área; ya no aparece el empty-state.
- [ ] **A3. Crear segunda área.** En `area-manager`, crear `Planta Alta` con `number_start=101`.
  - *Esperado:* aparece como segunda tab/área; cambiar de tab muestra su canvas propio.
- [ ] **A4. Renombrar área.** Renombrar `Salón` → `Planta Baja`.
  - *Esperado:* el nombre se actualiza; recargar persiste el cambio.
- [ ] **A5. Editar canvas del área.** Cambiar `width/height` y `number_start` de un área.
  - *Esperado:* el stage cambia de tamaño; el `number_start` afecta la autosugerencia de
    número de la próxima mesa creada en esa área.
- [ ] **A6. Reordenar áreas.** Reordenar las áreas.
  - *Esperado:* el orden de las tabs cambia; recargar persiste (posiciones densas `0..n-1`).
- [ ] **A7. Borrar la última área → bloqueo.** En un tenant con **una sola** área, intentar
      borrarla.
  - *Esperado:* bloqueado con mensaje "No podés borrar la única área. Creá otra antes."
    (`cannot_delete_last_area`).
- [ ] **A8. Borrar área con mesa activa ubicada → bloqueo.** Con una mesa activa colocada en
      el área, intentar borrar esa área.
  - *Esperado:* bloqueado con "El área tiene mesas activas. Movélas o desactivalas antes de
    borrar el área." (`area_has_active_tables`).
- [ ] **A9. Borrar área vacía → OK.** Borrar un área sin mesas activas (existiendo ≥1 área más).
  - *Esperado:* el área desaparece; su decoración cae por cascade.

---

## B. Mesas (crear, mover, redimensionar)

- [ ] **B1. Crear mesa (QR + autosugerencia editable).** Desde la paleta, "agregar mesa".
  - *Esperado:* aparece una mesa en el canvas con número autosugerido desde el
    `number_start` del área (editable antes de confirmar); se le genera un `qr_token` de
    16 chars. El número se puede editar y persiste.
- [ ] **B2. Arrastrar con snap (scale=1).** Arrastrar la mesa por el canvas.
  - *Esperado:* la posición **snapea a la grilla de 20px** al soltar; un click corto
    (<8px) **selecciona** y abre el inspector, no mueve.
- [ ] **B3. Redimensionar (scale=1).** Arrastrar un handle de resize.
  - *Esperado:* la mesa cambia de tamaño (mínimo 24px); arrastrar el handle **no** dispara
    el drag de mover (no "pelean"); al soltar persiste.
- [ ] **B4. Zoom in + arrastrar.** Hacer zoom (+) y volver a arrastrar la mesa.
  - *Esperado:* con `scale>1` el snap y el clamp siguen correctos en espacio lógico (la
    mesa no "colapsa" ni salta); el elemento queda dentro del área.
- [ ] **B5. Redimensionar con zoom.** Redimensionar con `scale>1`.
  - *Esperado:* el tamaño cambia en proporción correcta; persiste al soltar.
- [ ] **B6. Pan.** Desplazar el plano (pan transform-based).
  - *Esperado:* el stage se mueve sin scroll nativo; las mesas mantienen su posición lógica.
- [ ] **B7. Fit / reset de zoom.** Usar el botón de fit/reset.
  - *Esperado:* el zoom/pan vuelve a encuadrar el área.

---

## C. Decoración

- [ ] **C1. Agregar decoración.** Agregar `pared`, `columna`, `isla` y `barra` desde la paleta.
  - *Esperado:* cada una aparece con sus defaults (pared 200×16 rect, columna 40×40 circle,
    isla 120×80 rect, barra 240×40 rect); ninguna tiene QR ni sesión.
- [ ] **C2. Editar decoración.** En `decor-inspector`, cambiar tamaño, etiqueta y color.
  - *Esperado:* cambios visibles y persistidos (color hex 6 dígitos); el shape **no** es
    editable.
- [ ] **C3. z-index decoración.** "Al frente / al fondo" sobre una decoración solapada con
      una mesa.
  - *Esperado:* el orden de apilado cambia coherentemente (render por `z_index`).
- [ ] **C4. Borrar decoración.** Borrar una decoración.
  - *Esperado:* desaparece del canvas.

---

## D. Gestión mesa-QR (dividir / combinar / activar)

- [ ] **D1. Dividir.** Con una mesa seleccionada, "dividir".
  - *Esperado:* se crea **otra** mesa-QR con su propio `qr_token`, mismo `shape`/capacidad,
    posicionada a `(source.x + width + grid, source.y)` clampeada al área; número
    autosugerido.
- [ ] **D2. Combinar (sin sesión).** Combinar dos mesas (confirmar el `AlertDialog`).
  - *Esperado:* la **absorbida** pasa a `active=false`, su elemento desaparece del canvas;
    la sobreviviente conserva su QR y su elemento. La absorbida no aparece en la bandeja
    (está inactiva).
- [ ] **D3. Combinar con sesión abierta → bloqueo.** Con una sesión **abierta** en la mesa
      a absorber, intentar combinar.
  - *Esperado:* bloqueado con "La mesa tiene una sesión abierta. Cerrá o cobrá la sesión
    antes de continuar." (`table_has_open_session`).
- [ ] **D4. Desactivar.** Desactivar una mesa (Switch en el inspector → RPC).
  - *Esperado:* la mesa sale del canvas (su elemento se borra). Queda inactiva.
- [ ] **D5. Desactivar con sesión abierta → bloqueo.** Intentar desactivar una mesa con
      sesión abierta.
  - *Esperado:* bloqueado con `table_has_open_session` (mismo mensaje que D3).
- [ ] **D6. Reactivar → vuelve a la bandeja.** Reactivar una mesa desactivada.
  - *Esperado:* `active=true`; la mesa aparece en la **bandeja de no ubicadas** (sin
    elemento en el canvas).
- [ ] **D7. Colocar "no ubicada".** Desde la bandeja, colocar/arrastrar la mesa al canvas.
  - *Esperado:* se crea su elemento en el área activa; sale de la bandeja.
- [ ] **D8. Quitar del plano.** "Quitar del plano" en una mesa colocada (sin sesión abierta).
  - *Esperado:* el elemento se borra pero la mesa **sigue activa** y reaparece en la
    bandeja. (Con sesión abierta, la UI deshabilita "quitar del plano" — best-effort UX.)
- [ ] **D9. Imprimir QR.** Usar `PrintQrButton` desde el inspector.
  - *Esperado:* abre `/print/qr/<token>` con el QR de la mesa.
- [ ] **D10. Regenerar token.** Regenerar el `qr_token`.
  - *Esperado:* el token cambia; el QR impreso refleja el nuevo.

---

## E. Accesibilidad / robustez

- [ ] **E1. Teclado.** Tab hasta un elemento → Enter.
  - *Esperado:* Enter/click **selecciona y abre el inspector**. El modo mover por teclado
    es aparte (pickup con barra espaciadora, flechas mueven una celda = `grid*scale` px,
    Esc cancela); Enter no choca entre "abrir inspector" y "levantar para arrastrar".
- [ ] **E2. Lectura por screen reader.** Verificar `aria-label` (kind + label) y
      `aria-roledescription` en elementos; anuncios de drag en **español**.
  - *Esperado:* elementos anunciados con su tipo/etiqueta; sin tab-stops mudos.
- [ ] **E3. Fallback de lista.** Abrir la tab/ruta secundaria de **lista accesible**.
  - *Esperado:* `tables-list-fallback` lista todas las mesas con las mismas acciones, sin
    canvas (camino accesible canónico).
- [ ] **E4. Dark mode.** Alternar dark mode.
  - *Esperado:* grilla, mesas y decoración (incl. decor sin color → token neutral) con
    contraste AA; nada ilegible.
- [ ] **E5. Fallo de persistencia → revert.** Simular un fallo del flush de geometría
      (p. ej. cortar la red en DevTools mientras se arrastra) y soltar.
  - *Esperado:* **toast de error** + el estado optimista de los ids afectados **se revierte**
    (o se marca dirty y reintenta); no queda una posición fantasma sin persistir.

---

## Resultado

- [ ] Todos los pasos A–E en **verde**; bloqueos (A7, A8, D3, D5) muestran el mensaje
      accionable correcto.
- [ ] Screenshots/video corto adjuntos en el PR (al menos: canvas con mesas+decor,
      bandeja de no ubicadas, un bloqueo con su toast, dark mode).
````

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-floor-plan-smoke.md
git commit -m "docs(floor-plan): checklist de smoke manual del editor de plano"
```
