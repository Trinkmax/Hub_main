import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listLinkableHubEvents } from '@/lib/events/queries'
import {
  getBonusRule,
  listManagers,
  listRateTiers,
  listScheduledEventsForDate,
  listScheduledTemplates,
} from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ReservationForm } from '../_components/reservation-form'

export const metadata = { title: 'Nueva reserva' }
export const dynamic = 'force-dynamic'

function todayCordoba(): string {
  // Aprox: usamos la zona horaria de Argentina via Intl.
  const now = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  // en-CA devuelve YYYY-MM-DD
  return now
}

export default async function NuevaReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const today = todayCordoba()
  const dateParam =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined
  const initialDate = dateParam ?? today

  const [managers, templates, eventsToday, tiers, bonus, hubEvents] = await Promise.all([
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledEventsForDate({ tenantId: access.tenant.id, date: initialDate }),
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
    listLinkableHubEvents({ tenantId: access.tenant.id }),
  ])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/reservas`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver a reservas
          </Link>
        }
        title="Nueva reserva"
        description="Cargá los datos del cliente y la mesa. Se calcula la comisión en vivo."
      />
      <ReservationForm
        mode="create"
        tenantSlug={tenantSlug}
        initialDate={initialDate}
        managers={managers}
        templates={templates}
        initialEventsForDate={eventsToday}
        hubEvents={hubEvents}
        rateTiers={tiers}
        bonusPerGuestCents={bonus?.bonus_per_guest_cents ?? 0}
      />
    </div>
  )
}
