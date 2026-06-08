# Optimización 2026-06 — performance, DB y pulido visual

Auditoría completa + optimización del workspace manager. Tres ejes: (1) performance
percibida y real, (2) salud de la base, (3) deuda de design-system / a11y. La
reorganización del nav está documentada en [redesign-2026.md](./redesign-2026.md).

## 1. Performance

### Frontend (aplicado)

- **`requireTenantAccess` + `getCurrentUser` envueltos en `cache()` de React**
  (`lib/tenant/access.ts`, `lib/tenant/current.ts`). Antes el `getUser()`
  (round-trip a Supabase Auth) + la query de membership se ejecutaban en el
  `layout` **y** otra vez en cada `page` del mismo request. Ahora se deduplican:
  ~la mitad de los round-trips de auth por navegación. `getMembershipsForUser`
  también reusa el `getCurrentUser` cacheado.
- **`loading.tsx` en 44 rutas del manager** (antes 2/48). Cada navegación ahora
  muestra un skeleton al instante en vez de dejar la pantalla anterior congelada
  durante el server-render. Skeletons clonan el ancho/header de cada page.

### Pendiente / recomendado (no aplicado)

- **Dev contra Supabase local.** El `.env.local` apunta al proyecto **remoto**,
  así que en desarrollo cada query y cada `getUser()` viajan por internet — es la
  mayor causa de lentitud percibida mientras se trabaja. Recomendado:
  `npx supabase start && npm run db:reset` y apuntar `NEXT_PUBLIC_SUPABASE_URL`
  al local. Cambio de entorno, cero código.
- **`getUser()` → `getClaims()`** en middleware/access para verificar el JWT
  localmente (sin red) — requiere confirmar que el proyecto usa JWT signing keys
  asimétricas. Queda como follow-up (necesita validar la API vigente con
  Context7/Supabase antes de tocar auth).
- Revisar las 25 rutas `force-dynamic` que podrían pasar a ISR/cache.

## 2. Base de datos (migraciones aplicadas + verificadas)

Tres migraciones nuevas en `supabase/migrations/`, aplicadas al proyecto remoto
vía MCP y verificadas con queries puntuales:

| Migración | Qué corrige (advisor) | Riesgo |
|---|---|---|
| `20260607120000_perf_fk_indexes` | 39 `unindexed_foreign_keys` → índice b-tree por FK | additivo, cero |
| `20260607120100_perf_rls_initplan` | 16 `auth_rls_initplan` → `auth.uid()` envuelto en `(select auth.uid())` (se evalúa 1 vez por query, no por fila) | misma semántica de aislamiento |
| `20260607120200_security_hardening` | 4 `security_definer_view` + 6 `function_search_path_mutable` | ver nota |

**Nota sobre las 4 vistas (`v_customer_stats`, `v_churn_risk`,
`v_tenant_daily_metrics`, `v_visit_heatmap`):** son SECURITY DEFINER **a
propósito** — leen materialized views (`mv_*`) que no pueden llevar RLS y filtran
por tenant con un `WHERE` explícito sobre `memberships(auth.uid())`. Pasarlas a
`security_invoker` obligaría a dar `SELECT` directo sobre las `mv_*` (sin RLS) →
fuga cross-tenant peor. El fix correcto fue **cerrar los grants sobrantes**:
`anon` queda sin acceso y se elimina toda escritura; solo `SELECT` para
`authenticated`. Documentado con `COMMENT` en cada vista. (El advisor puede
seguir marcando el patrón definer; es intencional y seguro.)

Verificación post-migración: `crypto round-trip` de `encrypt/decrypt_meta_token`
OK (pgcrypto sigue resolviendo con el nuevo `search_path` que incluye
`extensions`); 0 policies con `auth.uid()` sin envolver; 0 FKs sin índice; vistas
solo con `SELECT` para `authenticated`.

**Deferido a propósito:** 40 `multiple_permissive_policies` (read + write
permissive coexisten en SELECT por el patrón "member_read + owner_write"). Es
perf-only, sin impacto a la escala actual, y separarlas (split de `FOR ALL` en
INSERT/UPDATE/DELETE) tiene riesgo de cambiar permisos sutilmente. Queda anotado.

> Las migraciones no cambian el shape del schema (solo índices, policies, grants,
> search_path, comments) → `types/database.ts` no necesita regenerarse.

## 3. Pulido visual / a11y

- **`PageShell` en páginas full-bleed** (auto-aceptación, plano, punch-cards,
  docs): tenían contenido pegado al borde sin max-width ni gutter.
- **Auto-aceptación rediseñada**: cards con chip de icono, toggles con `Switch`,
  topes condicionales, y el `toast` movido a `useEffect` (estaba en render).
- **`window.confirm()` → `<AlertDialog>`** en 8 acciones destructivas (rompía el
  tema oscuro y el focus-trap dependía del navegador).
- **Colores hardcodeados → tokens OKLCH** (Note de docs en `blue-*` ilegible en
  dark; hex del pie de comisiones → `var(--chart-*)`; amber → `text-warning`).
- **Tablas con scroll** (comisiones / managers) que se cortaban en tablet/mobile.
- **Calendarios responsive**: en mobile, agenda/lista en vez de grilla 7-col
  ilegible; el drag-and-drop de desktop queda intacto (`hidden sm:grid`).
- **Bandeja responsive**: master-detail colapsa a un panel en mobile (`?c=`) con
  botón Volver; altura en `dvh` para no recortar el composer.
- **Sub-páginas de Configuración**: se quitó el container duplicado (el layout ya
  aporta max-width + padding).

## Smoke manual (happy paths a verificar)

1. **Nav**: el sidebar muestra el orden nuevo; "Templates" ya no aparece;
   "Marketing" lista Shows y fiestas / Difusiones / Audiencias / Flows.
2. **Calendario**: `/[slug]/eventos/programados` abre con pestañas **Calendario**
   y **Eventos**; en Eventos se editan los formatos; arrastrar un formato a un día
   sigue funcionando (desktop); `/[slug]/eventos/templates` redirige a la pestaña
   Eventos.
3. **Auto-aceptación**: togglear "Habilitar auto-aceptación" muestra/oculta los
   topes; Guardar persiste y muestra toast (una sola vez).
4. **Navegación**: al cambiar de sección aparece un skeleton inmediato.
5. **Borrar** una regla de puntos / tier de comisión: abre AlertDialog y elimina.
6. **Bandeja** en mobile: seleccionar conversación muestra el hilo con "Volver".
