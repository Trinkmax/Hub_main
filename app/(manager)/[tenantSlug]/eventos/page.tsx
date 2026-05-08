import { CalendarDays, CalendarPlus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { listEvents } from '@/lib/events/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CalendarMonth } from './_components/calendar-month'
import { EventsGrid } from './_components/events-grid'
import { EventsTabs } from './_components/events-tabs'

export const metadata = { title: 'Eventos' }

const VALID_TABS = ['upcoming', 'past', 'drafts'] as const
type Tab = (typeof VALID_TABS)[number]

export default async function EventosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const rawTab = typeof sp.tab === 'string' ? sp.tab : 'upcoming'
  const tab: Tab = VALID_TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'upcoming'

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  const isOwner = access.role === 'owner'
  if (tab === 'drafts' && !isOwner) {
    try {
      requireRole(access.role, ['owner'])
    } catch (e) {
      if (e instanceof RoleRequiredError) notFound()
      throw e
    }
  }

  const events = await listEvents({ tenantId: access.tenant.id, tab })
  const calendarEvents = events.filter((e) => e.status === 'published')

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Marketing"
        title="Eventos"
        description="Programá fiestas, peñas o cenas temáticas y registrá quién viene."
        actions={
          isOwner ? (
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/eventos/nuevo`}>
                <CalendarPlus className="size-4" />
                Nuevo evento
              </Link>
            </Button>
          ) : null
        }
      />

      <EventsTabs tenantSlug={tenantSlug} current={tab} showDrafts={isOwner} />

      {tab === 'upcoming' && calendarEvents.length > 0 ? (
        <div className="card-hairline rounded-xl border bg-card p-5">
          <CalendarMonth tenantSlug={tenantSlug} events={calendarEvents} />
        </div>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={
            tab === 'upcoming'
              ? 'No hay próximos eventos'
              : tab === 'past'
                ? 'Sin eventos pasados'
                : 'No hay borradores'
          }
          description={
            tab === 'upcoming'
              ? 'Cuando publiques un evento va a aparecer acá y en el calendario.'
              : tab === 'past'
                ? 'Acá vas a ver todos los eventos que ya pasaron.'
                : 'Los eventos que estás armando pero no publicaste todavía.'
          }
          action={
            isOwner ? (
              <Button asChild className="gap-2">
                <Link href={`/${tenantSlug}/eventos/nuevo`}>
                  <CalendarPlus className="size-4" />
                  Crear evento
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <EventsGrid tenantSlug={tenantSlug} events={events} />
      )}
    </div>
  )
}
