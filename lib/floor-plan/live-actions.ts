'use server'

import { z } from 'zod'
import { isFeatureEnabled } from '@/lib/platform/features'
import { getFloorSnapshot, listBranches } from '@/lib/pos/queries'
import type { FloorSnapshot } from '@/lib/pos/types'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { canUseFloorPlan } from './access'
import type { LiveFloorData } from './queries'
import { getLegacyFloorSnapshot, getLiveFloor } from './queries'

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

const branchIdSchema = z.string().uuid()

/**
 * La foto del salón de una sucursal para la pestaña «En vivo» del editor, siempre
 * con la forma que dibuja la maqueta:
 *
 * - Con punto de venta: la misma que lee la pantalla del mozo (`pos_floor_snapshot`).
 *   La RPC vuelve a chequear el rol contra el bar DE la sucursal, así que una
 *   sucursal ajena devuelve «sin permiso» aunque alguien arme el id a mano.
 * - Sin punto de venta: se arma con las mesas abiertas del servicio de mesa de
 *   siempre (`getLegacyFloorSnapshot`). Antes esos bares veían acá el plano viejo.
 *   La sucursal se busca entre las del bar de la dirección: una ajena no existe.
 *
 * Solo el dueño (es su editor).
 */
export async function refreshLiveModelAction(
  slug: string,
  branchId: string,
): Promise<{ ok: true; data: FloorSnapshot } | { ok: false; message: string }> {
  const parsed = branchIdSchema.safeParse(branchId)
  if (!parsed.success) return { ok: false, message: 'No encontré esa sucursal.' }

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    if (!canUseFloorPlan(access.tenant, access.isPlatformAdmin)) {
      return { ok: false, message: 'No tenés permiso.' }
    }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, message: 'No tenés permiso.' }
    }
    throw error
  }

  if (!isFeatureEnabled(access.tenant, 'pos')) {
    const branch = (await listBranches(access.tenant.id)).find((b) => b.id === parsed.data)
    if (!branch) return { ok: false, message: 'No encontré esa sucursal.' }
    try {
      const data = await getLegacyFloorSnapshot(access.tenant.id, {
        id: branch.id,
        name: branch.name,
        short_name: branch.short_name,
        slug: branch.slug,
        color: branch.color,
        is_default: branch.is_default,
      })
      return { ok: true, data }
    } catch (error) {
      console.error(
        '[floor-plan.liveModel] legacy',
        error instanceof Error ? error.message : 'desconocido',
      )
      return { ok: false, message: 'No se pudo leer el salón. Probá de nuevo.' }
    }
  }

  const result = await getFloorSnapshot(parsed.data)
  if (!result.ok) return { ok: false, message: result.error.message }
  return { ok: true, data: result.data }
}
