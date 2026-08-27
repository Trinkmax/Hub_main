# Optimización 2026-08 — "todo tarda minutos"

Auditoría y corrección de la lentitud reportada el 27/08/2026 ("las cosas
directamente no cargaban o tardaban minutos"). Continúa
[optimizacion-2026-06.md](./optimizacion-2026-06.md), que ya había dejado
anotado el follow-up `getUser() → getClaims()`.

## 1. Diagnóstico (con datos, no con intuición)

Fuentes: `pg_stat_statements`, `pg_stat_user_tables`, advisors de Supabase y
los **edge logs de Supabase** (cada request HTTP que entra al proyecto, con
`origin_time`, path y datacenter de origen). Ventana: 24 h.

### La base de datos NO era el problema

| Métrica | Valor |
| --- | --- |
| Tamaño de la DB | 146 MB (31 MB después del vacuum) |
| Filas en tablas de negocio | decenas (clientes 19, reservas 34, menú 231) |
| Query más lenta llamada por la app | `award_points_by_amount` 200 ms p50 (6 llamadas) |
| Cache hit ratio | 100 % |
| Locks / deadlocks / errores en Postgres | 0 / 0 / 0 |
| `auth/v1/user` visto por GoTrue (auth_logs) | máx. 911 ms |

### El problema: round-trips secuenciales + cola en el API gateway

Cada navegación del manager o del salón hacía, **en serie**, antes de renderizar
un solo pixel:

```
proxy      → GET  /auth/v1/user            (getUser)          ~190 ms p50
proxy      → GET  /rest/v1/memberships     (rol por slug)     ~210 ms
layout     → GET  /auth/v1/user            (getUser otra vez) ~190 ms   ← cache() no cruza proxy/render
layout     → GET  /rest/v1/memberships     (tenant + rol)     ~210 ms
AppShell   → POST /rest/v1/rpc/is_platform_admin              ~210 ms
Topbar     → GET  /rest/v1/memberships     (switcher de bares)~210 ms
Topbar     → GET  /auth/v1/user            (email)            ~190 ms
page       → queries propias (en Promise.all, pero recién acá)
```

≈ 1,4 s de overhead fijo por navegación **en el mejor caso**. Y el peor caso
era el que ustedes vieron:

| Path (desde Vercel, colo IAD) | n | p50 | p90 | **máx** |
| --- | ---: | ---: | ---: | ---: |
| `/auth/v1/user` | 483 | 90 ms | 390 ms | **157.712 ms** |
| `/rest/v1/tenants` | 119 | 149 ms | 710 ms | **145.312 ms** |
| `/rest/v1/rpc/is_platform_admin` | 100 | 130 ms | 629 ms | **98.507 ms** |
| `/rest/v1/memberships` | 576 | 124 ms | 362 ms | **62.406 ms** |
| `/rest/v1/rpc/requeue_stuck_jobs` (cron) | 1440 | 241 ms | 478 ms | **106.710 ms** |

Entre las 17:26 y las 17:35 UTC el promedio de `/auth/v1/user` desde Vercel fue
de **23–41 segundos**. GoTrue (el servicio de auth) reportaba <1 s por request:
la espera estaba **delante** del servicio, en el gateway de una instancia
`t4g.nano` del plan Free (CPU compartida, 60 conexiones) que además atendía al cron cada
minuto, a Realtime polleando el WAL y a pg_net. Con 4 hops de auth por página,
la probabilidad de que una navegación pisara al menos uno de esos picos era
~25–30 %.

### Otras cosas que aparecieron

- `net._http_response` (tabla interna de pg_net): **48 MB para 360 filas**. La
  limpieza de pg_net (`DELETE … ORDER BY created LIMIT`) la recorría entera
  cada ~45 s → 37 min de CPU acumulados, picos de 6,8 s.
- `cron.job_run_details`: 106k filas / 75 MB, sin purga.
- `hub-dispatch` (pg_cron → Vercel `/api/cron/dispatch`): 1.440 invocaciones
  por día + ~4.300 requests a Supabase por día para, casi siempre, no hacer
  nada (job_queue vacía, sin broadcasts programadas).
- 21 FKs sin índice (advisor). 65 `multiple_permissive_policies` (deferido, ver
  BACKLOG).
- **El hook de JWT (`custom_access_token_hook`) nunca corrió en producción**:
  `pg_stat_statements` no registra ni una llamada de `supabase_auth_admin`. Está
  habilitado en `config.toml` (local) pero no en el proyecto hosted. Ver §3.

## 2. Cambios aplicados

### 2.1 Auth sin round-trips (`perf(auth)`, migración `20260827120000_perf_auth_fastpath`)

| Antes | Después |
| --- | --- |
| `getUser()` en el proxy (1 hop a GoTrue) | `getClaims()`: verifica la firma ES256 del JWT **en proceso** contra el JWKS del proyecto (auth-js 2.105 lo cachea en memoria del Lambda, TTL 10 min). 0 hops. Sigue refrescando el token vencido y reenviando cookies igual que antes. |
| Query a `memberships` en el proxy para saber el rol | El hook inyecta `app_metadata.tenants = [{id, slug, role}]` en el JWT; el proxy lee el rol de ahí (`lib/tenant/claims.ts`). 0 hops. Fallback a la query si el token es viejo y no trae el claim. |
| `getCurrentUser()` = `getUser()` | `getCurrentUser()` = claims del JWT (`id`, `email`, `activeTenantId`, `tenants`). |
| `requireTenantAccess`: getUser + query membership/tenant | **Un solo RPC** `get_tenant_access(slug)` (SQL, `SECURITY INVOKER` → corre bajo la RLS del usuario) que devuelve tenant + rol + memberships + `is_platform_admin`. |
| `AppShell` llamaba `isPlatformAdmin()`; `Topbar` llamaba `getMembershipsForUser()` + `getUser()`; `AppShellSalon` llamaba `isPlatformAdmin()` + `getUser()` | Los shells **no hacen I/O**: reciben `memberships`, `isPlatformAdmin`, `email` por props desde el layout. |

Camino crítico por navegación: **7 hops secuenciales → 1** (el RPC), más las
queries de la page (que ya iban en paralelo). El proxy pasa de 2 hops a 0.

Seguridad (CLAUDE.md §4): el JWT es **solo ruteo**. Cada layout/page sigue
llamando `get_tenant_access` bajo RLS y cada Server Action sigue con
`requireRole`. Un claim viejo (≤1 h) puede como mucho redirigir a un workspace
donde la página va a dar `notFound()`. `getUser()` (verificación contra el
servidor) se mantiene en cambio de contraseña, aceptar invitación y en las
~40 Server Actions existentes.

Archivos: `lib/supabase/middleware.ts`, `proxy.ts`, `lib/tenant/{claims,current,access,actions}.ts`,
`components/shell/{app-shell,topbar}.tsx`, `components/shell/salon/app-shell-salon.tsx`,
layouts de manager y salón, `app/page.tsx`, `app/v/[token]/page.tsx`,
`mi-turno`, `configuracion/equipo`, `types/database.ts`, `tests/lib/tenant-claims.test.ts`.

### 2.2 Client Router Cache (`next.config.ts`)

`experimental.staleTimes = { dynamic: 30, static: 180 }`. Next 15 bajó el
default de `dynamic` de 30 s a 0: cada vuelta a una pantalla ya visitada volvía
a pagar proxy + layout + page. Con 30 s, cambiar de tab en el salón o volver a
un listado del manager dentro de ese lapso es instantáneo. Las mutaciones vía
Server Action + `revalidatePath` siguen invalidando en el acto; el salón tiene
pull-to-refresh y realtime para lo que cambia desde otro dispositivo.

### 2.3 Base de datos

- `VACUUM FULL` de `net._http_response` (48 MB → 328 kB) y de
  `cron.job_run_details` (75 MB → 6 MB). DB total: 146 MB → 31 MB.
- Job `purge-cron-history` (03:00 UTC): borra `cron.job_run_details` > 7 días.
- `hub-dispatch` mantiene el `* * * * *` pero la llamada HTTP a Vercel sólo
  sale si hay broadcasts programadas vencidas, jobs `pending` vencidos o
  `processing` colgados (>5 min), flow executions `running` vencidas, o toca
  una tarea gated (minuto % 15 = 0; 04:20 UTC para refresh de tokens Meta).
  Espeja `lib/cron/schedule.ts`; todas las sub-tareas son idempotentes y
  toleran ticks salteados por diseño.
- 21 índices nuevos sobre FKs sin cubrir (`idx_<tabla>_<columna>`).
- `grant select on tenants to supabase_auth_admin` + policy (el hook lee slugs).

### 2.4 Fetching paralelo en queries/pages

Ver §5 (resultado del barrido por dominio).

## 3. Checklist de deploy (ORDEN IMPORTA)

1. **Habilitar el hook de JWT en el proyecto hosted** — sin esto el proxy usa el
   fallback (1 hop) en vez de 0 y el switcher de bares no persiste:
   Dashboard → Authentication → Hooks → *Customize Access Token (JWT) Claims*
   → Enable → Hook type **Postgres** → schema `public`, función
   `custom_access_token_hook`. Los grants ya están (`supabase_auth_admin` puede
   ejecutarla; `authenticated`/`anon` no).
2. Deploy a Vercel (`main`). Los tokens ya emitidos siguen funcionando: hasta
   que cada usuario refresque (≤1 h) o vuelva a loguearse, el proxy cae al
   fallback de DB. Después de eso, 0 hops.
3. Verificar en Supabase → Logs → Edge que `/auth/v1/user` desde `IAD` baja a
   ~0 requests por navegación y que `rpc/get_tenant_access` aparece 1 vez por
   página. Query lista para pegar (Logs Explorer):

   ```sql
   select log_attributes['request.path'] as path, count(*) as n,
     round(quantile(0.5)(toFloat64OrZero(log_attributes['response.origin_time']))) as p50,
     max(toFloat64OrZero(log_attributes['response.origin_time'])) as max_ms
   from logs where source='edge_logs' and log_attributes['request.cf.colo']='IAD'
   group by path order by n desc limit 20
   ```
4. **Compute de Supabase.** El proyecto está en el plan **Free** (`t4g.nano`,
   RAM al 58 % en reposo, CPU compartida). Los picos de 60–157 s son de
   saturación del gateway de esa instancia, no de queries. Con los cambios de
   arriba la carga por navegación baja ~7×, lo que debería alcanzar para HUB
   solo. Para operar varios bares en vivo sin sustos: plan Pro (US$ 25/mes,
   incluye Micro) y compute **Small** (+US$ 15/mes: 2 vCPU dedicadas, 2 GB, 90
   conexiones). Decisión del dueño; no requiere código.
5. **Regiones alineadas (hecho en el commit `perf(vercel)`).** Supabase está en
   **`us-west-2` (Oregon)** — confirmado en Settings → Infrastructure, instancia
   `t4g.nano` — y Vercel Hobby corría en `iad1` (Virginia): ~70 ms de ida y
   vuelta extra en CADA hop (p50 90 ms desde IAD, que debería ser ~15 ms local).
   `vercel.json` ahora fija `"regions": ["pdx1"]` (Portland, Oregon; una sola
   región es válido en Hobby). Si algún día se migra el proyecto de Supabase a
   otra región, mover `pdx1` con él.

## 4. Verificación (smoke ejecutado)

- Migración aplicada al proyecto remoto vía MCP; `cron.job` muestra
  `purge-cron-history` y el nuevo `hub-dispatch` (jobid 7).
- `custom_access_token_hook` invocada a mano con el `user_id` del owner de HUB
  → `app_metadata` sale con `tenants: [{id, slug: "hub", role: "owner"}]` y
  `active_tenant_id`.
- `get_tenant_access('hub')` ejecutada como `authenticated` con los claims del
  owner (`set_config('request.jwt.claims', …)` + `set local role authenticated`)
  → `{role: owner, is_platform_admin: true, memberships: [hub], tenant: {…settings, feature_flags…}}`.
  `get_tenant_access('no-existe')` → `null`.
- `npm run typecheck` ✔ · `npm run lint` ✔ · `npm run test:ci` 1093 tests ✔
  (incluye `tests/lib/tenant-claims.test.ts` nuevo) · `next build` ✔.
- Hook blindado: sin `claims` devuelve el evento; con `app_metadata: null`
  sigue inyectando `tenants`; con `user_id` inválido devuelve el evento intacto
  (antes: error → login bloqueado).

## 5. Barrido de fetching por dominio (`perf(queries)`)

Seis agentes en paralelo, uno por dominio, con la regla "solo cambios
obviamente correctos; misma semántica, mismo orden, mismo manejo de errores".
Un verificador leyó el diff completo, corrió typecheck/lint/tests y comprobó
contra la DB real que cada filtro nuevo devuelve exactamente el mismo conjunto
que la versión anterior. **41 cambios en 30 archivos.**

| Dominio | Qué cambió | Hops secuenciales |
| --- | --- | --- |
| Salón / reservas | `reservas/page`: capacidad del día y reserva `?nueva=` al `Promise.all`. `reservas/[id]`: managers/templates/tiers en paralelo con la reserva. `eventos/[id]`: reservas filtradas por `scheduled_event_id` en la query (nuevo filtro) en vez de traer el día y filtrar en memoria. `buildCommissionInputForReservation`: 4 awaits → 1. | 3–5 → 1–2 |
| Mesas / plano | `getSessionForWaiter`, `getCobroBreakdown`, `getFloorPlan`: 3 → 1. `getLiveFloor(knownArea?)` no relee el área que el caller ya tiene. `salon/mesas`: 7 → 3. `local/mesas`: `listFloorAreas` duplicaba la query de `getFloorPlan` (8 → 3). | 3–8 → 1–3 |
| Club / puntos | `listPunchCardTemplates`, `listCustomerPunchCards`: 2 → 1. `getWalletByToken`: el `wallet_pulse` va en el mismo `Promise.all`. `carta/[slug]`: `resolveTenant` en `cache()` — `generateMetadata` y la page hacían la misma query. | 2–5 → 1–4 |
| Stats / home | `getStaffSummaries`: sesiones → tickets → items en un embed anidado. `getCommunicationStats`: `broadcast_recipients` con `broadcasts!inner` en vez de dos queries. | 2–3 → 1 |
| Clientes | `reviews`: tenant por FK embebida vía service role. `tags/actions`: lecturas independientes en paralelo. | 2 → 1 |
| Mensajería / menú | `listMenu*`: asignaciones de tags por `item_tags!inner(tenant_id)` en vez de `.in(ids)`. `getFlow`, `getBroadcastDetail`, registros de flows, `conversations` con tags embebidas. | 2–3 → 1 |

Regresión detectada y corregida por el verificador: en `eventos/programados/[id]`
un `id` que no era UUID pasaba de 404 a 500 al paralelizar (la query de
reservas lanza, la del evento devolvía null); ahora se valida con zod antes.

Notas de contrato (documentadas en código): `getLiveFloor(…, knownArea)` asume
que el caller obtuvo el área filtrada por tenant; en caminos "no existe" ahora
se hacen 1–2 lecturas extra bajo RLS antes del `notFound()` (benigno).

## 6. Revisión adversarial del fast-path y hardening (`fix(auth)`)

Tres revisores con lentes distintas (seguridad multi-tenant, correctitud de
sesión/ruteo, DB/operación) intentaron refutar el commit `perf(auth)`.
**Sin bloqueantes.** Confirmado contra `node_modules/@supabase/auth-js`:
`getClaims()` recorre exactamente el mismo camino de refresh + `setAll` que
`getUser()`, así que el proxy sigue renovando cookies igual. Lo que sí se
corrigió:

| Hallazgo | Fix |
| --- | --- |
| El rol del JWT puede quedar viejo hasta 1 h si el owner cambia el rol de alguien; el proxy lo rutearía mal y las pages darían 404. | Layouts comparan `access.role` (DB) con el rol del claim: si difieren montan `<ClaimsRefresher />` (client) que hace `refreshSession()` + `router.refresh()`, una vez por minuto como máximo. El layout del manager además redirige a `/salon` a cualquier rol de salón (backstop con el rol real). |
| Pantallas en vivo del salón (`salon-view`, `kds-screen`, `live-floor`, `timeline-view`) sembraban estado desde el payload cacheado y recién sincronizaban a los 30 s. | `refresh()` / `fetchReservationsForDate` al montar. Además `<RefreshOnReturn />` en ambos shells: `router.refresh()` al volver a primer plano tras ≥10 s o al restaurar del bfcache (el mozo que bloquea el celular). |
| `PGRST301` (PostgREST rechaza un JWT que `getClaims` dio por bueno — clave revocada, skew) → `/login` → el proxy rebota a home → loop. | Los layouts redirigen con `?reason=session` y el proxy no rebota en ese caso. |
| El hook lanzaba (login bloqueado para TODOS) si `app_metadata` venía como JSON `null` o si fallaba cualquier query. | Migración `20260827130000_auth_hook_hardening`: `jsonb_typeof` guard, cast dentro del bloque, `EXCEPTION WHEN OTHERS → return event` (degrada a "más lento", nunca a "nadie entra"). |
| Sin tope, una cuenta miembro de decenas de bares inflaría la cookie de sesión. | El hook corta en 20 y marca `tenants_truncated`; `readTenantClaims` devuelve `null` → resolver por DB. |
| `email: ''` para usuarios sin email. | `getCurrentUser().email` es `null` en ese caso. |

Aceptado y documentado (no se cambia): la revocación de sesión (sign-out
global, ban) deja de ser inmediata para `getCurrentUser()` — vale hasta que
venza el access token (`jwt_expiry`, 3600 s). La baja de membership sí es
inmediata (RLS + RPC). Los flujos sensibles (cambio de contraseña, aceptar
invitación, acciones del equipo) siguen con `getUser()`. Si se quiere acotar la
ventana: bajar `jwt_expiry` a 900 s en el proyecto (el refresh es automático).

**Ledger de migraciones:** `apply_migration` del MCP registra cada migración
con su propio timestamp (`20260827180041` para el archivo `20260827120000_…`,
igual que todas las anteriores aplicadas por MCP). No es nuevo, pero un
`supabase db push` futuro re-ejecutaría estos archivos: son idempotentes
(`create or replace`, `if not exists`, `unschedule` + `schedule`), con el único
efecto de que `hub-dispatch` cambia de `jobid`. Alinear con `supabase migration
repair` cuando se adopte el CLI como única vía.

## 7. Carta: fotos más rápidas (`perf(carta)`)

Diagnóstico: `menu-images` tiene 437 fotos "full" de **621 kB promedio (máx.
4,8 MB)** y sólo existían dos variantes por foto: thumb 320 px y full 1600 px.
En cualquier celular con DPR ≥ 2, una tarjeta de categoría de ~190 px CSS
necesita ≥ 380 px reales → el browser elegía el full: **5–6 MB por pantalla**
del hub de la carta. Además todas las tarjetas eran `loading="lazy"`, incluidas
las 4–6 que están a la vista al abrir.

Cambios:

- **Variante media `_m.{ext}` (lado mayor 800 px)** en la convención de
  `lib/menu/media-urls.ts`; el pipeline de upload (`lib/menu/upload-image.ts`)
  la genera junto con el thumb; `StorageImage` la sirve en el `srcSet`
  (`320w, 800w, 1600w`). Backfill de las 348 fotos existentes con
  `npx tsx scripts/backfill-menu-media.ts --apply` (ahora también genera `_m`).
  Para una tarjeta retina: ~60 kB en vez de ~600 kB.
- **`priority`** (eager + `fetchpriority=high`) en las 4 primeras tarjetas del
  hub y los 2 primeros recomendados; el resto sigue lazy.
- **`preconnect`** al host de Supabase Storage desde el `<head>` de la carta
  (DNS + TLS antes de la primera foto).

Sin tocar: el full de 1600 px sigue siendo lo que abre el detalle del plato en
pantallas DPR 3 (en DPR 2 ya cae a la media). Las fotos de > 1 MB que quedaron
de antes del pipeline se podrían recomprimir en un backfill aparte (cambia la
URL → hay que repuntar `image_url`); no se hizo en esta tanda.
