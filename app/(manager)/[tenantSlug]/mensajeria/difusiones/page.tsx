import { ChevronRight, Megaphone, Plus } from 'lucide-react'
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
import { listBroadcasts } from '@/lib/broadcasts/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { BroadcastStatus } from '@/types/database'

export const metadata = { title: 'Difusiones' }
export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  sending: 'Enviando',
  sent: 'Enviada',
  partial: 'Parcial',
  failed: 'Fallida',
  cancelled: 'Cancelada',
}

function statusVariant(s: BroadcastStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'sent') return 'default'
  if (s === 'sending' || s === 'scheduled' || s === 'partial') return 'secondary'
  if (s === 'failed' || s === 'cancelled') return 'destructive'
  return 'outline'
}

export default async function DifusionesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
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

  const broadcasts = await listBroadcasts(access.tenant.id)

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Mensajería"
        title="Difusiones"
        description="Mandá un template aprobado a una audiencia. Programá envíos o despachá ahora mismo."
        actions={
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/mensajeria/difusiones/nueva`}>
              <Plus className="size-4" />
              Nueva difusión
            </Link>
          </Button>
        }
      />

      {broadcasts.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Aún no hay difusiones"
          description="Para mandar un broadcast, primero conectá un canal y aprobá al menos un template en Meta."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/mensajeria/difusiones/nueva`}>
                <Plus className="size-4" />
                Crear primera difusión
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
                  <DataTableHeader>Estado</DataTableHeader>
                  <DataTableHeader>Programada</DataTableHeader>
                  <DataTableHeader>Progreso</DataTableHeader>
                  <DataTableHeader className="w-8" />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {broadcasts.map((b) => {
                  const total = b.stats.total ?? 0
                  const sent = b.stats.sent ?? 0
                  const failed = b.stats.failed ?? 0
                  const pct = total > 0 ? Math.round((sent / total) * 100) : 0
                  return (
                    <tr key={b.id} className="group transition-colors hover:bg-secondary/40">
                      <DataTableCell>
                        <Link
                          href={`/${tenantSlug}/mensajeria/difusiones/${b.id}`}
                          className="font-medium group-hover:text-primary"
                        >
                          {b.name}
                        </Link>
                      </DataTableCell>
                      <DataTableCell>
                        <Badge variant={statusVariant(b.status)}>{STATUS_LABEL[b.status]}</Badge>
                      </DataTableCell>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {b.scheduled_at
                          ? new Date(b.scheduled_at).toLocaleString('es-AR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary/60">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {sent}/{total}
                          </span>
                          {failed > 0 ? (
                            <Badge variant="destructive" className="text-[10px]">
                              {failed} fallidos
                            </Badge>
                          ) : null}
                        </div>
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground/40 group-hover:text-muted-foreground">
                        <ChevronRight className="size-4" />
                      </DataTableCell>
                    </tr>
                  )
                })}
              </DataTableBody>
            </DataTableRoot>
          </DataTableScroll>
        </DataTableShell>
      )}
    </PageShell>
  )
}
