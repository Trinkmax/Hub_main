# Spec — Rediseño del floor plan (editor estilo SevenRooms + vista en vivo)

> Fecha: 2026-06-06 · Estado: aprobado para plan (brainstorming con companion visual)
> Workspace: `(manager)` (dueño) + `(salon)` (staff). Rediseña la feature de floor plan ya mergeada en `main` (specs `2026-06-05-floor-plan-editor-design.md`); **reusa su modelo de datos y backend**, reemplaza la capa de interacción del canvas, suma la **vista operativa en vivo**, y reestructura la navegación (tab "Local").

---

## 1. Problema y objetivo

El editor v1 (dnd-kit + divs + stage escalado por CSS) no cumple: **no se entiende cómo colocar elementos** (clic en la paleta → diálogo → aparece en el centro) y **el lienzo no se panea / el drag falla** (la matemática dnd-kit-bajo-escala era frágil; a 40% los elementos quedan minúsculos). Referencia pedida: **SevenRooms** — plano visual del local, drag-and-drop "de objetos físicos", y sobre todo la **vista operativa en vivo** (mesas coloreadas por estado + gasto acumulado en tiempo real).

**Objetivos (alcance B, aprobado):**
1. **Editor intuitivo**: arrastrar elementos desde la paleta al lugar; lienzo paneable (arrastrando el fondo) con zoom (scroll/pinch/+/−/fit); tamaños/zoom sensatos.
2. **Vista operativa en vivo**: el mismo plano, read-only, con cada mesa coloreada por estado de su sesión + gasto acumulado + comensales + tiempo + indicador de cocina, **en tiempo real**. Para el dueño (toggle en "Plano") y para el staff (en `/salón`).
3. **Navegación**: mover **"Local"** fuera de Configuración a su **propia tab** del sidebar.

---

## 2. Estado actual (anclas verificadas)

### Modelo de datos (se REUSA tal cual)
- `floor_plan_areas` (id, tenant_id, name, position, width, height, number_start) y `floor_plan_elements` (id, tenant_id, **area_id**, kind, shape, **physical_table_id**, x, y, width, height, rotation, z_index, label, color) — el área de una mesa vive en `floor_plan_elements.area_id` (`physical_tables` **no** tiene `area_id`; índice único `floor_plan_elements_pt_uidx` ⇒ 1 elemento por mesa). RPCs `fp_*` (create/merge/set-active/delete table, delete area) + `lib/floor-plan/{queries,actions,schemas,errors,numbering}.ts`. **Nada de esto cambia.**

### Datos para la vista en vivo (ya existen, sin schema nuevo)
- `table_sessions`: **status** (`open|paid|merged|abandoned`), **total_cents** (gasto acumulado, mantenido por triggers — leer la columna, no sumar), **opened_at** (tiempo), **party_size** (comensales declarados, nullable), **alias** (nombre de grupo opcional), `physical_table_id` (nullable → filtrar `is not null`). Índice único parcial `table_sessions_one_open_per_table_uidx` ⇒ **a lo sumo una sesión abierta por mesa** (join no ambiguo).
- **Cocina**: `tickets.status` (`pending|accepted|preparing|ready|served|cancelled`); una mesa "tiene cocina activa" si algún ticket de su `session_id` está en `('accepted','preparing','ready')`.
- **Comensales**: `party_size` (headcount declarado) o `count(session_guests)` (celulares conectados). Para la tarjeta usamos **party_size**.
- **Cuenta pedida**: `table_session_events` type `bill_requested` (la grilla actual ya lo muestra).
- **Reuso clave**: `listSalonTables(tenantId)` (`lib/sessions-waiter/queries.ts`) ya hace el join por-mesa a la sesión abierta (total_cents, party_size, alias, guest_count, pending_tickets, bill_requested, customer_names) — **no** está scopeada por área y usa solo `pending`. `getFloorPlan(tenantId)` da la geometría espacial por área. La vista en vivo = combinar ambos, scopeando por `floor_plan_elements.area_id` y ampliando el filtro de cocina a `accepted|preparing|ready`. Helpers UI existentes a reusar: `elapsedLabel(opened_at)` y `ARSFormat(total_cents)` (en `salon-tables-grid.tsx`).

### Realtime (gap a corregir)
- `lib/realtime/`: `subscribeChanges({channel, events:[{event,table,filter,onChange}]})` → cleanup; `mergeRow`; `useDebouncedRefresh`. El staff ya suscribe (`salon-view.tsx` canal `salon-${tenantId}` a `table_sessions`+`tickets`+`table_session_events`; `session-detail.tsx`; `kds-screen.tsx`).
- **BUG verificado**: `table_sessions`, `tickets`, `ticket_items`, `table_session_events` **NO están en la publicación `supabase_realtime`** → esas suscripciones **no reciben eventos hoy** (sobreviven por el `setInterval` de 30s + refresh manual). Solo `messages/conversations/broadcasts/.../salon_reservations/scheduled_events` están publicadas. → Hay que **publicarlas** (migración idempotente, espejo de `20260520040000_salon_reservations_realtime.sql`). Esto arregla también el realtime de la grilla actual.
- RLS de realtime = misma que SELECT: **authenticated (staff)** recibe lo de su tenant ✓; **anon** (`/m/[qrToken]`) **no** (sin policy `to anon`) → el comensal sigue con polling. Wireamos realtime **solo para staff/dueño**.

### Navegación (shell)
- Sidebar del dueño: `components/shell/nav-config.ts` → `NAV_GROUPS: NavGroup[]` (cada item: `{label, href:(slug)=>string, icon: NavIconKey, roles?}`); íconos en `nav-icons.ts` (agregar la key o es error TS); render genérico en `sidebar-content.tsx`/`sidebar-nav.tsx`. proxy.ts no enumera rutas (no se toca).
- "Local" hoy **no es un segmento de ruta**: es solo agrupación visual en `configuracion/_components/settings-nav.tsx` (GROUPS) + la card "Local" en `configuracion/page.tsx`. Las 3 páginas son carpetas hermanas bajo `configuracion/`: `mesas` (el editor, 15 files en `_components/`), `captura`, `auto-aceptacion` — cada una re-chequea owner adentro.

---

## 3. Decisiones validadas (brainstorming)

| Tema | Decisión |
|---|---|
| Alcance | **B**: editor rediseñado **+** vista operativa en vivo. |
| Colocar elementos | **Arrastrar desde la paleta** al lugar (no diálogo-al-centro). |
| Tarjeta en vivo | **Completo**: color por estado + gasto + comensales + tiempo + punto de cocina. |
| Navegación | Tab **"Local"** propia (Plano + Captura QRs + Auto-aceptación); **Plano** con toggle **Editar / En vivo**; el staff ve el plano en vivo en `/salón`. |
| Tech del canvas | **`react-zoom-pan-pinch` v4** (pan/zoom robusto) + **drag de elementos propio** (pointer events, en coords del stage). Sale dnd-kit. Mantiene divs DOM + accesibilidad. |

---

## 4. Diseño — Navegación (tab "Local")

- **Nuevo `NavGroup` "Local"** en `nav-config.ts` (roles `['owner']`), items → `/${s}/local/mesas` (Plano), `/${s}/local/captura`, `/${s}/local/auto-aceptacion`. Agregar íconos a `nav-icons.ts` (p.ej. `LayoutGrid`, `QrCode`, `Zap`). Posición: tras "Eventos" / antes de "Catálogo".
- **Mover** (con `git mv` carpetas enteras, imports `@/`/relativos quedan intactos): `configuracion/{mesas,captura,auto-aceptacion}` → **`app/(manager)/[tenantSlug]/local/{mesas,captura,auto-aceptacion}`** (nuevo route group). Owner-check viaja dentro de cada page.
- **Limpiar referencias** (typecheck las caza): `revalidatePath` en `lib/floor-plan/actions.ts` (17×), `lib/tables/actions.ts` (4×) → `/local/mesas`; `lib/capture/actions.ts` (3×) → `/local/captura`; `lib/admin/tenant-config.ts` → `/local/auto-aceptacion`. Links entrantes: `clientes/page.tsx` (2× captura), `docs-content.tsx` (mesas, auto-aceptacion), `onboarding-wizard.tsx` (cta mesas), `command-config.ts` (auto-accept — además corregir sus hrefs stale preexistentes). Quitar el grupo "Local" de `settings-nav.tsx` y la card "Local" de `configuracion/page.tsx`.
- Sin cambios de proxy/RLS/DB.

---

## 5. Diseño — Editor (modo **Editar**)

### Canvas con `react-zoom-pan-pinch`
- `<TransformWrapper>` (uncontrolled: `initialScale`, `centerOnInit`, `minScale={0.25}`, `maxScale={4}`, `limitToBounds={false}`, `panning={{ excluded:['floor-element'], velocityDisabled:true }}`, `wheel={{step:0.2}}`, `pinch={{step:5}}`) → `<TransformComponent wrapperStyle={{width:'100%',height:'100%'}}>` → **un** div "stage" `position:relative` de tamaño = área lógica (`area.width × area.height`) con grilla de fondo CSS. Las mesas/decoración son divs **`position:absolute` en coords lógicas** dentro del stage, con `className="floor-element"`.
- **Pan** = arrastrar el fondo (lo da la lib). **Zoom** = scroll/pinch + botones `+`/`−`/`fit` vía `ref` (`zoomIn`/`zoomOut`/`centerView`; "fit" = `centerView()` o `setTransform` con escala calculada; `zoomToElement(id)` para enfocar). El editor es **`'use client'`** (montar como leaf; opcional `dynamic(..., {ssr:false})` si hay problemas de medición).

### Drag de elementos (propio, sin dnd-kit)
- Pointer events en cada `floor-element`: `onPointerDown` → `e.stopPropagation()` + `setPointerCapture`; `onPointerMove` → leer **`scale` desde `ref.current.state`** (sin re-render) y `newX = origX + (clientX-startX)/scale`, `newY = …/scale` → `snapToGrid` + `clampToArea` (reusados de `grid.ts`) → set optimista del estado local; `onPointerUp` → persistir vía `saveGeometryAction` (reuso `use-geometry-queue.ts`, debounced + rollback). `touchAction:'none'`. La combinación `panning.excluded:['floor-element']` + `stopPropagation` garantiza que arrastrar una mesa NO panea el lienzo. (La conversión `/scale` es la corrección del bug de v1.)

### Colocar desde la paleta (drag-from-palette)
- Las chips de la paleta (`element-palette.tsx`) son arrastrables. Al **soltar sobre el stage**, convertir el punto de drop a coords lógicas (`(clientX − wrapperRect.left − positionX)/scale`, idem Y; restar el origen del wrapper y el pan) y:
  - **Mesa** → `createTableInPlanAction` en ese punto con label autosugerido (`suggestNextLabel`) + capacidad default; **abrir el inspector** de la mesa nueva para ajustar (reemplaza el diálogo-al-centro de v1; `create-table-dialog.tsx` se retira). Shape (rect/redonda) editable en el inspector.
  - **Pared/Columna/Isla/Barra** → `addDecorAction` con `ELEMENT_DEFAULTS[kind]` en el punto.
- Fallback no-drag: clic en una chip la agrega en el centro del área visible (compat/touch simple).

### Resize, inspector, áreas, bandeja (REUSO)
- `resize-handles.tsx`: se mantiene; el delta también se divide por `scale`. `table-inspector.tsx`, `decor-inspector.tsx`, `area-manager.tsx`, `unplaced-tray.tsx`, `tables-list-fallback.tsx`, `print-qr-button.tsx`, `floor-plan-error-boundary.tsx`, `zero-area-cta.tsx`: **se reusan** (las server actions/RPCs no cambian). `unplaced-tray` sigue siendo el camino para ubicar mesas/mover de piso.

---

## 6. Diseño — Vista en vivo (modo **En vivo**)

### Lectura `getLiveFloor`
- Nuevo `getLiveFloor(tenantId, areaId)` (`server-only`, en `lib/floor-plan/queries.ts`): toma los `floor_plan_elements` del área (incluye decoración, para dibujar el mismo plano) y, para los `kind='table'`, **join a la única sesión abierta** por `physical_table_id` → `{ status, total_cents, party_size, alias, opened_at }` + flag `kitchen` (`exists tickets status in ('accepted','preparing','ready')`) + flag `bill_requested`. Patrón: TS + supabase-js como `listSalonTables` (RLS abre SELECT a miembros; PostgREST no tiene NOT EXISTS → anti-join/conteos en JS), scopeado por área vía `floor_plan_elements`. **Sin tablas ni RPC nuevos** (opcional: un RPC SECURITY DEFINER `get_live_floor` para 1 round-trip, estilo `get_salon_occupancy` — decidir en el plan; por defecto TS).

### Render
- El **mismo canvas** (TransformWrapper/stage) pero **read-only**: sin handles de resize, sin drag de elementos (panning libre, sin `excluded`), sin paleta. Decoración en gris neutro; mesas coloreadas por `status`: **libre** (sin sesión) verde tenue, **ocupada** (`open`) ámbar, **pagada** (`paid`) azul/slate. Tarjeta **Completo**: `alias ?? label`, `ARSFormat(total_cents)`, `party_size` (👥), `elapsedLabel(opened_at)`, **punto de cocina** (ámbar=preparando / verde=lista) si `kitchen`, e indicador "cuenta pedida" si `bill_requested`. **Tap en mesa** → su sesión (la ruta de detalle que ya existe: `/salón/mesas/[sessionId]` para staff; el dueño abre el mismo detalle o un panel). Header con resumen (ocupadas/libres/total) vía `getSalonOccupancy`.
- **Tiempo real**: `subscribeChanges({ channel:`live-${tenantId}`, events:[{table:'table_sessions',filter:`tenant_id=eq.${tenantId}`},{table:'tickets',filter:`tenant_id=eq.${tenantId}`}], onChange: debouncedRefresh })` → refetch de `getLiveFloor` (o un endpoint). Reusar el patrón de `salon-view.tsx` (+ safety-net 30s). **Requiere la migración de publicación (§7).**

### Dónde vive
- **Dueño**: `Local → Plano` con un **toggle Editar/En vivo** (un componente contenedor que monta el editor o el live floor según el modo). 
- **Staff**: `/salón` (mesas) **reemplaza la grilla** (`salon-tables-grid`) por el **mismo live-floor** (componente compartido), área-scopeado, con su selector de áreas. El staff ya suscribe realtime (se reusa `salon-view.tsx`, ahora efectivo gracias a §7).

---

## 7. Datos & backend

- **Sin tablas nuevas.** Una **migración** (idempotente, espejo de `20260520040000`): agregar `table_sessions`, `tickets`, `ticket_items`, `table_session_events` a la publicación `supabase_realtime` (`alter publication … add table …` con guarda `exception when duplicate_object then null`). `replica identity` default alcanza (filtros por PK/`tenant_id`/`session_id` presentes en `new`). Aplicar vía Supabase MCP `apply_migration` (proyecto `ogplsevtrclzxvyejlns`).
- **Query nueva** `getLiveFloor(tenantId, areaId)` (TS, server-only) + sus tipos. Reusa `floor_plan_*` + `table_sessions`/`tickets` (lecturas RLS-abiertas a miembros). Opcional endpoint `/api/...` o `router.refresh` para el refetch realtime.
- `react-zoom-pan-pinch` como dependencia nueva (`npm i react-zoom-pan-pinch`, v4) — **confirmar versión vía Context7 al implementar** (§13 CLAUDE.md).
- `npm run db:types` no aplica (no hay cambio de tablas/columnas/enums; la publicación no altera tipos).

---

## 8. Componentes / archivos

**Nuevos**
- `lib/floor-plan/queries.ts` (o `lib/salon/live-floor.ts`) — `getLiveFloor` + tipos `LiveFloorTable`/`LiveFloorData`.
- `_components/live-floor.tsx` — el canvas read-only en vivo (TransformWrapper + tarjetas Completo + realtime), **compartido** por el dueño (modo En vivo) y el staff (`/salón`).
- `_components/live-table-card.tsx` — la tarjeta de mesa en vivo (color/gasto/comensales/tiempo/cocina/cuenta).
- `_components/plano-tabs.tsx` (o lógica en la page) — el toggle **Editar / En vivo** del dueño.
- `supabase/migrations/<ts>_realtime_salon_publication.sql` — publica las 4 tablas.

**Reescritos (sale dnd-kit; entra react-zoom-pan-pinch + pointer drag)**
- `floor-canvas.tsx` (TransformWrapper/TransformComponent/stage), `floor-element.tsx` (pointer drag + scale), `element-palette.tsx` (chips arrastrables → drop-to-create), `floor-plan-editor.tsx` (orquesta sin DndContext, drag-from-palette, toggle), `a11y.ts` (sale el de dnd-kit; la lista accesible queda como camino canónico — ver §10), `resize-handles.tsx` (ajuste de delta por scale). `create-table-dialog.tsx` se retira (el alta es drag-from-palette + ajustes en el inspector).

**Reusados sin cambios**
- `lib/floor-plan/{actions,schemas,errors,numbering}.ts`; `grid.ts` (snapToGrid/clampToArea/ELEMENT_DEFAULTS/GRID/RESIZE_MIN — **se borran** los modifiers dnd-kit `createSnapModifier`/`restrictToParent`); `use-geometry-queue.ts`; `table-inspector.tsx`, `decor-inspector.tsx`, `area-manager.tsx`, `unplaced-tray.tsx`, `tables-list-fallback.tsx`, `print-qr-button.tsx`, `floor-plan-error-boundary.tsx`, `zero-area-cta.tsx`. RPCs `fp_*`.

**Movidos (nav)** — las 3 carpetas a `app/(manager)/[tenantSlug]/local/*` + `nav-config.ts`/`nav-icons.ts` + limpieza de refs (§4). El staff `/salón` mesas pasa a montar `live-floor`.

**Dependencias** — `npm uninstall @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` si no quedan otros usos (verificar); `npm i react-zoom-pan-pinch`.

---

## 9. Multi-tenant / seguridad (LEY)
- Editor owner-only (guarda de page + actions/RPCs `fp_*` ya owner-gated). Live floor: lectura RLS-abierta a miembros del tenant (owner + staff) — correcto (el staff debe verla). Sin `service_role` en browser. Realtime: solo `authenticated` recibe (RLS); `anon` (comensal) no. La publicación no expone datos (RLS sigue filtrando). Sin PII nueva en logs.

---

## 10. Testing (DoD)
- **Unit (Vitest)**: helper de conversión screen→stage (`(clientX − originX − panX)/scale`) y el commit de drag (`snapToGrid((orig*scale+Δ)/scale)`), si se extraen a `grid.ts` puros — con casos a scale 1 y 2 (la clase de bug de v1). `getLiveFloor` mapeo (estado→color, kitchen flag desde tickets, party_size/total) si se extrae lógica pura.
- **RLS/integración (`tests/rls`)**: `getLiveFloor` aísla por tenant + por área; un miembro ve, otro tenant no. (Las RPCs `fp_*` ya tienen tests.)
- **Realtime**: verificar (manual/CI) que tras la migración un cambio en `table_sessions`/`tickets` dispara el `onChange` (publicación efectiva).
- **Smoke manual (PR)**: arrastrar mesa desde la paleta → cae donde la soltás + abre inspector → arrastrar el fondo panea, scroll zoomea, fit centra, a scale≠1 el drag no driftea → resize → dividir/combinar/activar (reuso) → toggle **En vivo**: mesas coloreadas, gasto/comensales/tiempo/cocina, **se actualiza en vivo** al cobrar/pedir en otra pestaña, tap → sesión → en `/salón` (staff) se ve el mismo plano en vivo → "Local" es tab propia, Configuración sin "Local", links viejos redirigen → dark mode → lista accesible (fallback). Incluir el smoke de los 2 bugs ya arreglados si aplica.
- **a11y**: el canvas con react-zoom-pan-pinch no da teclado nativo de mover; **la lista accesible (`tables-list-fallback`) es el camino canónico** (todas las acciones por teclado). En el canvas: elementos focusables (Tab) que con Enter abren el inspector. (Nudge por flechas: fuera de v1 de este rediseño; anotar en backlog.)

---

## 11. Fuera de alcance / por defecto
- Auto-seating con IA; cambiar estado de mesa a mano (lo maneja el ciclo QR/sesión); arrastrar mesas entre pisos (se mueven por la bandeja); rotación libre (queda `rotation`); realtime para el comensal `anon` (sigue con polling); nudge por teclado en el canvas (backlog). 
- No se toca el modelo de datos del floor plan, reservas, puntos, ni KDS más allá de leer su estado para el live floor + publicar las tablas a realtime.
