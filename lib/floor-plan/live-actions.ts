'use server'

import { z } from 'zod'
import { getFloorSnapshot } from '@/lib/pos/queries'
import type { FloorSnapshot } from '@/lib/pos/types'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { canUseFloorPlan } from './access'

const branchIdSchema = z.string().uuid()

/**
 * La foto del salón de una sucursal para la pestaña «En vivo» del editor: la misma que lee la
 * pantalla del mozo (`pos_floor_snapshot`). La RPC vuelve a chequear el rol contra el bar DE la
 * sucursal, así que una sucursal ajena devuelve «sin permiso» aunque alguien arme el id a mano.
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

  const result = await getFloorSnapshot(parsed.data)
  if (!result.ok) return { ok: false, message: result.error.message }
  return { ok: true, data: result.data }
}
