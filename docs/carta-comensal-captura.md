# Carta del comensal (drill-in) + captura de datos — guía técnica

> Rediseña la carta pública que ve el comensal al escanear el QR de la mesa
> (`/m/[qrToken]`): de una pantalla única con chips a un flujo **category-first**
> con cards hero, búsqueda global y carrusel de recomendados. Suma una **captura
> de datos no bloqueante** (bottom sheet al entrar + card tras la 1ª orden), con
> copy 100% configurable por el dueño, e imágenes alusivas por categoría.

---

## TL;DR

| Capa | Qué hay | Dónde |
|---|---|---|
| DB | `menu_categories.image_url` + `get_session_state` extendido (image_url por categoría + `capture_prompt`) | `supabase/migrations/20260603120000_carta_category_image_and_capture_prompt.sql` |
| Tipos | `image_url` en `menu_categories`; `image_url` por categoría + `capture_prompt` en el state del comensal | `types/database.ts`, `lib/m-session/actions.ts` |
| Lógica pura | dismissal por sesión (localStorage), búsqueda global, schema del banner | `lib/m-session/{capture-dismissal,menu-search}.ts`, `lib/capture-prompt/schemas.ts` |
| Server (dueño) | `image_url` en categorías; config del banner (`tenants.settings`) | `lib/menu/{schemas,actions,queries}.ts`, `lib/capture-prompt/{queries,actions}.ts` |
| UI dueño | uploader de imagen en alta/edición de categoría; form del copy del banner | `app/(manager)/[tenantSlug]/menu/_components/*`, `.../configuracion/bienvenida/*` |
| UI comensal — carta | hub drill-in (búsqueda + carrusel + cards de categoría + detalle) | `app/m/[qrToken]/_components/{menu-hub,category-card,item-row,recommended-carousel}.tsx` |
| UI comensal — captura | bottom sheet inicial + card post-orden + form compartido + confirmación | `app/m/[qrToken]/_components/{capture-sheet,capture-prompt-card,register-form,capture-hero,order-confirmation}.tsx` |
| Orquestación | sheet auto-abierto, card post-orden, drill-in | `app/m/[qrToken]/_components/mesa-screen.tsx` |
| Tests | dismissal, búsqueda, schema del banner, schema de categoría | `tests/lib/{capture-dismissal,menu-search,capture-prompt-schema,menu-category-schema}.test.ts` |

Eliminados: `menu-list.tsx` (reemplazado por el hub) y `register-dialog.tsx`
(su form se extrajo a `register-form.tsx`, compartido por sheet + card).

---

## Modelo de datos

Sin tablas nuevas. Dos cambios, ambos sobre estructuras existentes:

```
menu_categories.image_url   ← text, nullable, check (null o char_length <= 2048)
tenants.settings.capture_prompt  ← jsonb { enabled: bool, headline: text, subtext: text }
```

- `menu_categories` **ya** tiene RLS + GRANTs (`authenticated`). Una columna
  nueva en una tabla existente **no** requiere GRANT extra (los GRANTs son
  a nivel tabla, no columna). RLS sigue siendo la única defensa de filas.
- `capture_prompt` vive embebido en `tenants.settings` jsonb (mismo patrón que
  `salon_capacities`): **sin tabla nueva, sin grants nuevos**.

### Estado de captura por sesión — localStorage (sin DB)

El comensal es `anon`; para no agregar columnas/RLS/RPC sólo para trackear
"declinó la captura", el estado vive en `localStorage`, keyed por `sessionId`:

```
hub:capture:sheet:<sessionId>       ← descartó/vio el bottom sheet inicial
hub:capture:postorder:<sessionId>   ← vio la card tras la 1ª orden
```

Helper puro y testeable en `lib/m-session/capture-dismissal.ts`
(`captureKey`, `isCaptureSeen`, `markCaptureSeen`, tipo `CaptureMoment =
'sheet' | 'postorder'`), con un `StorageLike` inyectable para los tests y
SSR-safe (no toca `window` si no hay store).

- Sesión nueva (otro `sessionId`) → claves nuevas → vuelve a invitar (sheet).
- Cliente ya registrado (`customer_id != null`) → nunca se muestra nada.

---

## RPC `get_session_state` (SECURITY DEFINER)

Único punto de lectura del comensal `anon`. La migración hace
`create or replace` agregando, sin tocar el aislamiento por tenant existente:

1. **`image_url` por categoría** dentro del `jsonb` de `menu` (junto a `id`,
   `name`, `position`, `items`).
2. **Objeto top-level `capture_prompt`** `{ enabled, headline, subtext }`, leído
   de `tenants.settings->'capture_prompt'` **con defaults** vía `coalesce`/`nullif`:
   - `enabled` → `true` si falta.
   - `headline` → `"Sumá puntos en cada visita"`.
   - `subtext` → `"Dejá tu nombre y teléfono y empezá a ganar beneficios."`

Todo se sigue resolviendo a partir de `v_table.tenant_id` (derivado del
`qr_token`), con `set search_path = ''` y nombres calificados con `public.`.

---

## Carta — drill-in (`menu-hub.tsx`)

La navegación es **estado de cliente**, no rutas nuevas: así se preservan
sesión, carrito y la suscripción Realtime de `mesa-screen.tsx`. Un único
componente (`MenuHub`) maneja tres vistas según su estado interno
(`selectedId`, `query`, `opening`):

1. **Hub** (sin categoría seleccionada, sin búsqueda):
   - **Buscador global** (input `type="search"`) que filtra toda la carta por
     nombre + descripción (`lib/m-session/menu-search.ts`, case-insensitive;
     query vacía → sin resultados, muestra el hub).
   - **Carrusel "Recomendados"** (`recommended-carousel.tsx`): hasta 6 ítems
     `featured`, scroll horizontal. Si no hay featured, la sección se omite
     (retorna `null`).
   - **Lista de cards hero** (`category-card.tsx`): sólo categorías con ≥1 ítem.
2. **Resultados de búsqueda**: lista plana de `ItemRow` (estado vacío con CTA
   "limpiar búsqueda").
3. **Detalle de categoría** (drill-in): header con nombre + botón "volver" y la
   lista de `ItemRow` de esa categoría.

El sheet de detalle de ítem (`item-detail-sheet.tsx`, "agregar a la orden") es
común a las tres vistas. La card de ítem y los helpers `ARSFormat` /
`pickContrastText` viven en **`item-row.tsx`** (antes en `menu-list.tsx`).

### Card de categoría — hero + fallback

- **Con `image_url`**: `next/image` full-bleed (`unoptimized`, porque son URLs
  de Supabase Storage subidas por el tenant), degradé inferior
  `oklch(0.15 0.03 165 / 0.82)` → transparente, título serif (Fraunces) +
  contador "N opciones".
- **Sin `image_url`**: bloque `bg-primary` (forest) con un glow
  `--forest-glow` difuminado. Se ve intencional, no "imagen rota".

---

## Captura de datos — 2 momentos

El **sheet es el único punto de registro** del comensal (reemplaza el gate
`welcome_reward.enabled` del viejo `register-dialog`). El copy lo manda
`capture_prompt`; el **otorgamiento** del welcome reward sigue ocurriendo dentro
de `register_customer_for_session` para clientes nuevos (sin cambios).

| Momento | Componente | Se muestra si | Al verlo/descartarlo |
|---|---|---|---|
| 1º escaneo | `capture-sheet.tsx` (bottom sheet) | sesión activa + `!customer_id` + `capture_prompt.enabled` + `!isCaptureSeen('sheet')` | `markCaptureSeen('sheet')` |
| 1ª orden | `capture-prompt-card.tsx` (card en confirmación) | `!customer_id` + `capture_prompt.enabled` + `!isCaptureSeen('postorder')` | `markCaptureSeen('postorder')` |

- Ambos comparten **`register-form.tsx`** (nombre, teléfono, opt-in), que llama
  `registerCustomer` (RPC existente). Props: `submitLabel`, `dismissLabel`
  (default "No por ahora"), `onDismiss`, `onRegistered`.
- **"No por ahora"** cierra y marca el momento como visto; la carta queda 100%
  usable. **2 momentos y listo**: si rechaza ambos, no se insiste más en esa
  sesión. Al registrarse (vuelve `customer_id`), no reaparece nada.
- La confirmación "¡Pedido enviado!" (`order-confirmation.tsx`) es un overlay
  que, cuando corresponde, embebe la `CapturePromptCard`.

`mesa-screen.tsx` orquesta: un efecto abre el sheet automáticamente una sola vez
(guard `autoSheetTriedRef`), y `showOrderConfirm` controla el overlay post-orden.

---

## Config del dueño

### Imágenes de categoría
- `createCategory` / `updateCategory` aceptan `image_url` (zod
  `categoryImageUrl`: URL ≤ 2048, o `''`/`null` → normalizado a `null`).
- En alta (`new-category-form.tsx`) y edición (`category-edit-dialog.tsx`) se
  reusa el `MenuImageUploader` (bucket `menu-images`, prefijo del tenant).
- `lib/menu/queries.ts` sirve `image_url` en `select(... image_url)`.

### Copy del banner (`/configuracion/bienvenida`)
- Módulo dedicado `lib/capture-prompt/`:
  - `schemas.ts` — `capturePromptConfigSchema` (`enabled` coerce-bool default
    true, `headline` 1–80, `subtext` 1–160) + `DEFAULT_CAPTURE_PROMPT`.
  - `queries.ts` — `getCapturePromptConfig(tenantId)` lee
    `tenants.settings.capture_prompt`.
  - `actions.ts` — `updateCapturePromptConfig` (owner-only; read-modify-write de
    `tenants.settings` preservando las demás keys).
- UI: `capture-prompt-form.tsx` (Switch + inputs), agregado a la página de
  bienvenida junto al welcome reward.

---

## Multi-tenant / seguridad (LEY)

- Todo scopeado por `tenant_id`. El comensal sigue siendo `anon` y sólo toca
  RPCs SECURITY DEFINER (`get_session_state`, `register_customer_for_session`,
  `submit_ticket`). `capture_prompt` se sirve dentro de la RPC, sin grant directo.
- `updateCapturePromptConfig` valida `requireTenantAccess` + `requireRole(['owner'])`.
- Upload de imágenes de categoría con prefijo de tenant (igual patrón que ítems).
- Sin PII en logs. Rate-limit de registro existente (10/min) cubre sheet y card
  (misma acción `registerCustomer`). No se cambió el modelo de opt-in.

---

## Testing

### Unit (Vitest) — verde local
```bash
npx vitest run tests/lib/capture-dismissal.test.ts
npx vitest run tests/lib/menu-search.test.ts
npx vitest run tests/lib/capture-prompt-schema.test.ts
npx vitest run tests/lib/menu-category-schema.test.ts
```
Cubren: independencia de dismissal entre sesiones + SSR-safety; búsqueda
(vacía/case/nombre+descripción); validación del banner (límites de longitud,
coerción de `enabled`); validación de `image_url` de categoría (≤2048, opcional,
normalización de vacío a `null`).

### RLS — pendiente (sin Docker local)
`get_session_state` sólo sumó una columna y un objeto derivados del
`tenant_id` ya resuelto; no hay tabla nueva. El test de aislamiento del menú
debe seguir verde:
```bash
npx vitest run tests/rls       # requiere Supabase local + envs (CLAUDE.md §16)
```
> ⚠️ No se pudo correr en esta máquina (Docker Desktop no accesible desde WSL).
> La migración se aplicó al proyecto remoto vía Supabase MCP. **Pendiente**
> correr `tests/rls` en un entorno con Supabase local antes de mergear.

### Smoke manual (happy path) — pendiente de ejecución
> No ejecutado localmente (sin entorno de app/DB local). Pasos a registrar en el PR:
1. **Dueño**: subir imagen a 1 categoría, dejar otra sin imagen; editar copy del
   banner en `/configuracion/bienvenida` (toggle + headline + subtext).
2. **Comensal** (browser limpio): escanear mesa activada → bottom sheet con el
   copy del dueño.
3. "No por ahora" → ordenar → "¡Pedido enviado!" con card de captura.
4. Registrarse desde la card → toast de puntos/welcome reward → recargar
   (misma sesión): no reaparece nada.
5. Navegar categorías (foto + fallback), buscar global, abrir ítem, agregar a
   la orden.
6. Dark mode de las cards hero y del fallback (contraste AA).

---

## Decisiones de diseño (del brainstorming)

- **Drill-in como estado de cliente** (no rutas): preserva sesión, carrito y
  Realtime.
- **Hero + fallback en paleta**: identidad visual por categoría sin obligar a
  cargar imágenes.
- **2 momentos de captura y listo**: invita sin acosar; "No por ahora" siempre
  deja ordenar.
- **Copy 100% configurable** en `tenants.settings` (sin tabla nueva).
- **Detalle de categoría inline en `MenuHub`** (no `category-view.tsx`
  separado): una sola fuente de estado para hub/búsqueda/detalle.
- **`lib/capture-prompt/` dedicado** (en vez de extender
  `lib/admin/tenant-config.ts`): el banner tiene su propio schema/query/action.

---

## Fuera de alcance

Categorías sólo `name` + `image_url` (sin descripción). No se tocó puntos,
reservas, floor plan ni KDS. Sin logging de `capture_prompt_declined` (YAGNI).

## Navegación de sheets (2026-06-08)

Los sheets de la carta (detalle de producto, carrito, captura) se cierran con:
- botón ⟵ con scrim (producto) o X (carrito/captura),
- tocar fuera del sheet,
- el botón/gesto **"atrás"** del teléfono (vía hook `useDismissOnBack` → `lib/m-session/back-guard.ts`), que cierra el sheet abierto en vez de salir de la carta.

La barrita superior (`SheetGrabber`) es una señal visual; el swipe-to-dismiss real no está implementado (requeriría `vaul`).
