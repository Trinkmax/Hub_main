import { redirect } from 'next/navigation'
import { claimForTenantId } from '@/lib/tenant/claims'
import { getCurrentUser, getMembershipsForUser } from '@/lib/tenant/current'
import { homePathForRole } from '@/lib/tenant/roles'

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

  // Cada rol a su home (staff al salón, contadora a Administración, editor a la
  // carta, anfitrión a reservas; el dueño al panel): un rebote menos en el proxy.
  redirect(homePathForRole(target.role, target.slug))
}
