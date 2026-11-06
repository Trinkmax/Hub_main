import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CountScreen } from '@/components/purchasing/kitchen/count-screen'
import { todayInCordoba } from '@/lib/dates'
import { requirePurchasingPage } from '@/lib/purchasing/access'
import { getCountContext } from '@/lib/purchasing/queries'
import { routeComparator } from '@/lib/purchasing/suggest'
import { PURCHASING_KITCHEN_ROLES } from '@/lib/tenant/roles'

export const metadata = { title: 'Salón · Conteo' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CountPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; countId: string }>
}) {
  const { tenantSlug, countId } = await params
  if (!UUID.test(countId)) notFound()
  const { tenant } = await requirePurchasingPage(tenantSlug, PURCHASING_KITCHEN_ROLES)
  const ctx = await getCountContext(tenant.id, countId)
  if (!ctx) notFound()

  if (ctx.count.status !== 'open') {
    return (
      <div className="mx-auto w-full max-w-xl pt-10 text-center">
        <h1 className="font-serif text-2xl font-semibold">
          {ctx.count.status === 'sent' ? 'Este conteo ya se envió' : 'Este conteo se descartó'}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {ctx.count.status === 'sent'
            ? 'Lo que se contó ya está en los pedidos para revisar.'
            : 'No se armó ningún pedido con él.'}
        </p>
        <Link
          href={`/${tenantSlug}/salon/stock`}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-6 font-semibold text-primary-foreground"
        >
          Volver al inicio
        </Link>
      </div>
    )
  }

  const { catalog } = ctx
  const zones = catalog.zones.filter((z) => z.active)
  const items = [...ctx.items].sort(routeComparator(zones))
  return (
    <CountScreen
      slug={tenantSlug}
      today={todayInCordoba()}
      count={{
        id: ctx.count.id,
        kind: ctx.count.kind,
        countDate: ctx.count.countDate,
        eventsUntil: ctx.count.eventsUntil,
        countedByName: ctx.count.countedByName,
      }}
      zones={zones}
      items={items}
      initialLines={ctx.lines}
      needs={[...ctx.eventNeeds.needs]}
      events={ctx.eventNeeds.events}
      inHouse={ctx.eventNeeds.inHouse}
      inTransit={[...ctx.inTransit]}
      suppliers={catalog.suppliers.filter((s) => s.active)}
      lowFraction={catalog.settings.lowFraction}
      reviewerName={catalog.settings.reviewerName}
    />
  )
}
