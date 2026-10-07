import { notFound, redirect } from 'next/navigation'
import { getOnboardingState } from '@/lib/onboarding/actions'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { OnboardingWizard } from './_components/onboarding-wizard'

export const metadata = { title: 'Configuración inicial' }
export const dynamic = 'force-dynamic'

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantName: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
    tenantName = access.tenant.name
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const state = await getOnboardingState(tenantSlug)
  if (!state) notFound()

  // Si ya completó el onboarding, redirige al dashboard.
  if (state.completed) redirect(`/${tenantSlug}`)

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <OnboardingWizard
        tenantSlug={tenantSlug}
        tenantName={tenantName}
        initialSteps={state.steps}
      />
    </main>
  )
}
