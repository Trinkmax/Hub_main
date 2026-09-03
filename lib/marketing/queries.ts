import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { TenantRole } from '@/lib/tenant/types'
import type { TaskCategory, TaskKind, TaskStatus } from './constants'

export type MarketingTaskRow = {
  id: string
  title: string
  category: TaskCategory
  kind: TaskKind
  status: TaskStatus
  specifications: string | null
  notes: string | null
  fileUrl: string | null
  responsibleId: string | null
  involvedId: string | null
  idealDate: string | null
  definedDate: string | null
  updatedAt: string
}

/**
 * Todo el tablero de una sola vez. Son decenas de filas, no miles: traerlas
 * juntas deja el buscador y el filtro "Mis tareas" instantáneos en el cliente,
 * sin un round-trip por cada tecla. Si algún día explota, el corte natural es
 * por `category` (ya está el índice).
 */
export async function listMarketingTasks(tenantId: string): Promise<MarketingTaskRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marketing_tasks')
    .select(
      'id, title, category, kind, status, specifications, notes, file_url, responsible_user_id, involved_user_id, ideal_date, defined_date, updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[marketing.listTasks]', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    category: row.category as TaskCategory,
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    specifications: (row.specifications as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    fileUrl: (row.file_url as string | null) ?? null,
    responsibleId: (row.responsible_user_id as string | null) ?? null,
    involvedId: (row.involved_user_id as string | null) ?? null,
    idealDate: (row.ideal_date as string | null) ?? null,
    definedDate: (row.defined_date as string | null) ?? null,
    updatedAt: row.updated_at as string,
  }))
}

export type TeamMember = {
  id: string
  name: string
  role: TenantRole
}

/**
 * La gente asignable. Sale del RPC `get_marketing_team` porque los nombres
 * están repartidos entre `auth.users` (inaccesible vía PostgREST) y
 * `reservation_managers` — ver el comentario de la migración.
 */
export async function listMarketingTeam(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_marketing_team', { p_tenant: tenantId })

  if (error) {
    console.error('[marketing.listTeam]', error.message)
    return []
  }

  return ((data ?? []) as Array<{ member_id: string; member_name: string; member_role: string }>)
    .filter((r) => typeof r.member_id === 'string')
    .map((r) => ({
      id: r.member_id,
      name: r.member_name || 'Sin nombre',
      role: r.member_role as TenantRole,
    }))
}

export type RoutineRow = {
  id: string
  title: string
  description: string | null
  slots: number
  position: number
  /** Índices de slot ya tildados en la semana pedida. */
  doneSlots: number[]
}

/** El checklist orgánico de UNA semana, con los tildes ya cruzados. */
export async function listRoutinesForWeek(
  tenantId: string,
  weekStart: string,
): Promise<RoutineRow[]> {
  const supabase = await createClient()

  const [routinesRes, checksRes] = await Promise.all([
    supabase
      .from('marketing_routines')
      .select('id, title, description, slots, position')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('marketing_routine_checks')
      .select('routine_id, slot')
      .eq('tenant_id', tenantId)
      .eq('week_start', weekStart),
  ])

  if (routinesRes.error) {
    console.error('[marketing.listRoutines]', routinesRes.error.message)
    return []
  }
  if (checksRes.error) {
    console.error('[marketing.listRoutineChecks]', checksRes.error.message)
  }

  const bySlot = new Map<string, number[]>()
  for (const check of (checksRes.data ?? []) as Array<{ routine_id: string; slot: number }>) {
    const list = bySlot.get(check.routine_id)
    if (list) list.push(check.slot)
    else bySlot.set(check.routine_id, [check.slot])
  }

  return ((routinesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    slots: row.slots as number,
    position: row.position as number,
    doneSlots: bySlot.get(row.id as string) ?? [],
  }))
}
