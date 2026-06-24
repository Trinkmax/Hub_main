/**
 * Deriva un slug válido para `customer_capture_links` a partir del slug del tenant.
 *
 * Los namespaces de slug son incompatibles:
 *  - tenants.slug:                `^[a-z0-9-]{2,40}$`
 *  - customer_capture_links.slug: `^[a-zA-Z0-9_-]{4,32}$` (único global)
 *
 * El prefijo `club-` garantiza charset y largo mínimo; para slugs largos se recorta
 * y se agrega un sufijo determinístico del tenant id para no colisionar. Resultado
 * siempre en `^[a-zA-Z0-9_-]{4,32}$`.
 */
export function deriveCaptureLinkSlug(tenantId: string, tenantSlug: string): string {
  const base = `club-${tenantSlug}`.replace(/[^a-zA-Z0-9_-]/g, '')
  if (base.length >= 4 && base.length <= 32) return base
  const suffix = tenantId.replace(/-/g, '').slice(0, 6) || '000000'
  return `${base.slice(0, 25)}-${suffix}`
}
