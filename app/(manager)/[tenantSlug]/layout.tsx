import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/app-shell'
import { ClaimsRefresher } from '@/components/shell/claims-refresher'
import { RefreshOnReturn } from '@/components/shell/refresh-on-return'
import {
  canAccessManagerPath,
  getMembershipsForUser,
  homePathForRole,
  MANAGER_SCOPED_PREFIXES,
  requireTenantAccess,
  SALON_ROLES,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { roleForSlug } from '@/lib/tenant/claims'
import { PATH_HEADER } from '@/lib/workspace'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    // reason=session: le dice al proxy que NO rebote de vuelta a home si todavía
    // ve una cookie válida (PostgREST rechazó el JWT → sin esto, loop).
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=/${tenantSlug}`)
    }
    if (error instanceof TenantNotFoundError) {
      // El user está logueado pero no es miembro de este bar. En vez de 404,
      // lo llevamos a su primer bar disponible (o a onboarding si no tiene).
      const memberships = await getMembershipsForUser()
      const fallback = memberships[0]?.tenant.slug
      redirect(fallback ? `/${fallback}` : '/onboarding')
    }
    throw error
  }

  // Backstop con el rol REAL de la DB: el proxy rutea por el rol del JWT, que
  // puede quedar viejo hasta 1 h si el owner cambió el rol de esta persona.
  if (SALON_ROLES.includes(access.role)) redirect(`/${tenantSlug}/salon`)

  // Lo mismo para los roles acotados del panel (contenido, anfitrión,
  // contabilidad): la ruta la marca el proxy en PATH_HEADER. Si el header no
  // está, o es de otro bar, NO se redirige: con la ruta vacía el home del rol
  // también fallaría el chequeo y rebotaría en loop. En ese caso quedan el
  // ruteo del proxy y el requireRole de cada página.
  if (MANAGER_SCOPED_PREFIXES[access.role]) {
    const segments = ((await headers()).get(PATH_HEADER) ?? '').split('/').filter(Boolean)
    if (segments[0] === tenantSlug && !canAccessManagerPath(access.role, segments.slice(1))) {
      redirect(homePathForRole(access.role, tenantSlug))
    }
  }

  // Si el JWT trae un rol distinto al de la DB, forzar un refresh de sesión
  // desde el browser para que el hook re-inyecte los claims (una vez/min).
  const claimRole = access.user.tenants ? roleForSlug(access.user.tenants, tenantSlug) : null
  const claimsStale = access.user.tenants !== null && claimRole !== access.role

  return (
    <AppShell
      tenant={access.tenant}
      role={access.role}
      memberships={access.memberships}
      isPlatformAdmin={access.isPlatformAdmin}
      accounting={access.accounting}
      email={access.user.email ?? ''}
    >
      {claimsStale ? <ClaimsRefresher /> : null}
      <RefreshOnReturn />
      {children}
    </AppShell>
  )
}
