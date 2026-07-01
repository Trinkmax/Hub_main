# Sistema de Puntos — "Puntos de Categoría"

> Rediseño julio 2026. Este documento describe cómo funciona el sistema de puntos,
> niveles y beneficios de HUB tal como está implementado. Si un prompt de fase
> contradice esto, revisá primero las migraciones y `lib/points/*` — son la fuente
> de verdad.

---

## 1. Las dos monedas

El sistema maneja **dos contadores separados** por cliente. No se mezclan: uno
sirve para gastar, el otro para definir el nivel.

| Moneda | Columna | Qué hace | ¿Baja? |
| --- | --- | --- | --- |
| **Puntos Canjeables** | `customers.points_balance` | Es la billetera. Sube al ganar puntos, baja al canjear una recompensa. | Sí, al canjear. |
| **Puntos de Categoría** | `customers.category_points` | Define el **nivel** del cliente. Es la **suma móvil de los últimos N meses** de puntos *ganados* (solo deltas positivos). | Sí, cuando puntos viejos vencen (salen de la ventana). |

Además se conserva `customers.lifetime_points_earned` (acumulador histórico que
**nunca baja**), pero **ya no** determina el nivel: solo se usa para segmentación
de audiencias y estadísticas.

**La ventana es configurable por bar:** `tenants.category_window_months`
(`int`, default **4**, rango 1–24). Cambiar la ventana cambia cuántos meses de
historial pesan para el nivel.

Paridad TypeScript (para la UI y los tests):

- `lib/points/category.ts` → `computeCategoryPoints`, `computeExpiry`, `wouldDropTier`.
- `lib/points/tiers.ts` → `resolveTier`, `progressToNext`, `canRedeemReward`,
  type `LoyaltyTier` (`min_category_points`).

---

## 2. Cómo se calcula el nivel

El nivel del cliente = el `loyalty_tier` **activo de mayor umbral** cuyo
`min_category_points <= category_points`. Como `category_points` es una ventana
móvil, **el nivel puede bajar** cuando los puntos viejos vencen.

Hay **dos disparadores** que mantienen `category_points` y `current_tier_id` al día:

### a) Al ganar/canjear puntos — inmediato (trigger)

Toda fila en `points_transactions` dispara el trigger **`points_tx_apply()`**
(`SECURITY DEFINER`), que:

1. Actualiza `points_balance` (`+delta`) y `lifetime_points_earned`
   (solo el componente positivo).
2. Llama a **`recompute_customer_loyalty(customer_id)`**, que:
   - recalcula `category_points` = `sum(greatest(delta,0))` de las
     `points_transactions` con `created_at >= now() - N meses`;
   - resuelve el nivel (`min_category_points <= category_points`,
     `order by min_category_points desc, sort desc`) y actualiza
     `current_tier_id`.

Esto hace que **subir de nivel sea inmediato** al acreditar puntos.

### b) Vencimiento — diario (cron)

El paso del tiempo no genera ningún evento por sí solo: un cliente que dejó de
sumar puntos tiene que **bajar** cuando sus puntos viejos salen de la ventana.
Eso lo fuerza el cron diario **`refresh_all_category_points()`**, que recalcula
en masa `category_points` + `current_tier_id` de todos los clientes no borrados.
Corre **antes** de emitir beneficios (ver §7), así los niveles quedan frescos.

```
                        ┌─────────────────────────────────────────────┐
 acreditar puntos ─────▶│ INSERT points_transactions (delta > 0)      │
 canjear reward  ─────▶ │ INSERT points_transactions (delta < 0)      │
                        └──────────────────┬──────────────────────────┘
                                           │ trigger
                                           ▼
                        points_tx_apply()  ──▶  points_balance, lifetime
                                           │
                                           ▼
                        recompute_customer_loyalty(customer)
                                           │
                            category_points = Σ(deltas > 0, últimos N meses)
                                           │
                                           ▼
                            current_tier_id = tier de mayor umbral ≤ category_points
                                           ▲
                                           │ (recalcula en masa, hace vencer lo viejo)
 cron 08:30 UTC ─────▶ refresh_all_category_points()  ── el nivel PUEDE BAJAR
```

---

## 3. Los 5 niveles de HUB

Los niveles viven en `loyalty_tiers` (uno por tenant, configurables por el dueño
desde `/[slug]/club/niveles`). El umbral es `min_category_points`. Ejemplo de la
configuración de HUB (5 niveles; los umbrales y beneficios son editables):

| Nivel | `min_category_points` | Beneficios (ejemplo) |
| --- | --- | --- |
| **Bienvenido** | 0 | Nivel de entrada, sin beneficios. |
| **Habitué** | 500 | `discount`: 10% off en cafetería. |
| **Amigo del Hub** | 1.500 | `recurring_reward`: 1 café gratis por mes · `partner`: 15% en librería aliada. |
| **Embajador** | 3.500 | `recurring_reward`: postre gratis mensual · `perk`: remera del Hub. |
| **Leyenda** | 7.000 | `recurring_reward`: cumpleaños con torta · `discount`: 20% off eventos · `partner`: beneficios de todas las marcas aliadas. |

> Los nombres, colores (`color`), íconos (`badge_icon`), umbrales
> (`min_category_points`), texto de perks (`perks`) y el orden (`sort`) se
> configuran por bar. Un cliente que baja su `category_points` por debajo de un
> umbral **pierde** ese nivel y sus beneficios exclusivos (incluye el gating de
> recompensas, ver §6).

---

## 4. Beneficios por nivel (`tier_benefits`)

Cada nivel puede tener una **lista** de beneficios (tabla `tier_benefits`),
en lugar de un único beneficio. Hay **4 tipos** (`kind`):

| `kind` | Qué es | Cómo se entrega |
| --- | --- | --- |
| `recurring_reward` | Ítem gratis recurrente (café mensual, torta de cumpleaños…). Requiere `reward_id`, `cadence` (`monthly`/`birthday`) y `quantity` (1–20). | **Automático**: el cron `grant_tier_benefits` emite `quantity` canjes **pendientes** (`points_spent = 0`) una vez por período. |
| `discount` | % de descuento en un contexto. Requiere `discount_pct` (0–100), opcional `discount_scope`. | **Display-only**: se muestra al cliente/staff; **lo aplica el staff** manualmente al cobrar. |
| `perk` | Beneficio físico u "otro" (ej. una remera). | **Display-only**: lo entrega el staff. |
| `partner` | Descuento de una **marca aliada** externa. Requiere `partner_id`. | **Display-only**: se muestra la marca y su descuento. |

Modelo (paridad TS en `lib/points/benefits.ts`): `TierBenefit`, enums
`TierBenefitKind` / `TierBenefitCadence`, consts `BENEFIT_KINDS`,
`BENEFIT_KIND_META`, `CADENCE_LABEL`, helpers `groupBenefitsByKind`,
`sortedActiveBenefits`. El check `tier_benefits_kind_shape` garantiza en DB que
cada `kind` tenga sus campos obligatorios.

### Entrega del `recurring_reward` (cron)

`grant_tier_benefits()` recorre los `tier_benefits` activos de `kind =
'recurring_reward'` cuyo nivel esté activo, y para cada cliente **actualmente en
ese nivel** (`current_tier_id = tier_id`):

- **`monthly`** → `period_key = 'YYYY-MM'`.
- **`birthday`** → solo si el mes de `birthdate` coincide con el mes actual;
  `period_key = 'bday-YYYY'`.
- Inserta un `tier_benefit_grants` (idempotente por
  `unique(customer_id, tier_benefit_id, period_key)` + `on conflict do nothing`)
  y, si es nuevo, emite `quantity` filas en `reward_redemptions` con
  `points_spent = 0`, `status = 'pending'` y `notes = label` del beneficio.

Los descuentos/perks/partner **no** generan canjes: son informativos y los aplica
el staff en el momento.

---

## 5. Partners (marcas aliadas)

`partners` es el catálogo de marcas aliadas **por tenant** (`name`, `logo_url`,
`discount_label`, `category`, `url`, `sort`). Se crean como **borrador**:
`active` arranca en **`false`** hasta cerrar el acuerdo; recién ahí el dueño lo
activa y aparece en los beneficios `kind = 'partner'` que lo referencian.

Paridad TS: type `Partner` en `lib/points/benefits.ts`.

---

## 6. Catálogo de canje (`rewards`)

`rewards` ganó dos columnas nuevas:

- **`category` (text, ≤40)** → agrupa el catálogo (Desayuno / Almuerzo / Cena /
  Eventos…). Const `REWARD_CATEGORIES = ['desayuno','almuerzo','cena','evento']`
  en `lib/points/schemas.ts`; la UI ofrece esas 4 y agrupa al final las categorías
  desconocidas (texto libre para multi-tenant).
- **`visible_in_catalog` (boolean, default `true`)** → separa las recompensas del
  **catálogo público de canje** de las recompensas "de beneficio" (el café del
  club, el welcome, etc.), que solo se usan como *target* de un `tier_benefit` o
  del bonus de bienvenida y **no** se listan en el catálogo.

El canje pasa por el RPC **`redeem_reward(customer, reward)`**:

- valida que quien canjea sea `owner`/`cashier`;
- si la reward tiene `min_tier_id`, el **gating usa `category_points`** contra
  `min_category_points` del nivel exigido → si el cliente bajó de nivel, **ya no
  accede** a la recompensa exclusiva (coherente con "nivel actual");
- descuenta contra `points_balance` (no contra `category_points`) e inserta una
  `points_transaction` negativa.

Paridad TS: `listRewards` / `listActiveRewards` y el `Reward` type
(`category`, `visible_in_catalog`) en `lib/points/queries.ts`.

---

## 7. Crons (pg_cron)

Migración `20260701000300_loyalty_cron_schedule.sql`. pg_cron corre como
`postgres`, así que puede ejecutar las funciones `SECURITY DEFINER` internas
directo por SQL (mismo patrón que `refresh-mv-stats`). Horarios en **UTC**
(Córdoba = UTC-3):

| Job | Horario | Llama | Qué hace |
| --- | --- | --- | --- |
| `refresh-category-points` | `30 8 * * *` (**08:30 UTC ≈ 05:30 AR**) | `refresh_all_category_points()` | Recalcula `category_points` + nivel de todos los clientes → **hace vencer los puntos viejos**. |
| `grant-tier-benefits` | `0 9 * * *` (**09:00 UTC ≈ 06:00 AR**) | `grant_tier_benefits()` | Emite los ítems gratis recurrentes del período. Corre **después** del refresh para operar con niveles ya actualizados. |

> El orden importa: primero se recalculan los niveles (algunos clientes bajan),
> recién después se emiten los beneficios, para no regalar el café del mes a
> alguien que ya no está en el nivel. Existe además un route handler
> `app/api/cron/grant-tier-benefits/route.ts` (invocación por Vercel Cron con
> `service_role` + `CRON_SECRET`); la programación canónica del rediseño es la de
> pg_cron.

---

## 8. Tablas y RLS

Todas las tablas del sistema siguen la LEY multi-tenant (`tenant_id` +
RLS + GRANT a `authenticated`). El patrón de escritura es **owner-write /
tenant-read**: cualquier miembro del tenant puede **leer**, solo el `owner`
puede **escribir**.

| Tabla | Escritura | Notas |
| --- | --- | --- |
| `loyalty_tiers` | owner (insert/update/delete) | Umbral renombrado a `min_category_points`. Columnas `benefit_cadence` / `benefit_reward_id` **eliminadas** (migradas a `tier_benefits`). |
| `tier_benefits` | owner (insert/update/delete) | 4 `kind`; check `tier_benefits_kind_shape` por tipo. FKs a `rewards`/`partners` con `on delete set null`. |
| `partners` | owner (insert/update/delete) | `active` default `false` (borrador). |
| `tier_benefit_grants` | **solo RPC** (`SECURITY DEFINER`, cron) — sin policy de write | Idempotencia por `unique(customer_id, tier_benefit_id, period_key)`. Solo `select` a `authenticated`. |

Además:

- `customers.category_points` (cache, index `customers_category_points_idx`).
- `tenants.category_window_months` (ventana configurable).
- `rewards.category` + `rewards.visible_in_catalog` (index parcial
  `rewards_catalog_idx where visible_in_catalog = true`).

### Funciones SQL clave

| Función | Rol | Acceso |
| --- | --- | --- |
| `points_tx_apply()` | trigger de `points_transactions`: balance + lifetime + recompute. | interno (revoke a public/anon/authenticated). |
| `recompute_customer_loyalty(uuid)` | recalcula `category_points` + nivel de un cliente. | interno (lo llama el trigger). |
| `refresh_all_category_points()` | recompute masivo (cron). Hace vencer lo viejo. | interno (solo cron). |
| `grant_tier_benefits()` | emite canjes de beneficios recurrentes (cron). | interno (solo cron). |
| `redeem_reward(uuid, uuid)` | canje con gating por nivel (`category_points`). | `authenticated` (owner/cashier). |
| `get_loyalty_state(text, text)` | estado del wallet: balance, category_points, nivel actual/próximo, próximo vencimiento. | `anon` + `authenticated`. |

Endurecimiento en `20260701000400_lock_loyalty_functions.sql`: los helpers
internos revocan `EXECUTE` de `public`, `anon` **y** `authenticated` (el proyecto
tiene `ALTER DEFAULT PRIVILEGES` que otorga a anon/authenticated, así que hay que
revocar de los tres para cerrarlos de verdad).

---

## 9. Archivos de referencia

- Migraciones: `supabase/migrations/`
  - `20260701000000_loyalty_category_window.sql` (dos monedas, recompute, cron fn refresh).
  - `20260701000100_tier_benefits_partners.sql` (`tier_benefits`, `partners`, nuevo `grant_tier_benefits`).
  - `20260701000200_rewards_catalog.sql` (`category` + `visible_in_catalog`).
  - `20260701000300_loyalty_cron_schedule.sql` (pg_cron).
  - `20260701000400_lock_loyalty_functions.sql` (endurecimiento).
  - Base: `20260613000000_loyalty_tiers_schema.sql`, `20260613000200_tier_benefit_grants.sql`.
- Lib (`lib/points/`): `tiers.ts`, `benefits.ts`, `category.ts`, `queries.ts`,
  `schemas.ts`, `actions.ts`.
- UI del manager: `app/(manager)/[tenantSlug]/club/niveles/`,
  `.../club/puntos/`, `.../club/aliados/`, `.../club/_components/`.
- Wallet del cliente: `app/c/[token]/_components/{tier-hero,tier-benefits,rewards-grid,
  benefit-icon,wallet-shell}.tsx`; datos en `lib/wallet/queries.ts` (`getWalletByToken`).
- Cron HTTP (trigger manual): `app/api/cron/{refresh-category-points,grant-tier-benefits}/route.ts`.

---

## 10. Verificación

**Automatizada (hecha):**
- 5 migraciones aplicadas al proyecto dev remoto vía MCP + `get_advisors` (sólo warnings
  genéricos de SECURITY DEFINER, pre-existentes).
- Smoke SQL end-to-end contra la DB live (en transacción auto-revertida): acreditar 250 pts →
  sube a nivel; backdatear la tx > ventana + `refresh_all_category_points()` → **el nivel baja**;
  `grant_tier_benefits()` emite N canjes e **idempotente** al re-correr.
- Check del `seed.sql`: las 3 formas de `tier_benefits` (recurring_reward/discount/perk) pasan el
  `tier_benefits_kind_shape` check.
- `npm run typecheck` + `npm run lint` sin errores; **728 tests unit** verdes
  (incluye `tests/lib/points-category.test.ts`).
- Revisión adversarial (4 dimensiones × verificación) → 3 hallazgos corregidos.

**Smoke manual del happy path (para correr localmente con Docker):**
1. `npx supabase start` → `npm run db:reset` (siembra HUB con 5 niveles, catálogo, beneficios,
   18 partners y la regla 1pt/$1000) → `npm run dev`.
2. **Manager** (login owner de HUB): `/hub/club/niveles` muestra los 5 niveles por *puntos de
   categoría* con chips de beneficios; "Beneficios" de Gold lista ítems del mes + descuentos.
   `/hub/club/aliados` muestra las 18 marcas en borrador (activá una). `/hub/club/puntos` muestra
   el catálogo agrupado por categoría.
3. **Acreditar** (`/hub/acreditar`): pegá el QR de un cliente demo y acreditá $500.000 → **+500 pts**
   → el cliente sube a **Gold**.
4. **Wallet** (`/c/<qr_token>` del cliente): el carnet muestra *500 pts de categoría*, nivel Gold,
   anillo de progreso a Black y chip *Canjeables*; sección "Beneficios de tu nivel"; catálogo de
   canje agrupado.
5. **Vencimiento**: backdateá una tx del cliente a > 4 meses y corré `select
   public.refresh_all_category_points();` → el nivel baja y el wallet muestra el pill
   "X pts vencen el DD/MM".
6. **Beneficios del mes**: `select public.grant_tier_benefits();` → aparecen canjes pendientes
   "para retirar" en el wallet.
7. **Canje**: el staff canjea una recompensa → descuenta *Canjeables*, **no** toca *Puntos de
   Categoría*.
