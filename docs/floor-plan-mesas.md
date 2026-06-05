# Editor visual de plano de mesas (floor plan) — guía técnica

> Convierte la pantalla de mesas del dueño
> (`(manager)/[tenantSlug]/configuracion/mesas`) de una grilla de cards a un
> **editor visual de plano**: arrastrar/redimensionar mesas y decoración
> (paredes/columnas/islas/barra) sobre **áreas configurables** por tenant, con
> gestión mesa-QR (crear, dividir, combinar-soft, activar/desactivar, quitar del
> plano) desde un panel lateral. Solo el editor del dueño; la vista operativa en
> vivo del salón queda para entrega 2 sobre el mismo modelo.

Ruta: `/{tenantSlug}/configuracion/mesas` (solo `owner`).

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
| `fp_create_table` | `(p_area_id, p_label, p_shape, p_x, p_y, p_capacity default null)` | `{table_id, element_id, qr_token}` | inserta `physical_tables` (qr_token default) + su elemento `kind='table'` z=10 en una transacción |
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

## Persistencia de geometría

Mover y redimensionar son operaciones de alta frecuencia: van por una cola
optimista (`use-geometry-queue.ts`) con debounce de 600 ms y flush en
`beforeunload`. Si el flush falla, el editor revierte el estado optimista de los
ids afectados y muestra un toast. Las mutaciones estructurales (alta/baja/merge,
áreas, colocar/quitar del plano) usan `router.refresh()` para re-sembrar el RSC.

El pipeline de commit de un drag es canónico: los deltas de dnd-kit vienen en px
de pantalla, así que se dividen por `scale` antes de snapear a la grilla en
espacio lógico y clampear al área (`snapToGrid(el.x + delta.x / scale)` →
`clampToArea`). El `DndContext` usa `autoScroll={false}` y mide contra el
viewport sin transform (el stage escalado vive dentro).

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
