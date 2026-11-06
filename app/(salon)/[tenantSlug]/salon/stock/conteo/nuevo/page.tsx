import { redirect } from 'next/navigation'
import { NewCountForm } from '@/components/purchasing/kitchen/new-count-form'
import { todayInCordoba } from '@/lib/dates'
import { requirePurchasingPage, viewerFirstName } from '@/lib/purchasing/access'
import { defaultEventsUntil } from '@/lib/purchasing/dates'
import { getCatalog, getOpenCount } from '@/lib/purchasing/queries'
import { PURCHASING_KITCHEN_ROLES } from '@/lib/tenant/roles'

export const metadata = { title: 'Salón · Nuevo conteo' }
export const dynamic = 'force-dynamic'

export default async function NewCountPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { tenant } = await requirePurchasingPage(tenantSlug, PURCHASING_KITCHEN_ROLES)
  const [open, catalog, firstName] = await Promise.all([
    getOpenCount(tenant.id),
    getCatalog(tenant.id),
    viewerFirstName(),
  ])
  // Hay uno solo abierto por bar: si alguien ya empezó, se sigue ese.
  if (open) redirect(`/${tenantSlug}/salon/stock/conteo/${open.id}`)
  const today = todayInCordoba()
  return (
    <NewCountForm
      slug={tenantSlug}
      today={today}
      defaultUntil={defaultEventsUntil(today, catalog.settings.countWeekdays)}
      defaultName={firstName}
    />
  )
}
