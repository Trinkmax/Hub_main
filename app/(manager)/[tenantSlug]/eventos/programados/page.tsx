import { CalendarPlus, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { listPublishedShowsForDateRange } from '@/lib/events/queries'
import {
  getMonthCapacity,
  listScheduledEventsForDateRange,
  listScheduledTemplates,
} from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CalendarTabs } from './_components/calendar-tabs'

export const metadata = { title: 'Calendario' }
export const dynamic = 'force-dynamic'

function defaultRange(monthStr?: string): { from: string; to: string; ymCurrent: string } {
  const now = new Date()
  const ym =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr)
      ? monthStr
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [yStr, mStr] = ym.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const from = `${ym}-01`
  // Último día del mes:
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${ym}-${String(lastDay).padStart(2, '0')}`
  return { from, to, ymCurrent: ym }
}

export default async function CalendarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const monthStr = typeof sp.month === 'string' ? sp.month : undefined
  const defaultTab = sp.tab === 'eventos' ? 'eventos' : 'calendario'

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'cashier'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const { from, to, ymCurrent } = defaultRange(monthStr)
  const [events, shows, templates, monthCapacity] = await Promise.all([
    listScheduledEventsForDateRange({ tenantId: access.tenant.id, from, to }),
    listPublishedShowsForDateRange({ tenantId: access.tenant.id, from, to }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: false }),
    getMonthCapacity({ tenantId: access.tenant.id, ym: ymCurrent }),
  ])
  const activeTemplates = templates.filter((t) => t.active)

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Agenda"
        title="Calendario"
        description="Todo lo que pasa en el bar, mes a mes: los eventos programados a partir de tus formatos (Sushi Libre, Pizza Libre…) y los shows puntuales (fiestas, peñas). El catálogo de formatos vive en la pestaña Formatos."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/${tenantSlug}/eventos`}>
                <PartyPopper className="size-4" />
                Administrar shows
              </Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/eventos/programados/nuevo`}>
                <CalendarPlus className="size-4" />
                Programar evento
              </Link>
            </Button>
          </div>
        }
      />

      <CalendarTabs
        tenantSlug={tenantSlug}
        ym={ymCurrent}
        events={events}
        shows={shows}
        templates={templates}
        activeTemplates={activeTemplates}
        monthCapacity={monthCapacity}
        defaultTab={defaultTab}
      />
    </PageShell>
  )
}
