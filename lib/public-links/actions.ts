'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  publicLinkCreateSchema,
  publicLinkOrderSchema,
  publicLinkPageSchema,
  publicLinkUpdateSchema,
} from './schemas'

export type PublicLinkActionState = { ok: true } | { ok: false; message: string }

async function authorizeOwner(slug: string) {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { tenant, userId: user.id }
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

/**
 * El editor y la página pública. `/l/[slug]` es `force-dynamic`, así que
 * revalidarla es barato y garantiza que el cambio se vea al instante desde el
 * celular sin esperar ningún TTL.
 */
function revalidate(slug: string) {
  revalidatePath(`/${slug}/enlaces`)
  revalidatePath(`/l/${slug}`)
}

function readLinkForm(formData: FormData) {
  return {
    label: formData.get('label'),
    description: formData.get('description'),
    url: formData.get('url'),
    icon: formData.get('icon'),
    // Un checkbox sin tildar no viaja en el FormData: ausencia = false.
    highlight: formData.get('highlight') === 'on' || formData.get('highlight') === 'true',
  }
}

export async function createPublicLink(
  slug: string,
  _prev: PublicLinkActionState,
  formData: FormData,
): Promise<PublicLinkActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = publicLinkCreateSchema.safeParse(readLinkForm(formData))
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Al fondo de la lista: el orden lo decide el dueño arrastrando, no el alta.
  const { data: last } = await supabase
    .from('public_links')
    .select('position')
    .eq('tenant_id', auth.tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('public_links')
    .insert({
      tenant_id: auth.tenant.id,
      ...parsed.data,
      position: ((last?.position as number | undefined) ?? 0) + 1,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[public-links.create]', error.message)
    return { ok: false, message: 'No pudimos crear el link.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'public_link.created',
    entity: 'public_link',
    entityId: data.id,
    payload: { label: parsed.data.label },
  })

  revalidate(slug)
  return { ok: true }
}

export async function updatePublicLink(
  slug: string,
  _prev: PublicLinkActionState,
  formData: FormData,
): Promise<PublicLinkActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = publicLinkUpdateSchema.safeParse({
    ...readLinkForm(formData),
    id: formData.get('id'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const { id, ...fields } = parsed.data
  const supabase = await createClient()
  const { error } = await supabase
    .from('public_links')
    .update(fields)
    .eq('id', id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[public-links.update]', error.message)
    return { ok: false, message: 'No pudimos guardar el link.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'public_link.updated',
    entity: 'public_link',
    entityId: id,
    payload: { label: fields.label },
  })

  revalidate(slug)
  return { ok: true }
}

export async function deletePublicLink(slug: string, id: string): Promise<PublicLinkActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('public_links')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[public-links.delete]', error.message)
    return { ok: false, message: 'No pudimos eliminar el link.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'public_link.deleted',
    entity: 'public_link',
    entityId: id,
    payload: {},
  })

  revalidate(slug)
  return { ok: true }
}

/** Apagar un link sin borrarlo: la promo vuelve el mes que viene. */
export async function togglePublicLink(
  slug: string,
  input: { id: string; active: boolean },
): Promise<PublicLinkActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('public_links')
    .update({ active: input.active })
    .eq('id', input.id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[public-links.toggle]', error.message)
    return { ok: false, message: 'No pudimos cambiar el link.' }
  }

  revalidate(slug)
  return { ok: true }
}

/**
 * Reordenar. Llega la lista completa de ids en el orden nuevo y se guarda la
 * posición de cada uno; es O(n) updates pero n son ~6 botones y así el orden
 * queda consistente aunque dos socios muevan cosas a la vez.
 */
export async function reorderPublicLinks(
  slug: string,
  ids: string[],
): Promise<PublicLinkActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = publicLinkOrderSchema.safeParse({ ids })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Orden inválido' }
  }

  const supabase = await createClient()
  for (const [index, id] of parsed.data.ids.entries()) {
    const { error } = await supabase
      .from('public_links')
      .update({ position: index })
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
    if (error) {
      console.error('[public-links.reorder]', error.message)
      return { ok: false, message: 'No pudimos guardar el orden.' }
    }
  }

  revalidate(slug)
  return { ok: true }
}

export async function savePublicLinkPage(
  slug: string,
  _prev: PublicLinkActionState,
  formData: FormData,
): Promise<PublicLinkActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = publicLinkPageSchema.safeParse({
    headline: formData.get('headline'),
    bio: formData.get('bio'),
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('public_link_pages')
    .upsert({ tenant_id: auth.tenant.id, ...parsed.data }, { onConflict: 'tenant_id' })

  if (error) {
    console.error('[public-links.savePage]', error.message)
    return { ok: false, message: 'No pudimos guardar la página.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'public_link_page.updated',
    entity: 'public_link_page',
    entityId: auth.tenant.id,
    payload: { active: parsed.data.active },
  })

  revalidate(slug)
  return { ok: true }
}
