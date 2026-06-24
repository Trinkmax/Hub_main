# Spec — Configuración de credenciales de Meta desde la UI (panel de plataforma)

> Fecha: 2026-06-24 · Estado: **Diseño aprobado, pendiente de plan de implementación**
> Alcance: mover las credenciales de la Meta App de HUB de variables de entorno a una
> configuración editable desde un panel de **superadmin de plataforma**, con fallback a env.

---

## 1. Contexto y objetivo

HUB integra WhatsApp (y modela Instagram) vía **una única Meta App de plataforma** (modelo
"Tech Provider": una sola app, cada bar conecta su propio WhatsApp por OAuth/Embedded Signup).
Hoy las credenciales de esa app viven sólo en variables de entorno de Vercel y se leen con
`getMetaConfig()` (`lib/meta/env.ts`, vía `requireEnv`).

**Objetivo:** poder configurar/rotar esas credenciales desde un panel en la app (workspace de
plataforma `(platform)/admin`, sólo superadmins), sin tener que tocar el env de Vercel ni
redeployar. Mantener compatibilidad: lo que ya está en env sigue funcionando.

**No-objetivos:** que cada bar (tenant) cargue credenciales propias (se descartó — ver §3);
mover la llave de cifrado o la URL pública a la UI (no es seguro/posible — ver §3).

---

## 2. Estado actual

- `lib/meta/env.ts`:
  - `getMetaConfig()` (síncrona) hace `requireEnv` de: `META_APP_ID`, `META_APP_SECRET`,
    `META_WEBHOOK_VERIFY_TOKEN`, `META_TOKEN_KEY`, `NEXT_PUBLIC_APP_URL`; `META_GRAPH_VERSION`
    es opcional (default `v23.0`).
  - `isMetaConfigured()` (síncrona) → `Boolean(process.env.META_APP_ID && META_APP_SECRET)`.
- Consumidores de `getMetaConfig()`/config: `lib/meta/oauth.ts`, rutas `app/api/meta/whatsapp/{connect,callback}`,
  webhooks `app/api/webhooks/{whatsapp,meta-verify}`, `lib/meta/signature.ts` (vía appSecret),
  `lib/meta/templates.ts`, `lib/meta/whatsapp.ts`, `lib/meta/token-refresh.ts`.
- Cifrado existente: RPCs `encrypt_meta_token(plaintext, key)` / `decrypt_meta_token(ciphertext, key)`
  (`pgp_sym_encrypt` con `META_TOKEN_KEY`), ya usadas para los tokens de canal (`lib/meta/crypto.ts`).
- Plataforma: workspace `app/(platform)/admin/` con guard `requirePlatformAdmin()`
  (`lib/platform/is-admin.ts`), tabla `platform_admins` (allowlist por email) y función SQL
  `is_platform_admin()` usada por RLS (migración `20260612000000_platform_admins_and_feature_flags`).

---

## 3. Decisiones tomadas

| # | Decisión | Elección |
|---|----------|----------|
| 1 | Alcance | **Plataforma**: una sola Meta App de HUB, configurable por superadmin. NO por-tenant (cada dueño tendría que crear su app de FB Developer → fricción inviable). |
| 2 | Estrategia de resolución | **DB con fallback a env** (enfoque A): `getMetaConfig` usa el valor de DB y, si falta, cae al env var. Aditivo, sin disrupción. |
| 3 | Campos editables en UI | `META_APP_ID`, `META_APP_SECRET` (cifrado), `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION`. |
| 4 | Campos que NO van a la UI | **`META_TOKEN_KEY`** (es la llave que cifra/descifra todo en la DB — guardarla en la DB anula el cifrado; queda en env) y **`NEXT_PUBLIC_APP_URL`** (build-time/pública; no es config de runtime). |
| 5 | Quién edita | Sólo **superadmins de plataforma** (`requirePlatformAdmin()` + RLS `is_platform_admin()`). Un dueño de bar nunca la ve ni la edita. |
| 6 | "Probar credenciales" | **Fuera de v1** (YAGNI). Posible v2: validar App ID/Secret contra Meta al guardar. |

**Rechazado:** que la UI edite las env de Vercel por API (requiere token con scope de escritura,
dispara redeploys, ata a Vercel).

---

## 4. Arquitectura

### 4.1 Datos — tabla singleton `platform_meta_config`

Tabla **global de plataforma** (sin `tenant_id`; es una sola Meta App para todo HUB). Migración
nueva (aplicar a prod vía MCP `apply_migration` — ver [[supabase-prod-migrations-via-mcp]]; regenerar
tipos con [[supabase-types-regen-via-mcp]]).

```sql
create table public.platform_meta_config (
  id boolean primary key default true,
  constraint platform_meta_config_singleton check (id),  -- fuerza 1 sola fila (id = true)
  app_id text,
  app_secret_encrypted text,        -- pgp_sym_encrypt(app_secret, META_TOKEN_KEY) vía encrypt_meta_token
  webhook_verify_token text,        -- handshake con Meta (menor sensibilidad; texto plano)
  graph_version text,               -- null → el código usa el default v23.0
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.platform_meta_config enable row level security;

-- Sólo superadmins leen/escriben vía la Data API. El runtime la lee por service_role.
create policy "platform_meta_config_admin_all" on public.platform_meta_config
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update on public.platform_meta_config to authenticated;
```

- **Cifrado:** `app_secret` se guarda como `app_secret_encrypted` usando `encrypt_meta_token(secret, META_TOKEN_KEY)`.
  Nunca se persiste en claro. `webhook_verify_token` y `graph_version` en texto plano (no son credenciales de API).
- **Singleton:** PK booleana con check `id` → una única fila (`id = true`); upsert `on conflict (id) do update`.
- **RLS:** la lectura/escritura vía sesión queda restringida a superadmins. El runtime usa `service_role`
  (que saltea RLS) — igual que el resto de los flujos de Meta.

### 4.2 Resolución de config — `getMetaConfig()` async con fallback

- `getMetaConfig()` pasa a **async**. Carga la fila de `platform_meta_config` (service client),
  descifra `app_secret_encrypted` con `decrypt_meta_token(..., META_TOKEN_KEY)`, y resuelve **por campo**:
  `valorDeDB ?? process.env.<VAR>`. Lanza error claro si un campo requerido falta en **ambos**.
  `META_TOKEN_KEY` y `NEXT_PUBLIC_APP_URL` se siguen leyendo **sólo de env** (no están en la tabla).
- **Cache por instancia:** memo a nivel módulo `{ value, expiresAt }` con TTL corto (p.ej. 60s) para no
  pegarle a la DB en cada request; se invalida al guardar desde el panel. (En serverless el cache vive por
  instancia caliente.)
- **`isMetaConfigured()`** pasa a async y considera DB ?? env (para gating de UI del botón "Conectar").
- **Costo principal del cambio:** volver `await` a todos los llamadores (rutas de connect/callback,
  webhooks, `signature`/`appSecret`, `templates`, `whatsapp` send, `token-refresh`, `oauth`). Es mecánico
  pero toca varios archivos; el plan debe enumerarlos y verificar typecheck.

### 4.3 UI — panel de superadmin

- Página en `app/(platform)/admin/` (p.ej. `app/(platform)/admin/meta/page.tsx`), gated por `requirePlatformAdmin()`.
  Server component: lee los campos **no secretos** + un booleano `tiene_app_secret` (NUNCA devuelve el secret en claro al cliente).
- Form (client, `useActionState` + `useFormStatus`) → server action **`savePlatformMetaConfig`**:
  `requirePlatformAdmin()` + zod. Cifra el `app_secret` (si vino uno nuevo), upsert de la fila, invalida cache,
  escribe `audit_log`. El campo secret se muestra **enmascarado** ("•••• configurado"); sólo se actualiza si se
  ingresa un valor nuevo (vacío = conservar el existente).
- **Aviso en la UI:** cambiar `webhook_verify_token` exige reflejarlo en el dashboard de Meta; cambiar el `app_secret`
  debe coincidir con el secret real de la Meta App.

---

## 5. Seguridad (CLAUDE.md §9/§12)

- `app_secret` cifrado en reposo (`META_TOKEN_KEY`); **nunca** vuelve al cliente en texto plano (campo write-only/enmascarado).
- Acceso restringido a superadmins de plataforma (RLS `is_platform_admin()` + `requirePlatformAdmin()` en el server action).
- Toda escritura escribe `audit_log` (sin PII; sin loguear el secret).
- `META_TOKEN_KEY` permanece como secreto de entorno (no se persiste). Sin esto, el cifrado no tiene sentido.
- zod en el borde del server action.

## 6. Testing (CLAUDE.md §10)

- **Unit:** resolver de config — DB pisa env, fallback a env cuando el campo de DB es null, error si falta en ambos,
  descifrado del secret, `graph_version` default. zod del input del action.
- **RLS:** un usuario no-admin NO puede leer ni escribir `platform_meta_config`; un superadmin sí. El secret no se expone.
- **Regresión:** typecheck verde tras volver async `getMetaConfig` y sus llamadores.
- ⚠️ **Nota CI:** el job "RLS integration tests" ya está rojo en `main` por un problema pre-existente (ver [[rls-ci-broken]]); cualquier test RLS nuevo lo hereda hasta que se arregle ese job. No confundir con una regresión de esta feature.

## 7. Rollout / compatibilidad

- **Aditivo:** con el fallback (§4.2), todo lo que hoy está en env sigue funcionando → **no bloquea** la reconexión
  de WhatsApp ni el go-live del envío de mensajería. Se puede mergear y luego ir migrando credenciales al panel.
- Orden sugerido: migración + tipos → resolver async + llamadores → panel UI. Migración a prod vía MCP.

## 8. Out of scope / YAGNI

- Botón "Probar credenciales" contra Meta (posible v2).
- Credenciales por-tenant (rechazado — §3).
- Mover `META_TOKEN_KEY` o `NEXT_PUBLIC_APP_URL` a la UI (§3, decisión 4).
- Configuración de Instagram más allá de lo ya modelado (sigue el mismo `getMetaConfig`).

## 9. Archivos clave

- DB: `supabase/migrations/<ts>_platform_meta_config.sql`, `types/database.ts` (regen MCP).
- Config: `lib/meta/env.ts` (`getMetaConfig` async + fallback + cache, `isMetaConfigured` async) y todos sus llamadores
  (`lib/meta/{oauth,signature,templates,whatsapp,token-refresh}.ts`, `app/api/meta/whatsapp/{connect,callback}/route.ts`,
  `app/api/webhooks/{whatsapp,meta-verify}/route.ts`).
- UI/acciones: `app/(platform)/admin/meta/*`, `lib/platform/actions.ts` (o `lib/meta/platform-config.ts` nuevo),
  `lib/platform/is-admin.ts` (reuso).

## 10. Definition of Done (CLAUDE.md §11)

Migración aplicada (MCP) + tipos regenerados · RLS testeada · zod en el borde · `getMetaConfig` async sin romper
llamadores (typecheck) · unit tests verdes · panel accesible sólo a superadmins, secret enmascarado · sin secretos en
logs · README de la feature · smoke documentado (cargar credenciales en el panel → conectar WhatsApp usa las de DB) ·
Conventional Commits.
