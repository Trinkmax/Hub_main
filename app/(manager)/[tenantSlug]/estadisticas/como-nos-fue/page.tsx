import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { isRealIsoDay, todayInCordoba } from '@/lib/salon/date-presets'
import {
  getDayReport,
  getTemplateReport,
  listEventTemplateOptions,
  listRecentReservationDays,
} from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ComoNosFueDashboard } from './_components/como-nos-fue-dashboard'

export const metadata = { title: 'Cómo nos fue' }
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ComoNosFuePage({
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
    // Explícito: la RLS de `salon_reservations` deja leer a cualquier miembro
    // del tenant. Este es un tablero de dueño.
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const view = sp.vista === 'evento' ? 'evento' : 'dia'
  // Cualquier valor raro cae al default en vez de romper la pantalla.
  const requestedDay = typeof sp.dia === 'string' && isRealIsoDay(sp.dia) ? sp.dia : undefined
  const requestedTemplate =
    typeof sp.evento === 'string' && UUID_RE.test(sp.evento) ? sp.evento : undefined

  // Las últimas noches con gente sirven para dos cosas: el atajo del calendario
  // y el default. Abrir un reporte retrospectivo en una noche vacía es una mala
  // primera pantalla, aunque el vacío también sea un dato cuando se lo busca.
  const recentDays = await listRecentReservationDays({ tenantId, until: today })
  const day = requestedDay ?? recentDays[0]?.day ?? today

  const templateOptions =
    view === 'evento'
      ? await listEventTemplateOptions({ tenantId, today })
      : { options: [], truncated: false }
  const templates = templateOptions.options
  // El default abre en el evento con más historia, no en el primero de la lista:
  // sin esto, un formato que todavía no corrió pero tiene mucha gente anotada
  // para el mes que viene abría una pantalla que dice "no se hizo nunca".
  const defaultTemplate = templates.find((t) => t.guests > 0) ?? templates[0]
  const templateId = requestedTemplate ?? (view === 'evento' ? (defaultTemplate?.id ?? null) : null)

  const [dayReport, templateReport] = await Promise.all([
    view === 'dia' ? getDayReport({ tenantId, day }) : Promise.resolve(null),
    view === 'evento' && templateId
      ? getTemplateReport({ tenantId, templateId, today })
      : Promise.resolve(null),
  ])

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/estadisticas`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Estadísticas
          </Link>
        }
        title="Cómo nos fue"
        description={
          <span className="hidden sm:inline">
            Cuánta gente entró, en cuántas reservas y de a cuántos. Elegí una noche o un evento.
          </span>
        }
      />
      <ComoNosFueDashboard
        tenantSlug={tenantSlug}
        view={view}
        day={day}
        today={today}
        recentDays={recentDays}
        dayReport={dayReport}
        templates={templates}
        templatesTruncated={templateOptions.truncated}
        templateId={templateId}
        templateReport={templateReport}
      />
    </PageShell>
  )
}
