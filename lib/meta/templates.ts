import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json, TemplateStatus } from '@/types/database'
import { decryptToken } from './crypto'
import { graphUrl } from './env'
import { metaFetch } from './http'
import { buildTemplateComponents, type TemplateButtonInput } from './template-components'
import type { CreateTemplateInput } from './template-schemas'

type ChannelRow = Database['public']['Tables']['channels']['Row']

type MetaTemplateStatus =
  | 'APPROVED'
  | 'IN_APPEAL'
  | 'PENDING'
  | 'REJECTED'
  | 'PENDING_DELETION'
  | 'DELETED'
  | 'DISABLED'
  | 'PAUSED'
  | 'LIMIT_EXCEEDED'

type MetaTemplate = {
  id: string
  name: string
  language: string
  category: string
  status: MetaTemplateStatus
  components?: unknown
}

type ListResponse = {
  data?: MetaTemplate[]
  paging?: { next?: string }
}

function mapStatus(s: MetaTemplateStatus): TemplateStatus {
  switch (s) {
    case 'APPROVED':
      return 'approved'
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending'
    case 'REJECTED':
      return 'rejected'
    case 'DISABLED':
    case 'PAUSED':
    case 'LIMIT_EXCEEDED':
    case 'PENDING_DELETION':
    case 'DELETED':
      return 'disabled'
    default:
      return 'pending'
  }
}

export async function syncTemplates(channel: ChannelRow): Promise<{ synced: number }> {
  if (channel.type !== 'whatsapp') return { synced: 0 }
  if (!channel.encrypted_access_token) {
    throw new Error('Channel has no token; reconnect required')
  }

  const accessToken = await decryptToken(channel.encrypted_access_token)
  const service = createServiceClient()
  const now = new Date().toISOString()

  let next: string | null = graphUrl(
    `${channel.external_account_id}/message_templates?fields=id,name,language,category,status,components&limit=200`,
  )
  let synced = 0

  while (next) {
    const res: ListResponse = await metaFetch<ListResponse>(next, { accessToken })
    const items = res.data ?? []
    for (const t of items) {
      const { error } = await service.from('message_templates').upsert(
        {
          tenant_id: channel.tenant_id,
          channel_id: channel.id,
          meta_template_id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          components: (t.components ?? []) as Json,
          status: mapStatus(t.status),
          last_synced_at: now,
        },
        { onConflict: 'channel_id,name,language' },
      )
      if (error) throw new Error(`Template upsert failed: ${error.message}`)
      synced += 1
    }
    next = res.paging?.next ?? null
  }

  return { synced }
}

type CreateTemplateResponse = {
  id?: string
  status?: string
  // Meta may return error fields for non-2xx; those are handled by metaFetch throw
}

export async function createTemplate(
  channel: ChannelRow,
  input: CreateTemplateInput,
): Promise<{ meta_template_id: string; status: string }> {
  if (channel.type !== 'whatsapp') throw new Error('Solo canales WhatsApp admiten templates.')
  if (!channel.encrypted_access_token) throw new Error('Canal sin token; reconectá el canal.')

  const accessToken = await decryptToken(channel.encrypted_access_token)

  // Armar botones: enlace (opcional) + baja/opt-out (recomendado en marketing).
  const buttons: TemplateButtonInput[] = []
  if (input.urlButtonText && input.urlButtonUrl) {
    buttons.push({ type: 'url', text: input.urlButtonText, url: input.urlButtonUrl })
  }
  if (input.optOut) {
    buttons.push({ type: 'quick_reply', text: input.optOutLabel })
  }

  const { components, parameterFormat } = buildTemplateComponents({
    bodyText: input.bodyText,
    bodyExamples: input.bodyExamples,
    headerText: input.headerText,
    headerExample: input.headerExample,
    footerText: input.footerText,
    buttons,
  })

  const payload: Record<string, unknown> = {
    name: input.name,
    language: input.language,
    category: input.category,
    components,
  }
  if (parameterFormat) payload.parameter_format = parameterFormat

  const res = await metaFetch<CreateTemplateResponse>(
    graphUrl(`${channel.external_account_id}/message_templates`),
    { method: 'POST', accessToken, body: payload },
  )

  const metaTemplateId = res.id ?? ''
  const metaStatus = res.status ?? 'PENDING'

  // Upsert into local DB so the template shows immediately as pending
  const service = createServiceClient()
  const now = new Date().toISOString()

  const { error } = await service.from('message_templates').upsert(
    {
      tenant_id: channel.tenant_id,
      channel_id: channel.id,
      meta_template_id: metaTemplateId,
      name: input.name,
      language: input.language,
      category: input.category,
      components: components as unknown as Json,
      // Qué dato del cliente va en cada {{n}}: lo elige el editor con botones
      // y lo lee la difusión para precargar la personalización.
      variable_hints: (input.variableHints ?? {}) as unknown as Json,
      status: mapStatus(metaStatus as MetaTemplateStatus),
      last_synced_at: now,
    },
    { onConflict: 'channel_id,name,language' },
  )
  if (error) throw new Error(`Local upsert failed: ${error.message}`)

  return { meta_template_id: metaTemplateId, status: metaStatus }
}

/**
 * Componentes de una plantilla AUTHENTICATION tal como los pide Meta: el
 * cuerpo lo escribe Meta en el idioma elegido, con la recomendación de no
 * compartir el código, un pie con la expiración y el botón "Copiar código".
 * Vive aparte para que la action del club y el test la lean igual.
 */
export function buildOtpTemplateComponents(opts: {
  codeExpirationMinutes: number
  buttonText: string
}): Record<string, unknown>[] {
  return [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: opts.codeExpirationMinutes },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: opts.buttonText }],
    },
  ]
}

/**
 * Crea (o intenta crear) la plantilla de código de un solo uso del club.
 *
 * Es la única categoría con la que Meta acepta mandar códigos fuera de la
 * ventana de 24 h: una UTILITY con "tu código es {{2}}" la rechaza o la
 * recategoriza. Suele aprobarse en segundos. El upsert local la deja
 * `pending` hasta el próximo sync (o `approved` si Meta ya la devolvió así).
 */
export async function createOtpTemplate(
  channel: ChannelRow,
  input: { name: string; language: string; codeExpirationMinutes?: number; buttonText?: string },
): Promise<{ meta_template_id: string; status: string }> {
  if (channel.type !== 'whatsapp') throw new Error('Solo canales WhatsApp admiten templates.')
  if (!channel.encrypted_access_token) throw new Error('Canal sin token; reconectá el canal.')

  const accessToken = await decryptToken(channel.encrypted_access_token)
  const components = buildOtpTemplateComponents({
    codeExpirationMinutes: input.codeExpirationMinutes ?? 10,
    buttonText: input.buttonText ?? 'Copiar código',
  })

  const res = await metaFetch<CreateTemplateResponse>(
    graphUrl(`${channel.external_account_id}/message_templates`),
    {
      method: 'POST',
      accessToken,
      body: {
        name: input.name,
        language: input.language,
        category: 'AUTHENTICATION',
        // Un código que llega tarde no sirve: si Meta no lo entrega en 10
        // minutos, que lo descarte en vez de despertar al socio a las 3 AM.
        message_send_ttl_seconds: (input.codeExpirationMinutes ?? 10) * 60,
        components,
      },
    },
  )

  const metaTemplateId = res.id ?? ''
  const metaStatus = res.status ?? 'PENDING'
  const service = createServiceClient()
  const { error } = await service.from('message_templates').upsert(
    {
      tenant_id: channel.tenant_id,
      channel_id: channel.id,
      meta_template_id: metaTemplateId,
      name: input.name,
      language: input.language,
      category: 'AUTHENTICATION',
      components: components as unknown as Json,
      variable_hints: {} as unknown as Json,
      status: mapStatus(metaStatus as MetaTemplateStatus),
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'channel_id,name,language' },
  )
  if (error) throw new Error(`Local upsert failed: ${error.message}`)

  return { meta_template_id: metaTemplateId, status: metaStatus }
}

export async function deleteTemplate(channel: ChannelRow, name: string): Promise<void> {
  if (channel.type !== 'whatsapp') throw new Error('Solo canales WhatsApp admiten templates.')
  if (!channel.encrypted_access_token) throw new Error('Canal sin token; reconectá el canal.')

  const accessToken = await decryptToken(channel.encrypted_access_token)

  // La plantilla puede no existir en Meta (creada sólo localmente, seed, o ya
  // borrada). No bloqueamos el borrado local por un fallo de Meta.
  try {
    await metaFetch<unknown>(
      graphUrl(`${channel.external_account_id}/message_templates?name=${encodeURIComponent(name)}`),
      { method: 'DELETE', accessToken },
    )
  } catch (e) {
    console.warn(
      '[templates.delete] Meta delete falló; se borra local igual:',
      (e as Error).message,
    )
  }

  // Remove local rows for this channel+name (all languages)
  const service = createServiceClient()
  const { error } = await service
    .from('message_templates')
    .delete()
    .eq('channel_id', channel.id)
    .eq('name', name)
  if (error) throw new Error(`Local delete failed: ${error.message}`)
}
