import { isFeatureEnabled } from '@/lib/platform/features'
import type { Tenant } from '@/lib/tenant/types'

/**
 * Quién puede abrir el editor del plano: los bares con el punto de venta
 * prendido (`pos`), porque el mapa en vivo del salón se dibuja acá. Los
 * superadmins pasan siempre, igual que en `requireFeature` (pueden ver los
 * paneles ocultos).
 *
 * Pura: la usan la página (que corta con 404) y las acciones del editor.
 */
export function canUseFloorPlan(
  tenant: Pick<Tenant, 'feature_flags'>,
  isPlatformAdmin: boolean,
): boolean {
  return isPlatformAdmin || isFeatureEnabled(tenant, 'pos')
}
