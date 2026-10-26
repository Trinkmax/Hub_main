import 'server-only'
import { getCurrentUser, getMembershipsForUser } from '@/lib/tenant/current'

/**
 * ¿Quien mira las páginas públicas es dueño de este bar? Solo decide la VISTA
 * PREVIA (ver también lo no publicado): no da acceso a nada más. Sale del JWT
 * verificado localmente; con un token viejo sin claims, de la base.
 */
export async function viewerOwnsTenant(tenantSlug: string): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  if (user.tenants) return user.tenants.some((t) => t.slug === tenantSlug && t.role === 'owner')
  const memberships = await getMembershipsForUser()
  return memberships.some((m) => m.tenant.slug === tenantSlug && m.role === 'owner')
}
