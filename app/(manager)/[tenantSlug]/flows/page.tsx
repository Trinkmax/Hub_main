import { ChevronRight, Plus, Workflow } from 'lucide-react'
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
import { listFlows } from '@/lib/flows/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { FlowTriggerType } from '@/types/database'

export const metadata = { title: 'Flows' }
export const dynamic = 'force-dynamic'

const TRIGGER_LABEL: Record<FlowTriggerType, string> = {
  customer_inactive: 'Cliente inactivo',
  birthday: 'Cumpleaños',
  after_visit: 'Después de visita',
  event_starting: 'Evento próximo',
  tag_added: 'Tag agregado',
}

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
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Marketing"
        title="Flows"
        description="Automatizaciones que se disparan solas: cumpleaños, post-visita, recordatorios de evento."
        actions={
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/flows/nuevo`}>
              <Plus className="size-4" />
              Nuevo flow
            </Link>
          </Button>
        }
      />

      {flows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Sin flows automáticos"
          description="Los flows ejecutan acciones cuando algo pasa: el cliente cumple años, no viene hace 30 días, viene un evento. Definilos una vez y trabajan solos."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/flows/nuevo`}>
                <Plus className="size-4" />
                Crear primer flow
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
                  <DataTableHeader>Trigger</DataTableHeader>
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
                        href={`/${tenantSlug}/flows/${f.id}`}
                        className="font-medium group-hover:text-primary"
                      >
                        {f.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-sm text-muted-foreground">
                      {TRIGGER_LABEL[f.trigger_type]}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{f.step_count}</DataTableCell>
                    <DataTableCell>
                      {f.active ? (
                        <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
                          <span className="size-1.5 rounded-full bg-current" />
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="outline">Pausado</Badge>
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
    </div>
  )
}
