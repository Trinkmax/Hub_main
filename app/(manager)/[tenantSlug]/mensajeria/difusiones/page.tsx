import { Megaphone, MessageSquareText, Plus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Progress } from '@/components/ui/progress'
import { type BroadcastListRow, listBroadcasts } from '@/lib/broadcasts/queries'
import { formatNumber } from '@/lib/format/number-kind'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import {
  BroadcastStatusBadge,
  broadcastDateTime,
  clientesLabel,
} from './_components/broadcast-status'

export const metadata = { title: 'Difusiones' }
export const dynamic = 'force-dynamic'

/** Resultado del envío en criollo: "3 de 5 entregados", sin barras crípticas. */
function ResultCell({ b }: { b: BroadcastListRow }) {
  const total = b.stats.total ?? 0
  const sent = b.stats.sent ?? 0
  const failed = b.stats.failed ?? 0
  const delivered = b.stats.delivered ?? 0

  if (b.status === 'draft') {
    return <span className="type-small text-muted-foreground">Todavía sin enviar</span>
  }
  if (b.status === 'cancelled') {
    return <span className="type-small text-muted-foreground">No se envió</span>
  }
  if (b.status === 'scheduled') {
    return (
      <span className="type-small text-muted-foreground">
        {total > 0 ? `Va a salir a ${clientesLabel(total)}` : 'Lista para salir'}
      </span>
    )
  }
  if (b.status === 'sending') {
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0
    const text = `${formatNumber(sent)} de ${formatNumber(total)} enviados`
    return (
      <span className="flex items-center gap-2">
        <Progress
          value={pct}
          tone="success"
          size="sm"
          label="Progreso del envío"
          valueText={text}
          className="w-16"
        />
        <span className="type-small tabular-nums text-muted-foreground">{text}</span>
      </span>
    )
  }
  // sent · partial · failed
  const okText =
    delivered > 0
      ? `${formatNumber(delivered)} de ${formatNumber(total)} entregados`
      : `${formatNumber(sent)} de ${formatNumber(total)} enviados`
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-small">
      <span className="tabular-nums">{okText}</span>
      {failed > 0 ? (
        <span className="font-medium text-destructive-text">
          · {formatNumber(failed)} {failed === 1 ? 'falló' : 'fallaron'}
        </span>
      ) : null}
    </span>
  )
}

/** Fecha relevante según estado: programada → cuándo sale; enviada → cuándo salió. */
function whenText(b: BroadcastListRow): string {
  if (b.status === 'scheduled' && b.scheduled_at) {
    return `Sale el ${broadcastDateTime(b.scheduled_at)}`
  }
  const d = b.completed_at ?? b.started_at ?? b.scheduled_at
  return d ? broadcastDateTime(d) : '—'
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
  const newHref = `/${tenantSlug}/mensajeria/difusiones/nueva`

  return (
    <PageShell width="comfortable">
      <PageHeader
        title="Difusiones"
        description="Mandá un mensaje a una lista de clientes. Programalo para más tarde o envialo ahora mismo."
        actions={
          broadcasts.length > 0 ? (
            <Button asChild>
              <Link href={newHref}>
                <Plus aria-hidden />
                Nueva difusión
              </Link>
            </Button>
          ) : null
        }
      />

      {broadcasts.length === 0 ? (
        <EmptyState
          size="lg"
          icon={Megaphone}
          title="Todavía no mandaste difusiones"
          description="Una difusión es un mensaje a muchos clientes a la vez. Antes de la primera, conectá WhatsApp y prepará al menos un mensaje aprobado en Plantillas."
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href={`/${tenantSlug}/mensajeria/plantillas`}>
                <MessageSquareText aria-hidden />
                Ir a Plantillas
              </Link>
            </Button>
          }
          action={
            <Button asChild>
              <Link href={newHref}>
                <Plus aria-hidden />
                Crear la primera difusión
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Difusiones"
          rows={broadcasts}
          getRowId={(b) => b.id}
          rowHref={(b) => `/${tenantSlug}/mensajeria/difusiones/${b.id}`}
          rowLabel={(b) => b.name}
          columns={[
            { id: 'name', header: 'Difusión', cell: (b) => b.name },
            {
              id: 'status',
              header: 'Estado',
              mobile: 'value',
              cell: (b) => <BroadcastStatusBadge status={b.status} />,
            },
            {
              id: 'when',
              header: 'Cuándo',
              cell: (b) => (
                <span className="type-small tabular-nums text-muted-foreground">{whenText(b)}</span>
              ),
            },
            {
              id: 'result',
              header: 'Resultado',
              mobile: 'meta',
              cell: (b) => <ResultCell b={b} />,
            },
          ]}
        />
      )}
    </PageShell>
  )
}
