import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listOpenSessions } from '@/lib/sessions-waiter/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { SessionsGrid } from './_components/sessions-grid'

export const metadata = { title: 'Salón · Mesas' }
export const dynamic = 'force-dynamic'

export default async function SalonMesasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }

  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()

  const sessions = await listOpenSessions(tenantId)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Salón"
        title="Mesas activas"
        description="Cada mesa abierta en tu turno. Tap para entrar, swipe-left para marcar pagada."
      />
      <SessionsGrid tenantSlug={tenantSlug} initialSessions={sessions} tenantId={tenantId} />
    </div>
  )
}
