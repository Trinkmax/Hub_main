import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getFlowGraph } from '@/lib/flows/graph-queries'
import { getFlow } from '@/lib/flows/queries'
import type { FlowStepConfig, FlowTriggerConfig } from '@/lib/flows/schemas'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { FlowBuilder } from '../_components/flow-builder'
import { FlowGraphEditor } from '../_components/flow-graph-editor'

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

  const channels = chRes.data ?? []
  const templates = tplRes.data ?? []
  const tags = tagsRes.data ?? []

  // Try the graph representation first
  const graphData = await getFlowGraph(access.tenant.id, id)

  if (!graphData) notFound()

  const isGraphFlow = graphData.nodes.length > 0

  if (isGraphFlow) {
    // New-style graph flow → graph editor
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col px-4 py-4 sm:px-6">
        <div className="mb-4 flex shrink-0 flex-col gap-3">
          <Link
            href={`/${tenantSlug}/mensajeria/flows`}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Volver a automatizaciones
          </Link>
          <PageHeader
            eyebrow="Mensajería"
            title="Editar automatización"
            description={
              graphData.flow.active
                ? 'Está prendida: se les manda a tus clientes cuando corresponde.'
                : 'En pausa · prendela cuando esté lista.'
            }
          />
        </div>
        <FlowGraphEditor
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
      </div>
    )
  }

  // Legacy linear flow → keep existing builder
  const flow = await getFlow(access.tenant.id, id)
  if (!flow) notFound()

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/mensajeria/flows`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a flows
      </Link>
      <PageHeader
        eyebrow="Mensajería"
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
    </div>
  )
}
