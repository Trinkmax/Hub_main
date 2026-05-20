import { ArrowLeft, CalendarPlus, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { listScheduledEventsForDateRange, listScheduledTemplates } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ScheduledEventsMonth } from './_components/scheduled-events-month'

export const metadata = { title: 'Eventos programados' }
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

export default async function ProgramadosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const monthStr = typeof sp.month === 'string' ? sp.month : undefined

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
  const [events, templates] = await Promise.all([
    listScheduledEventsForDateRange({ tenantId: access.tenant.id, from, to }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
  ])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/eventos`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver a Eventos
          </Link>
        }
        title="Eventos programados"
        description="Calendario mensual de Sushi Libre, Pizza Libre, Ramen y más. Cada instancia tiene su cupo y fecha."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/${tenantSlug}/eventos/templates`}>
                <Settings2 className="size-4" />
                Templates
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

      {templates.length === 0 ? (
        <EmptyState
          icon={Settings2}
          title="Configurá los templates primero"
          description="Sushi Libre, Pizza Libre, Ramen, etc. — necesitás al menos un template para programar eventos."
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/eventos/templates`}>
                <Settings2 className="size-4" />
                Crear templates
              </Link>
            </Button>
          }
        />
      ) : (
        <ScheduledEventsMonth
          tenantSlug={tenantSlug}
          ym={ymCurrent}
          events={events}
          templates={templates}
        />
      )}
    </div>
  )
}
