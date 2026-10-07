import { Banknote, MessageCircle, Receipt, Star } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type * as React from 'react'
import { ContactButton } from '@/components/messaging/contact-button'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { DetailTemplate } from '@/components/ui/page-templates'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAppUrl } from '@/lib/app-url'
import { getCustomerById, listTags } from '@/lib/customers/queries'
import { formatDate } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import { formatPhoneForDisplay } from '@/lib/phone'
import {
  listCustomerLedger,
  listCustomerRedemptions,
  listCustomerVisits,
} from '@/lib/points/queries'
import { getCustomerLunchSnapshot } from '@/lib/punch-cards/queries'
import { listCustomerReviews } from '@/lib/reviews/queries'
import { parseServiceAlerts, type ServiceAlert } from '@/lib/salon/alerts'
import { getCustomerInsights } from '@/lib/stats/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { customerSourceLabel } from '../_components/customer-meta'
import { CustomerForm } from './_components/customer-form'
import { CustomerQrPanel } from './_components/customer-qr-panel'
import { CustomerTags } from './_components/customer-tags'
import { DeleteButton } from './_components/delete-button'
import { LedgerTab } from './_components/ledger-tab'
import { LunchCardPanel } from './_components/lunch-card-panel'
import { ReviewsTab } from './_components/reviews-tab'
import { VisitsTab } from './_components/visits-tab'

export const metadata = { title: 'Cliente' }

/** Las pestañas de la ficha; la activa viaja en `?tab=` (se puede copiar el link). */
const TABS = ['visitas', 'puntos', 'datos', 'comunicaciones', 'resenas', 'notas'] as const
type CustomerTab = (typeof TABS)[number]

function isCustomerTab(value: unknown): value is CustomerTab {
  return typeof value === 'string' && (TABS as readonly string[]).includes(value)
}

/** Pesos enteros, como en los tableros: «$ 12.500». */
function pesos(cents: number): string {
  return formatCents(cents, { decimals: 0 })
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, id } = await params
  const sp = await searchParams
  const appUrl = await getAppUrl()
  const initialTab: CustomerTab = isCustomerTab(sp.tab) ? sp.tab : 'visitas'

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [customer, allTags, visits, ledger, redemptions, insights, lunchSnapshot, reviews] =
    await Promise.all([
      getCustomerById({ tenantId: access.tenant.id, id }),
      listTags({ tenantId: access.tenant.id }),
      listCustomerVisits({ tenantId: access.tenant.id, customerId: id }),
      listCustomerLedger({ tenantId: access.tenant.id, customerId: id }),
      listCustomerRedemptions({ tenantId: access.tenant.id, customerId: id }),
      getCustomerInsights(access.tenant.id, id),
      getCustomerLunchSnapshot({ tenantId: access.tenant.id, customerId: id }),
      listCustomerReviews(access.tenant.id, id),
    ])

  if (!customer) notFound()

  // Índice visita → reseña para marcar en la pestaña Visitas cuál dejó comentario.
  const reviewedVisits: Record<string, number> = {}
  for (const review of reviews.reviews) {
    if (review.visitId) reviewedVisits[review.visitId] ??= review.rating
  }

  type C = {
    id: string
    first_name: string
    last_name: string
    phone: string
    email: string | null
    notes: string | null
    birthdate: string | null
    opt_in_marketing: boolean
    is_blocked: boolean
    points_balance: number
    total_visits: number
    total_spent_cents: number
    last_visit_at: string | null
    created_at: string
    source: string
    qr_token: string
    /** Avisos permanentes; la query trae `*`, así que llegan solos. */
    service_alerts: ServiceAlert[] | null
    tags: { id: string; name: string; color: string }[]
  }
  const c = customer as unknown as C
  const fullName = `${c.first_name} ${c.last_name}`.trim()
  const basePath = `/${tenantSlug}/clientes/${c.id}`
  const showInsights = Boolean(insights) || reviews.total > 0

  return (
    <DetailTemplate
      width="comfortable"
      header={
        <PageHeader
          back={{ href: `/${tenantSlug}/clientes`, label: 'Clientes' }}
          title={fullName || 'Cliente sin nombre'}
          meta={[
            <span key="phone" className="type-amount">
              {formatPhoneForDisplay(c.phone)}
            </span>,
            `Cliente desde ${formatDate(c.created_at)}`,
            customerSourceLabel(c.source),
          ]}
          actions={
            <>
              {access.role === 'owner' ? (
                <DeleteButton tenantSlug={tenantSlug} customerId={c.id} customerName={fullName} />
              ) : null}
              <ContactButton
                tenantSlug={tenantSlug}
                phone={c.phone}
                customerId={c.id}
                name={fullName}
                variant="secondary"
                size="md"
              />
              <Button asChild>
                <Link href={`${basePath}/canjear`}>
                  <Star aria-hidden="true" />
                  Canjear puntos
                </Link>
              </Button>
            </>
          }
        >
          <CustomerTags
            tenantSlug={tenantSlug}
            customerId={c.id}
            currentTags={c.tags}
            allTags={allTags}
          />
        </PageHeader>
      }
      summary={
        <KPIGroup columns={3}>
          <KPI
            icon={Receipt}
            label="Visitas"
            value={formatNumber(c.total_visits)}
            hint={
              c.last_visit_at
                ? `Última: ${formatDate(c.last_visit_at)}`
                : 'Todavía no registró visitas'
            }
          />
          <KPI
            icon={Banknote}
            label="Gastado"
            value={pesos(c.total_spent_cents)}
            hint={
              c.total_visits > 0
                ? `Ticket promedio: ${pesos(Math.floor(c.total_spent_cents / c.total_visits))}`
                : 'Todavía no consumió'
            }
          />
          <KPI
            icon={Star}
            label="Puntos disponibles"
            value={formatNumber(c.points_balance)}
            hint="Para canjear por recompensas del club"
          />
        </KPIGroup>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {showInsights ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Hábitos de consumo</h2>
              </CardTitle>
            </CardHeader>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <InsightLine label="Plato favorito" value={insights?.favorite_item_name ?? null} />
              <InsightLine
                label="Categoría favorita"
                value={insights?.favorite_category_name ?? null}
              />
              <InsightLine
                label="Ticket promedio"
                value={
                  insights?.avg_ticket_cents != null
                    ? pesos(Number(insights.avg_ticket_cents))
                    : null
                }
              />
              <InsightLine
                label="Frecuencia"
                value={
                  insights?.visit_frequency_days != null
                    ? `Cada ${formatNumber(Number(insights.visit_frequency_days), 1)} días`
                    : null
                }
              />
              <InsightLine
                label="Días sin venir"
                value={
                  insights?.days_since_last_visit != null
                    ? `${formatNumber(Number(insights.days_since_last_visit))} días`
                    : null
                }
              />
              <InsightLine
                label="Última visita"
                value={insights?.last_visit_at ? formatDate(insights.last_visit_at) : null}
              />
              <InsightLine
                label="Reseñas"
                value={
                  reviews.total > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Star aria-hidden="true" className="size-3.5 fill-warning text-warning" />
                      <span className="sr-only">Promedio </span>
                      {formatNumber(reviews.average, 1)} · {formatNumber(reviews.total)}{' '}
                      {reviews.total === 1 ? 'reseña' : 'reseñas'}
                    </span>
                  ) : null
                }
              />
            </dl>
          </Card>
        ) : null}

        <CustomerQrPanel
          tenantSlug={tenantSlug}
          customerId={c.id}
          initialQrToken={c.qr_token}
          appUrl={appUrl}
          isOwner={access.role === 'owner'}
        />

        {lunchSnapshot ? (
          <LunchCardPanel
            tenantSlug={tenantSlug}
            customerId={c.id}
            initial={{
              template_id: lunchSnapshot.template_id,
              template_name: lunchSnapshot.template_name,
              current_stamps: lunchSnapshot.current_stamps,
              threshold: lunchSnapshot.threshold,
              reward_name: lunchSnapshot.reward_name,
              hours_from: (lunchSnapshot.config.hours_from as string | undefined) ?? null,
              hours_to: (lunchSnapshot.config.hours_to as string | undefined) ?? null,
            }}
          />
        ) : null}
      </div>

      <Tabs defaultValue={initialTab} syncParam="tab" className="gap-6">
        <TabsList aria-label="Secciones de la ficha">
          <TabsTrigger value="visitas">Visitas</TabsTrigger>
          <TabsTrigger value="puntos">Puntos</TabsTrigger>
          <TabsTrigger value="datos">Datos</TabsTrigger>
          <TabsTrigger value="comunicaciones">Mensajes</TabsTrigger>
          {/* El contador se ve sin abrir la pestaña: si el cliente se quejó, se nota. */}
          <TabsTrigger value="resenas" count={reviews.total > 0 ? reviews.total : undefined}>
            Reseñas
          </TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
        </TabsList>

        <TabsContent value="visitas">
          <VisitsTab visits={visits} reviewedVisits={reviewedVisits} />
        </TabsContent>

        <TabsContent value="puntos">
          <LedgerTab ledger={ledger} redemptions={redemptions} balance={c.points_balance} />
        </TabsContent>

        <TabsContent value="datos">
          <Section title="Datos personales" description="Solo los ve tu equipo." headingLevel={2}>
            <CustomerForm
              tenantSlug={tenantSlug}
              customer={{ ...c, service_alerts: parseServiceAlerts(c.service_alerts) }}
            />
          </Section>
        </TabsContent>

        <TabsContent value="comunicaciones">
          <Section
            title="Mensajes"
            description="Mandale un mensaje directo o una plantilla por WhatsApp."
            actions={
              <ContactButton
                tenantSlug={tenantSlug}
                phone={c.phone}
                customerId={c.id}
                name={fullName}
                variant="secondary"
                size="md"
              />
            }
          >
            <EmptyState
              icon={MessageCircle}
              title="Todavía no hay mensajes"
              description="Cuando le mandes una difusión o te escriba por WhatsApp, la conversación aparece acá."
            />
          </Section>
        </TabsContent>

        <TabsContent value="resenas">
          <ReviewsTab reviews={reviews.reviews} />
        </TabsContent>

        <TabsContent value="notas">
          <Card>
            {c.notes ? (
              <p className="max-w-prose whitespace-pre-wrap type-body">{c.notes}</p>
            ) : (
              <p className="type-body text-muted-foreground">
                No hay notas. Las cargás en la pestaña{' '}
                <Link
                  href={`${basePath}?tab=datos`}
                  scroll={false}
                  className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
                >
                  Datos
                </Link>
                .
              </p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </DetailTemplate>
  )
}

/** Una fila de «Hábitos de consumo»: nombre a la izquierda, dato a la derecha. Sin dato, «—». */
function InsightLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 type-body">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">
        {value ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">sin dato</span>
          </>
        )}
      </dd>
    </div>
  )
}
