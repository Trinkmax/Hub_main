/**
 * De quién es cada mesa — PURO y testeado (`tests/lib/pos-floor-prep.test.ts`).
 *
 * Pedido de Nacho (26/11/2026): «que a cada mozo se le filtren sus comandas […] el mozo debe ver las que
 * él atiende; las ya atendidas por otro mozo le tienen que aparecer así, bloqueadas o atendidas».
 *
 * Cada mesa abierta tiene quién la atiende (`table_sessions.waiter_id`: el mozo que la abrió, el primer
 * mozo que le cargó un pedido, o quien el encargado puso a mano). Con eso:
 *   · a un MOZO, la mesa de otro se le muestra tomada: apagada, con candado y el nombre de quien la
 *     atiende. No la abre ni le carga nada. Si hace falta, se la pasa el encargado o su compañero;
 *   · al encargado (dueño, caja, anfitriona) no se le bloquea nada: ve quién atiende cada una y la pasa
 *     a quien haga falta;
 *   · una mesa que todavía no atiende nadie (la sentó la anfitriona) es de quien la tome.
 */
import type { TenantRole } from '@/lib/tenant/types'

/** `mine` = la atiendo yo · `other` = la atiende otra persona · `none` = todavía nadie. */
export type TableOwner = 'mine' | 'other' | 'none'

export function tableOwner(
  waiterId: string | null | undefined,
  me: string | null | undefined,
): TableOwner {
  if (!waiterId) return 'none'
  return me && waiterId === me ? 'mine' : 'other'
}

/** A este rol, ¿una mesa de otra persona se le muestra tomada (sin poder operarla)? Solo al mozo. */
export function isLockedFor(
  role: TenantRole | string | null | undefined,
  owner: TableOwner,
): boolean {
  return role === 'waiter' && owner === 'other'
}

/** Quién reparte las mesas: no se les bloquea ninguna y las pueden pasar o dejar sin nadie. */
const MANAGER_ROLES: ReadonlySet<string> = new Set(['owner', 'cashier', 'host'])

export function isFloorManager(role: TenantRole | string | null | undefined): boolean {
  return typeof role === 'string' && MANAGER_ROLES.has(role)
}

/**
 * Qué puede hacer esta persona con quién atiende una mesa (lo mismo que decide `pos_assign_waiter`):
 *   `take`   tomarla (no la atiende nadie);
 *   `pass`   pasársela a alguien (es suya, o es quien reparte);
 *   `clear`  dejarla sin nadie (solo quien reparte).
 */
export function waiterMoves(
  role: TenantRole | string | null | undefined,
  owner: TableOwner,
): { take: boolean; pass: boolean; clear: boolean } {
  const manager = isFloorManager(role)
  if (manager) return { take: owner !== 'mine', pass: true, clear: owner !== 'none' }
  if (role === 'waiter') return { take: owner === 'none', pass: owner === 'mine', clear: false }
  return { take: false, pass: false, clear: false }
}

/** El nombre en corto, para una bandera chica: «Sofía Giménez» → «Sofía». */
export function shortName(name: string | null | undefined): string {
  const clean = (name ?? '').trim()
  if (!clean) return ''
  const first = clean.split(/\s+/)[0] ?? clean
  return first.length > 12 ? `${first.slice(0, 11)}…` : first
}
