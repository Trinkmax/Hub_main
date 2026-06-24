# Credenciales de Meta configurables desde la UI (panel de plataforma)

> Permite a un **superadmin** cargar las credenciales de la Meta App de HUB desde un panel
> en `/admin/meta`, en vez de tener que setearlas como variables de entorno en Vercel.

## Qué hace

La Meta App de HUB es **única para toda la plataforma** (modelo Tech Provider: una app, cada bar
conecta su propio WhatsApp por OAuth). Sus credenciales solían vivir sólo en env de Vercel; ahora
se pueden gestionar desde **`/admin/meta`** (workspace `(platform)/admin`, gated por
`requirePlatformAdmin()`).

## Qué se configura dónde

| Variable | Dónde | Por qué |
|----------|-------|---------|
| `META_APP_ID` | UI (`platform_meta_config.app_id`) ó env | credencial de la app |
| `META_APP_SECRET` | UI (cifrado en `app_secret_encrypted`) ó env | credencial sensible — cifrada con `pgp_sym_encrypt` |
| `META_WEBHOOK_VERIFY_TOKEN` | UI (`webhook_verify_token`) ó env | handshake del webhook |
| `META_TOKEN_KEY` | **sólo env** | es la llave que cifra/descifra todo en la DB; guardarla en la DB anula el cifrado |
| `NEXT_PUBLIC_APP_URL` | **sólo env** | build-time/pública; arma el redirect_uri del OAuth |
| `META_GRAPH_VERSION` | **sólo env** (default `v23.0`) | hacerla configurable obligaba a volver async `graphUrl` (usada en ~15 lugares) |

## Cómo resuelve la config

`getMetaConfig()` (en `lib/meta/env.ts`) es **async** y delega en `loadMetaCredentials()`
(`lib/meta/platform-config.ts`), que:
1. Lee la fila singleton de `platform_meta_config` (service_role).
2. Descifra `app_secret_encrypted` con `decryptToken` (`META_TOKEN_KEY`).
3. Resuelve **por campo: valor de DB ?? env** (`resolveMetaCredentials`, puro y testeado).
4. Cachea el resultado por instancia (TTL 60s); el panel invalida el cache al guardar.

`tokenKey`/`graphVersion` se leen directo de env (`getTokenKey`/`getGraphVersion`) — esto mantiene
`graphUrl`/`crypto` síncronos y **rompe la dependencia circular** del descifrado.

## Datos

Tabla `platform_meta_config` (1 fila, `id = true`, sin `tenant_id` — es global). RLS: sólo
`is_platform_admin()` lee/escribe vía la Data API; el runtime la lee por `service_role`. El
`app_secret` nunca vuelve al cliente en claro (el panel sólo muestra "configurado").

## Cómo se usa

1. **Una sola vez en Vercel (Production):** setear `META_TOKEN_KEY` (llave de cifrado, 32 bytes) y
   `NEXT_PUBLIC_APP_URL` (`https://hubbar.vercel.app`) + redeploy.
2. **Superadmin → `/admin/meta`:** cargar App ID, App Secret y Webhook Verify Token → Guardar.
   (App ID/Secret salen de developers.facebook.com → tu app → Configuración → Básica.)
3. Listo: el flujo de "Conectar WhatsApp" (Configuración → Canales) ya usa esas credenciales.

## Notas / deferred

- ⚠️ **Rotar `META_TOKEN_KEY`** sin re-guardar el App Secret rompe el descifrado: `loadMetaCredentials` falla y todo el flujo de Meta queda como "no configurado". Si rotás la key, volvé a guardar el App Secret desde el panel (`/admin/meta`).
- Audit de plataforma: hoy se loguea server-side sin PII (`audit_log` es tenant-scoped). Un audit de
  plataforma queda para v2.
- Botón "Probar credenciales" contra Meta: v2.
- `META_GRAPH_VERSION` configurable por UI: requiere volver async `graphUrl` — diferido.
- ⚠️ El job "RLS integration tests" del CI está pre-existentemente rojo (ver memoria `rls-ci-broken`);
  el test `tests/rls/platform-meta-config.test.ts` lo hereda hasta que se arregle ese job.
