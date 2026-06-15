'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
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
import { createTemplateSchema, deleteTemplateSchema } from './template-schemas'
import { createTemplate, deleteTemplate } from './templates'

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

  const parsed = createTemplateSchema.safeParse({
    name: formData.get('name'),
    language: formData.get('language'),
    category: formData.get('category'),
    bodyText: formData.get('bodyText'),
    headerText: formData.get('headerText') || undefined,
    footerText: formData.get('footerText') || undefined,
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

    revalidatePath(`/${slug}/configuracion/templates`)
    return {
      ok: true,
      message: `Plantilla "${parsed.data.name}" creada. Estado: ${result.status}.`,
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
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

    revalidatePath(`/${slug}/configuracion/templates`)
    return { ok: true, message: `Plantilla "${parsed.data.name}" eliminada.` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
