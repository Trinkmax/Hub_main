import { ArrowLeft, CheckCircle2, Send, TriangleAlert, Users } from 'lucide-react'
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
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { RecipientStatus } from '@/types/database'

export const metadata = { title: 'Detalle difusión' }
export const dynamic = 'force-dynamic'

const RECIPIENT_LABEL: Record<RecipientStatus, string> = {
  pending: 'Pendiente',
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  replied: 'Respondió',
  failed: 'Falló',
}

function recipientVariant(s: RecipientStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'failed') return 'destructive'
  if (s === 'pending') return 'outline'
  if (s === 'read' || s === 'replied') return 'default'
  return 'secondary'
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
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/difusiones`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a difusiones
      </Link>

      <PageHeader
        eyebrow="Marketing · Difusión"
        title={b.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {channel?.display_name ?? channel?.type} · template{' '}
              <strong className="text-foreground">{template?.name}</strong>
            </span>
            <span>·</span>
            <span>
              audiencia <strong className="text-foreground">{audience?.name}</strong>
            </span>
          </span>
        }
        actions={
          <Badge variant="secondary" className="capitalize">
            {b.status}
          </Badge>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label="Total"
          value={total.toLocaleString('es-AR')}
          hint="Recipients"
        />
        <StatCard
          icon={Send}
          label="Enviados"
          value={sent.toLocaleString('es-AR')}
          hint={`${pct}% del total`}
        />
        <StatCard
          icon={failed > 0 ? TriangleAlert : CheckCircle2}
          label="Fallidos"
          value={failed.toLocaleString('es-AR')}
          deltaTone={failed > 0 ? 'negative' : 'positive'}
        />
      </section>

      <DataTableShell>
        <header className="border-b border-border/60 px-5 py-4">
          <h2 className="font-display text-base font-semibold tracking-tight">
            Recipients <span className="text-muted-foreground">(últimos 200)</span>
          </h2>
        </header>
        <DataTableScroll>
          <DataTableRoot>
            <DataTableHead>
              <tr>
                <DataTableHeader>Cliente</DataTableHeader>
                <DataTableHeader>Teléfono</DataTableHeader>
                <DataTableHeader>Estado</DataTableHeader>
                <DataTableHeader>Enviado</DataTableHeader>
                <DataTableHeader>Error</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {detail.recipients.map((r) => {
                const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer
                return (
                  <tr key={r.id} className="transition-colors hover:bg-secondary/40">
                    <DataTableCell className="font-medium">
                      {customer ? `${customer.first_name} ${customer.last_name}` : '—'}
                    </DataTableCell>
                    <DataTableCell className="font-mono text-xs text-muted-foreground">
                      {customer?.phone ?? '—'}
                    </DataTableCell>
                    <DataTableCell>
                      <Badge variant={recipientVariant(r.status)}>
                        {RECIPIENT_LABEL[r.status]}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {r.sent_at ? new Date(r.sent_at).toLocaleString('es-AR') : '—'}
                    </DataTableCell>
                    <DataTableCell className="text-xs text-destructive">
                      {r.error ?? ''}
                    </DataTableCell>
                  </tr>
                )
              })}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
      </DataTableShell>
    </div>
  )
}
