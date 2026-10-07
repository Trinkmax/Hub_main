import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getFlowGraph } from '@/lib/flows/graph-queries'
import { getFlow } from '@/lib/flows/queries'
import type { FlowStepConfig, FlowTriggerConfig } from '@/lib/flows/schemas'
import { visibleTemplates } from '@/lib/meta/template-visibility'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { FlowBuilder } from '../_components/flow-builder'
import { FlowGraphEditorClient } from '../_components/flow-graph-editor-client'

export const metadata = { title: 'Editar automatización' }
export const dynamic = 'force-dynamic'

export default async function EditFlowPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
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
  // El grafo del flow no depende de canales/plantillas/tags: entra en el mismo
  // Promise.all en vez de esperar a que terminen (un hop secuencial menos).
  const [chRes, tplRes, tagsRes, graphData] = await Promise.all([
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
    // Try the graph representation first
    getFlowGraph(access.tenant.id, id),
  ])

  const channels = chRes.data ?? []
  const templates = visibleTemplates(tplRes.data ?? [])
  const tags = tagsRes.data ?? []

  if (!graphData) notFound()

  const isGraphFlow = graphData.nodes.length > 0
  const listHref = `/${tenantSlug}/mensajeria/flows`

  if (isGraphFlow) {
    // New-style graph flow → graph editor. Ocupa lo que queda debajo de las
    // pestañas del layout (flex), sin alturas con números a mano: antes se
    // descontaban 4rem de topbar (mide 3,5) y en el celular sobraba scroll.
    return (
      <PageShell width="full" className="min-h-0 flex-1 gap-4 py-4 sm:py-4">
        <PageHeader
          back={{ href: listHref, label: 'Automatizaciones' }}
          title="Editar automatización"
          description={
            graphData.flow.active
              ? 'Está prendida: se les manda a tus clientes cuando corresponde.'
              : 'En pausa · prendela cuando esté lista.'
          }
        />
        <FlowGraphEditorClient
          tenantSlug={tenantSlug}
          initial={{
            id: graphData.flow.id,
            name: graphData.flow.name,
            active: graphData.flow.active,
            trigger: graphData.flow.trigger_config,
            nodes: graphData.nodes,
            edges: graphData.edges,
          }}
          channels={channels}
          templates={templates}
          tags={tags}
        />
      </PageShell>
    )
  }

  // Legacy linear flow → keep existing builder
  const flow = await getFlow(access.tenant.id, id)
  if (!flow) notFound()

  return (
    <PageShell width="compact">
      <PageHeader
        back={{ href: listHref, label: 'Automatizaciones' }}
        title="Editar automatización"
        description={
          flow.active
            ? 'Está prendida: se les manda a tus clientes cuando corresponde.'
            : 'En pausa · prendela cuando esté lista.'
        }
      />
      <FlowBuilder
        tenantSlug={tenantSlug}
        flowId={flow.id}
        initialName={flow.name}
        initialActive={flow.active}
        initialTrigger={flow.trigger_config as FlowTriggerConfig}
        initialSteps={flow.steps.map(
          (s) => ({ ...(s.config as object), type: s.type }) as FlowStepConfig,
        )}
        channels={channels}
        templates={templates}
        tags={tags}
      />
    </PageShell>
  )
}
