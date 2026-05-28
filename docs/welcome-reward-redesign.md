# Rediseño QR del cliente + Admin de menú + Incentivo de registro

## Resumen

Rediseño extremo a extremo de la experiencia del comensal al escanear el QR
de mesa y del admin del menú del propietario. Sumamos un **regalo de bienvenida
configurable** que el cliente recibe al registrarse en 20 segundos.

**Tres ejes:**

1. **Carta del cliente** (`/m/[qrToken]`) — paleta forest+cream del design
   system Hub, búsqueda live, filtros por tags, sección destacados, modal de
   detalle de producto, hero del regalo de bienvenida.
2. **Admin del menú** (`/{slug}/menu`) — galería visual de items con tags,
   destacados (★), búsqueda, item-edit-dialog con tabs (Información /
   Etiquetas / Avanzado), gestor de tags.
3. **Configuración del incentivo** (`/{slug}/configuracion/bienvenida`) — nueva
   ruta con switch enabled, selector visual de recompensa, mensajes custom,
   preview en vivo del QR del cliente.

## Schema DB nuevo

Migraciones aplicadas:

- `20260527120000_welcome_reward_and_menu_extensions.sql`
  - `menu_items.featured boolean default false` + índice partial
  - Tabla `welcome_reward_configs` (PK = tenant_id, 1 fila por tenant)
  - Tabla `welcome_reward_grants` con `unique(customer_id)` (one-shot real)
  - Relaja `reward_redemptions.points_spent` de `> 0` a `>= 0` (el welcome
    reward es un regalo, no un canje por puntos)
- `20260527120100_register_customer_welcome_reward.sql`
  - RPC `register_customer_for_session` extendido: si el cliente es nuevo
    y hay config enabled + reward activo + stock disponible, crea
    `reward_redemption` pendiente + `welcome_reward_grants` y devuelve
    `welcome_redemption_id`, `welcome_reward_name`, `welcome_reward_image_url`
- `20260527120200_get_session_state_extended.sql`
  - RPC `get_session_state` extendido: devuelve `tenant_logo_url`, por ítem
    `featured`, `points_override`, `tags[]`, y a nivel root `welcome_reward`
    (si aplica) o `welcome_reward_redeemed` (si ya canjeó)

## Cómo aplicar y verificar

### 1. Aplicar migraciones (requiere Docker)

```bash
npx supabase start
npm run db:reset    # aplica las 3 migraciones nuevas
npm run db:types    # regenera types/database.ts con las tablas nuevas
```

Después de regenerar tipos, en `lib/welcome-reward/queries.ts`,
`lib/welcome-reward/actions.ts` y los tests RLS, podés quitar los
`biome-ignore: as any` y usar el tipo regenerado directamente.

### 2. Tests automatizados

```bash
npm run test:ci                # 238 unit tests, incluye welcome-reward.test.ts (15 casos)
npx vitest run tests/rls       # RLS contra Supabase local (necesita docker arriba)
```

### 3. Smoke manual (happy path)

1. Levantar dev: `npm run dev`. Login como owner del tenant HUB.
2. **Crear una recompensa** en `/<slug>/puntos` si no hay ninguna activa.
   Por ejemplo "Café gratis de bienvenida" con stock 50, cost_points = 1
   (el cost es irrelevante para welcome; siempre se entrega gratis).
3. **Configurar el incentivo**: ir a `/<slug>/configuracion/bienvenida`.
   - Switch "Activar regalo de bienvenida" en ON
   - Click sobre la card "Café gratis de bienvenida"
   - Headline: "Llevate un café gratis"
   - Subtext: "Solo registrate y mostrále esto al mozo"
   - "Guardar configuración" — toast verde
   - Preview a la derecha debe mostrar lo que verá el cliente
4. **Asignar tags y destacados al menú**: ir a `/<slug>/menu`.
   - Click "Gestionar etiquetas" → crear "Vegano" (verde), "Sin TACC" (azul),
     "Picante" (rojo)
   - Click sobre un ítem → tab "Etiquetas" → marcar "Vegano". Tab "Avanzado"
     → switch "Destacado" ON → "Guardar cambios"
   - Repetir para 2-3 ítems más
5. **Abrir QR del cliente**: en `/<slug>/menu` click "Vista cliente" (abre
   `/m/[qrToken]` en nueva pestaña).
   - **Hero del welcome reward** visible con imagen del reward, headline y CTA
   - Click "Lo quiero →" → abre el dialog de registro con imagen del reward
   - Completar form: nombre, apellido, teléfono. Submit.
   - **Toast**: "¡Listo! Mostrále esto al mozo: Café gratis de bienvenida"
   - Estado pasa a "Sumando puntos · {tenant}" con badge del reward redeemed
6. **Verificar persistencia**: en DB confirmá:

   ```sql
   select * from welcome_reward_grants where customer_id = '...';
   select * from reward_redemptions where customer_id = '...' order by created_at desc;
   ```

   - Debe haber 1 fila en `welcome_reward_grants`
   - Debe haber 1 fila en `reward_redemptions` con `status='pending'`,
     `points_spent=0`, notes="Regalo de bienvenida automático"
7. **Verificar one-shot**: borrá el localStorage del browser y volvé a
   escanear el QR (mismo phone). Resultado:
   - Hero del welcome reward no aparece (el customer ya está registrado)
   - `was_new_customer` = false, `welcome_redemption_id` = null
   - No se duplica nada en DB
8. **Búsqueda + filtros**: en la carta, tipear el nombre de un ítem. Probar
   los chips de filtro (Todo / ★ Destacados / cada tag). Probar abrir el
   detalle de un ítem con el sheet bottom.
9. **Cobro y closing**: simular el flow de pedido → request bill → marcar
   pagado desde el panel del cashier. La pantalla de cierre debe mostrar la
   sección "Tu regalo de bienvenida" prominente con imagen y CTA.

### 4. Screenshots a capturar para el PR

- Vista cliente: hero del welcome reward (cuando NO registrado)
- Vista cliente: carta con búsqueda, filtros y sección destacados
- Vista cliente: sheet de detalle de un ítem
- Vista cliente: estado registered con "Sumando puntos" + thumbnail del reward
- Vista cliente: closing screen con welcome reward redeemed
- Admin /menu: galería visual con tags y destacados
- Admin /menu: item-edit-dialog con tabs
- Admin /menu: tags-manager-dialog
- Admin /configuracion/bienvenida: form completo + preview live

## Archivos nuevos / modificados

### Migraciones (3 nuevas)
- `supabase/migrations/20260527120000_welcome_reward_and_menu_extensions.sql`
- `supabase/migrations/20260527120100_register_customer_welcome_reward.sql`
- `supabase/migrations/20260527120200_get_session_state_extended.sql`

### Backend (6 nuevos + 3 modificados)
- `lib/welcome-reward/{schemas,queries,actions}.ts` (NUEVOS)
- `lib/item-tags/schemas.ts` (modificado, agrega `setItemTagsSchema`)
- `lib/item-tags/queries.ts` (modificado, exporta `ItemTag` y `getTagsByItemIds`)
- `lib/item-tags/actions.ts` (modificado, agrega `setItemTags` con approach diff)
- `lib/menu/schemas.ts` (modificado, agrega `featured` y `tag_ids` opcionales)
- `lib/menu/actions.ts` (modificado, agrega `toggleFeatured` + sync de tags)
- `lib/menu/queries.ts` (modificado, devuelve `tags` y `featured` por ítem)
- `lib/m-session/actions.ts` (modificado, extiende `SessionStateData`)

### Frontend cliente (6 modificados + 1 nuevo)
- `app/m/[qrToken]/_components/mesa-screen.tsx` (reescrito, paleta forest+cream)
- `app/m/[qrToken]/_components/register-dialog.tsx` (reescrito, image-led hero)
- `app/m/[qrToken]/_components/menu-list.tsx` (reescrito, búsqueda + filtros +
  destacados)
- `app/m/[qrToken]/_components/item-detail-sheet.tsx` (NUEVO)
- `app/m/[qrToken]/_components/cart-sheet.tsx` (refresh visual)
- `app/m/[qrToken]/_components/my-orders-pane.tsx` (refresh visual)
- `app/m/[qrToken]/_components/closing-screen.tsx` (refresh visual + welcome
  reward redeemed)

### Admin menú (4 modificados + 2 nuevos)
- `app/(manager)/[tenantSlug]/menu/page.tsx` (reescrito)
- `app/(manager)/[tenantSlug]/menu/_components/menu-board.tsx` (reescrito,
  agrega prop `tags`, búsqueda, dropdown de acciones por categoría)
- `app/(manager)/[tenantSlug]/menu/_components/category-row.tsx` (reescrito
  con galería 1/2/3 cols)
- `app/(manager)/[tenantSlug]/menu/_components/item-edit-dialog.tsx`
  (reescrito como Sheet con tabs)
- `app/(manager)/[tenantSlug]/menu/_components/menu-search.tsx` (NUEVO)
- `app/(manager)/[tenantSlug]/menu/_components/tags-manager-dialog.tsx`
  (NUEVO)
- `app/(manager)/[tenantSlug]/menu/_components/new-item-form.tsx` (modificado,
  acepta `onCreated` callback)

### Admin bienvenida (2 nuevos + 1 modificado)
- `app/(manager)/[tenantSlug]/configuracion/bienvenida/page.tsx` (NUEVO)
- `app/(manager)/[tenantSlug]/configuracion/bienvenida/_components/welcome-reward-form.tsx`
  (NUEVO)
- `app/(manager)/[tenantSlug]/configuracion/_components/settings-nav.tsx`
  (modificado, agrega grupo "Fidelización" con "Regalo de bienvenida")

### Tests (2 nuevos)
- `tests/lib/welcome-reward.test.ts` (15 casos)
- `tests/rls/welcome-reward.test.ts` (8 escenarios)

## Decisiones de diseño relevantes

- **Recompensa fija vs puntos**: el incentivo se modela como una FK a
  `rewards` (no un input numérico de puntos). Razón: es más concreto y
  visual para el cliente ("Café gratis" es claro), y permite reusar la
  infraestructura existente de `reward_redemptions` y stock control.
- **One-shot por customer**: garantizado por `unique(customer_id)` en
  `welcome_reward_grants`. Aún si el cliente re-escanea con otro
  dispositivo o se borra el localStorage, el `register_customer_for_session`
  dedupe por `(tenant_id, phone)` y solo entrega el reward la PRIMERA vez
  que `was_new_customer = true`.
- **Silent-fail si el reward está sin stock o pausado**: el RPC chequea
  ambas condiciones antes de entregar. Si la config está enabled pero el
  reward no se puede otorgar, simplemente no se entrega — el registro del
  cliente NUNCA falla por esto. El admin recibe un aviso visual en
  `/configuracion/bienvenida` cuando el stock es bajo.
- **Branding tenant-aware**: el QR del cliente respeta el `tenant_logo_url`
  si está cargado. Sino, fallback a brand-mark "HUB" en círculo primary.
- **Modal vs sheet en admin**: cambié el item-edit de Dialog a Sheet
  (side="right") para tener espacio horizontal para los tabs sin
  empequeñecer el form. En mobile sigue siendo full-width.
- **Featured como overlay icon en item cards admin**: usar overlay ★ en
  esquina del thumbnail comunica "destacado" más fuerte que un badge de
  texto y mantiene la card limpia.
- **Welcome reward visible en closing screen**: la sección "Tu regalo de
  bienvenida" en la pantalla de gracias hace dos cosas: refuerza la
  experiencia del regalo y le da contexto al cliente para reclamarlo al
  mozo (especialmente útil si pagó tarjeta y se va rápido).

## Definition of Done

- [x] Migraciones generadas con RLS y GRANTs
- [x] RPC `register_customer_for_session` entrega welcome reward one-shot
- [x] RPC `get_session_state` devuelve datos extendidos
- [x] Zod schemas en cada borde
- [x] Auth + role checks en todas las actions
- [x] Audit log en mutaciones críticas (`welcome_reward.config_updated`,
      `menu_item.featured_toggled`, `item_tag.*`)
- [x] `npm run typecheck` limpio
- [x] `npm run lint` sin nuevos warnings/errors (los 13 warnings son
      preexistentes en `commissions/`, `tests/rls/loyalty.test.ts`,
      `tests/lib/commissions-engine.test.ts`)
- [x] `npm run test:ci` — 238 tests pasan (los 101 skipped son RLS tests
      que necesitan Supabase local arriba)
- [ ] **Pendiente**: aplicar migraciones (`npm run db:reset`) y regenerar
      tipos (`npm run db:types`) cuando se levante Docker
- [ ] **Pendiente**: smoke manual visual (no se ejecutó porque Docker no
      estaba activo al momento de la implementación)
- [ ] **Pendiente**: capturar screenshots para PR
