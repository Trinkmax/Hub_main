'use server'

import { requireTenantAccess } from '@/lib/tenant/access'
import type { LiveFloorData } from './queries'
import { getLiveFloor } from './queries'

/**
 * Server Action para refrescar la vista en vivo de un área.
 * Llamado por LiveFloor en el onChange de Supabase Realtime (vía useDebouncedRefresh).
 * Acepta cualquier miembro del tenant (owner + staff); no requiere rol específico.
 */
export async function refreshLiveFloorAction(
  slug: string,
  areaId: string,
): Promise<{ ok: true; data: LiveFloorData } | { ok: false; message: string }> {
  try {
    const { tenant } = await requireTenantAccess(slug)
    const data = await getLiveFloor(tenant.id, areaId)
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar el plano'
    console.error('[floor-plan.refreshLiveFloorAction]', message)
    return { ok: false, message }
  }
}
