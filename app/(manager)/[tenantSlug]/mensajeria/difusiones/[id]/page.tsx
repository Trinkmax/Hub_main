import { ArrowLeft, CheckCheck, Eye, MessageCircle, Send, TriangleAlert, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { getBroadcastDetail } from '@/lib/broadcasts/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { RecipientStatus } from '@/types/database'
import { BroadcastStatusBadge, formatDateTime } from '../_components/broadcast-status'
import { BroadcastActions } from './_components/broadcast-actions'
import { LiveStats } from './_components/live-stats'

export const metadata = { title: 'Detalle difusión' }
export const dynamic = 'force-dynamic'

type RecipientBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info'

const RECIPIENT_META: Record<RecipientStatus, { label: string; variant: RecipientBadgeVariant }> = {
  pending: { label: 'En cola', variant: 'outline' },
  sending: { label: 'Enviando', variant: 'warning' },
  sent: { label: 'Enviado', variant: 'secondary' },
  delivered: { label: 'Entregado', variant: 'info' },
  read: { label: 'Leído', variant: 'success' },
  replied: { label: 'Respondió', variant: 'default' },
  failed: { label: 'Falló', variant: 'destructive' },
}

// Traduce los errores más comunes de WhatsApp a algo accionable. El código
// crudo queda en el tooltip por si soporte lo necesita.
function friendlyError(raw: string | null): string {
  if (!raw) return ''
  const r = raw.toLowerCase()
  if (r.includes('131047') || r.includes('re-engagement') || r.includes('24 h')) {
    return 'Pasaron más de 24 h; hacía falta un mensaje aprobado.'
  }
  if (r.includes('131030') || r.includes('allowed list')) {
    return 'El número todavía no está habilitado para recibir.'
  }
  if (r.includes('131026') || r.includes('undeliverable') || r.includes('not a whatsapp')) {
    return 'No se pudo entregar (puede no tener WhatsApp).'
  }
  if (r.includes('131042') || r.includes('payment')) {
    return 'Falta configurar el método de pago en Meta.'
  }
  if (r.includes('opt_out')) {
    return 'El cliente dejó de aceptar promos antes del envío.'
  }
  if (r.includes('block')) {
    return 'El cliente bloqueó los mensajes.'
  }
  return 'No se pudo enviar.'
}

export default async function BroadcastDetailPage({
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

  const detail = await getBroadcastDetail(access.tenant.id, id)
  if (!detail?.broadcast) notFound()

  const b = detail.broadcast as unknown as {
    id: string
    name: string
    status: string
    scheduled_at: string | null
    started_at: string | null
    completed_at: string | null
    stats: Record<string, number>
    channel:
      | { display_name: string | null; type: string }
      | { display_name: string | null; type: string }[]
      | null
    template: { name: string; language: string } | { name: string; language: string }[] | null
    audience:
      | { name: string; customer_count_cached: number }
      | { name: string; customer_count_cached: number }[]
      | null
  }
  const channel = Array.isArray(b.channel) ? b.channel[0] : b.channel
  const template = Array.isArray(b.template) ? b.template[0] : b.template
  const audience = Array.isArray(b.audience) ? b.audience[0] : b.audience
  const stats = b.stats ?? {}
  const total = stats.total ?? 0
  const sent = stats.sent ?? 0
  const failed = stats.failed ?? 0
  const delivered = stats.delivered ?? 0
  const read = stats.read ?? 0
  const replied = stats.replied ?? 0
  const excluded = stats.excluded ?? 0
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0

  const timing: string[] = []
  if (b.status === 'scheduled' && b.scheduled_at) {
    timing.push(`Sale el ${formatDateTime(b.scheduled_at, { withYear: true })}`)
  }
  if (b.started_at) timing.push(`Empezó el ${formatDateTime(b.started_at, { withYear: true })}`)
  if (b.completed_at)
    timing.push(`Terminó el ${formatDateTime(b.completed_at, { withYear: true })}`)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <LiveStats broadcastId={id} />
      <Link
        href={`/${tenantSlug}/mensajeria/difusiones`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a difusiones
      </Link>

      <PageHeader
        eyebrow="Mensajería · Difusión"
        title={b.name}
        description={
          <span className="flex flex-col gap-1">
            <span>
              Por {channel?.display_name ?? channel?.type ?? '—'} · mensaje{' '}
              <strong className="text-foreground">{template?.name ?? '—'}</strong> · lista{' '}
              <strong className="text-foreground">{audience?.name ?? '—'}</strong>
            </span>
            {timing.length > 0 ? <span>{timing.join(' · ')}</span> : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BroadcastStatusBadge status={b.status} />
            <BroadcastActions
              tenantSlug={tenantSlug}
              broadcastId={id}
              status={b.status}
              failedCount={failed}
            />
          </div>
        }
      />

      <section
        aria-label="Resultados del envío"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <StatCard
          icon={Users}
          label="En la lista"
          value={total.toLocaleString('es-AR')}
          hint="Destinatarios"
        />
        <StatCard
          icon={Send}
          label="Enviados"
          value={sent.toLocaleString('es-AR')}
          hint={total > 0 ? `${pct}% del total` : undefined}
        />
        <StatCard
          icon={CheckCheck}
          label="Entregados"
          value={delivered.toLocaleString('es-AR')}
          hint="Llegaron al teléfono"
        />
        <StatCard icon={Eye} label="Leídos" value={read.toLocaleString('es-AR')} />
        <StatCard
          icon={MessageCircle}
          label="Respondieron"
          value={replied.toLocaleString('es-AR')}
        />
        <StatCard
          icon={TriangleAlert}
          label="Fallidos"
          value={failed.toLocaleString('es-AR')}
          deltaTone={failed > 0 ? 'negative' : 'positive'}
          iconClassName={failed > 0 ? 'text-destructive' : undefined}
          hint={failed > 0 ? 'Mirá el motivo abajo' : 'Todo bien'}
        />
      </section>

      {excluded > 0 ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {excluded.toLocaleString('es-AR')}{' '}
          {excluded === 1
            ? 'cliente de la lista quedó afuera porque no acepta'
            : 'clientes de la lista quedaron afuera porque no aceptan'}{' '}
          recibir promos. No se les envió nada.
        </p>
      ) : null}

      <DataTableShell>
        <header className="border-b border-border/60 px-5 py-4">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Destinatarios</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Los últimos 200, del más reciente al más viejo.
          </p>
        </header>
        <DataTableScroll>
          <DataTableRoot>
            <DataTableHead>
              <tr>
                <DataTableHeader>Cliente</DataTableHeader>
                <DataTableHeader className="hidden sm:table-cell">Teléfono</DataTableHeader>
                <DataTableHeader>Estado</DataTableHeader>
                <DataTableHeader className="hidden md:table-cell">Enviado</DataTableHeader>
                <DataTableHeader>Motivo</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {detail.recipients.length === 0 ? (
                <tr>
                  <DataTableCell
                    colSpan={5}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Todavía no hay destinatarios para mostrar.
                  </DataTableCell>
                </tr>
              ) : (
                detail.recipients.map((r) => {
                  const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer
                  const meta = RECIPIENT_META[r.status]
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-secondary/40">
                      <DataTableCell className="font-medium">
                        {customer ? `${customer.first_name} ${customer.last_name}` : '—'}
                        {customer?.phone ? (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground sm:hidden">
                            {formatPhoneForDisplay(customer.phone)}
                          </p>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell className="hidden text-xs text-muted-foreground tabular-nums sm:table-cell">
                        {customer?.phone ? formatPhoneForDisplay(customer.phone) : '—'}
                      </DataTableCell>
                      <DataTableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </DataTableCell>
                      <DataTableCell className="hidden text-xs text-muted-foreground tabular-nums md:table-cell">
                        {r.sent_at ? formatDateTime(r.sent_at, { withYear: true }) : '—'}
                      </DataTableCell>
                      <DataTableCell className="text-xs text-destructive">
                        <span title={r.error ?? undefined}>{friendlyError(r.error)}</span>
                      </DataTableCell>
                    </tr>
                  )
                })
              )}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>
    </div>
  )
}
