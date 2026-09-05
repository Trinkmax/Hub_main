'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import {
  CLUB_OTP_TEMPLATE_FALLBACK_LANGUAGE,
  getClubOtpTemplateName,
} from '@/lib/club-auth/message'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { MetaActionState } from './actions'
import { humanizeTemplateError } from './errors'
import { createTemplateSchema, deleteTemplateSchema } from './template-schemas'
import { isHiddenTemplate } from './template-visibility'
import { createOtpTemplate, createTemplate, deleteTemplate } from './templates'

async function authorizeOwner(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    return access
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

async function resolveWhatsAppChannel(tenantId: string) {
  const service = createServiceClient()
  const { data: channel, error } = await service
    .from('channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (error || !channel) return null
  return channel
}

export async function createTemplateAction(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  let bodyExamples: unknown = []
  try {
    bodyExamples = JSON.parse((formData.get('bodyExamples') as string) || '[]')
  } catch {
    bodyExamples = []
  }

  let variableHints: unknown = {}
  try {
    variableHints = JSON.parse((formData.get('variableHints') as string) || '{}')
  } catch {
    variableHints = {}
  }

  const parsed = createTemplateSchema.safeParse({
    name: formData.get('name'),
    language: formData.get('language'),
    category: formData.get('category'),
    bodyText: formData.get('bodyText'),
    bodyExamples,
    variableHints,
    headerText: formData.get('headerText') || undefined,
    headerExample: formData.get('headerExample') || undefined,
    footerText: formData.get('footerText') || undefined,
    optOut: formData.get('optOut') === 'true',
    optOutLabel: formData.get('optOutLabel') || undefined,
    urlButtonText: formData.get('urlButtonText') || undefined,
    urlButtonUrl: formData.get('urlButtonUrl') || undefined,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, message: first?.message ?? 'Datos inválidos.' }
  }

  const channel = await resolveWhatsAppChannel(access.tenant.id)
  if (!channel) return { ok: false, message: 'Canal WhatsApp no encontrado.' }

  try {
    const result = await createTemplate(channel, parsed.data)

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await logAudit({
      tenantId: access.tenant.id,
      userId: user?.id ?? null,
      action: 'template_created',
      entity: 'message_templates',
      entityId: result.meta_template_id || null,
      payload: {
        name: parsed.data.name,
        category: parsed.data.category,
        language: parsed.data.language,
        status: result.status,
      },
    })

    revalidatePath(`/${slug}/mensajeria/plantillas`)
    return {
      ok: true,
      message: `Plantilla "${parsed.data.name}" creada. Estado: ${result.status}.`,
    }
  } catch (e) {
    // Loguear el error crudo (sin PII: son textos de plantilla y códigos Meta)
    // para poder diagnosticar; al dueño le mostramos la versión en criollo.
    console.error('[templates.create] Meta rechazó la plantilla', {
      name: parsed.data.name,
      error: (e as Error).message,
    })
    return { ok: false, message: humanizeTemplateError(e) }
  }
}

export async function deleteTemplateAction(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  const parsed = deleteTemplateSchema.safeParse({
    name: formData.get('name'),
    channel_id: formData.get('channel_id'),
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, message: first?.message ?? 'Datos inválidos.' }
  }

  // Verify channel belongs to this tenant
  const service = createServiceClient()
  const { data: channel, error: channelErr } = await service
    .from('channels')
    .select('*')
    .eq('id', parsed.data.channel_id)
    .eq('tenant_id', access.tenant.id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (channelErr || !channel) return { ok: false, message: 'Canal WhatsApp no encontrado.' }

  try {
    await deleteTemplate(channel, parsed.data.name)

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await logAudit({
      tenantId: access.tenant.id,
      userId: user?.id ?? null,
      action: 'template_deleted',
      entity: 'message_templates',
      payload: { name: parsed.data.name, channel_id: parsed.data.channel_id },
    })

    revalidatePath(`/${slug}/mensajeria/plantillas`)
    return { ok: true, message: `Plantilla "${parsed.data.name}" eliminada.` }
  } catch (e) {
    console.error('[templates.delete] falló', {
      name: parsed.data.name,
      error: (e as Error).message,
    })
    return { ok: false, message: humanizeTemplateError(e) }
  }
}

/**
 * Crea la plantilla del código de recuperación del club (AUTHENTICATION) en
 * la cuenta de Meta del bar. Es la que manda el "Recuperá tu acceso" de la
 * carta cuando el socio está fuera de la ventana de 24 h: sin ella, el código
 * no llega. Idempotente en la práctica: si ya existe, Meta lo dice y se
 * muestra tal cual.
 */
export async function createClubOtpTemplateAction(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  const channelId = formData.get('channel_id')
  if (typeof channelId !== 'string') return { ok: false, message: 'channel_id requerido.' }

  const service = createServiceClient()
  const { data: channel, error } = await service
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .eq('tenant_id', access.tenant.id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (error || !channel) return { ok: false, message: 'Canal WhatsApp no encontrado.' }

  const name = getClubOtpTemplateName()
  try {
    const { status } = await createOtpTemplate(channel, {
      name,
      language: CLUB_OTP_TEMPLATE_FALLBACK_LANGUAGE,
      codeExpirationMinutes: 10,
    })

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await logAudit({
      tenantId: access.tenant.id,
      userId: user?.id ?? null,
      action: 'template_created',
      entity: 'message_templates',
      payload: { name, category: 'AUTHENTICATION', channel_id: channelId, meta_status: status },
    })

    revalidatePath(`/${slug}/mensajeria/plantillas`)
    return {
      ok: true,
      message:
        status.toUpperCase() === 'APPROVED'
          ? `Plantilla "${name}" creada y aprobada: el código ya llega fuera de la ventana de 24 h.`
          : `Plantilla "${name}" enviada a WhatsApp (estado: ${status.toLowerCase()}). Suele aprobarse en minutos; tocá "Traer las novedades" para ver el estado.`,
    }
  } catch (e) {
    console.error('[templates.create-otp] Meta rechazó la plantilla', {
      name,
      error: (e as Error).message,
    })
    return { ok: false, message: humanizeTemplateError(e) }
  }
}

/**
 * Borra todas las plantillas del canal que NO están en español: las de muestra
 * de Meta ("hello_world", "jaspers_market_…"), que ensucian la lista. Va nombre
 * por nombre y no aborta si una falla: devuelve cuántas salieron y cuáles no.
 */
export async function deleteForeignTemplatesAction(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  const channelId = formData.get('channel_id')
  if (typeof channelId !== 'string') return { ok: false, message: 'channel_id requerido.' }

  const service = createServiceClient()
  const { data: channel, error } = await service
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .eq('tenant_id', access.tenant.id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (error || !channel) return { ok: false, message: 'Canal WhatsApp no encontrado.' }

  const { data: rows } = await service
    .from('message_templates')
    .select('name, language')
    .eq('channel_id', channel.id)
  // Meta borra por NOMBRE (todos los idiomas): sólo se tocan los nombres que no
  // tienen ninguna versión en español, para no llevarse una plantilla del bar.
  const byName = new Map<string, string[]>()
  for (const r of rows ?? []) byName.set(r.name, [...(byName.get(r.name) ?? []), r.language])
  const names = Array.from(byName.entries())
    .filter(([name, langs]) => langs.every((language) => isHiddenTemplate({ name, language })))
    .map(([name]) => name)
  if (names.length === 0) return { ok: true, message: 'No había plantillas en inglés.' }

  const failed: string[] = []
  for (const name of names) {
    try {
      await deleteTemplate(channel, name)
    } catch (e) {
      console.error('[templates.delete-foreign] falló', { name, error: (e as Error).message })
      failed.push(name)
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: user?.id ?? null,
    action: 'templates_foreign_deleted',
    entity: 'message_templates',
    payload: { channel_id: channelId, deleted: names.filter((n) => !failed.includes(n)), failed },
  })

  revalidatePath(`/${slug}/mensajeria/plantillas`)
  const deleted = names.length - failed.length
  if (failed.length > 0) {
    return {
      ok: false,
      message: `Se borraron ${deleted}; no se pudieron borrar: ${failed.join(', ')}.`,
    }
  }
  return { ok: true, message: `Listo: ${deleted} plantillas en inglés borradas.` }
}
