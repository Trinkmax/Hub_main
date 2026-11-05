import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { evaluateAudience } from './engine'
import { type AudienceReach, blockedFilter, optedInFilter, reachOf } from './reach-filters'
import { audienceFilterSchema } from './schemas'

/** Más «No contactar» que esto no se cuentan así: la pantalla vuelve al último conteo guardado. */
const BLOCKED_CAP = 1000

/** Los «No contactar» que aceptaron promos: los que la difusión deja afuera aunque estén en la lista. */
async function blockedIds(tenantId: string): Promise<string[] | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_blocked', true)
    .eq('opt_in_marketing', true)
    .is('deleted_at', null)
    .limit(BLOCKED_CAP)
  if (error) throw new Error(`audiences.blockedIds: ${error.message}`)
  const ids = (data ?? []).map((row) => row.id)
  return ids.length >= BLOCKED_CAP ? null : ids
}

async function reachOfFilters(
  tenantId: string,
  rawFilters: unknown,
  blocked: string[],
): Promise<AudienceReach | null> {
  const parsed = audienceFilterSchema.safeParse(rawFilters)
  if (!parsed.success) return null
  const filter = parsed.data
  const [all, optedIn, optedInBlocked] = await Promise.all([
    evaluateAudience(tenantId, filter, { limit: 1 }),
    evaluateAudience(tenantId, optedInFilter(filter), { limit: 1 }),
    blocked.length > 0
      ? evaluateAudience(tenantId, blockedFilter(filter, blocked), { limit: 1 })
      : Promise.resolve({ total: 0, customerIds: [] }),
  ])
  return reachOf(all.total, optedIn.total, optedInBlocked.total)
}

/**
 * Cuántos son hoy y a cuántos les llega cada lista. La pantalla mostraba el conteo de cuando se guardó la lista, y a
 * todos, aunque solo les llega a los que aceptan promos: en HUB decía 5 cuando eran 159. Lo que no se pudo contar no
 * va en el mapa, y la pantalla dice el último conteo guardado. Solo del lado del servidor, para quien ya es dueño.
 */
export async function audiencesReachToday(
  tenantId: string,
  audiences: ReadonlyArray<{ id: string; filters: unknown }>,
): Promise<Map<string, AudienceReach>> {
  const out = new Map<string, AudienceReach>()
  if (audiences.length === 0) return out
  try {
    const blocked = await blockedIds(tenantId)
    if (blocked === null) return out
    const counted = await Promise.all(
      audiences.map(async (audience) => {
        try {
          return [audience.id, await reachOfFilters(tenantId, audience.filters, blocked)] as const
        } catch (error) {
          console.error('[audiences.reachToday]', (error as Error).message)
          return [audience.id, null] as const
        }
      }),
    )
    for (const [id, reach] of counted) if (reach) out.set(id, reach)
  } catch (error) {
    console.error('[audiences.reachToday]', (error as Error).message)
  }
  return out
}
