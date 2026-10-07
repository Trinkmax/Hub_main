import { redirect } from 'next/navigation'
import { claimForTenantId } from '@/lib/tenant/claims'
import { getCurrentUser, getMembershipsForUser } from '@/lib/tenant/current'
import type { TenantRole } from '@/lib/tenant/types'

const STAFF_ROLES = new Set<TenantRole>(['cashier', 'waiter', 'kitchen'])

/**
 * `/` sólo decide a qué bar mandar al usuario. Todo sale del JWT (verificado
 * localmente): memberships + bar activo vienen en `app_metadata`. La query a
 * memberships queda como fallback para tokens emitidos antes del hook.
 */
export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  let tenants = user.tenants
  if (tenants === null) {
    tenants = (await getMembershipsForUser()).map((m) => ({
      id: m.tenant.id,
      slug: m.tenant.slug,
      role: m.role,
    }))
  }
  if (tenants.length === 0) redirect('/onboarding')

  const active = user.activeTenantId ? claimForTenantId(tenants, user.activeTenantId) : null
  const target = active ?? tenants[0]
  if (!target) redirect('/onboarding')

  // Mandar staff directo al salón. Owner queda en el manager.
  const dest = STAFF_ROLES.has(target.role) ? `/${target.slug}/salon` : `/${target.slug}`
  redirect(dest)
}
