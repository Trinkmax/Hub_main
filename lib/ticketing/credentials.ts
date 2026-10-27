import 'server-only'
import { decryptToken } from '@/lib/meta/crypto'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * La cuenta de Mercado Pago de un bar, descifrada. Solo para el server: el
 * token NUNCA viaja al navegador ni se loguea. El cifrado es el mismo
 * pgp_sym_encrypt de los tokens de Meta (clave en META_TOKEN_KEY).
 */

export type MercadoPagoCredentials = {
  accessToken: string
  webhookSecret: string | null
  live: boolean
  userId: number | null
}

type Row = {
  mp_access_token_enc: string | null
  mp_webhook_secret_enc: string | null
  mp_live: boolean | null
  mp_user_id: number | null
}

export async function getMercadoPagoCredentials(
  tenantId: string,
): Promise<MercadoPagoCredentials | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ticketing_settings')
    .select('mp_access_token_enc, mp_webhook_secret_enc, mp_live, mp_user_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.credentials]', { tenantId, code: error.code })
    throw new Error('No pudimos leer la cuenta de Mercado Pago.')
  }
  const row = data as Row | null
  if (!row?.mp_access_token_enc) return null

  const [accessToken, webhookSecret] = await Promise.all([
    decryptToken(row.mp_access_token_enc),
    row.mp_webhook_secret_enc ? decryptToken(row.mp_webhook_secret_enc) : Promise.resolve(null),
  ])
  return {
    accessToken,
    webhookSecret,
    live: row.mp_live ?? true,
    userId: row.mp_user_id,
  }
}
