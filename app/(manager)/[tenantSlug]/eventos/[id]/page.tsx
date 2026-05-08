import { ArrowLeft, ScanLine } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getEvent, listReservations } from '@/lib/events/queries'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { CheckInTab } from './_components/check-in-tab'
import { EventActions } from './_components/event-actions'
import { EventSidebar } from './_components/event-sidebar'
import { ReservationsTab } from './_components/reservations-tab'
import { WaitlistTab } from './_components/waitlist-tab'

export const metadata = { title: 'Evento' }

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    throw e
  }

  const detail = await getEvent({ tenantId: access.tenant.id, id })
  if (!detail) notFound()
  const reservations = await listReservations({ tenantId: access.tenant.id, eventId: id })

  const confirmed = reservations.filter(
    (r) => r.status === 'confirmed' || r.status === 'checked_in',
  )
  const waitlist = reservations.filter((r) => r.status === 'waitlist')
  const isOwner = access.role === 'owner'

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/${tenantSlug}/eventos`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Volver a eventos
        </Link>
        <Button asChild variant="outline" className="gap-2">
          <Link href={`/${tenantSlug}/eventos/${id}/check-in`}>
            <ScanLine className="size-4" />
            Modo Check-in
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <EventSidebar
            event={detail.event}
            confirmedSeats={detail.confirmed_seats}
            waitlistCount={detail.waitlist_count}
          />
          {isOwner ? <EventActions tenantSlug={tenantSlug} event={detail.event} /> : null}
        </div>

        <Tabs defaultValue="reservas">
          <TabsList className="bg-secondary/40">
            <TabsTrigger
              value="reservas"
              className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              Reservas <span className="ml-1.5 tabular-nums opacity-70">({confirmed.length})</span>
            </TabsTrigger>
            <TabsTrigger
              value="waitlist"
              className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              Waitlist <span className="ml-1.5 tabular-nums opacity-70">({waitlist.length})</span>
            </TabsTrigger>
            <TabsTrigger
              value="checkin"
              className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
            >
              Check-in
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reservas" className="mt-4">
            <div className="card-hairline overflow-hidden rounded-xl border bg-card">
              <ReservationsTab
                tenantSlug={tenantSlug}
                eventId={id}
                reservations={reservations}
                capacity={detail.event.capacity}
                confirmedSeats={detail.confirmed_seats}
                status={detail.event.status}
              />
            </div>
          </TabsContent>

          <TabsContent value="waitlist" className="mt-4">
            <div className="card-hairline overflow-hidden rounded-xl border bg-card">
              <WaitlistTab tenantSlug={tenantSlug} reservations={waitlist} />
            </div>
          </TabsContent>

          <TabsContent value="checkin" className="mt-4">
            <div className="card-hairline rounded-xl border bg-card p-5">
              <CheckInTab tenantSlug={tenantSlug} reservations={confirmed} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
