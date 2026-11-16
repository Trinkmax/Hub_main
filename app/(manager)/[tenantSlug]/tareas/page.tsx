import { notFound } from 'next/navigation'
import { isTaskView, type TaskView } from '@/lib/marketing/constants'
import { listMarketingTeam, listRoutinesForWeek, loadTaskBoard } from '@/lib/marketing/queries'
import { currentWeekStart, isIsoDay, todayIso, weekLabel, weekStartOf } from '@/lib/marketing/week'
import {
  MARKETING_GROUP_ROLES,
  MARKETING_TASK_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TaskBoard } from './_components/task-board'

export const metadata = { title: 'Tareas' }

// El tablero es colaborativo: si tres socios lo tienen abierto, ninguno puede
// estar mirando una versión cacheada de hace cinco minutos.
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?x=a&x=b` llega como lista: vale el primero. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

/**
 * Tareas (Marketing): el tablero estilo Monday que pidió Nacho Badra el
 * 15/11/2026. Lo trabajan dueños, Contenido y la anfitriona; los grupos los arma
 * el dueño. La URL lleva el estado que vale la pena mandar por WhatsApp:
 *   · `?tarea=<id>` abre esa tarea;
 *   · `?persona=yo|<id>` filtra (lo de cada uno);
 *   · `?grupo=<id>` baja hasta ese grupo;
 *   · `?vista=rutina&semana=yyyy-MM-dd` es la rutina de la semana (el «Orgánico»).
 * Los `?seccion=organico|mias` del tablero de septiembre siguen andando.
 */
export default async function TareasPage({
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
    requireRole(access.role, MARKETING_TASK_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const semana = first(sp.semana)
  const weekStart = isIsoDay(semana) ? weekStartOf(semana) : currentWeekStart()
  const vista = first(sp.vista)
  const seccion = first(sp.seccion)
  const view: TaskView = isTaskView(vista) ? vista : seccion === 'organico' ? 'rutina' : 'tablero'
  const persona = first(sp.persona)
  const person = persona === 'yo' || seccion === 'mias' ? access.user.id : uuidOrNull(persona)

  const [board, team, routines] = await Promise.all([
    loadTaskBoard(access.tenant.id),
    listMarketingTeam(access.tenant.id),
    listRoutinesForWeek(access.tenant.id, weekStart),
  ])

  return (
    <div className="@container mx-auto w-full max-w-7xl px-4 pb-12 pt-3 sm:px-6 lg:px-8">
      <TaskBoard
        tenantSlug={tenantSlug}
        tenantId={access.tenant.id}
        groups={board.groups}
        tasks={board.tasks}
        doneTotal={board.doneTotal}
        team={team}
        currentUserId={access.user.id}
        canManage={MARKETING_GROUP_ROLES.includes(access.role)}
        today={todayIso()}
        initialView={view}
        initialPerson={person}
        initialTaskId={uuidOrNull(first(sp.tarea))}
        initialGroupId={uuidOrNull(first(sp.grupo))}
        routines={routines}
        weekStart={weekStart}
        weekTitle={weekLabel(weekStart)}
        isCurrentWeek={weekStart === currentWeekStart()}
      />
    </div>
  )
}
