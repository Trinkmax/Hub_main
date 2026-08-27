# BACKLOG

Hallazgos fuera del scope de la tarea en curso, anotados para retomar
(ver CLAUDE.md §14.7). No bloquean el merge de la feature donde se detectaron.

## Rediseño del panel de mozos (salón)

- **`award_points_by_amount` no tiene clave de idempotencia.** La RPC inserta una
  `visits` sintética + su `points_transactions` en cada llamada, sin ninguna
  restricción: un reintento de red, un doble tap o dos mozos escaneando el mismo
  QR acreditan dos veces e inflan `total_visits`/`total_spent_cents` del cliente
  vía `visits_apply_stats`. Se agregó un guard en `awardPointsByAmount`
  (`lib/points/actions.ts`): rechaza mismo `customer_id` + mismo `amount_cents`
  dentro de 3 minutos. **No es a prueba de carreras** — dos requests simultáneas
  pasan las dos. El fix real es un índice único parcial sobre
  `points_transactions (tenant_id, customer_id, reason, (payload->>'amount_cents'))`
  acotado por ventana de tiempo, o un `p_idempotency_key` en la RPC.
- **Revertir `arrived` → `pending` deja la entry de comisión colgada.** Desde la
  migración `20260826150000` la comisión se liquida al marcar "Llegó", pero
  `transition_reservation_status` no llama a `recalc_reservation_commission` al
  volver a `pending`, así que la fila de `commission_ledger` sobrevive. Es el
  mismo comportamiento que ya tenía `closed` → `seated`, no una regresión nueva.
  Limpiarlo implica que `recalc_reservation_commission` trate `pending` como
  "sin servicio efectivo" (hoy sólo lo hace con `cancelled`/`no_show`), y eso
  **borraría entries impagas ya existentes** de reservas en `pending` (al escribir
  esto: 5 filas, $2.250 en HUB). Decidir con el dueño antes de tocarlo.
- **Sintaxis Tailwind v4 rota en el resto de la app: `bg-[--var]` es no-op.** En
  v4.2 la forma correcta de leer una CSS var en una utilidad es `bg-(--var)`, o
  el token registrado en `@theme inline` (`bg-cream-tint`). Se corrigieron las
  primitivas que usa el salón (`button`, `badge`, `empty-state`, `data-table`) —
  ojo que eso **devuelve el hover a los botones `ghost`/`outline` en TODA la
  app**, que estaba silenciosamente muerto. Quedan ~30 usos del patrón viejo en
  `app/(manager)/**`, `components/shell/sidebar-nav.tsx`, `app/m/**` y
  `app/onboarding/**`. Barrido global pendiente.
- **Navegación client-side manager → salón saldría en oscuro.** El tema del salón
  se decide en el `<html>` del root layout con el header `x-hub-workspace` que
  pone el proxy. En una navegación client-side el `<html>` no se re-renderiza.
  Hoy no pasa: los únicos links manager → salón (`nav-config.ts`) son
  `newTab: true` y están detrás de `table_service`/`kitchen` (OFF en HUB). Si se
  agrega un `<Link>` normal, hace falta un client component en el layout del
  salón que setee/limpie `documentElement.dataset.forceLight`.
- **`salon/mesas`, `salon/cocina` y `salon/mi-turno` siguen con el diseño viejo.**
  El rediseño cubrió las 3 pantallas vivas de HUB (escanear, QR del club,
  reservas). Esas tres están detrás de `table_service`/`kitchen` — apagadas en
  HUB, vivas para otros tenants — y todavía tienen `PageHeader` duplicando el
  título del topbar y una barra de acción `fixed bottom-0` que colisiona con la
  tab bar (`mesas/[sessionId]/_components/session-detail.tsx:500`). Alinearlas al
  contrato de scroll del shell cuando se prenda alguno de esos flags.
- **`components/shell/salon/swipe-action.tsx` es código muerto.** Nadie lo
  importa. O se conecta a un gesto real (swipe → "No vino" en la card de
  reserva) o se borra.

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

## Mensajería — deuda backend (auditoría jul 2026, rama `fix/mensajeria-deuda-backend`)

Detectada en la auditoría del sistema de mensajería (2026-07) y verificada contra
prod el 2026-07-08. El fix de `refresh-mv-stats` se resolvió en esta rama
(`20260708012237_schedule_refresh_mv_stats.sql`); el resto queda acá priorizado.
**No tocar `lib/cron/dispatch.ts` a las apuradas: corre en prod cada minuto y maneja
TODO el trabajo de fondo — un bug ahí frena difusiones, flows y jobs.**

- **[ALTA] Auditar drift de migraciones prod ↔ repo.** La migración
  `20260520203834_enable_pg_cron_and_schedule_refresh_stats` está **aplicada en prod
  pero su archivo no existe en el repo** (se perdió) — por eso `refresh-mv-stats` no se
  reproducía en `db:reset`. Si se perdió esa, pueden faltar otras → el repo no reproduce
  el schema de prod y los tests RLS (que corren contra local) no reflejan producción.
  Comparar `select version, name from supabase_migrations.schema_migrations` (prod, vía
  MCP) contra `ls supabase/migrations/` y reconciliar las que falten.
- **[MEDIA] Endpoints de cron legacy huérfanos + drift acotado.** El dispatcher
  (`lib/cron/dispatch.ts`) es la fuente de verdad; los endpoints `process-broadcasts`,
  `process-flows`, `process-jobs`, `evaluate-time-flows`, `sync-templates`,
  `refresh-meta-tokens` (y `refresh-stats`/`refresh-category-points`/`grant-tier-benefits`,
  cuyos pg_cron llaman la función SQL directa) **no los agenda nadie** (`vercel.json` solo
  tiene `auto-abandon-stale` + `expire-punch-cards`). No son "lógica duplicada peligrosa":
  la mayoría son thin wrappers de funciones de `lib/` compartidas (`processScheduledBroadcasts`,
  `messagingJobHandler`). El único **drift real** es que `tickDueFlows` y
  `syncAllConnectedTemplates` están **copiadas inline en `dispatch.ts`** (`dispatch.ts:62,98`)
  en vez de vivir en `lib/` y ser compartidas con los endpoints. Fix limpio: extraer esas 2 a
  `lib/flows/` y `lib/meta/` y que dispatcher + endpoints las reusen (preserva el disparo
  manual para debug, sin borrar). Opción alternativa: borrar los huérfanos. Requiere tests +
  cuidado por tocar el dispatcher.
- **[MEDIA] `recomputeBroadcastStats` + `maybeFinalizeBroadcast` corren por-recipient**
  (`lib/broadcasts/engine.ts:292-374`): ~7 count queries exactas × N destinatarios +
  contención de escritura sobre la fila `broadcasts`. A volumen (difusiones grandes) es
  O(N×7). Batchear el recompute (cada K recipients o al final) en vez de tras cada envío.
  Relevante ahora que WhatsApp real se va a usar.
- **[MEDIA] Throttle de difusiones fijo, no consciente del tier del WABA.**
  `DEFAULT_BROADCAST_RATE_PER_SEC=10` (`lib/broadcasts/throttle.ts`) es una tasa fija; no
  lee el tier de mensajería del WABA ni hace backoff ante `429`/`#131056`. A volumen real
  puede chocar con el rate limit de Meta. Hacerlo adaptativo (leer tier + backoff exponencial).
- **[MEDIA] Webhooks sin DLQ.** Ante caída sostenida de DB, `app/api/webhooks/whatsapp` (e
  `instagram`) devuelven 200 y **pierden el evento en silencio** (catch + log, correcto para
  no gatillar redelivery de Meta, pero sin cola de reintento). Agregar una dead-letter
  (tabla `webhook_dead_letters` + reprocesamiento) para no perder estados/mensajes.
- **[BAJA] Runtime de flows dual (lineal legacy + grafo).** `lib/flows/runtime.ts:97-108`
  mantiene `tickLinear` (legacy) además del runtime de grafo; el dispatch elige por
  `nodeList.length`. Sin ruta de migración legacy→grafo. Consolidar a solo-grafo y retirar
  el lineal cuando no queden flows lineales vivos.
- **[BAJA] `service_role` en Server Actions de mensajería.** `lib/broadcasts/actions.ts`,
  `lib/meta/actions.ts`, `lib/meta/contact.ts` usan `createServiceClient` (más amplio que la
  letra de CLAUDE.md §4.4 "solo webhooks/cron/admin"). **Mitigado**: todos con
  `requireTenantAccess` + `requireRole` + `.eq('tenant_id', …)`; sin fuga cross-tenant hallada.
  Es el patrón establecido del repo, no un bug — documentarlo como desviación consciente
  (comentario en cada uso + nota en CLAUDE.md §4.4) o migrar a RLS-scoped client donde se pueda.
- **[BAJA] Refresh de token Meta no corre si `token_expires_at` es null.**
  `lib/meta/token-refresh.ts:88-93` solo procesa canales con `token_expires_at` no-null dentro
  de 7 días. Un canal conectado sin setear expiración (como el de HUB hoy, token permanente)
  nunca entra al refresh — correcto si es permanente, pero si en realidad expira, expira en
  silencio. Confirmar semántica del token de Usuario del sistema; si puede expirar, setear
  `token_expires_at` al conectar.

## 2026-07-16 — hallazgos del rediseño UX (nav/roles/carta/reservas)

- **Flujo de invitaciones huérfano.** `invitations` (tabla + RPCs `accept_invitation`/
  `get_invitation_preview`) y la UI `/accept-invite/[token]` existen completos, pero nada
  crea invitaciones: el alta real de equipo es `createMemberWithPassword` (service role)
  en Configuración → Equipo. Decidir: revivir invitaciones por email o retirar el flujo.
- **RPC `reservation_day_lock_key` sin call sites.** Existe en la DB (y endurecida en
  security_hardening) pero ni el código TS ni otras funciones SQL la llaman. Candidata
  a retirar en una migración futura.
- **CHECK de `tenants.slug` desalineado con `RESERVED_SLUGS`.** El constraint de DB no
  incluye `m`, `print`, `salon`, `c`, `carta`, `r` que el proxy sí reserva — un tenant
  podría registrarse con slug `carta` y quedar inaccesible. Alinear en una migración.
- **`npm run db:types` apunta a `--local`** pero el proyecto trabaja contra el remoto
  (sin stack local). Regenerar via MCP o cambiar el script a `--project-id`.
- **Dos sistemas de progreso de setup conviven**: el wizard `/onboarding` (6 pasos,
  flag en `tenants.settings.onboarding`) y el checklist del dashboard (5 pasos mundo
  reservas). Unificar criterios o al menos compartir estado.
- **Resumen (home del manager) muestra KPIs de facturación a cualquier membership.**
  El proxy hoy rebota a editor/host antes de llegar, pero como defensa en
  profundidad la página debería gatear los KPIs (getKpis/revenue) a owner.
- **Media entrante por Realtime aparece como placeholder hasta el próximo refresh.**
  El payload de `postgres_changes` trae la fila cruda de `messages` sin la signed
  URL derivada (solo la genera `listMessages`). En el manager se mitiga solo
  (la lista hace `router.refresh()` ante cambios de `conversations`), pero en el
  salón no hay realtime de lista: evaluar un fetch puntual del mensaje al recibir
  INSERT con media.
- **RLS de `conversations`/`messages` es membership-only: `kitchen` podría leer
  chats vía API directa.** Las pages del salón ahora gatean con `requireRole`
  (owner/cashier/waiter) igual que las actions, pero como defensa en profundidad
  las policies deberían excluir roles sin permiso de mensajería.
- **Lista de chats del salón sin realtime ni paginación** (limit 30 fijo): traer
  el patrón de la lista del manager (suscripción a `conversations` + "ver más").
- **`[isMetaConfigured] decryptToken failed` en dev local.** El token del canal
  en la DB remota está cifrado con una `META_TOKEN_KEY` distinta a la del
  `.env` local: en dev el estado del canal puede leerse mal. Alinear la clave
  local con la de producción o tolerar el fallo con un estado "no verificable".

## Carta — RPCs de orden/movimiento siguen owner-only (post rediseño roles)

- ✅ **RESUELTO** (mig `20260723130000_menu_reorder_rpcs_editor`): `reorder_menu_items`,
  `reorder_menu_categories` y `move_category` pasaron de owner-only a `owner|editor`,
  alineados con las policies de tabla, `MENU_EDIT_ROLES` y el RPC `move_menu_items`.
  Síntoma original: la diseñadora (rol `editor`) recibía "No pudimos reordenar." /
  "No pudimos mover la categoría." al arrastrar. Verificado contra la DB: editor
  reordena OK.

## Tanda de 16 correcciones del dueño (jul 2026)

Hallazgos y deudas que quedaron fuera del alcance de esa tanda:

- **Review gating a Google sigue PRENDIDO por decisión del dueño.** Hoy sólo las
  reseñas de 5★ ven el botón para publicar en Google (`tenants.review_gating_enabled
  = true`, lógica en `lib/reviews/gating.ts`). Se le señaló que esto contradice las
  políticas de Google Business Profile sobre *review gating* y que puede penalizar
  la ficha del local; ratificó el flujo ("5★ → Google, el resto → WhatsApp de
  feedback"). Queda anotado como riesgo asumido, no como bug. Si en algún momento
  Google marca la ficha, el interruptor para mandar todas ya existe.
- **Google no permite prellenar el texto de una reseña por URL.** El pedido era
  "que te lleve a Google Maps con el comentario listo para publicarse". No hay API
  ni parámetro para eso: se implementó lo máximo posible (copiar el comentario al
  portapapeles + abrir la ficha), pero la reseña la tiene que pegar el cliente.
- **La sesión del socio sigue siendo el `qr_token` en cookie.** Al agregar login con
  contraseña se mantuvo la cookie `hub_wallet_<tenantId>` con el `qr_token` (180
  días) para no romper `/c/[token]`, `/print/c-qr` ni el escaneo del staff. El
  problema conceptual persiste: es la MISMA credencial que el mostrador escanea
  para acreditar y canjear, y no se puede revocar sin rotar el QR físico del
  cliente (`rotate_customer_qr_token`). Migrar a una tabla `customer_sessions`
  (token propio, expiración, revocación) cuando haya margen.
- **Plantilla de WhatsApp para el código de recuperación: no existe todavía.** El
  flujo de "olvidé mi contraseña" manda texto libre si el socio está dentro de la
  ventana de 24 h, y plantilla si está fuera. El tenant hub NO tiene ninguna
  plantilla apta cargada (`hello_world`, `test_difusiones` y las demo
  `jaspers_market_*`), así que fuera de ventana el envío falla hasta que el dueño
  cree y Meta apruebe una UTILITY con dos variables (nombre del bar + código).
  Pendiente confirmar además si el número conectado es productivo o el número de
  prueba de Meta (allowed-list) — si es el de prueba, no le llega a nadie real.
- **21 reservas históricas tienen `customer_id` null.** Son anteriores al
  auto-vínculo por teléfono (Matias Burgos, Melisa Puentes, Luciana Viola, etc.):
  esa gente existe como reserva pero no tiene ficha en el CRM y no va a aparecer
  en ninguna vista de Personas. El backfill de `acquisition_channel` no las cubre
  (no hay a quién marcarle el canal). Definir si se crean clientes a partir de
  `guest_phone` — ojo con los teléfonos mal normalizados: ya hay un duplicado
  real de "Franco Delucchi" (`+54 351 327 5110` con espacios vs `+5493513275110`).
- **Stock de recompensas: no se reserva al generar el QR de canje.** Se valida al
  pedir y se vuelve a validar al entregar. Con dos clientes peleando la última
  unidad, el segundo se entera en el mostrador. Es el trade-off elegido para no
  necesitar un proceso de devolución de reservas vencidas; a este volumen no pasa.
- **Canjes pendientes vencidos no se limpian.** `reward_redemptions.token_expires_at`
  vencido deja la fila en `pending` con un token muerto (inofensivo: `deliver`
  rechaza vencidos). Si molesta en el historial, sumar un barrido al cron.
- **`punch_card_stamps` no tiene tope de tamaño ni archivado.** Un sello por
  consumo; a volumen de bar tarda años en importar, pero es una tabla que sólo
  crece.
- **El login del club distingue "socio sin contraseña" de "no es socio".** Cuando
  alguien intenta entrar con el teléfono de un socio que todavía no creó
  contraseña, la respuesta es distinta a la genérica ("Todavía no tenés
  contraseña…"), así que la pantalla se puede usar para averiguar si un teléfono
  es socio de HUB. Se dejó a propósito: los ~11 socios previos al rediseño no
  tienen contraseña y sin ese cartel quedan encerrados afuera. Lo que sí se cerró
  es el envío automático de WhatsApp en ese caso (era un cañón de spam contra el
  teléfono de cualquier socio y contra la cuota del WABA): ahora el código lo pide
  el usuario con un tap y ese pedido sí pasa por el rate limit por teléfono.
  Cuando todos los socios tengan contraseña, unificar el mensaje.
- **`resolveEarnRate` quedó sin llamadores.** Al sacar la tasa de puntos de la
  billetera (item 3) el helper dejó de usarse, pero sigue exportado y testeado en
  `lib/points/earn-rate.ts`. Borrarlo o darle uso en el panel del dueño.
- **La billetera se actualiza por pulso, no por Realtime.** `/c/[token]` (y la
  billetera embebida en la carta) consultan `wallet_pulse` cada 3 s con el QR de
  canje en pantalla y cada 20 s el resto del tiempo, y sólo refrescan cuando el
  hash cambió. No es `postgres_changes` porque no puede serlo: la pantalla es
  anónima (la identidad es el `qr_token`, no una sesión de Supabase) y los claims
  de una suscripción se fijan al hacer JOIN — con claims `anon` la RLS filtra
  todos los eventos. Para que Realtime entregara habría que abrir policies de
  lectura sobre `customers` y `reward_redemptions` para `anon`. Si en algún
  momento el socio pasa a tener sesión propia (ver la nota de `customer_sessions`
  más arriba), ahí sí conviene migrar a Realtime y borrar el poller.

## Registros de ejecución de automatizaciones (ago 2026)

- **`flow_execution_events`: definir purga > 180 días.** La tabla es append-only
  y crece con cada paso de cada flow por cada cliente (un flow de 5 pasos sobre
  una difusión de 1.000 socios = 5.000 filas por corrida). No se agregó purga
  automática para no perder historial antes de que el dueño lo use; definir la
  retención (¿180 días?) y un job de `pg_cron` que borre lo viejo, o un archivado
  a resumen mensual.
- **El nodo `trigger` no deja registro.** En `executeGraphNode` el caso
  `'trigger'` es defensivo (normalmente nunca es el nodo actual) y se dejó sin
  loguear para no meter ruido: la entrada al flow ya queda como evento
  `enrolled`, que escribe el RPC `start_flow_for_customer`. Si algún día el
  trigger pasa a ser un paso real, agregarle su evento.
- **El registro no cubre las difusiones.** `broadcast_recipients` ya tiene su
  propio estado por destinatario; si el dueño pide la misma pantalla para
  difusiones, conviene unificar la vista y no duplicar la tabla de eventos.

## Punch cards por categoría (ago 2026)

- **`register_lunch_visit` no filtra por categoría, sólo la rechaza.** A diferencia
  del cobro de mesa (`_advance_punch_cards_for_visit`, que saltea en silencio las
  tarjetas de otra categoría), el almuerzo apunta a UN template explícito: si no
  corresponde, el trigger tira `punch_tier_locked` y la action lo traduce. Está
  bien así, pero la UI de almuerzo podría ocultar el botón de entrada en vez de
  dejar que el mozo lo toque y falle.
- **Sin auditoría del cambio de niveles de una tarjeta.** `syncTemplateTiers`
  borra e inserta sin escribir en `audit_log`. Volver exclusiva una tarjeta que
  la gente ya estaba llenando es una decisión con impacto y hoy no queda rastro
  de quién la tomó (CLAUDE.md §4 punto 8).

## Deuda transversal detectada de paso

- **[MEDIA] Fechas sin timezone explícita en 11 archivos.** Varias pantallas usan
  `format(new Date(...))` de date-fns pelado, que renderiza en la TZ del sistema:
  en Vercel (UTC) eso corre las fechas 3 horas contra `America/Argentina/Cordoba`.
  Convive con 7 archivos que sí usan `formatInTimeZone`. Los más visibles son la
  ficha del cliente (`clientes/[id]/_components/visits-tab.tsx` y el bloque
  Insights de `page.tsx`). Amerita un barrido propio, no parches sueltos:
  arreglar sólo algunos deja la app inconsistente consigo misma.

- **[BAJA] Cinco `optionalNumber` más con el orden de union frágil.** El bug del
  stock (vacío → 0 porque `z.coerce.number()` come `''` y `null`, y la union se
  queda con la primera rama que pasa) está arreglado en `lib/points/schemas.ts` y
  en `points_override` de `lib/menu/schemas.ts`. Quedan con el schema numérico
  adelante: `lib/punch-cards/schemas.ts:29`, `lib/tables/schemas.ts:6`,
  `lib/salon/schemas.ts:210` y `:266`, y `lib/admin/tenant-config.ts:19` y `:22`.
  Hoy no rompen, pero **por accidente**: todos validan `.min(1)`, así que el 0 que
  sale de la coerción no pasa y cae a la rama del vacío. El día que alguno acepte
  0 como valor legítimo, vuelve el mismo bug silencioso. Barrido mecánico: mover
  `z.literal('')`, `z.null()` y `z.undefined()` delante del schema numérico.

## Optimización de performance (auditoría 27/08/2026)

Contexto y cambios aplicados en `docs/optimizacion-2026-08.md`. Lo que quedó
afuera a propósito:

- **65 `multiple_permissive_policies` (advisor).** Patrón `X_member_read`
  (SELECT) + `X_owner_write` (`for all`, que también cubre SELECT) en
  broadcasts/flows/channels/templates/audiences/quick_messages/etc. Postgres
  evalúa las dos por fila. Hoy es irrelevante (tablas de decenas de filas); el
  fix es mecánico pero toca ~40 policies: reemplazar cada `for all` por tres
  policies `insert/update/delete`. Hacerlo en una migración propia con test de
  RLS que verifique que owner sigue escribiendo y member sigue leyendo.
- **`user_role_in_tenant(tenant_id)` en policies de escritura** se evalúa por
  fila (depende del `tenant_id` de la fila, no es initplan). Alternativa
  initplan-able: `tenant_id in (select tenant_id from memberships where
  user_id = (select auth.uid()) and role in (...))`. Mismo veredicto: sin
  impacto hoy, refactor cuando alguna tabla pase de ~10k filas.
- **Realtime `postgres_changes` → Broadcast.** `realtime.list_changes` es la
  query con más llamadas de toda la DB (280k) porque Realtime pollea el WAL
  mientras haya UN suscriptor, y evalúa RLS por cada cambio × suscriptor.
  Supabase recomienda `realtime.broadcast_changes()` desde triggers para
  escalar. Afecta inbox, difusiones en vivo, mesas/cocina y la billetera.
- **Compute de Supabase.** El proyecto corre en la instancia más chica (60
  conexiones = Nano o Micro, CPU compartida). Los picos de 60–157 s en
  `/auth/v1/user` y `/rest/v1/*` NO fueron queries lentas (la DB responde en
  <1 ms) sino el API gateway saturado. Para operar un bar en vivo, subir a
  **Small** (2 vCPU dedicadas, 2 GB) es la única palanca que queda del lado de
  infraestructura. Decisión del dueño.
- **`refresh_stats()` cada 10 min hace `REFRESH MATERIALIZED VIEW CONCURRENTLY`
  de 3 MVs** → 379 GB de temp files acumulados desde abril (work_mem de 2 MB).
  Con el volumen actual es tolerable; cuando crezca, pasar a refresh
  incremental por trigger o bajar la cadencia a 30 min.
- **`getUser()` sigue en ~40 Server Actions** (customers, menu, item-tags,
  tickets, tables, sessions-waiter…). Es UN hop por acción y da revocación
  inmediata; aceptable. Si alguna acción de alta frecuencia del salón se
  siente lenta, cambiarla a `getCurrentUser()` (claims).
- **Vercel Hobby.** Sin `regions` explícito las funciones corren en `iad1`
  (Washington), que coincide con la región del proyecto Supabase (us-east-1,
  inferido de los logs: p50 90 ms desde IAD vs 190 ms desde GRU). NO mover la
  región de Vercel sin mover Supabase. El dueño ve +100 ms por hop desde
  Córdoba en cualquier caso — es el costo del datacenter en EE.UU.
- **Revisión adversarial del fast-path — lows aceptados:** (a) el gate SQL de
  `hub-dispatch` y `gatedTasksDue()` en Node deciden por separado con sus
  propios relojes; si pg_cron arranca >55 s tarde en el minuto %15 el SQL
  dispara pero Node no ve la tarea gated (se recupera en el próximo slot; el
  único de un solo slot es el refresh de tokens Meta a las 04:20 UTC). Fix
  limpio: mandar la decisión en el body del POST. (b) Un superadmin sin
  membership recibe `null` de `get_tenant_access` (igual que antes); si se
  quiere que abra cualquier bar, `left join` desde tenants + rol `owner`
  virtual cuando `is_platform_admin()`. (c) `getCurrentUser()` ya no detecta
  revocación inmediata de sesión (ban / sign-out global) hasta `jwt_expiry`;
  documentado en `docs/optimizacion-2026-08.md` §6.

