import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { getMetaConfig } from './env'

// Cifrado/descifrado vía RPC de Postgres (pgp_sym_encrypt). La clave nunca sale
// del entorno servidor; se pasa a la RPC como argumento.
export async function encryptToken(plaintext: string): Promise<string> {
  const { tokenKey } = getMetaConfig()
  const service = createServiceClient()
  const { data, error } = await service.rpc('encrypt_meta_token', {
    plaintext,
    key: tokenKey,
  })
  if (error || !data) {
    throw new Error(`encryptToken failed: ${error?.message ?? 'no data'}`)
  }
  return data
}

export async function decryptToken(ciphertext: string): Promise<string> {
  const { tokenKey } = getMetaConfig()
  const service = createServiceClient()
  const { data, error } = await service.rpc('decrypt_meta_token', {
    ciphertext,
    key: tokenKey,
  })
  if (error || !data) {
    throw new Error(`decryptToken failed: ${error?.message ?? 'no data'}`)
  }
  return data
}
