'use server'

import { revalidatePath } from 'next/cache'
import { encryptToken } from '@/lib/meta/crypto'
import { invalidateMetaConfigCache } from '@/lib/meta/platform-config'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/tenant/current'
import { isPlatformAdmin } from './is-admin'
import { savePlatformMetaConfigSchema } from './meta-config-schema'

export type SavePlatformMetaConfigResult = { ok: true } | { ok: false; error: string }

// Devuelve campos no-secretos + si hay secret. NUNCA el secret en claro.
export async function getPlatformMetaConfigForDisplay(): Promise<{
  appId: string
  webhookVerifyToken: string
  hasSecret: boolean
} | null> {
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

export async function savePlatformMetaConfig(
  input: unknown,
): Promise<SavePlatformMetaConfigResult> {
  if (!(await isPlatformAdmin())) return { ok: false, error: 'No autorizado' }
  const parsed = savePlatformMetaConfigSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const { appId, appSecret, webhookVerifyToken } = parsed.data

  const user = await getCurrentUser()
  const supabase = await createClient()
  const row: Record<string, unknown> = {
    id: true,
    app_id: appId,
    webhook_verify_token: webhookVerifyToken,
    updated_at: new Date().toISOString(),
    updated_by: user?.id ?? null,
  }
  // appSecret vacío = conservar el existente; sólo re-cifra si vino uno nuevo.
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
