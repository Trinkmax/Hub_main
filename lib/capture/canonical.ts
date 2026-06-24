import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { deriveCaptureLinkSlug } from './slug'

/**
 * Slug del link de captura canónico de un tenant (el contexto de tenant que usa
 * la RPC `submit_capture` cuando el formulario del club se envía desde la carta).
 * Modelo "una carta, un club": a lo sumo un link por tenant.
 */
export async function getCanonicalCaptureLink(tenantId: string): Promise<string | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('customer_capture_links')
    .select('slug')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.slug ?? null
}

/**
 * Como `getCanonicalCaptureLink`, pero crea el link si no existe. Idempotente.
 * Sólo para contextos autenticados (la página de captura del dueño) — no para el
 * render público de la carta (evita escrituras en un GET anónimo).
 */
export async function getOrCreateCanonicalCaptureLink(opts: {
  tenantId: string
  tenantSlug: string
}): Promise<string | null> {
  const existing = await getCanonicalCaptureLink(opts.tenantId)
  if (existing) return existing

  const service = createServiceClient()
  const { data: created, error } = await service
    .from('customer_capture_links')
    .insert({
      tenant_id: opts.tenantId,
      slug: deriveCaptureLinkSlug(opts.tenantId, opts.tenantSlug),
      label: 'Club de beneficios',
    })
    .select('slug')
    .single()

  if (error) {
    // Race o colisión de slug: re-leer. Si igual no hay link, logueamos (sin PII)
    // para que un mismatch de constraint no quede silencioso.
    const fallback = await getCanonicalCaptureLink(opts.tenantId)
    if (!fallback) {
      console.error('[capture] getOrCreateCanonicalCaptureLink insert failed', {
        tenantId: opts.tenantId,
        error: error.message,
      })
    }
    return fallback
  }
  return created.slug
}
