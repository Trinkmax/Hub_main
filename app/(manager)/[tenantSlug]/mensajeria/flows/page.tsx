import { ChevronRight, Plus, Workflow, Zap } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { listFlows } from '@/lib/flows/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
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

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Mensajería"
        title="Automatizaciones"
        description="Mensajes que se mandan solos cuando pasa algo: un cumpleaños, una visita, un evento."
        actions={
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/mensajeria/flows/nuevo`}>
              <Plus className="size-4" />
              Nueva automatización
            </Link>
          </Button>
        }
      />

      {flows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Todavía no tenés automatizaciones"
          description="Trabajan solas: cuando un cliente cumple años, hace rato que no viene, o se acerca un evento, se manda el mensaje que definas. Lo armás una vez."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/mensajeria/flows/nuevo`}>
                <Plus className="size-4" />
                Crear tu primera automatización
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTableShell>
          <DataTableScroll>
            <DataTableRoot>
              <DataTableHead>
                <tr>
                  <DataTableHeader>Nombre</DataTableHeader>
                  <DataTableHeader>Se activa cuando</DataTableHeader>
                  <DataTableHeader>Pasos</DataTableHeader>
                  <DataTableHeader>Estado</DataTableHeader>
                  <DataTableHeader className="w-8" />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {flows.map((f) => (
                  <tr key={f.id} className="group transition-colors hover:bg-secondary/40">
                    <DataTableCell>
                      <Link
                        href={`/${tenantSlug}/mensajeria/flows/${f.id}`}
                        className="font-medium group-hover:text-primary"
                      >
                        {f.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Zap className="size-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                        {TRIGGER_TYPE_LABEL[f.trigger_type]}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{f.step_count}</DataTableCell>
                    <DataTableCell>
                      {f.active ? (
                        <Badge variant="success" className="gap-1">
                          <span className="size-1.5 rounded-full bg-current" />
                          Activa
                        </Badge>
                      ) : (
                        <Badge variant="outline">En pausa</Badge>
                      )}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground/40 group-hover:text-muted-foreground">
                      <ChevronRight className="size-4" />
                    </DataTableCell>
                  </tr>
                ))}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      )}
    </PageShell>
  )
}
