# Carta única + Club + Wallet

Consolidación de cartas y QRs (jun 2026). Antes había sprawl: dos cartas
(`/carta/[slug]` y `/m/[qrToken]`), un generador de QRs de captura ilimitado, y
4 familias de QR. Ahora hay **una sola carta pública** y **dos QRs fijos**.

## La carta (`/carta/[tenantSlug]`)

Pública, sin login. Server Component (`force-dynamic`) → `CartaExperience` (client).

- **Hub drill-down:** el landing muestra tarjetas de las secciones madre
  (Comida, Bebidas, Vinos, Brunch & Café, Dulces, Sin TACC). Tap → entrás a sus
  subsecciones/ítems con breadcrumb. Búsqueda global sobre todo el árbol.
- **Anidamiento:** usa `menu_categories.parent_id` + `lib/menu/tree.ts`
  (`buildCategoryTree`). El dueño organiza la jerarquía en `/[slug]/menu`.
- **Logo:** `CartaBrand` muestra `tenants.logo_url`; si es null, cae a un
  wordmark serif del nombre con acento "!" (para HUB ⇒ "Hub!").
- **Botonera inferior:** `Carta` (volver al inicio) + `Mi billetera` /
  `Sumate al club` según identidad.

## Club de beneficios (formulario embebido)

`ClubSheet` reúne el alta (teléfono, nombre, apellido, opt-in) y envía vía la
Server Action `submitCapture` → RPC `submit_capture`. El QR del club abre
`/carta/[slug]?club=1` (la carta con el sheet abierto). Para clientes nuevos, si
`welcome_reward_configs.enabled`, el RPC otorga regalo de bienvenida + puntos
bonus (igual que el alta en mesa).

## Wallet sin login (cookie de identidad)

Al sumarse, `submit_capture` devuelve el `qr_token` y `submitCapture` lo guarda
en una cookie httpOnly **tenant-scoped** (`hub_wallet_<tenantId>`). La carta lee
esa cookie, valida que la wallet sea del mismo tenant y renderiza `WalletShell`
(reusado de `/c/[token]`) en un sheet: puntos, nivel + progreso, beneficios
pendientes, canjes, visitas, tarjetas, eventos y QR personal.

## Los 2 QRs (`/[slug]/local/captura`)

Página de solo lectura con dos tarjetas QR fijas (sin crear/pausar/borrar):

1. **Carta** → `/carta/[slug]` (pegar en mesas; imprimible vía `/print/carta`).
2. **Club** → `/carta/[slug]?club=1` (el mozo lo muestra al cerrar la cuenta).

Se mantiene **un** `customer_capture_links` canónico por tenant como contexto de
la RPC del formulario. La página de captura del dueño lo crea si falta
(`getOrCreateCanonicalCaptureLink`, con slug derivado válido — ver `lib/capture/slug.ts`);
la carta pública sólo lo **lee** (`getCanonicalCaptureLink`) para no escribir en un
GET anónimo. Si todavía no existe, el form del club muestra "no disponible" hasta
que el dueño abra su pantalla de QRs (donde obtiene los QRs igual).

## Qué NO se tocó

- `/m/[qrToken]` (auto-pedido en mesa) y `/print/qr*`: operativa apagada por
  flag `table_qr`, intacta.
- El QR personal del cliente (`/c/[token]`, `/print/c-qr`): sigue siendo el QR
  que escanea la caja para acreditar/canjear.

## Smoke manual

1. `/carta/hub` → 6 tarjetas madre; entrar a *Comida* → subsecciones + ítems con
   breadcrumb; buscar "milanesa" encuentra ítems de cualquier rama; header "Hub!".
2. Botonera → *Sumate al club* → completar y enviar → éxito → *Ver mi billetera*.
3. La wallet muestra puntos/nivel/visitas/canjes/QR. Recargar `/carta/hub`
   mantiene la identidad (cookie) y la barra muestra *Mi billetera*.
4. `/carta/hub?club=1` abre la carta con el formulario del club abierto.
5. `/[slug]/local/captura` muestra solo 2 QRs (carta + club), sin generador.
6. `/capture/<slug-viejo>` redirige a `/carta/hub?club=1`.
7. Sin regresiones: `/c/[token]` y `/print/c-qr` siguen funcionando; `/m/*` sigue
   apagado por flag.

## Migración

`supabase/migrations/20260624120000_carta_capture_welcome_and_token.sql`:
`submit_capture` ahora devuelve `jsonb` (`customer_id, tenant_id, qr_token,
was_new, welcome_*`) y otorga bienvenida a clientes nuevos. Sin cambios de tablas
(el anidamiento ya existía). Regenerar tipos con `npm run db:types`.
