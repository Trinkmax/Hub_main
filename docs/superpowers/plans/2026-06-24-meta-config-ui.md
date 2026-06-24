# Panel de configuración de credenciales de Meta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir configurar las credenciales de la Meta App de HUB (`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`) desde un panel de superadmin de plataforma, con fallback a variables de entorno y el secret cifrado en reposo.

**Architecture:** Tabla singleton `platform_meta_config` (global, sin `tenant_id`). `getMetaConfig()` pasa a async y resuelve cada campo credencial como `DB ?? env` (cacheado por instancia). `META_TOKEN_KEY`, `NEXT_PUBLIC_APP_URL` y `META_GRAPH_VERSION` se desacoplan de `getMetaConfig` y se leen sólo de env (mantiene `graphUrl`/`crypto` sync y rompe la dependencia circular del descifrado). Panel en `(platform)/admin`, gated por `requirePlatformAdmin()`.

**Tech Stack:** Next.js 16 (RSC + Server Actions), Supabase (Postgres + RLS + pgcrypto), TypeScript estricto, Vitest, Biome, zod.

## Global Constraints

- Migraciones idempotentes en `supabase/migrations/`; aplicar a prod con MCP `apply_migration` (proyecto `ogplsevtrclzxvyejlns`) — el CLI no está credencializado (memoria `supabase-prod-migrations-via-mcp`). Regenerar `types/database.ts` con MCP `generate_typescript_types` re-anexando el bloque de alias (memoria `supabase-types-regen-via-mcp`).
- Toda tabla nueva: RLS habilitada + GRANTs explícitos (CLAUDE.md §4/§5).
- `META_TOKEN_KEY` y `NEXT_PUBLIC_APP_URL` **nunca** se persisten ni van a la UI; el secret de la Meta App se guarda cifrado (`pgp_sym_encrypt` vía `encrypt_meta_token`), **nunca** vuelve al cliente en claro.
- Sólo superadmins (`requirePlatformAdmin()` + RLS `is_platform_admin()`) leen/escriben la config.
- zod en el borde del server action. Sin `any`. Commits Conventional en español terminando con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Calidad antes de commit: `npm run typecheck && npm run lint`. Unit en `tests/lib/*.test.ts` (`npx vitest run <file>`). RLS en `tests/rls/*.test.ts` (requiere `npx supabase start` + envs; ⚠️ el job "RLS integration tests" ya está rojo en `main` por un problema pre-existente — memoria `rls-ci-broken` — no confundir con regresión).

---

### Task 1: Migración `platform_meta_config` + tipos

**Files:**
- Create: `supabase/migrations/20260624120000_platform_meta_config.sql`
- Regenerate: `types/database.ts` (MCP)

**Interfaces:**
- Produces: tabla `public.platform_meta_config` (columns `id boolean`, `app_id text`, `app_secret_encrypted text`, `webhook_verify_token text`, `updated_at`, `updated_by`).

- [ ] **Step 1: Escribir la migración (idempotente)**

Create `supabase/migrations/20260624120000_platform_meta_config.sql`:

```sql
-- ============================================================
-- platform_meta_config: credenciales de la Meta App de HUB (GLOBAL de plataforma).
-- 1 sola fila (id = true). Editable sólo por superadmins; el runtime la lee por service_role.
-- app_secret cifrado con pgp_sym_encrypt (encrypt_meta_token / META_TOKEN_KEY). Fallback a env en código.
-- ============================================================
create table if not exists public.platform_meta_config (
  id boolean primary key default true,
  constraint platform_meta_config_singleton check (id),  -- fuerza una única fila (id = true)
  app_id text,
  app_secret_encrypted text,        -- pgp_sym_encrypt(app_secret, META_TOKEN_KEY)
  webhook_verify_token text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.platform_meta_config enable row level security;

drop policy if exists "platform_meta_config_admin_all" on public.platform_meta_config;
create policy "platform_meta_config_admin_all" on public.platform_meta_config
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update on public.platform_meta_config to authenticated;
```

- [ ] **Step 2: Aplicar a prod (MCP) + regenerar tipos**

Aplicar con MCP `apply_migration` (proyecto `ogplsevtrclzxvyejlns`). Luego MCP `generate_typescript_types` → sobrescribir `types/database.ts` y re-anexar el bloque de alias.
Expected: `Database['public']['Tables']['platform_meta_config']` existe con las 5 columnas.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260624120000_platform_meta_config.sql types/database.ts
git commit -m "feat(meta): tabla platform_meta_config (RLS superadmin) para credenciales de Meta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Resolver puro de credenciales (`resolveMetaCredentials`) + tests

Lógica pura DB-pisa-env, testeable sin DB. Vive en el módulo que en Task 4 sumará la carga async.

**Files:**
- Create: `lib/meta/platform-config.ts` (sólo el resolver puro + tipos en este task)
- Test: `tests/lib/meta-platform-config.test.ts`

**Interfaces:**
- Produces: `type MetaCredentials = { appId: string; appSecret: string; webhookVerifyToken: string }`; `resolveMetaCredentials(db, env): MetaCredentials`.

- [ ] **Step 1: Escribir los tests (failing)**

Create `tests/lib/meta-platform-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveMetaCredentials } from '@/lib/meta/platform-config'

const env = { appId: 'ENV_ID', appSecret: 'ENV_SECRET', webhookVerifyToken: 'ENV_TOKEN' }

describe('resolveMetaCredentials', () => {
  it('usa el valor de DB cuando está presente', () => {
    const out = resolveMetaCredentials(
      { appId: 'DB_ID', appSecret: 'DB_SECRET', webhookVerifyToken: 'DB_TOKEN' },
      env,
    )
    expect(out).toEqual({ appId: 'DB_ID', appSecret: 'DB_SECRET', webhookVerifyToken: 'DB_TOKEN' })
  })

  it('cae al env cuando el campo de DB es null/empty', () => {
    const out = resolveMetaCredentials({ appId: 'DB_ID', appSecret: null, webhookVerifyToken: '' }, env)
    expect(out).toEqual({ appId: 'DB_ID', appSecret: 'ENV_SECRET', webhookVerifyToken: 'ENV_TOKEN' })
  })

  it('tira error claro si un campo falta en DB y env', () => {
    expect(() =>
      resolveMetaCredentials({ appId: null, appSecret: null, webhookVerifyToken: null }, { appId: null, appSecret: null, webhookVerifyToken: null }),
    ).toThrow(/META_APP_ID/)
  })
})
```

- [ ] **Step 2: Correr (failing)**

Run: `npx vitest run tests/lib/meta-platform-config.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el resolver puro**

Create `lib/meta/platform-config.ts`:

```ts
import 'server-only'

export type MetaCredentials = {
  appId: string
  appSecret: string
  webhookVerifyToken: string
}

type PartialCreds = {
  appId?: string | null
  appSecret?: string | null
  webhookVerifyToken?: string | null
}

// PURO: por campo, DB ?? env (tratando ''/null como ausente). Throw si falta en ambos.
export function resolveMetaCredentials(db: PartialCreds, env: PartialCreds): MetaCredentials {
  const pick = (name: string, d?: string | null, e?: string | null): string => {
    const v = (d || undefined) ?? (e || undefined)
    if (!v) throw new Error(`Meta config incompleta: falta ${name} (ni en DB ni en env)`)
    return v
  }
  return {
    appId: pick('META_APP_ID', db.appId, env.appId),
    appSecret: pick('META_APP_SECRET', db.appSecret, env.appSecret),
    webhookVerifyToken: pick('META_WEBHOOK_VERIFY_TOKEN', db.webhookVerifyToken, env.webhookVerifyToken),
  }
}
```

- [ ] **Step 4: Correr (passing)**

Run: `npx vitest run tests/lib/meta-platform-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/meta/platform-config.ts tests/lib/meta-platform-config.test.ts
git commit -m "feat(meta): resolver puro de credenciales (DB pisa env) + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Desacoplar `tokenKey` y `graphVersion` de `getMetaConfig`

Prep que rompe la futura dependencia circular y saca a `graphUrl` del ripple async. **Sin cambio de comportamiento** (siguen leyendo de env). Deja `getMetaConfig` aún sync por ahora.

**Files:**
- Modify: `lib/meta/env.ts` (agregar `getTokenKey`/`getGraphVersion`; `graphUrl`/`instagramGraphUrl` usan `getGraphVersion`)
- Modify: `lib/meta/crypto.ts` (usar `getTokenKey` en vez de `getMetaConfig().tokenKey`)

**Interfaces:**
- Produces: `getTokenKey(): string`, `getGraphVersion(): string` en `lib/meta/env.ts`.

- [ ] **Step 1: Agregar helpers env-only y desacoplar graphUrl en `lib/meta/env.ts`**

En `lib/meta/env.ts`, agregar tras `DEFAULT_GRAPH_VERSION`:

```ts
export function getTokenKey(): string {
  return requireEnv('META_TOKEN_KEY')
}

export function getGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
}
```

Y cambiar `graphUrl`/`instagramGraphUrl` para que NO llamen a `getMetaConfig()`:

```ts
export function graphUrl(path: string) {
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.facebook.com/${getGraphVersion()}/${clean}`
}

export function instagramGraphUrl(path: string) {
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.instagram.com/${getGraphVersion()}/${clean}`
}
```

- [ ] **Step 2: `lib/meta/crypto.ts` usa `getTokenKey()`**

Reemplazar el import y los dos usos:

```ts
import { getTokenKey } from './env'
// ...
export async function encryptToken(plaintext: string): Promise<string> {
  const tokenKey = getTokenKey()
  // ...resto igual...
}
export async function decryptToken(ciphertext: string): Promise<string> {
  const tokenKey = getTokenKey()
  // ...resto igual...
}
```

(Quitar `import { getMetaConfig } from './env'` si ya no se usa en el archivo.)

- [ ] **Step 3: Typecheck + lint + suite**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: verde (sin cambio de comportamiento).

- [ ] **Step 4: Commit**

```bash
git add lib/meta/env.ts lib/meta/crypto.ts
git commit -m "refactor(meta): desacoplar tokenKey/graphVersion de getMetaConfig (env directo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `getMetaConfig` async con fallback DB + propagar `await`

`getMetaConfig`/`isMetaConfigured` pasan a async; suma `loadMetaCredentials` (DB ?? env, cacheada, descifra el secret). Actualiza todos los llamadores de credenciales a `await`.

**Files:**
- Modify: `lib/meta/platform-config.ts` (agregar `loadMetaCredentials` + `invalidateMetaConfigCache`)
- Modify: `lib/meta/env.ts` (`getMetaConfig`/`isMetaConfigured` async)
- Modify: `lib/meta/state.ts`, `lib/meta/oauth.ts`, `lib/meta/token-refresh.ts`
- Modify rutas: `app/api/meta/whatsapp/{connect,callback}/route.ts`, `app/api/meta/instagram/{connect,callback}/route.ts`, `app/api/webhooks/{whatsapp,instagram,meta-verify}/route.ts`
- Modify: `app/(manager)/[tenantSlug]/configuracion/canales/page.tsx`

**Interfaces:**
- Consumes: `resolveMetaCredentials` (Task 2), `decryptToken` (Task 3), `getTokenKey`/`getGraphVersion` (Task 3).
- Produces: `getMetaConfig(): Promise<{ appId; appSecret; webhookVerifyToken; graphVersion; tokenKey; appUrl }>`, `isMetaConfigured(): Promise<boolean>`, `loadMetaCredentials(): Promise<MetaCredentials>`, `invalidateMetaConfigCache(): void`.

- [ ] **Step 1: Agregar `loadMetaCredentials` + cache a `lib/meta/platform-config.ts`**

Append a `lib/meta/platform-config.ts`:

```ts
import { createServiceClient } from '@/lib/supabase/service'
import { decryptToken } from './crypto'

type Cache = { value: MetaCredentials; expiresAt: number }
let cache: Cache | null = null
const TTL_MS = 60_000

export function invalidateMetaConfigCache(): void {
  cache = null
}

// Lee la fila singleton (service_role), descifra el secret, y resuelve DB ?? env.
// Cacheada por instancia (TTL corto). En serverless, vive por instancia caliente.
export async function loadMetaCredentials(now: number = Date.now()): Promise<MetaCredentials> {
  if (cache && cache.expiresAt > now) return cache.value
  const service = createServiceClient()
  const { data } = await service
    .from('platform_meta_config')
    .select('app_id, app_secret_encrypted, webhook_verify_token')
    .eq('id', true)
    .maybeSingle()
  const appSecret = data?.app_secret_encrypted ? await decryptToken(data.app_secret_encrypted) : null
  const value = resolveMetaCredentials(
    { appId: data?.app_id ?? null, appSecret, webhookVerifyToken: data?.webhook_verify_token ?? null },
    {
      appId: process.env.META_APP_ID ?? null,
      appSecret: process.env.META_APP_SECRET ?? null,
      webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
    },
  )
  cache = { value, expiresAt: now + TTL_MS }
  return value
}
```

> Nota: el ciclo de imports `env → platform-config → crypto → env` es sólo a nivel de funciones (ninguna se ejecuta en module-eval), así que es seguro en runtime.

- [ ] **Step 2: `getMetaConfig`/`isMetaConfigured` async en `lib/meta/env.ts`**

Reemplazar las funciones (dejando `graphUrl`/`instagramGraphUrl`/`getTokenKey`/`getGraphVersion` como están de Task 3):

```ts
import { loadMetaCredentials } from './platform-config'

export async function isMetaConfigured(): Promise<boolean> {
  try {
    await loadMetaCredentials()
    return true
  } catch {
    return false
  }
}

export async function getMetaConfig() {
  const creds = await loadMetaCredentials()
  return {
    appId: creds.appId,
    appSecret: creds.appSecret,
    webhookVerifyToken: creds.webhookVerifyToken,
    graphVersion: getGraphVersion(),
    tokenKey: getTokenKey(),
    appUrl: requireEnv('NEXT_PUBLIC_APP_URL'),
  }
}
```

- [ ] **Step 3: `lib/meta/state.ts` → async**

`signState`/`verifyState` pasan a async (usan `appSecret`):

```ts
export async function signState(tenantId: string): Promise<string> {
  const { appSecret } = await getMetaConfig()
  // ...resto igual...
}
export async function verifyState(state: string): Promise<{ tenantId: string } | null> {
  const { appSecret } = await getMetaConfig()
  // ...resto igual...
}
```

- [ ] **Step 4: `lib/meta/oauth.ts` → await**

`buildWhatsAppEmbeddedSignupUrl` y `buildInstagramLoginUrl` pasan a `async` y `await getMetaConfig()` + `await signState(...)`. En las funciones ya async (`exchangeFacebookCode`, `findWabaIdsFromToken`, `exchangeInstagramCode`, `exchangeForLongLivedInstagramToken`) cambiar `const {...} = getMetaConfig()` por `const {...} = await getMetaConfig()`. (6 sitios: líneas ~8, 27, 49, 63, 79, 115.)

- [ ] **Step 5: `lib/meta/token-refresh.ts` → await**

Línea ~38: `const { appId, appSecret, graphVersion } = await getMetaConfig()`.

- [ ] **Step 6: Rutas → await**

En cada ruta, volver `await` la llamada y `await isMetaConfigured()`/`await build*Url(...)`/`await verifyState(...)` según corresponda:
- `app/api/meta/whatsapp/connect/route.ts`: `if (!(await isMetaConfigured()))`; `const { appUrl } = await getMetaConfig()`; `await buildWhatsAppEmbeddedSignupUrl(...)`; `await signState(...)`.
- `app/api/meta/whatsapp/callback/route.ts`: `const { appUrl } = await getMetaConfig()`; `await verifyState(...)`.
- `app/api/meta/instagram/connect/route.ts` y `.../callback/route.ts`: idem (instagram).
- `app/api/webhooks/whatsapp/route.ts` (línea 16) y `.../instagram/route.ts` (línea 15): `const { appSecret } = await getMetaConfig()`.
- `app/api/webhooks/meta-verify/route.ts` (línea 10): `const { webhookVerifyToken } = await getMetaConfig()`.

- [ ] **Step 7: `canales/page.tsx` → await**

`app/(manager)/[tenantSlug]/configuracion/canales/page.tsx` línea ~51: `const configured = await isMetaConfigured()` (es server component async).

- [ ] **Step 8: Typecheck + lint + suite**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: verde. Typecheck es el guard real: cualquier `getMetaConfig()` sin `await` ahora es `Promise<...>` y rompe el build.

- [ ] **Step 9: Commit**

```bash
git add lib/meta/platform-config.ts lib/meta/env.ts lib/meta/state.ts lib/meta/oauth.ts lib/meta/token-refresh.ts \
  app/api/meta app/api/webhooks "app/(manager)/[tenantSlug]/configuracion/canales/page.tsx"
git commit -m "feat(meta): getMetaConfig async con fallback DB->env + propagar await

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Schema zod + server action `savePlatformMetaConfig` + lectura para display

**Files:**
- Create: `lib/platform/meta-config-schema.ts`
- Create: `lib/platform/meta-config-actions.ts`
- Test: `tests/lib/meta-config-schema.test.ts`

**Interfaces:**
- Consumes: `encryptToken` (crypto), `invalidateMetaConfigCache` (platform-config), `isPlatformAdmin` (is-admin).
- Produces: `savePlatformMetaConfig(input): Promise<{ ok: true } | { ok: false; error: string }>`, `getPlatformMetaConfigForDisplay(): Promise<{ appId; webhookVerifyToken; hasSecret } | null>`.

- [ ] **Step 1: Tests del schema (failing)**

Create `tests/lib/meta-config-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { savePlatformMetaConfigSchema } from '@/lib/platform/meta-config-schema'

describe('savePlatformMetaConfigSchema', () => {
  it('acepta appSecret vacío (= conservar)', () => {
    const r = savePlatformMetaConfigSchema.safeParse({ appId: '123', appSecret: '', webhookVerifyToken: 'tok' })
    expect(r.success).toBe(true)
  })
  it('rechaza appId vacío', () => {
    const r = savePlatformMetaConfigSchema.safeParse({ appId: '', webhookVerifyToken: 'tok' })
    expect(r.success).toBe(false)
  })
  it('rechaza webhookVerifyToken vacío', () => {
    const r = savePlatformMetaConfigSchema.safeParse({ appId: '123', webhookVerifyToken: '' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Correr (failing)** — `npx vitest run tests/lib/meta-config-schema.test.ts` → FAIL.

- [ ] **Step 3: Implementar el schema**

Create `lib/platform/meta-config-schema.ts`:

```ts
import { z } from 'zod'

export const savePlatformMetaConfigSchema = z.object({
  appId: z.string().trim().min(1).max(64),
  appSecret: z.string().trim().max(256).optional(), // vacío/ausente = conservar el existente
  webhookVerifyToken: z.string().trim().min(1).max(256),
})
export type SavePlatformMetaConfigInput = z.infer<typeof savePlatformMetaConfigSchema>
```

- [ ] **Step 4: Correr (passing)** — `npx vitest run tests/lib/meta-config-schema.test.ts` → PASS.

- [ ] **Step 5: Implementar las actions**

Create `lib/platform/meta-config-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { encryptToken } from '@/lib/meta/crypto'
import { invalidateMetaConfigCache } from '@/lib/meta/platform-config'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from './is-admin'
import { savePlatformMetaConfigSchema } from './meta-config-schema'

export type SavePlatformMetaConfigResult = { ok: true } | { ok: false; error: string }

// Devuelve campos no-secretos + si hay secret. NUNCA el secret en claro.
export async function getPlatformMetaConfigForDisplay(): Promise<
  { appId: string; webhookVerifyToken: string; hasSecret: boolean } | null
> {
  if (!(await isPlatformAdmin())) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('platform_meta_config')
    .select('app_id, webhook_verify_token, app_secret_encrypted')
    .eq('id', true)
    .maybeSingle()
  return {
    appId: data?.app_id ?? '',
    webhookVerifyToken: data?.webhook_verify_token ?? '',
    hasSecret: Boolean(data?.app_secret_encrypted),
  }
}

export async function savePlatformMetaConfig(input: unknown): Promise<SavePlatformMetaConfigResult> {
  if (!(await isPlatformAdmin())) return { ok: false, error: 'No autorizado' }
  const parsed = savePlatformMetaConfigSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const { appId, appSecret, webhookVerifyToken } = parsed.data

  const supabase = await createClient()
  const row: Record<string, unknown> = {
    id: true,
    app_id: appId,
    webhook_verify_token: webhookVerifyToken,
    updated_at: new Date().toISOString(),
  }
  if (appSecret && appSecret.length > 0) {
    row.app_secret_encrypted = await encryptToken(appSecret)
  }
  const { error } = await supabase.from('platform_meta_config').upsert(row, { onConflict: 'id' })
  if (error) {
    console.error('[platform.savePlatformMetaConfig]', error.code, error.message)
    return { ok: false, error: 'No se pudo guardar' }
  }
  invalidateMetaConfigCache()
  console.info('[platform.meta-config] actualizado', { appId, secretUpdated: Boolean(appSecret) })
  revalidatePath('/admin/meta')
  return { ok: true }
}
```

- [ ] **Step 6: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint && npx vitest run tests/lib/meta-config-schema.test.ts`
```bash
git add lib/platform/meta-config-schema.ts lib/platform/meta-config-actions.ts tests/lib/meta-config-schema.test.ts
git commit -m "feat(platform): action savePlatformMetaConfig + lectura enmascarada + schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Panel UI en `(platform)/admin/meta`

**Files:**
- Create: `app/(platform)/admin/meta/page.tsx`
- Create: `app/(platform)/admin/meta/_form.tsx`

**Interfaces:**
- Consumes: `getPlatformMetaConfigForDisplay`, `savePlatformMetaConfig` (Task 5).

- [ ] **Step 1: Página (server component)**

Create `app/(platform)/admin/meta/page.tsx`:

```tsx
import { getPlatformMetaConfigForDisplay } from '@/lib/platform/meta-config-actions'
import { MetaConfigForm } from './_form'

export const dynamic = 'force-dynamic'

export default async function PlatformMetaConfigPage() {
  const current = await getPlatformMetaConfigForDisplay()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Credenciales de Meta</h1>
        <p className="text-sm text-muted-foreground">
          La Meta App de plataforma (WhatsApp/Instagram). Lo que cargues acá pisa las variables de entorno.
        </p>
      </div>
      <MetaConfigForm
        initial={{
          appId: current?.appId ?? '',
          webhookVerifyToken: current?.webhookVerifyToken ?? '',
          hasSecret: current?.hasSecret ?? false,
        }}
      />
    </div>
  )
}
```

> El layout `(platform)/admin/layout.tsx` ya corre `requirePlatformAdmin()`, así que la página hereda el gate. `getPlatformMetaConfigForDisplay` lo re-chequea (defensa en profundidad).

- [ ] **Step 2: Form (client)**

Create `app/(platform)/admin/meta/_form.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  savePlatformMetaConfig,
  type SavePlatformMetaConfigResult,
} from '@/lib/platform/meta-config-actions'

type Initial = { appId: string; webhookVerifyToken: string; hasSecret: boolean }
const init: SavePlatformMetaConfigResult = { ok: true }

export function MetaConfigForm({ initial }: { initial: Initial }) {
  const submitted = useRef(false)
  const [state, action, pending] = useActionState(
    async (_prev: SavePlatformMetaConfigResult, formData: FormData) => {
      submitted.current = true
      return savePlatformMetaConfig({
        appId: formData.get('appId'),
        appSecret: formData.get('appSecret'),
        webhookVerifyToken: formData.get('webhookVerifyToken'),
      })
    },
    init,
  )
  useEffect(() => {
    if (!submitted.current) return
    if (state.ok) toast.success('Credenciales guardadas')
    else toast.error(state.error)
  }, [state])

  return (
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="appId">App ID</Label>
          <Input id="appId" name="appId" defaultValue={initial.appId} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="appSecret">App Secret</Label>
          <Input
            id="appSecret"
            name="appSecret"
            type="password"
            placeholder={initial.hasSecret ? '•••• configurado (vacío = conservar)' : 'Sin configurar'}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="webhookVerifyToken">Webhook Verify Token</Label>
          <Input
            id="webhookVerifyToken"
            name="webhookVerifyToken"
            defaultValue={initial.webhookVerifyToken}
            required
          />
          <p className="text-xs text-muted-foreground">
            Si lo cambiás, actualizalo también en el dashboard de Meta.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 3: Typecheck + lint + smoke**

Run: `npm run typecheck && npm run lint`
Smoke: `npm run dev`, como superadmin abrir `/admin/meta` → cargar App ID + secret + verify token → Guardar → toast OK. Recargar: App ID/verify token persisten, el secret muestra "•••• configurado". Como NO superadmin, `/admin/meta` da 404.

- [ ] **Step 4: Commit**

```bash
git add "app/(platform)/admin/meta/page.tsx" "app/(platform)/admin/meta/_form.tsx"
git commit -m "feat(platform): panel UI de credenciales de Meta (superadmin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Test RLS de `platform_meta_config`

**Files:**
- Create: `tests/rls/platform-meta-config.test.ts`

- [ ] **Step 1: Escribir el test (skip sin env)**

Create `tests/rls/platform-meta-config.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUserClient, deleteUser, getServiceClient, RLS_TESTS_ENABLED, uniqueEmail } from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('platform_meta_config — sólo superadmins', () => {
  let admin: Awaited<ReturnType<typeof createUserClient>>
  let plain: Awaited<ReturnType<typeof createUserClient>>
  const adminEmail = uniqueEmail('pmc-admin')

  beforeAll(async () => {
    const service = getServiceClient()
    admin = await createUserClient({ email: adminEmail })
    plain = await createUserClient({ email: uniqueEmail('pmc-plain') })
    await service.from('platform_admins').insert({ email: adminEmail })
    // Sembrar la fila singleton vía service_role.
    await service.from('platform_meta_config').upsert({ id: true, app_id: 'SEED' }, { onConflict: 'id' })
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('platform_admins').delete().eq('email', adminEmail)
    await service.from('platform_meta_config').delete().eq('id', true)
    await deleteUser(admin.userId)
    await deleteUser(plain.userId)
  })

  it('un usuario común NO ve la fila', async () => {
    const { data } = await plain.client.from('platform_meta_config').select('app_id').eq('id', true).maybeSingle()
    expect(data).toBeNull()
  })

  it('un usuario común NO puede escribir', async () => {
    const { error } = await plain.client
      .from('platform_meta_config')
      .upsert({ id: true, app_id: 'HACK' }, { onConflict: 'id' })
    expect(error).not.toBeNull()
  })

  it('un superadmin SÍ ve y escribe', async () => {
    const { data: seen } = await admin.client.from('platform_meta_config').select('app_id').eq('id', true).maybeSingle()
    expect(seen?.app_id).toBe('SEED')
    const { error } = await admin.client
      .from('platform_meta_config')
      .update({ app_id: 'ADMIN_SET' })
      .eq('id', true)
    expect(error).toBeNull()
  })
})
```

- [ ] **Step 2: Correr (con supabase local + envs)**

Run: `npx vitest run tests/rls/platform-meta-config.test.ts`
Expected: PASS. (⚠️ Si el job RLS de `main` sigue roto por el problema pre-existente de `permission denied for table tenants` — memoria `rls-ci-broken` — correr este archivo puntual igual debería pasar, porque no usa `createTenant`.)

- [ ] **Step 3: Commit**

```bash
git add tests/rls/platform-meta-config.test.ts
git commit -m "test(platform): RLS de platform_meta_config (sólo superadmins)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verificación final + README

**Files:**
- Create: `docs/features/meta-config-ui.md`

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: typecheck/lint limpios; unit verdes (RLS se skipean sin env).

- [ ] **Step 2: Smoke documentado del happy path**

1. Como superadmin: `/admin/meta` → cargar App ID + App Secret + Verify Token → Guardar.
2. Verificar (MCP `execute_sql`): `select app_id, app_secret_encrypted is not null as has_secret, webhook_verify_token from public.platform_meta_config;` → fila con `has_secret = true`.
3. **Sin** las env vars de Meta (o con valores distintos), Configuración → Canales → "Conectar WhatsApp" usa las credenciales de la DB (el OAuth arranca con el `app_id` del panel).
4. Como NO superadmin: `/admin/meta` → 404.

- [ ] **Step 3: README + commit**

Crear `docs/features/meta-config-ui.md` con: qué hace, la tabla `platform_meta_config`, el orden de precedencia (DB ?? env), qué queda en env (`META_TOKEN_KEY`, `NEXT_PUBLIC_APP_URL`, `META_GRAPH_VERSION`) y por qué, y el smoke de arriba.

```bash
git add docs/features/meta-config-ui.md
git commit -m "docs(meta): README del panel de configuración de credenciales

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de cierre

- **Es follow-up del go-live de mensajería:** por el fallback a env, esta feature es aditiva y no bloquea el envío. Se puede implementar después de prender el dispatcher + reconectar WhatsApp.
- **Riesgo a vigilar:** el ciclo de imports `env ↔ platform-config ↔ crypto` es seguro porque todas las dependencias son a nivel de función (sin ejecución en module-eval). Si Turbopack se queja, extraer `getTokenKey`/`getGraphVersion` a `lib/meta/env-secrets.ts`.
- **Deferred:** `META_GRAPH_VERSION` configurable por UI (requiere volver async `graphUrl`); audit de plataforma (audit_log es tenant-scoped); botón "Probar credenciales" contra Meta.
