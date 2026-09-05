/**
 * Crea en la cuenta de Meta de un bar la plantilla del código de recuperación
 * del club (categoría AUTHENTICATION) y la deja registrada en message_templates.
 *
 *   npx tsx scripts/create-club-otp-template.ts <tenant-slug> [--name hub_codigo_recuperacion] [--lang es_AR]
 *
 * Es lo mismo que hace sola la action de recuperación cuando no encuentra la
 * plantilla (lib/club-auth/actions.ts#ensureOtpTemplate), pero a mano y con
 * salida legible, para dejarla creada ANTES de que un socio la necesite: si no,
 * el primer código después de la ventana de 24 h se pierde mientras Meta la
 * aprueba.
 *
 * Script admin: usa SUPABASE_SERVICE_ROLE_KEY de .env/.env.local para leer el
 * canal del tenant y descifrar su token (cross-tenant justificado: se pasa el
 * slug a mano y se toca un solo tenant, CLAUDE.md §4).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        out[key] = value
      }
    } catch {
      // archivo opcional
    }
  }
  return { ...out, ...(process.env as Record<string, string>) }
}

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback
}

async function main() {
  const slug = process.argv[2]
  if (!slug || slug.startsWith('--')) {
    console.error(
      'Uso: npx tsx scripts/create-club-otp-template.ts <tenant-slug> [--name X] [--lang es_AR]',
    )
    process.exit(1)
  }
  const name = arg('name', 'hub_codigo_recuperacion')
  const language = arg('lang', 'es_AR')
  const minutes = 10

  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  const tokenKey = env.META_TOKEN_KEY
  const graphVersion = env.META_GRAPH_VERSION || 'v23.0'
  if (!url || !key || !tokenKey) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o META_TOKEN_KEY.')
    process.exit(1)
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle()
  if (!tenant) {
    console.error(`No existe el tenant "${slug}".`)
    process.exit(1)
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id, external_account_id, encrypted_access_token, status')
    .eq('tenant_id', tenant.id)
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
    .maybeSingle()
  if (!channel?.encrypted_access_token) {
    console.error(`"${tenant.name}" no tiene un canal de WhatsApp conectado.`)
    process.exit(1)
  }

  const { data: accessToken, error: decryptError } = await supabase.rpc('decrypt_meta_token', {
    ciphertext: channel.encrypted_access_token,
    key: tokenKey,
  })
  if (decryptError || !accessToken) {
    console.error('No se pudo descifrar el token del canal:', decryptError?.message)
    process.exit(1)
  }

  const components = [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: minutes },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }] },
  ]

  console.log(`Creando "${name}" (${language}, AUTHENTICATION) en la cuenta de ${tenant.name}…`)
  const res = await fetch(
    `https://graph.facebook.com/${graphVersion}/${channel.external_account_id}/message_templates`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        language,
        category: 'AUTHENTICATION',
        message_send_ttl_seconds: minutes * 60,
        components,
      }),
    },
  )
  const json = (await res.json()) as {
    id?: string
    status?: string
    category?: string
    error?: { message?: string; error_user_msg?: string; code?: number }
  }
  if (!res.ok) {
    console.error(
      'Meta rechazó la creación:',
      json.error?.error_user_msg ?? json.error?.message ?? json,
    )
    process.exit(1)
  }

  const status = (json.status ?? 'PENDING').toUpperCase()
  const local = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'pending'
  const { error: upsertError } = await supabase.from('message_templates').upsert(
    {
      tenant_id: tenant.id,
      channel_id: channel.id,
      meta_template_id: json.id ?? '',
      name,
      language,
      category: json.category ?? 'AUTHENTICATION',
      components,
      variable_hints: {},
      status: local,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'channel_id,name,language' },
  )
  if (upsertError) {
    console.error('Meta la creó pero no se pudo registrar localmente:', upsertError.message)
    process.exit(1)
  }

  console.log(`Listo: id ${json.id}, estado en Meta ${status} (local: ${local}).`)
  if (local !== 'approved') {
    console.log(
      'Cuando Meta la apruebe, el próximo sync de plantillas (cron sync-templates o Configuración → Mensajería) la deja en "approved". La action de recuperación también re-sincroniza sola antes de mandar.',
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
