import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeft, Banknote, Phone, Receipt, Sparkles, Star } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCustomerById, listTags } from '@/lib/customers/queries'
import { formatPhoneForDisplay } from '@/lib/phone'
import {
  listCustomerLedger,
  listCustomerRedemptions,
  listCustomerVisits,
} from '@/lib/points/queries'
import { getCustomerInsights } from '@/lib/stats/queries'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { CustomerForm } from './_components/customer-form'
import { CustomerQrPanel } from './_components/customer-qr-panel'
import { CustomerTags } from './_components/customer-tags'
import { DeleteButton } from './_components/delete-button'
import { LedgerTab } from './_components/ledger-tab'
import { VisitsTab } from './_components/visits-tab'

export const metadata = { title: 'Cliente' }

function fmtCents(c: number) {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  const [customer, allTags, visits, ledger, redemptions, insights] = await Promise.all([
    getCustomerById({ tenantId: access.tenant.id, id }),
    listTags({ tenantId: access.tenant.id }),
    listCustomerVisits({ tenantId: access.tenant.id, customerId: id }),
    listCustomerLedger({ tenantId: access.tenant.id, customerId: id }),
    listCustomerRedemptions({ tenantId: access.tenant.id, customerId: id }),
    getCustomerInsights(access.tenant.id, id),
  ])

  if (!customer) notFound()

  type C = {
    id: string
    first_name: string
    last_name: string
    phone: string
    email: string | null
    notes: string | null
    birthdate: string | null
    opt_in_marketing: boolean
    points_balance: number
    total_visits: number
    total_spent_cents: number
    last_visit_at: string | null
    created_at: string
    source: string
    qr_token: string
    tags: { id: string; name: string; color: string }[]
  }
  const c = customer as unknown as C
  const initials = `${c.first_name?.[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase() || '?'

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/clientes`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a clientes
      </Link>

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-secondary font-display text-base font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {c.first_name} {c.last_name}
              </h1>
              <Badge variant="outline" className="capitalize">
                {c.source}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5 font-mono">
                <Phone className="size-3.5" />
                {formatPhoneForDisplay(c.phone)}
              </span>
              <span>
                Cliente desde {format(new Date(c.created_at), "d 'de' MMM yyyy", { locale: es })}
              </span>
            </div>
            <div className="mt-3">
              <CustomerTags
                tenantSlug={tenantSlug}
                customerId={c.id}
                currentTags={c.tags}
                allTags={allTags}
              />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button asChild size="sm" className="gap-2">
              <Link href={`/${tenantSlug}/clientes/${c.id}/canjear`}>
                <Star className="size-3.5" />
                Canjear puntos
              </Link>
            </Button>
            {access.role === 'owner' ? (
              <DeleteButton tenantSlug={tenantSlug} customerId={c.id} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Receipt}
          label="Visitas"
          value={c.total_visits.toLocaleString('es-AR')}
          hint={
            c.last_visit_at
              ? `Última: ${format(new Date(c.last_visit_at), "d 'de' MMM", { locale: es })}`
              : 'Sin visitas todavía'
          }
        />
        <StatCard
          icon={Banknote}
          label="Gastado"
          value={fmtCents(c.total_spent_cents)}
          hint={
            c.total_visits > 0
              ? `Ticket prom. ${fmtCents(Math.floor(c.total_spent_cents / c.total_visits))}`
              : '—'
          }
        />
        <StatCard
          icon={Star}
          label="Puntos disponibles"
          value={c.points_balance.toLocaleString('es-AR')}
          hint="Balance actual"
        />
      </div>

      <CustomerQrPanel
        tenantSlug={tenantSlug}
        customerId={c.id}
        initialQrToken={c.qr_token}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
        isOwner={access.role === 'owner'}
      />

      {insights ? (
        <div className="card-hairline rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">Insights</h2>
          </div>
          <div className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
            <InsightLine label="Plato favorito" value={insights.favorite_item_name ?? '—'} />
            <InsightLine
              label="Categoría favorita"
              value={insights.favorite_category_name ?? '—'}
            />
            <InsightLine
              label="Ticket promedio"
              value={fmtCents(Number(insights.avg_ticket_cents ?? 0))}
            />
            <InsightLine
              label="Frecuencia"
              value={
                insights.visit_frequency_days != null
                  ? `Cada ${Number(insights.visit_frequency_days).toFixed(1)} días`
                  : '—'
              }
            />
            <InsightLine
              label="Días sin venir"
              value={
                insights.days_since_last_visit != null
                  ? `${insights.days_since_last_visit} días`
                  : '—'
              }
            />
            <InsightLine
              label="Última visita"
              value={
                insights.last_visit_at
                  ? format(new Date(insights.last_visit_at), "d 'de' MMM yyyy", { locale: es })
                  : '—'
              }
            />
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="visitas">
        <TabsList className="bg-secondary/40">
          <TabsTrigger
            value="visitas"
            className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            Visitas
          </TabsTrigger>
          <TabsTrigger
            value="puntos"
            className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            Puntos
          </TabsTrigger>
          <TabsTrigger
            value="datos"
            className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            Datos
          </TabsTrigger>
          <TabsTrigger
            value="comunicaciones"
            className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            Mensajes
          </TabsTrigger>
          <TabsTrigger
            value="notas"
            className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
          >
            Notas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="visitas" className="mt-4">
          <VisitsTab visits={visits} />
        </TabsContent>

        <TabsContent value="puntos" className="mt-4">
          <LedgerTab ledger={ledger} redemptions={redemptions} balance={c.points_balance} />
        </TabsContent>

        <TabsContent value="datos" className="mt-4">
          <div className="card-hairline rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="font-display text-base font-semibold tracking-tight">
              Datos personales
            </h2>
            <p className="text-sm text-muted-foreground">
              Estos datos solo los ven los miembros del equipo.
            </p>
            <div className="mt-5">
              <CustomerForm tenantSlug={tenantSlug} customer={c} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="comunicaciones" className="mt-4">
          <EmptyState
            icon={Phone}
            title="Sin comunicaciones aún"
            description="Cuando le mandes un broadcast o reciba un mensaje 1-a-1, va a aparecer acá."
          />
        </TabsContent>

        <TabsContent value="notas" className="mt-4">
          <div className="card-hairline rounded-xl border bg-card p-5">
            {c.notes ? (
              <p className="whitespace-pre-wrap text-sm">{c.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay notas. Editalas desde la pestaña{' '}
                <strong className="text-foreground">Datos</strong>.
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function InsightLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
