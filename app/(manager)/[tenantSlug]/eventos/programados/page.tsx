import { CalendarPlus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { listScheduledEventsForDateRange, listScheduledTemplates } from '@/lib/salon/queries'
import { type DayOverview, getDayOverview, getMonthSegments } from '@/lib/salon/segment-queries'
import { calendarParamsSchema, firstParams } from '@/lib/salon/segment-schemas'
import {
  RESERVATION_STAFF_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CalendarSearch } from './_components/calendar-search'
import { CalendarTabs } from './_components/calendar-tabs'
import { EventosTourButton } from './_components/eventos-tour'

export const metadata = { title: 'Calendario' }
export const dynamic = 'force-dynamic'

/** Primer y último día de 'YYYY-MM' (28 a 31, en UTC: sin la TZ del server). */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}` }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * El calendario: el mes con sus eventos y, por cada día, almuerzo, merienda y
 * cena contra su cupo. Es una de las dos puertas de las reservas (la otra es la
 * lista /reservas): desde un día se ve cómo viene y se reserva con la hora del
 * servicio ya puesta, o adentro de un evento. Al guardar se vuelve acá
 * (?volver=calendario en el alta y en la ficha).
 *
 * URL (todo validado con zod; un param roto se ignora, no rompe la página):
 * - ?month=YYYY-MM el mes. Si falta, sale de ?day y si no, de hoy en Córdoba
 *   (antes salía del reloj del server, UTC en Vercel: entre las 21 y las 24 del
 *   último día del mes mostraba el mes siguiente).
 * - ?day=YYYY-MM-DD | hoy abre la vista del día (?seg ancla un servicio, ?res
 *   resalta una reserva). La página la precarga: al volver de guardar una
 *   reserva el día aparece sin flash de carga.
 * - ?planta=alta|baja|sin filtra el mes y el día por planta (sin = reservas
 *   de evento sin planta). Lo lee y lo cambia el mes en el cliente: el mes ya
 *   trae todas las zonas y el cupo de cada planta, así que filtrar no pide
 *   nada al server.
 * - ?buscar=texto abre el buscador con ese texto.
 * - ?tab=eventos abre la pestaña Formatos.
 */
export default async function CalendarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = calendarParamsSchema.parse(firstParams(await searchParams))
  const defaultTab = sp.tab === 'eventos' ? 'eventos' : 'calendario'

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, RESERVATION_STAFF_ROLES)
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const today = todayInCordoba()
  const day = sp.day === 'hoy' ? today : (sp.day ?? null)
  const ym = sp.month ?? day?.slice(0, 7) ?? today.slice(0, 7)
  const { from, to } = monthRange(ym)
  const tenantId = access.tenant.id

  // El día abierto no depende de nada del mes: arranca ya, en paralelo con
  // todo lo demás. Si falla, la página igual sale y la vista del día lo pide
  // por su cuenta (con su "Reintentar"): un día roto no tumba el mes.
  const dayOverviewPromise: Promise<DayOverview | null> = day
    ? getDayOverview({ tenantId, date: day }).catch((error: unknown) => {
        console.error('[calendario.page.dayOverview]', { tenantId, code: errorCode(error) })
        return null
      })
    : Promise.resolve(null)

  // Dos viajes como máximo: eventos + formatos, y después el mes por servicio
  // reutilizando esos mismos eventos (no se vuelven a pedir).
  const [events, templates] = await Promise.all([
    listScheduledEventsForDateRange({ tenantId, from, to }),
    listScheduledTemplates({ tenantId, onlyActive: false }),
  ])
  const [monthSegments, initialOverview] = await Promise.all([
    getMonthSegments({ tenantId, ym, events }),
    dayOverviewPromise,
  ])
  const activeTemplates = templates.filter((t) => t.active)

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Agenda"
        title="Calendario"
        description="Cada día, almuerzo, merienda y cena contra su cupo. Tocá un día para ver cómo viene y reservar, o un evento para reservar adentro. Los eventos se programan arrastrando un formato (Sushi Libre, Pizza Libre…) a su fecha."
        actions={
          <div className="flex flex-wrap gap-2">
            <EventosTourButton role={access.role} />
            <CalendarSearch tenantSlug={tenantSlug} ym={ym} initialQuery={sp.buscar ?? null} />
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/eventos/programados/nuevo`} data-tour="eventos-programar">
                <CalendarPlus className="size-4" />
                Programar evento
              </Link>
            </Button>
          </div>
        }
      />

      <CalendarTabs
        tenantSlug={tenantSlug}
        ym={ym}
        events={events}
        templates={templates}
        activeTemplates={activeTemplates}
        monthSegments={monthSegments}
        today={today}
        defaultTab={defaultTab}
        role={access.role}
        initialOverview={initialOverview}
      />
    </PageShell>
  )
}
