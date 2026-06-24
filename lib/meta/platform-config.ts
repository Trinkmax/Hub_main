import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptToken } from './crypto'

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
    webhookVerifyToken: pick(
      'META_WEBHOOK_VERIFY_TOKEN',
      db.webhookVerifyToken,
      env.webhookVerifyToken,
    ),
  }
}

type Cache = { value: MetaCredentials; expiresAt: number }
let cache: Cache | null = null
const TTL_MS = 60_000

export function invalidateMetaConfigCache(): void {
  cache = null
}

// Reads the singleton row (service_role), decrypts the secret, resolves DB ?? env. Cached per instance.
export async function loadMetaCredentials(now: number = Date.now()): Promise<MetaCredentials> {
  if (cache && cache.expiresAt > now) return cache.value
  const service = createServiceClient()
  const { data } = await service
    .from('platform_meta_config')
    .select('app_id, app_secret_encrypted, webhook_verify_token')
    .eq('id', true)
    .maybeSingle()
  const appSecret = data?.app_secret_encrypted
    ? await decryptToken(data.app_secret_encrypted)
    : null
  const value = resolveMetaCredentials(
    {
      appId: data?.app_id ?? null,
      appSecret,
      webhookVerifyToken: data?.webhook_verify_token ?? null,
    },
    {
      appId: process.env.META_APP_ID ?? null,
      appSecret: process.env.META_APP_SECRET ?? null,
      webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
    },
  )
  cache = { value, expiresAt: now + TTL_MS }
  return value
}
