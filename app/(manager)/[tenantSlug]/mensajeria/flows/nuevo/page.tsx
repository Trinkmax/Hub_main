import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { FlowGraphEditor } from '../_components/flow-graph-editor'

export const metadata = { title: 'Nuevo flow' }
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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col px-4 py-4 sm:px-6">
      <div className="mb-4 flex shrink-0 flex-col gap-3">
        <Link
          href={`/${tenantSlug}/mensajeria/flows`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Volver a flows
        </Link>
        <PageHeader
          eyebrow="Mensajería"
          title="Nuevo flow"
          description="Diseñá el grafo de automatización. El trigger dispara; el grafo define el camino."
        />
      </div>
      <FlowGraphEditor
        tenantSlug={tenantSlug}
        channels={chRes.data ?? []}
        templates={tplRes.data ?? []}
        tags={tagsRes.data ?? []}
      />
    </div>
  )
}
