# BACKLOG

Hallazgos fuera del scope de la tarea en curso, anotados para retomar
(ver CLAUDE.md §14.7). No bloquean el merge de la feature donde se detectaron.

## Carta del comensal + captura (rama `feat/carta-comensal-captura`)

- **Imágenes de menú huérfanas en Storage (ítems).** `deleteMenuImageByUrl`
  (`lib/menu/upload-image.ts`) ya se usa al reemplazar/limpiar la foto de una
  **categoría** (`category-edit-dialog.tsx`), pero el flujo de **ítems**
  (alta/edición) nunca borra la imagen previa al reemplazarla o quitarla → deja
  archivos huérfanos en el bucket `menu-images`. Aplicar el mismo patrón en el
  editor de ítems, o centralizar el borrado dentro de `MenuImageUploader` cuando
  cambia `value`.
- **`next/image unoptimized` en toda la carta del comensal.** Todas las imágenes
  de `/m/[qrToken]` usan `unoptimized` (convención preexistente: item-detail,
  closing-screen, mesa-screen, y las nuevas item-row/category-card/recommended).
  `next.config.ts` ya whitelistea `*.supabase.co/storage`, así que se podría
  habilitar la optimización de Next (responsive + WebP/AVIF + lazy) quitando
  `unoptimized`. Evaluar el tradeoff de costo de Image Optimization en Vercel
  vs. performance, y aplicarlo de forma consistente (no solo en los componentes
  nuevos) si se decide adoptar.
- **Carrusel "Recomendados": scroll por teclado.** El contenedor
  `overflow-x-auto` (`recommended-carousel.tsx`) no es operable con flechas del
  teclado (los botones internos sí son alcanzables por Tab). Coincide con el
  patrón del viejo `menu-list.tsx` (no es regresión). Mejora a11y: `role="region"`
  + manejo de Left/Right, o patrón WAI-ARIA de carrusel.
- **`OrderConfirmation`: focus-trap completo.** Se agregaron `role="dialog"`,
  `aria-modal`, `aria-labelledby` y foco al montar. Falta trap real (Tab no
  debería salir del overlay) y restaurar foco al cerrar. Evaluar migrar a shadcn
  `Dialog` para heredar estos comportamientos.
- **`CategoryCard` fallback sin imagen: acento dorado.** El spec (§4.1) pedía un
  "detalle dorado (acento)" en el contador cuando la categoría no tiene foto;
  hoy usa `text-primary-foreground/80`. Cosmético — definir el token de acento
  (¿`--forest-glow`/`--warning`?) y aplicarlo manteniendo contraste AA.

## Floor plan de mesas (rama `feat/floor-plan-mesas`)

Hallazgos Minor del code-review de la Migración A (`20260605000100_floor_plan_editor.sql`,
ya aplicada al remoto vía MCP — **no editar**; corregir en una migración follow-up
cuando aterrice el editor v1):

- **`floor_plan_elements.rotation` sin CHECK.** La columna es "siempre 0 en v1" pero no lo
  enforcea el DB. Agregar en follow-up `check (rotation between 0 and 359)` (forward-compat
  con v2) o `check (rotation = 0)` (invariante estricta v1).
- **`floor_plan_areas.position` y `floor_plan_elements.z_index` sin cota superior.** El resto
  de las columnas numéricas (width/height/x/y/number_start) tienen rango; estas no. Agregar
  `check (… between 0 and 9999)` en follow-up para frenar basura de un bug de cliente.
- **Estilo de `revoke` divergente.** `fp_elements_integrity` revoca en dos statements
  (`from anon` + `from public`) y omite `authenticated`; funcionalmente equivalente, pero el
  resto del repo usa `revoke execute … from public, anon, authenticated;` en un solo statement.
  Consolidar en la próxima migración que toque la función.
- **`types/database.ts`: aliases `FloorElementKind`/`FloorElementShape` fuera de orden alfabético**
  (apendizados al final en vez de tras `EventStatus`). Nit cosmético en la sección hand-maintained.
- **`reorderAreasAction` no es atómico.** Hace N `update` secuenciales de `position`; un fallo
  parcial deja el orden inconsistente (no hay rollback). Bajo riesgo (un solo owner edita, y un
  retry restaura el orden). Mejorar con un único statement/RPC transaccional (p. ej. update con
  CASE o un `fp_reorder_areas(p_ids uuid[])`).
- **`splitTableAction` no re-chequea que el elemento fuente siga existiendo** entre la lectura y el
  RPC. Benigno (crea la mesa igual en el área correcta); informativo.
- **Re-colocar una mesa pierde la forma `circle`.** `placeTableAction` (y el drop/“Colocar” de la
  bandeja) hardcodean `shape: ELEMENT_DEFAULTS.table.shape` (`'rect'`). Una mesa creada redonda,
  al quitarla del plano y volver a colocarla desde la bandeja, vuelve como rectángulo (la forma no
  se guarda en `physical_tables`). Aceptable v1; para arreglarlo habría que persistir la última
  forma (columna nueva o en el último element antes de quitarla).
- **`useGeometryQueue.flushNow` se expone pero el editor no lo llama.** Superficie muerta en el tipo
  de retorno del hook; el flush por `beforeunload` es interno y alcanza. Quitar `flushNow` del API
  o usarlo (p. ej. flush al cambiar de área).

## Arreglo drag + estilo del floor plan v2.1 (2026-06-07)

- **Migrar el resize al mismo patrón rAF + transform del move.** Hoy `resize-handles.tsx`
  usa `setLiveSize` (estado), que re-renderiza el elemento activo por frame durante el
  gesto; funciona y commitea al soltar, pero por consistencia/perf convendría pintar el
  resize con `transform`/dimensiones imperativas como hace ahora el move.
- **Feedback de "agarrado" en el drag.** Pulido visual no incluido: al `pointerdown` de
  una mesa, subir sombra + `scale(1.02)` + `cursor:grabbing`. Aplicarlo al `<button>`
  (no al wrapper, que recibe el `translate3d` del drag) para no pisar el transform.
- **Nudge por teclado en el canvas.** Mover elementos con flechas (con/ sin snap) — sigue
  fuera de alcance; la lista accesible es el camino canónico por teclado.

## Rediseño del floor plan v2 (rama `feat/floor-plan-rediseno`)

- **Falta unit test de la derivación JS de `getLiveFloor`.** El plan listaba
  `tests/lib/floor-plan-live.test.ts` para la lógica pura (estado→color, cocina ready>preparing>none,
  bill flag); no se creó. El test RLS cubre aislamiento/área/join de sesión, pero la derivación de
  cocina/estado no tiene cobertura automatizada. Extraer esa lógica a un helper puro y testearla.
- **`bill_requested` en la vista en vivo tarda hasta 30s.** `table_session_events` **no tiene
  `tenant_id`**, así que no se puede filtrar una suscripción realtime por tenant; el flag de
  "cuenta pedida" se actualiza solo en el tick del safety-net (≤30s). Para hacerlo instantáneo:
  agregar `tenant_id` a `table_session_events` y sumar la suscripción (mirror de salon-view).
- **`getLiveFloor`: `total_cents ?? 0` es dead code** (`table_sessions.total_cents` es `NOT NULL
  DEFAULT 0`). Cosmético; quitar el fallback.
- **Doc/commits dicen `react-zoom-pan-pinch` v4 pero se instaló v3.7.0** (v4 no existe en npm; v3.7
  es el `latest` estable y API-compatible). Nit de naming en el plan/commits; el código es correcto.

## Rediseño floor plan v3 (SevenRooms) — lows diferidos del review adversarial

Anotados del review (2026-06-08); no bloquean. Confirmados pero de bajo impacto:

- **Marquee/box-select en el editor.** La multi-selección hoy es shift/cmd-click + grupo.
  Falta arrastrar un rectángulo sobre el fondo para seleccionar varios. (rzpp usa el
  drag de fondo para panear; haría falta un modo o Shift+drag-bg.)
- **Re-seed del editor sólo guardado por `draggingRef`** (lo setean el body-drag y
  drag-from-palette, NO el resize/rotate). Un `router.refresh` concurrente a mitad de un
  resize/rotate podría pisar el estado optimista. Muy estrecho. Fix: que ResizeHandles/
  RotateHandle también marquen el ref de gesto activo.
- **`router.refresh` tras create/duplicate/delete no flushea la cola de geometría** (sí lo
  hace `onChanged`). Un move sin flushear (<600ms) seguido de una op estructural se revierte
  visualmente hasta el próximo flush+refresh. Fix: `await queue.flushNow()` en esos paths.
- **Fit-to-content ignora la rotación** al calcular el bbox (puede recortar levemente una
  mesa muy rotada). Fix: expandir cada elemento a su AABB rotado.
- **Bulk-create: dedup de labels best-effort** (snapshot único; dos bulk concurrentes en la
  misma área podrían repetir números). No hay unicidad DB en `(tenant_id, label)`.
- **`saveGeometryAction` / `reorderAreasAction` son loops por fila no atómicos** (patrón
  preexistente). Un fallo a mitad deja layout parcial. Fix: RPC transaccional `fp_save_geometry(jsonb)`.
- **LiveFloor ignora cambios de `initial` tras `router.refresh`** (depende de Realtime +
  safety-net 30s). No se hizo re-seed naive por el estado interno de área (causaría salto de
  área). Fix correcto: re-seed sólo del área activa.
- **Nudge de teclado por flechas en el canvas** ya existe; falta documentarlo en la ayuda.

## Carta — categorías anidadas (rama `feat/carta-nested-categories`)

Diferidas del review final (ninguna bloquea; la feature es correcta y testeada):

- **Hardening DB del invariante intra-tenant de `parent_id`.** Hoy lo garantizan RLS
  + validación en `move_category`/`createCategory`. Vía PostgREST directo, un owner
  podría setear `parent_id` a una categoría de otro tenant (tendría que adivinar el
  UUID, RLS le oculta los ids ajenos). Agregar un trigger que valide que el `tenant_id`
  del padre == el de la fila para hacerlo garantía de DB.
- **Audit actor en `createCategory`/`moveCategory`/`createMenuItem`.** Registran
  `userId: null`; `deleteCategory`/`toggleFeatured` ya capturan el actor con
  `auth.getUser()`. Unificar para tener el "quién" en todos los eventos.
- **`lib/item-tags/queries.ts` (gestión de tags).** No filtra `active` ni `category_id`,
  así que tras un borrado en cascada los ítems archivados aparecen con `category_name = null`
  (no crashea). Agregar `.not('category_id','is',null)` si molesta.
- **`get_session_state`: `order by category->>'position'` es lexicográfico** (preexistente):
  con 10+ categorías de primer nivel el orden sale "1,10,2…". Castear: `order by (category->>'position')::int`.
- **Consistencia de validación.** `lib/menu/schemas.ts` usa `z.guid()` para
  `parent_id`/`moveCategorySchema`/`reorderCategoriesSchema`; el resto del repo usa
  `z.string().uuid()`. Estandarizar (con fixtures de UUID v4 válidos en tests).
- **Paridad de pausado padre→hijo (cliente).** Al pausar una categoría padre, sus
  subcategorías activas se promueven a raíz en la carta (decisión aceptada). Para paridad
  estricta, filtrar subtrees con ancestro inactivo en `get_session_state`.
- **Mozo `items-step`: tabs planas con ruta** en vez de drill-down (decisión explícita del
  usuario sobre la UI del staff). El texto del spec quedó desactualizado respecto a esa decisión.
- **`new-per-item-form` (puntos)** usa `<Select>` con labels de ruta en vez del
  `CategoryTreePicker`. Cumple el requisito (muestra la ruta); opcional unificar componente.
- **Perf menor:** en `menu-hub.tsx`, `levelNodes`/`subcatCount` recomputan `hasContent`
  por render. Memoizar si aparecen árboles muy grandes (no relevante a escala de un bar).
- **Datos cíclicos de categorías.** `buildCategoryTree`/`buildForest` excluyen nodos en
  ciclo (no crashean; nunca quedan como raíz) → esas categorías se vuelven invisibles. Un
  ciclo solo es alcanzable por escritura raw/seed (la app lo previene en `move_category`). Aceptable.
- **Unicidad de nombres entre hermanos** no se enforce (`unique(tenant_id, parent_id, name)`).
  Opcional con warning suave en UI.

## Bugs pre-existentes detectados (fuera del scope del sistema de puntos, jul 2026)

Hallados al documentar el rediseño de puntos; **no** los introduce ese trabajo y no
bloquean su merge. Tocan la operativa de mesa (hoy oculta por feature-flag).

- **Las punch cards item/category/tag no avanzan al cobrar una sesión.** La versión
  vigente de `mark_session_paid(uuid, jsonb)`
  (`supabase/migrations/20260529120100_mark_session_paid_with_redemptions.sql`) **ya no
  llama** a `_advance_punch_cards_for_visit` — sí lo hacía la versión anterior
  (`20260506130200_plan4_punch_cards_in_mark_paid.sql`, con 3 invocaciones). Resultado:
  al cerrar/cobrar una mesa, las punch cards de tipo `item` / `category` / `tag` **no
  suman sello**. Solo avanza el `visit_window`, y solo por la vía manual
  `register_lunch_visit`. Rehabilitar el avance de punch cards dentro de
  `mark_session_paid` (reintroducir la llamada) o mover esa lógica a un lugar que el
  cobro sí ejecute.

- **`register_lunch_visit` inserta `points_transactions` con `delta = 0`.** En
  `supabase/migrations/20260511000100_phase9b_punch_window_and_rpcs.sql`, tras marcar el
  sello del `visit_window`, la función inserta una `points_transactions` con `delta = 0`
  y `reason = 'lunch_visit'`, lo que **viola el CHECK `delta <> 0`**
  (`20260504030000_phase3_consumption_loyalty.sql`, línea 116) → la transacción
  abortaría. Es un bug **latente** (no hay datos/flujos que hoy ejerciten esa rama del
  RPC), pero explota si alguien registra un almuerzo por esa vía. Arreglar: no insertar
  la fila de puntos cuando `delta = 0` (registrar el sello sin ledger), o usar otra tabla
  de auditoría para el evento `lunch_visit`.
