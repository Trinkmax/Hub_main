import { notFound } from 'next/navigation'
import { PageShell } from '@/components/ui/page-shell'
import { type BoardView, isBoardView } from '@/lib/marketing/constants'
import { listMarketingTasks, listMarketingTeam, listRoutinesForWeek } from '@/lib/marketing/queries'
import { currentWeekStart, isIsoDay, todayIso, weekLabel, weekStartOf } from '@/lib/marketing/week'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { MarketingBoard } from './_components/marketing-board'

export const metadata = { title: 'Tareas de marketing' }

// El tablero es colaborativo: si tres socios lo tienen abierto, ninguno puede
// estar mirando una versión cacheada de hace cinco minutos.
export const dynamic = 'force-dynamic'

export default async function TareasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ seccion?: string; semana?: string }>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  // La semana del checklist viaja por la URL para que el server pueda traer
  // los tildes correctos; se normaliza al lunes por si llega un día suelto.
  const weekStart = isIsoDay(sp.semana) ? weekStartOf(sp.semana) : currentWeekStart()
  const initialView: BoardView = isBoardView(sp.seccion) ? sp.seccion : 'eventos'

  const [tasks, team, routines] = await Promise.all([
    listMarketingTasks(access.tenant.id),
    listMarketingTeam(access.tenant.id),
    listRoutinesForWeek(access.tenant.id, weekStart),
  ])

  return (
    <PageShell width="comfortable">
      <MarketingBoard
        tenantSlug={tenantSlug}
        tasks={tasks}
        team={team}
        routines={routines}
        currentUserId={access.user.id}
        today={todayIso()}
        weekStart={weekStart}
        weekTitle={weekLabel(weekStart)}
        isCurrentWeek={weekStart === currentWeekStart()}
        initialView={initialView}
      />
    </PageShell>
  )
}
