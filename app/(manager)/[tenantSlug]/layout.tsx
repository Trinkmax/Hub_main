import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/app-shell'
import {
  getMembershipsForUser,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

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
    if (error instanceof UnauthenticatedError) redirect(`/login?redirectTo=/${tenantSlug}`)
    if (error instanceof TenantNotFoundError) {
      // El user está logueado pero no es miembro de este bar. En vez de 404,
      // lo llevamos a su primer bar disponible (o a onboarding si no tiene).
      const memberships = await getMembershipsForUser()
      const fallback = memberships[0]?.tenant.slug
      redirect(fallback ? `/${fallback}` : '/onboarding')
    }
    throw error
  }

  return (
    <AppShell tenant={access.tenant} role={access.role}>
      {children}
    </AppShell>
  )
}
