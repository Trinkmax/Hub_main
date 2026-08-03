/**
 * Punch cards exclusivas de una categoría.
 *
 * Una tarjeta puede quedar atada a un set ARBITRARIO de niveles ("sólo Gold",
 * "Select y Black pero no Gold"). Sin niveles atados no hay restricción: es lo
 * que hace que todas las tarjetas que ya existían sigan andando igual.
 *
 * Esto es sólo la cara visible. Quien de verdad impide sellar es el trigger
 * `trg_customer_punch_cards_tier_guard` en la DB (migración 20260803120000):
 * la caja sella por Server Action y por trigger de cobro, así que el portero no
 * puede vivir en un componente.
 */

export type PunchCardTierGate = {
  /** Niveles habilitados. Vacío = todos. */
  tierIds: readonly string[]
  /** Si el socio que no llega la ve bloqueada (true) o directamente no la ve. */
  showWhenLocked: boolean
}

/** ¿Este socio puede sumar sellos en esta tarjeta? */
export function isPunchCardUnlocked(
  tierIds: readonly string[],
  currentTierId: string | null,
): boolean {
  if (tierIds.length === 0) return true
  if (!currentTierId) return false
  return tierIds.includes(currentTierId)
}

/**
 * Decide qué hace la billetera con cada tarjeta: mostrarla normal, mostrarla
 * bloqueada, o esconderla. Devolver `null` en vez de filtrar acá adentro deja
 * que el llamador use su propio tipo sin que este módulo lo conozca.
 */
export function resolvePunchCardLock(
  gate: PunchCardTierGate,
  currentTierId: string | null,
): { hidden: boolean; locked: boolean } {
  const unlocked = isPunchCardUnlocked(gate.tierIds, currentTierId)
  if (unlocked) return { hidden: false, locked: false }
  return { hidden: !gate.showWhenLocked, locked: true }
}

/**
 * Cómo se le nombra al socio el nivel que le falta. Un solo nivel se dice
 * derecho ("Exclusiva Gold"); varios se enumeran con "y" al final, que es como
 * se lee en castellano y no "Gold, Black".
 */
export function formatRequiredTiers(tierNames: readonly string[]): string {
  const clean = tierNames.filter((n) => n.trim().length > 0)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0] as string
  return `${clean.slice(0, -1).join(', ')} y ${clean[clean.length - 1]}`
}
