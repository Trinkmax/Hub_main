/**
 * Los niveles de acceso a Administración (`acc_access.scope`). Pedido de los socios de HUB del
 * 22/11/2026: «dentro de administración, los empleados solo deberían poder ver compra y pagos».
 *
 * - `full` — Completo: todo Administración, como hasta ahora. Es el nivel de los socios, y el único
 *   que puede dar accesos.
 * - `purchases` — Solo compras y pagos: carga compras, gastos y pagos a proveedores y ve lo que se
 *   les debe. Nada más: ni ventas, ni cierres, ni sueldos, ni gastos fijos, ni saldos de las cajas,
 *   ni resumen, ni libros; tampoco anula comprobantes.
 *
 * Qué ve cada uno lo decide la base (la RLS y las RPC `acc_*`); acá vive lo que comparten la lectura
 * de la lista, las acciones y la pantalla de Ajustes › Accesos. Puro: sin `server-only`.
 */

import { ACCOUNTING_SCOPES, type AccountingScope } from '@/lib/tenant/types'

export { ACCOUNTING_SCOPES, type AccountingScope }

/** El nivel que se propone al dar un acceso nuevo: el prudente. Un socio se marca «Completo». */
export const DEFAULT_GRANT_SCOPE: AccountingScope = 'purchases'

/**
 * El nivel de una fila de `acc_access`. Si la columna todavía no existe (la app puede salir un rato
 * antes que la base) o trae algo que no conocemos, es `full`: así era todo acceso antes de los niveles.
 */
export function scopeOf(value: unknown): AccountingScope {
  return value === 'purchases' ? 'purchases' : 'full'
}

/** Dar accesos es cosa de socios: pide el nivel completo (la base lo exige con `admin_needs_full`). */
export function canGrantOthers(scope: AccountingScope): boolean {
  return scope === 'full'
}

type Ordered = { scope: AccountingScope; displayName: string }

/**
 * El orden de la lista: primero quienes ven todo, después quienes ven solo compras y pagos; adentro
 * de cada grupo, por nombre. «Da accesos» no mueve a nadie de lugar: prender ese interruptor a varios
 * seguidos no hace saltar las filas.
 */
export function compareAccessRows(a: Ordered, b: Ordered): number {
  if (a.scope !== b.scope) return a.scope === 'full' ? -1 : 1
  return a.displayName.localeCompare(b.displayName, 'es')
}
