import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { visibleTemplates } from '@/lib/meta/template-visibility'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { FlowGraphEditorClient } from '../_components/flow-graph-editor-client'

export const metadata = { title: 'Nueva automatización' }
export const dynamic = 'force-dynamic'

export default async function NewFlowPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const supabase = await createClient()
  const [chRes, tplRes, tagsRes] = await Promise.all([
    supabase
      .from('channels')
      .select('id, type, display_name')
      .eq('tenant_id', access.tenant.id)
      .eq('status', 'connected'),
    supabase
      .from('message_templates')
      .select('id, name, language, channel_id')
      .eq('tenant_id', access.tenant.id)
      .eq('status', 'approved'),
    supabase.from('customer_tags').select('id, name').eq('tenant_id', access.tenant.id),
  ])

  // El lienzo ocupa todo el alto que queda (el marco de Mensajería ya descuenta
  // el topbar y las pestañas del celular): nada de alturas con números a mano.
  return (
    <PageShell width="full" className="h-full min-h-0 gap-4 py-4 sm:py-4">
      <PageHeader
        back={{ href: `/${tenantSlug}/mensajeria/flows`, label: 'Automatizaciones' }}
        title="Nueva automatización"
        description="Armá un mensaje que se manda solo. Elegí cuándo tiene que salir y qué decir."
      />
      <FlowGraphEditorClient
        tenantSlug={tenantSlug}
        channels={chRes.data ?? []}
        templates={visibleTemplates(tplRes.data ?? [])}
        tags={tagsRes.data ?? []}
      />
    </PageShell>
  )
}
