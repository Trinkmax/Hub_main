import { CheckCheck, Eye, MessageCircle, Send, TriangleAlert, Users } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Callout } from '@/components/ui/callout'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import { getBroadcastDetail } from '@/lib/broadcasts/queries'
import { formatNumber } from '@/lib/format/number-kind'
import { formatPhoneForDisplay } from '@/lib/phone'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import {
  BroadcastStatusBadge,
  broadcastDateTime,
  RECIPIENT_STATUS,
} from '../_components/broadcast-status'
import { BroadcastActions } from './_components/broadcast-actions'
import { LiveStats } from './_components/live-stats'

export const metadata = { title: 'Detalle difusión' }
export const dynamic = 'force-dynamic'

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
    timing.push(`Sale el ${broadcastDateTime(b.scheduled_at, { withYear: true })}`)
  }
  if (b.started_at) timing.push(`Empezó el ${broadcastDateTime(b.started_at, { withYear: true })}`)
  if (b.completed_at)
    timing.push(`Terminó el ${broadcastDateTime(b.completed_at, { withYear: true })}`)

  type Recipient = (typeof detail.recipients)[number]
  const customerOf = (r: Recipient) => (Array.isArray(r.customer) ? r.customer[0] : r.customer)

  return (
    <PageShell width="comfortable">
      <LiveStats broadcastId={id} />

      <PageHeader
        back={{ href: `/${tenantSlug}/mensajeria/difusiones`, label: 'Difusiones' }}
        title={b.name}
        meta={[
          <BroadcastStatusBadge key="status" status={b.status} />,
          `Por ${channel?.display_name ?? channel?.type ?? '—'}`,
          `Mensaje «${template?.name ?? '—'}»`,
          `Lista «${audience?.name ?? '—'}»`,
          ...timing,
        ]}
        actions={
          <BroadcastActions
            tenantSlug={tenantSlug}
            broadcastId={id}
            status={b.status}
            failedCount={failed}
          />
        }
      />

      <KPIGroup aria-label="Resultados del envío" columns={3}>
        <KPI icon={Users} label="En la lista" value={formatNumber(total)} hint="Destinatarios" />
        <KPI
          icon={Send}
          label="Enviados"
          value={formatNumber(sent)}
          hint={total > 0 ? `${pct} % del total` : undefined}
        />
        <KPI
          icon={CheckCheck}
          label="Entregados"
          value={formatNumber(delivered)}
          hint="Llegaron al teléfono"
        />
        <KPI icon={Eye} label="Leídos" value={formatNumber(read)} />
        <KPI icon={MessageCircle} label="Respondieron" value={formatNumber(replied)} />
        <KPI
          icon={TriangleAlert}
          label="Fallidos"
          value={formatNumber(failed)}
          hint={failed > 0 ? 'Mirá el motivo abajo' : 'Todo bien'}
        />
      </KPIGroup>

      {excluded > 0 ? (
        <Callout tone="info">
          {formatNumber(excluded)}{' '}
          {excluded === 1
            ? 'cliente de la lista quedó afuera porque no acepta'
            : 'clientes de la lista quedaron afuera porque no aceptan'}{' '}
          recibir promos. No se les envió nada.
        </Callout>
      ) : null}

      <Section title="Destinatarios" description="Los últimos 200, del más reciente al más viejo.">
        <DataTable
          caption="Destinatarios de la difusión"
          rows={detail.recipients}
          getRowId={(r) => r.id}
          empty={
            <EmptyState
              size="sm"
              title="Todavía no hay destinatarios para mostrar"
              description="Cuando la difusión empiece a salir, cada cliente aparece acá con su estado."
            />
          }
          columns={[
            {
              id: 'customer',
              header: 'Cliente',
              cell: (r) => {
                const customer = customerOf(r)
                return customer ? `${customer.first_name} ${customer.last_name}` : '—'
              },
            },
            {
              id: 'phone',
              header: 'Teléfono',
              cell: (r) => {
                const phone = customerOf(r)?.phone
                return (
                  <span className="tabular-nums text-muted-foreground">
                    {phone ? formatPhoneForDisplay(phone) : '—'}
                  </span>
                )
              },
            },
            {
              id: 'status',
              header: 'Estado',
              mobile: 'value',
              cell: (r) => <StatusBadge status={r.status} map={RECIPIENT_STATUS} />,
            },
            {
              id: 'sent',
              header: 'Enviado',
              mobile: 'meta',
              cell: (r) => (
                <span className="tabular-nums text-muted-foreground">
                  {r.sent_at ? broadcastDateTime(r.sent_at, { withYear: true }) : '—'}
                </span>
              ),
            },
            {
              id: 'reason',
              header: 'Motivo',
              mobile: 'meta',
              cell: (r) =>
                r.error ? (
                  <span title={r.error} className="text-destructive-text">
                    {friendlyError(r.error)}
                  </span>
                ) : null,
            },
          ]}
        />
      </Section>
    </PageShell>
  )
}
