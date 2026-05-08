import 'server-only'
import { Resend } from 'resend'

let cachedClient: Resend | null = null

function getClient(): Resend | null {
  if (cachedClient) return cachedClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  cachedClient = new Resend(apiKey)
  return cachedClient
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  /** Override del FROM por email — útil para tests; default usa EMAIL_FROM. */
  from?: string
  /** Tag opcional para Resend analytics. */
  tag?: string
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; reason: 'no_provider' | 'no_from' | 'send_failed' }

/**
 * Manda un email vía Resend. Si RESEND_API_KEY no está configurada, retorna
 * { ok: false, reason: 'no_provider' } sin tirar — el caller decide qué hacer
 * (típicamente: mostrar el link manual al owner).
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getClient()
  if (!client) {
    console.warn('[email] RESEND_API_KEY no configurada — email skipped')
    return { ok: false, error: 'no_provider', reason: 'no_provider' }
  }

  const from = input.from ?? process.env.EMAIL_FROM
  if (!from) {
    console.warn('[email] EMAIL_FROM no configurado — email skipped')
    return { ok: false, error: 'no_from', reason: 'no_from' }
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tag ? [{ name: 'kind', value: input.tag }] : undefined,
    })
    if (error || !data) {
      console.error('[email] resend error:', error?.message ?? 'unknown')
      return { ok: false, error: error?.message ?? 'unknown', reason: 'send_failed' }
    }
    return { ok: true, id: data.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[email] send threw:', msg)
    return { ok: false, error: msg, reason: 'send_failed' }
  }
}
