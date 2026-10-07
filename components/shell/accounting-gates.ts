import type { AccountingAccess } from '@/lib/tenant/types'

/**
 * Administración sin ningún acceso. Es el default de todo lo que el shell
 * muestra o esconde del módulo: si alguien se olvida de pasar el acceso real,
 * el menú y la paleta quedan cerrados (falla cerrado), nunca abiertos.
 */
export const NO_ACCOUNTING_ACCESS: Readonly<AccountingAccess> = Object.freeze({
  enabled: false,
  setUp: false,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
})

/**
 * Puerta de un ítem del menú lateral (contable, §H.0):
 * - `read`: ve Administración (contadora, o dueño con acceso, con el módulo
 *   prendido y configurado).
 * - `read_or_setup`: lo anterior o quien puede hacer la puesta en marcha. Es
 *   el «Resumen»: antes de configurar es la puerta al asistente.
 */
export type NavAccountingGate = 'read' | 'read_or_setup'

/**
 * Puerta de una entrada de ⌘K:
 * - `read`: navegación (libros, cajas, plan de cuentas).
 * - `write`: cargar, pagar, cobrar, cerrar. Nunca la contadora ni un dueño
 *   sin acceso: `write` ya llega en `false` para los dos desde la base.
 */
export type CommandAccountingGate = 'read' | 'write'

export function navAccountingAllows(
  gate: NavAccountingGate | undefined,
  access: AccountingAccess,
): boolean {
  if (!gate) return true
  return gate === 'read' ? access.read : access.read || access.canSetUp
}

export function commandAccountingAllows(
  gate: CommandAccountingGate | undefined,
  access: AccountingAccess,
): boolean {
  if (!gate) return true
  return gate === 'write' ? access.write : access.read
}
