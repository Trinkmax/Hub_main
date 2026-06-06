'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { getRequestIp, getRequestUserAgent } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { captureSubmitSchema } from './schemas'

export type CaptureActionState = { ok: true; was_new: boolean } | { ok: false; message: string }

/**
 * Acción pública sin autenticación: la consume el form de `/capture/[slug]`.
 * Usa `createClient` de browser (anon) en server context — el cliente anon
 * es seguro acá porque la única vía de escritura es la RPC `submit_capture`
 * (SECURITY DEFINER) y la lectura del link valida `active = true` por RLS.
 */
export async function submitCapture(formData: FormData): Promise<CaptureActionState> {
  const ip = await getRequestIp()
  const userAgent = await getRequestUserAgent()

  try {
    rateLimit({ key: `capture:${ip}`, limit: 10, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = captureSubmitSchema.safeParse({
    link_slug: formData.get('link_slug'),
    phone: formData.get('phone'),
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    opt_in_marketing: formData.get('opt_in_marketing') === 'on',
    website: formData.get('website') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_capture', {
    p_link_slug: parsed.data.link_slug,
    p_phone: parsed.data.phone,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_opt_in: parsed.data.opt_in_marketing,
    p_ip: ip,
    p_user_agent: userAgent ?? '',
  })

  if (error) {
    console.error('[capture] submit_capture failed', error.message)
    return { ok: false, message: 'No pudimos guardar tus datos. Probá de nuevo.' }
  }

  const result = Array.isArray(data) ? data[0] : data
  return { ok: true, was_new: Boolean(result?.was_new) }
}

// ──────────────────────────────────────────────────────────
// ABM de capture links (autenticado, owner)
// ──────────────────────────────────────────────────────────

const slugSchema = z
  .string()
  .trim()
  .min(4, 'Mínimo 4 caracteres')
  .max(32, 'Máximo 32 caracteres')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Sólo letras, números, `-` y `_`')

const createLinkSchema = z.object({
  slug: slugSchema,
  label: z.string().trim().min(1, 'Etiqueta requerida').max(60),
})

const idSchema = z.object({ id: z.string().uuid() })
const toggleSchema = idSchema.extend({ active: z.coerce.boolean() })

export type LinkActionState = { ok: true; message?: string } | { ok: false; message: string }

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
    ) {
      return null
    }
    throw error
  }
}

export async function createCaptureLink(
  tenantSlug: string,
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const tenant = await authorizeOwner(tenantSlug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createLinkSchema.safeParse({
    slug: formData.get('slug'),
    label: formData.get('label'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()

  const { error } = await supabase.from('customer_capture_links').insert({
    tenant_id: tenant.id,
    slug: parsed.data.slug,
    label: parsed.data.label,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ese slug ya está usado.' }
    }
    return { ok: false, message: 'No pudimos crear el link.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: user.user?.id ?? null,
    action: 'capture_link.created',
    entity: 'capture_link',
    payload: { slug: parsed.data.slug, label: parsed.data.label },
  })

  revalidatePath(`/${tenantSlug}/local/captura`)
  return { ok: true, message: 'Link creado.' }
}

export async function toggleCaptureLink(
  tenantSlug: string,
  linkId: string,
  active: boolean,
): Promise<LinkActionState> {
  const tenant = await authorizeOwner(tenantSlug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = toggleSchema.safeParse({ id: linkId, active })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_capture_links')
    .update({ active: parsed.data.active })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) return { ok: false, message: 'No pudimos actualizar.' }

  revalidatePath(`/${tenantSlug}/local/captura`)
  return { ok: true }
}

export async function deleteCaptureLink(
  tenantSlug: string,
  linkId: string,
): Promise<LinkActionState> {
  const tenant = await authorizeOwner(tenantSlug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = idSchema.safeParse({ id: linkId })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_capture_links')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) return { ok: false, message: 'No pudimos borrar.' }

  revalidatePath(`/${tenantSlug}/local/captura`)
  return { ok: true }
}
