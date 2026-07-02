import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listConversationTags } from '@/lib/conversation-tags/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TagsManager } from './_components/tags-manager'

export const metadata = { title: 'Etiquetas de conversación' }

export default async function EtiquetasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(tenantSlug)
    requireRole(role, ['owner', 'cashier'])
    tenantId = tenant.id
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const tags = await listConversationTags(tenantId)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Mensajería"
        title="Etiquetas de conversación"
        description="Organizá las conversaciones del inbox con etiquetas de color. Se usan al etiquetar un chat y para filtrar la bandeja."
      />
      <TagsManager tenantSlug={tenantSlug} tags={tags} />
    </div>
  )
}
