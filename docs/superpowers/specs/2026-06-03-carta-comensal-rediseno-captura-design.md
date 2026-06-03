# Spec — Rediseño de carta del comensal + captura de datos

> Fecha: 2026-06-03 · Estado: aprobado para plan
> Workspace afectado: `(salon)`/público `/m/[qrToken]` (comensal) + `(manager)/menu` y ajustes del tenant (dueño).
> Forma parte de un set de 3 specs independientes pedidos juntos: **(1) Floor plan de mesas**, **(2) este — Carta del comensal + captura**, **(3) KDS robusto**. Este spec NO toca floor plan ni KDS.

---

## 1. Problema y objetivo

Hoy, cuando un comensal escanea el QR de la mesa, la carta (`menu-list.tsx`) muestra chips de categoría scrollables + ítems debajo + búsqueda + sección de destacados, todo en una pantalla. No hay un "primer paso" claro y las categorías no tienen identidad visual.

Además, la captura de datos del cliente solo aparece como un diálogo condicionado a que el `welcome_reward` esté activo: muchos comensales ordenan sin que se les invite a dejar sus datos, y el bar pierde la oportunidad de fidelizar.

**Objetivos:**

1. **Carta category-first**: el primer paso del comensal es elegir una categoría. Categorías apiladas verticalmente, cada una con imagen alusiva (configurable por el dueño) y un fallback elegante en paleta HUB cuando no hay imagen.
2. **Captura con buen gancho**: en el primer escaneo, un banner prominente pero no bloqueante invita a dejar los datos, con un "No por ahora" que permite ordenar igual. Un segundo recordatorio aparece al confirmar la primera orden.

---

## 2. Estado actual (anclas de código)

### Carta / menú
- `menu_categories` (id, tenant_id, **name**, **position**, **active**, created_at) — **sin columna de imagen**.
- `menu_items` (… `image_url` nullable, `featured` bool, `position`, `price_cents`, `points_override`, tags vía `menu_item_tag_assignments`).
- Imágenes de ítem: Supabase Storage bucket **`menu-images`**, resize en cliente (AVIF→WebP→JPEG) en `lib/menu/upload-image.ts`; subida con prefijo `{tenant_id}/...`.
- Carta pública: `app/m/[qrToken]/_components/menu-list.tsx` (chips + ítems + búsqueda + destacados), embebida en `mesa-screen.tsx`. La data del menú llega vía RPC **`get_session_state`** (SECURITY DEFINER), que arma un JSON `categories[]{ id,name,position,items[]{…,featured,image_url,tags} }`.
- Owner: `app/(manager)/[tenantSlug]/menu/` (`menu-board.tsx`, `category-row.tsx`, `item-edit-dialog.tsx`, `new-category-form.tsx`, `image-uploader.tsx`, `tags-manager-dialog.tsx`). Acciones en `lib/menu/{actions,queries,schemas}.ts`.

### Captura / registro
- `customers` (dedup por `(tenant_id, phone)`, `opt_in_marketing/at/ip`, soft delete).
- Sesión: `table_sessions` (open|paid|merged|abandoned), `session_guests` (browser_token, `customer_id` nullable — se completa al registrarse).
- `browser_token` persistido en `localStorage` (`lib/m-session/browser-token.ts`).
- `register-dialog.tsx` muestra hero del welcome reward + form (phone/name/birthdate/opt-in) + "Ahora no"; se renderiza **solo si** `!state.customer_id && welcome_reward.enabled`. Llama `registerCustomer` → RPC `register_customer_for_session` (otorga welcome reward one-shot si es cliente nuevo; `opt_in` nunca revierte true→false).
- `welcome_reward_configs` (tenant_id PK, enabled, reward_id, headline, subtext).
- Rate-limit en memoria (`lib/rate-limit.ts`): m-join 30/min, m-register 10/min, m-submit 60/min.
- Config del tenant (kitchen_flow, auto-accept, etc.) se lee/escribe en `tenants` vía `lib/admin/tenant-config.ts`. `tenants.settings` jsonb ya guarda config como `salon_capacities`.

---

## 3. Decisiones validadas (brainstorming visual)

| Tema | Decisión |
|---|---|
| Navegación de la carta | **Drill-in**: hub de categorías → pantalla dedicada de la categoría con sus ítems + "volver". |
| Card de categoría | **Hero inmersivo**: foto full-bleed + título serif sobre degradé + contador de ítems. Fallback sin foto: bloque forest sólido + título + detalle dorado. |
| Búsqueda | **Global, en el hub**: ícono/barra que busca en toda la carta y muestra resultados planos. |
| Destacados (`featured`) | **Carrusel "Recomendados"** horizontal arriba del hub (hasta 6). |
| Banner inicial | **Bottom sheet** sobre la carta en el primer escaneo. |
| Re-prompt | **Card embebida en la pantalla de confirmación** tras la 1ª orden. |
| Insistencia | **2 momentos y listo**: sheet al entrar + card en la 1ª orden. Si rechaza ambos, no se insiste más en esa sesión. Sesión nueva → vuelve a aparecer el sheet. |
| Gancho/copy | **100% configurable por el dueño**: `enabled` + `headline` + `subtext`. |

---

## 4. Diseño — Carta (drill-in)

### 4.1 Hub de categorías (pestaña "Carta")
Pantalla inicial, de arriba a abajo:
1. **Buscador global**: ícono de lupa que despliega una barra. Al escribir, reemplaza el contenido del hub por resultados planos (ítems de toda la carta, reusando la card de ítem). Limpiar la búsqueda vuelve al hub. (Reusa la lógica de filtrado por nombre+descripción que ya existe en `menu-list.tsx`.)
2. **Carrusel "Recomendados"**: tira horizontal scrollable con los ítems `featured` (máx 6). Si no hay featured, se omite la sección. Tap en un ítem → sheet de detalle existente.
3. **Lista de cards hero** de categoría (solo categorías `active` con ≥1 ítem activo), ordenadas por `position`. Cada card:
   - Con `image_url`: foto full-bleed, degradé inferior, título serif (Fraunces) + contador "N opciones".
   - Sin `image_url`: bloque `--card`/forest sólido, borde tinted, título serif centrado + detalle dorado (acento). Debe verse intencional, no "imagen rota".
   - Tap → vista de detalle de esa categoría.

### 4.2 Detalle de categoría
- Header con el nombre de la categoría + botón "volver" al hub (back).
- Lista de ítems de la categoría (reusa las cards de ítem actuales: thumb, nombre, precio, badges de tags, sheet de detalle, "Agregar a la orden").
- Mantiene el carrito/estado de la sesión (no se pierde al navegar).

### 4.3 Implementación
- Reemplazar `menu-list.tsx` por dos vistas controladas por **estado de cliente** dentro de `mesa-screen.tsx` (`selectedCategoryId: string | null`) — **sin rutas nuevas**, para preservar sesión, carrito y suscripción realtime.
- El contador de ítems por categoría se calcula client-side desde el array de ítems del state.

---

## 5. Diseño — Captura de datos

### 5.1 Sheet inicial (primer escaneo)
- Disparo: la carta tiene sesión activa, `state.customer_id == null`, `capture_prompt.enabled == true`, y el helper de dismissal (localStorage) no marcó este `sessionId` como descartado.
- Bottom sheet (shadcn `Sheet` side="bottom") con: gancho (`headline` + `subtext` del tenant), **form compartido** de registro (nombre, teléfono, opt-in marketing), CTA primaria ("Quiero sumar" / copy del dueño) y link secundario **"No por ahora"**.
- "No por ahora" → cierra y marca `capture_dismissed:<sessionId>` en localStorage; la carta queda 100% usable.
- Registrar → reusa `registerCustomer` (RPC existente). Al volver con `customer_id`, no se vuelve a mostrar nada.

### 5.2 Card post-orden (1ª orden)
- Tras `submitTicket` exitoso, la pantalla/estado de "¡Pedido enviado!" muestra una **card embebida** (no sheet) con el mismo gancho + form compartido, **solo si**: `!customer_id`, `capture_prompt.enabled`, y no se marcó aún `capture_postorder_shown:<sessionId>`.
- Mostrarla setea `capture_postorder_shown:<sessionId>`. "No por ahora" la descarta. No reaparece en órdenes siguientes de la misma sesión.

### 5.3 Lifecycle (resumen)
- Estado por sesión en **localStorage**, claves keyed por `sessionId`:
  - `hub:capture_dismissed:<sessionId>`
  - `hub:capture_postorder_shown:<sessionId>`
- Sesión nueva (nuevo `sessionId`) → claves nuevas → vuelve a invitar (sheet).
- Cliente ya registrado (`customer_id`) → nunca se muestra.
- No se agregan columnas a `session_guests` (los comensales son `anon`; evitamos RLS/RPC extra para tracking de decline).

### 5.4 Reconciliación con welcome reward
- El sheet pasa a ser el **único** punto de registro del comensal (reemplaza el gate `welcome_reward.enabled` del `register-dialog`).
- El copy lo manda `capture_prompt` (no el welcome reward). El **otorgamiento** del welcome reward sigue ocurriendo en `register_customer_for_session` para clientes nuevos (sin cambios en esa lógica).
- `register-dialog.tsx` se refactoriza: su form se extrae a `register-form.tsx` (compartido por sheet + card); el wrapper de diálogo queda deprecado/eliminado.

---

## 6. Config del dueño

### 6.1 Imágenes de categoría
- En crear/editar categoría (`new-category-form.tsx` / un dialog de edición de categoría), sumar upload de imagen reusando `image-uploader.tsx` + `lib/menu/upload-image.ts`.
- Storage: bucket existente `menu-images`, con prefijo de categorías (p. ej. `{tenant_id}/categories/...`).
- Acciones `createCategory`/`updateCategory` aceptan `image_url`; al limpiar/reemplazar, borrar la imagen previa (`deleteMenuImageByUrl`).

### 6.2 Copy del banner
- En ajustes del tenant (sección Mensajería/Captura, patrón `lib/admin/tenant-config.ts`): toggle `enabled`, input `headline`, textarea `subtext`.
- Persistencia: `tenants.settings` jsonb bajo `capture_prompt: { enabled: bool, headline: string, subtext: string }`. Default: `enabled=true`, copy genérico de fidelización.

---

## 7. Datos & backend

### 7.1 Migración (`supabase/migrations/`)
```sql
alter table public.menu_categories
  add column image_url text check (image_url is null or char_length(image_url) <= 2048);
```
- `menu_categories` ya tiene RLS + GRANTs → no se tocan permisos.
- `capture_prompt` vive en `tenants.settings` jsonb → **sin tabla nueva, sin grants nuevos**.

### 7.2 RPC `get_session_state`
- Agregar `image_url` a cada objeto `category` del JSON.
- Agregar objeto top-level `capture_prompt: { enabled, headline, subtext }` leído de `tenants.settings` (con defaults si falta la key). Sirve al comensal `anon` sin grants directos (SECURITY DEFINER).

### 7.3 Tipos
- `npm run db:types` tras la migración. Tipar `capture_prompt` y el `image_url` de categoría en los tipos del state del comensal (`lib/m-session`).

---

## 8. Componentes / archivos

**Nuevos**
- `app/m/[qrToken]/_components/menu-hub.tsx` — hub (búsqueda + carrusel + lista de categorías).
- `app/m/[qrToken]/_components/category-view.tsx` — detalle de una categoría.
- `app/m/[qrToken]/_components/category-card.tsx` — card hero (con/sin imagen).
- `app/m/[qrToken]/_components/recommended-carousel.tsx` — carrusel de destacados.
- `app/m/[qrToken]/_components/capture-sheet.tsx` — bottom sheet inicial.
- `app/m/[qrToken]/_components/capture-prompt-card.tsx` — card post-orden.
- `app/m/[qrToken]/_components/register-form.tsx` — form compartido (extraído de `register-dialog`).
- `lib/m-session/capture-dismissal.ts` — helper de localStorage (get/set por sessionId). **Lógica pura testeable.**

**Modificados**
- `app/m/[qrToken]/_components/mesa-screen.tsx` — orquesta hub/detalle + sheet + card post-orden.
- `menu-list.tsx` → reemplazado por hub/detalle. Su render de lista plana de ítems se extrae a un componente reutilizable consumido tanto por los resultados de la búsqueda global como por la vista de detalle de categoría.
- `register-dialog.tsx` → refactor a `register-form.tsx`; wrapper viejo eliminado.
- `app/(manager)/[tenantSlug]/menu/_components/{new-item-form, category-row, …}` — alta/edición de categoría con imagen.
- `lib/menu/{schemas,actions,queries}.ts` — `image_url` en categorías; servir `image_url` en queries.
- `lib/admin/tenant-config.ts` + su UI de ajustes — `capture_prompt`.
- RPC SQL `get_session_state` (migración).

---

## 9. Multi-tenant / seguridad (LEY)
- Todo scopeado por `tenant_id` vía RLS existente. El comensal sigue siendo `anon` y solo toca RPCs SECURITY DEFINER (`get_session_state`, `register_customer_for_session`, `submit_ticket`).
- Upload de imágenes de categoría con prefijo de tenant (igual patrón que ítems).
- Sin PII en logs. Rate-limit de registro existente (10/min) cubre el sheet y la card (misma acción).
- Auditoría: el registro ya audita vía RPC; no se agrega PII nueva.

---

## 10. Testing (DoD)
- **Unit (Vitest)**:
  - `lib/m-session/capture-dismissal.ts` (set/get por sessionId, independencia entre sesiones).
  - Zod del `capture_prompt` (validación de `headline`/`subtext`/`enabled`).
  - Zod de `image_url` de categoría (≤2048, opcional).
  - Si se extrae el filtrado de búsqueda a una función pura, testearla.
- **RLS**: cubierto por tests de menú existentes (solo columna nueva; no hay tabla nueva). Verificar que `get_session_state` sigue aislando por tenant.
- **Smoke manual (en PR)**: escanear QR con sesión activa → ver sheet → "No por ahora" → navegar categorías (con y sin imagen) → buscar global → ordenar → ver card post-orden → registrarse → confirmar que no reaparece → recargar (misma sesión) sin sheet → como dueño, subir imagen de categoría y editar copy del banner.

---

## 11. Por defecto / fuera de alcance
- Categorías: solo `name` + `image_url` (sin descripción/subtítulo — YAGNI).
- **Opcional, fuera salvo pedido**: loguear evento `capture_prompt_declined` en `table_session_events` para analítica de conversión.
- No se toca el sistema de puntos, reservas, floor plan ni KDS.
- No se cambia el modelo de opt-in ni el rate-limit (se reusan).
