import { ChevronRight, Megaphone, Plus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
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
import { type BroadcastListRow, listBroadcasts } from '@/lib/broadcasts/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { BroadcastStatusBadge, clientesLabel, formatDateTime } from './_components/broadcast-status'

export const metadata = { title: 'Difusiones' }
export const dynamic = 'force-dynamic'

/** Resultado del envío en criollo: "3 de 5 entregados", sin barras crípticas. */
function ResultCell({ b }: { b: BroadcastListRow }) {
  const total = b.stats.total ?? 0
  const sent = b.stats.sent ?? 0
  const failed = b.stats.failed ?? 0
  const delivered = b.stats.delivered ?? 0

  if (b.status === 'draft') {
    return <span className="text-xs text-muted-foreground">Todavía sin enviar</span>
  }
  if (b.status === 'cancelled') {
    return <span className="text-xs text-muted-foreground">No se envió</span>
  }
  if (b.status === 'scheduled') {
    return (
      <span className="text-xs text-muted-foreground">
        {total > 0 ? `Va a salir a ${clientesLabel(total)}` : 'Lista para salir'}
      </span>
    )
  }
  if (b.status === 'sending') {
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0
    return (
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progreso del envío"
          className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary/60"
        >
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {sent.toLocaleString('es-AR')} de {total.toLocaleString('es-AR')} enviados
        </span>
      </div>
    )
  }
  // sent · partial · failed
  const okText =
    delivered > 0
      ? `${delivered.toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')} entregados`
      : `${sent.toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')} enviados`
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="tabular-nums">{okText}</span>
      {failed > 0 ? (
        <span className="font-medium text-destructive">
          · {failed.toLocaleString('es-AR')} {failed === 1 ? 'falló' : 'fallaron'}
        </span>
      ) : null}
    </div>
  )
}

/** Fecha relevante según estado: programada → cuándo sale; enviada → cuándo salió. */
function whenText(b: BroadcastListRow): string {
  if (b.status === 'scheduled' && b.scheduled_at) {
    return `Sale el ${formatDateTime(b.scheduled_at)}`
  }
  const d = b.completed_at ?? b.started_at ?? b.scheduled_at
  return d ? formatDateTime(d) : '—'
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
        description="Mandá un mensaje a una lista de clientes. Programalo para más tarde o envialo ahora mismo."
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
          description="Para enviar tu primer mensaje masivo, primero conectá WhatsApp y prepará al menos un mensaje aprobado en Plantillas."
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
                  <DataTableHeader>Difusión</DataTableHeader>
                  <DataTableHeader>Estado</DataTableHeader>
                  <DataTableHeader className="hidden md:table-cell">Cuándo</DataTableHeader>
                  <DataTableHeader>Resultado</DataTableHeader>
                  <DataTableHeader className="w-8">
                    <span className="sr-only">Abrir</span>
                  </DataTableHeader>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {broadcasts.map((b) => (
                  <tr
                    key={b.id}
                    className="group relative cursor-pointer transition-colors hover:bg-secondary/40"
                  >
                    <DataTableCell>
                      {/* Link estirado: toda la fila navega al detalle. */}
                      <Link
                        href={`/${tenantSlug}/mensajeria/difusiones/${b.id}`}
                        className="text-sm font-medium group-hover:text-primary after:absolute after:inset-0 after:content-['']"
                      >
                        {b.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                        {whenText(b)}
                      </p>
                    </DataTableCell>
                    <DataTableCell>
                      <BroadcastStatusBadge status={b.status} />
                    </DataTableCell>
                    <DataTableCell className="hidden text-xs text-muted-foreground tabular-nums md:table-cell">
                      {whenText(b)}
                    </DataTableCell>
                    <DataTableCell>
                      <ResultCell b={b} />
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground/40 transition-colors group-hover:text-muted-foreground">
                      <ChevronRight className="size-4" aria-hidden />
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
