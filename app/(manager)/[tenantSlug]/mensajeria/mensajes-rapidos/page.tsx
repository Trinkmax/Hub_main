import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listQuickMessages } from '@/lib/quick-messages/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { QuickMessagesManager } from './_components/quick-messages-manager'

export const metadata = { title: 'Mensajes rápidos' }

export default async function QuickMessagesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier'])
    tenantId = access.tenant.id
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const messages = await listQuickMessages(tenantId)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración · Mensajería"
        title="Mensajes rápidos"
        description="Creá atajos para respuestas frecuentes. En el composer escribí / para buscarlos."
      />
      <Section>
        <QuickMessagesManager tenantSlug={tenantSlug} initialMessages={messages} />
      </Section>
    </div>
  )
}
