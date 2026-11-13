import { isFeatureEnabled } from '@/lib/platform/features'
import type { Tenant } from '@/lib/tenant/types'

/**
 * Quién puede abrir el editor del plano: alcanza con CUALQUIERA de los dos
 * interruptores, el del plano (`floor_plan`) o el del punto de venta (`pos`),
 * porque el mapa en vivo del salón se dibuja acá. Los superadmins pasan
 * siempre, igual que en `requireFeature` (pueden ver los paneles ocultos).
 *
 * Pura: la usan la página (que corta con 404) y las acciones del editor.
 */
export function canUseFloorPlan(
  tenant: Pick<Tenant, 'feature_flags'>,
  isPlatformAdmin: boolean,
): boolean {
  return (
    isPlatformAdmin || isFeatureEnabled(tenant, 'floor_plan') || isFeatureEnabled(tenant, 'pos')
  )
}

/**
 * Los QR de mesa (imprimir, regenerar) viven detrás de `table_qr`: la hoja de
 * impresión y la carta de la mesa dan 404 sin ese interruptor, así que el
 * editor no ofrece un botón que lleva a una página que no existe.
 */
export function canUseTableQr(
  tenant: Pick<Tenant, 'feature_flags'>,
  isPlatformAdmin: boolean,
): boolean {
  return isPlatformAdmin || isFeatureEnabled(tenant, 'table_qr')
}
