'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
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
import { createEventSchema, updateEventSchema } from './schemas'

export type EventActionState =
  | { ok: true; message?: string; eventId?: string }
  | { ok: false; message: string }

async function authorizeOwner(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return tenant
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    )
      return null
    throw error
  }
}

export async function createEvent(
  slug: string,
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createEventSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    starts_at: formData.get('starts_at'),
    ends_at: formData.get('ends_at'),
    capacity: formData.get('capacity'),
    waitlist_enabled: formData.get('waitlist_enabled') === 'on',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()

  const { data: created, error } = await supabase
    .from('events')
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      description: parsed.data.description,
      starts_at: new Date(parsed.data.starts_at).toISOString(),
      ends_at: new Date(parsed.data.ends_at).toISOString(),
      capacity: parsed.data.capacity,
      waitlist_enabled: parsed.data.waitlist_enabled,
      created_by: user.user?.id ?? null,
    })
    .select('id')
    .single()
  if (error || !created) return { ok: false, message: 'No pudimos crear el evento.' }

  // Procesar imagen de portada si vino.
  const cover = formData.get('cover_image')
  if (cover instanceof File && cover.size > 0) {
    const url = await uploadEventCover({
      tenantId: tenant.id,
      eventId: created.id,
      file: cover,
    })
    if (url) {
      await supabase.from('events').update({ cover_image_url: url }).eq('id', created.id)
    }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: user.user?.id ?? null,
    action: 'event.created',
    entity: 'event',
    entityId: created.id,
    payload: { name: parsed.data.name },
  })

  revalidatePath(`/${slug}/eventos`)
  return { ok: true, message: 'Evento creado.', eventId: created.id }
}

export async function updateEvent(slug: string, formData: FormData): Promise<EventActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateEventSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    description: formData.get('description'),
    starts_at: formData.get('starts_at'),
    ends_at: formData.get('ends_at'),
    capacity: formData.get('capacity'),
    waitlist_enabled: formData.get('waitlist_enabled') === 'on',
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('events')
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      starts_at: new Date(parsed.data.starts_at).toISOString(),
      ends_at: new Date(parsed.data.ends_at).toISOString(),
      capacity: parsed.data.capacity,
      waitlist_enabled: parsed.data.waitlist_enabled,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${slug}/eventos`)
  revalidatePath(`/${slug}/eventos/${parsed.data.id}`)
  return { ok: true }
}

export async function publishEvent(slug: string, eventId: string): Promise<EventActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(eventId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('events')
    .update({ status: 'published' })
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
    .eq('status', 'draft')
  if (error) return { ok: false, message: 'No pudimos publicar.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'event.published',
    entity: 'event',
    entityId: idParsed.data,
  })

  revalidatePath(`/${slug}/eventos`)
  revalidatePath(`/${slug}/eventos/${idParsed.data}`)
  return { ok: true, message: 'Evento publicado.' }
}

export async function finishEvent(slug: string, eventId: string): Promise<EventActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(eventId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('events')
    .update({ status: 'finished' })
    .eq('id', idParsed.data)
    .eq('tenant_id', tenant.id)
  if (error) return { ok: false, message: 'No pudimos finalizar.' }

  revalidatePath(`/${slug}/eventos`)
  revalidatePath(`/${slug}/eventos/${idParsed.data}`)
  return { ok: true, message: 'Evento finalizado.' }
}

export async function cancelEvent(slug: string, eventId: string): Promise<EventActionState> {
  const tenant = await authorizeOwner(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const idParsed = z.string().uuid().safeParse(eventId)
  if (!idParsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_event', { p_event_id: idParsed.data })
  if (error) return { ok: false, message: 'No pudimos cancelar.' }

  await logAudit({
    tenantId: tenant.id,
    userId: null,
    action: 'event.cancelled',
    entity: 'event',
    entityId: idParsed.data,
  })

  revalidatePath(`/${slug}/eventos`)
  revalidatePath(`/${slug}/eventos/${idParsed.data}`)
  return { ok: true, message: 'Evento cancelado.' }
}

async function uploadEventCover(opts: {
  tenantId: string
  eventId: string
  file: File
}): Promise<string | null> {
  const ext = (opts.file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(ext) ? ext : 'jpg'
  const path = `${opts.tenantId}/${opts.eventId}/cover.${safeExt}`
  const arrayBuffer = await opts.file.arrayBuffer()
  const service = createServiceClient()
  const { error } = await service.storage.from('event-covers').upload(path, arrayBuffer, {
    contentType: opts.file.type,
    upsert: true,
  })
  if (error) {
    console.error('[event_cover] upload failed:', error.message)
    return null
  }
  const { data } = service.storage.from('event-covers').getPublicUrl(path)
  return data.publicUrl
}
