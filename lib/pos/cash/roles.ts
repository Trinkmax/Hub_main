import type { TenantRole } from '@/lib/tenant/types'

/**
 * Quién puede qué en cobro y caja. Espejan las RPC `pos_*` de la migración
 * `pos_cobro_y_caja`, que son las que mandan: acá solo se corta antes para no
 * hacer el viaje.
 *
 *   · cobrar: ver la cuenta, cobrar una parte, cerrar la mesa, pedir un
 *     descuento o una baja y seguir su pedido. Es todo el salón.
 *   · caja: abrir y cerrar el turno, anotar retiros e ingresos, ver los números
 *     y la lista de cobros, anular y corregir un cobro.
 *
 * Quién aplica un descuento directo o da el OK a un pedido NO sale de acá: lo
 * decide el bar en `pos_settings.approver_roles` y lo resuelve la base (la
 * cuenta lo informa en `can`).
 */
export const POS_CHARGE_ROLES: ReadonlyArray<TenantRole> = ['owner', 'cashier', 'waiter', 'host']
export const POS_CASH_ROLES: ReadonlyArray<TenantRole> = ['owner', 'cashier']
