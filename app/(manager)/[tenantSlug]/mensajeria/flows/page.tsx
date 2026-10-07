import { History, Plus, Workflow, Zap } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { StatusBadge } from '@/components/ui/status-badge'
import { listFlows } from '@/lib/flows/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { FLOW_ACTIVE_STATUS } from './_components/flow-status'
// Misma fuente de labels que el editor, para que la lista y el canvas
// digan exactamente lo mismo sobre cada disparador.
import { TRIGGER_TYPE_LABEL } from './_components/step-meta'

export const metadata = { title: 'Automatizaciones' }
export const dynamic = 'force-dynamic'

export default async function FlowsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  const flows = await listFlows(access.tenant.id)
  const newHref = `/${tenantSlug}/mensajeria/flows/nuevo`

  return (
    <PageShell width="comfortable">
      <PageHeader
        title="Automatizaciones"
        description="Mensajes que se mandan solos cuando pasa algo: un cumpleaños, una visita, un evento."
        actions={
          flows.length > 0 ? (
            <Button asChild>
              <Link href={newHref}>
                <Plus aria-hidden />
                Nueva automatización
              </Link>
            </Button>
          ) : null
        }
      />

      {flows.length === 0 ? (
        <EmptyState
          size="lg"
          icon={Workflow}
          title="Todavía no tenés automatizaciones"
          description="Trabajan solas: cuando un cliente cumple años, hace rato que no viene, o se acerca un evento, se manda el mensaje que definas. Lo armás una vez."
          action={
            <Button asChild>
              <Link href={newHref}>
                <Plus aria-hidden />
                Crear la primera automatización
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Automatizaciones"
          rows={flows}
          getRowId={(f) => f.id}
          rowHref={(f) => `/${tenantSlug}/mensajeria/flows/${f.id}`}
          rowLabel={(f) => f.name}
          columns={[
            { id: 'name', header: 'Nombre', cell: (f) => f.name },
            {
              id: 'trigger',
              header: 'Se activa cuando',
              cell: (f) => (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {TRIGGER_TYPE_LABEL[f.trigger_type]}
                </span>
              ),
            },
            {
              id: 'steps',
              header: 'Pasos',
              numeric: true,
              width: '6rem',
              mobile: 'meta',
              cell: (f) => (f.step_count === 1 ? '1 paso' : `${f.step_count} pasos`),
            },
            {
              id: 'status',
              header: 'Estado',
              mobile: 'value',
              cell: (f) => (
                <StatusBadge status={f.active ? 'active' : 'paused'} map={FLOW_ACTIVE_STATUS} />
              ),
            },
            // Atajo directo a "¿qué hizo?", que es la pregunta que aparece
            // apenas la automatización está prendida.
            {
              id: 'logs',
              header: 'Registros',
              headerHidden: true,
              align: 'end',
              mobile: 'meta',
              cell: (f) => (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/${tenantSlug}/mensajeria/flows/${f.id}/registros`}>
                    <History aria-hidden />
                    Registros
                    <span className="sr-only"> de {f.name}</span>
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      )}
    </PageShell>
  )
}
