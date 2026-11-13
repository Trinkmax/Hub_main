/**
 * Con qué billetes se cuenta la caja — PURO y testeado (`tests/lib/pos-settings-bills.test.ts`).
 *
 * Al cerrar el turno la caja se cuenta billete por billete. Acá se elige cuáles: de los que
 * existen, no un número suelto que alguien tipea.
 */

/** Los billetes de pesos en circulación, de mayor a menor. */
export const PESO_BILLS: ReadonlyArray<number> = [
  20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10,
]

/** Un tope de cordura para un valor que no está en la lista (un billete nuevo cargado a mano). */
const MAX_BILL = 1_000_000

/** Sin repetidos, solo pesos enteros, de mayor a menor. */
export function normalizeBills(bills: ReadonlyArray<number>): number[] {
  const clean = bills.filter((bill) => Number.isInteger(bill) && bill > 0 && bill <= MAX_BILL)
  return [...new Set(clean)].sort((a, b) => b - a)
}

/**
 * Los billetes que se ofrecen: los que existen y, si el bar ya usa alguno que no está en la
 * lista (salió uno nuevo), ese también, para que se pueda sacar.
 */
export function billChoices(current: ReadonlyArray<number>): number[] {
  return normalizeBills([...PESO_BILLS, ...current])
}

/**
 * Tocar un billete: lo suma o lo saca. `null` si era el último: una caja no se puede contar
 * sin billetes.
 */
export function toggleBill(current: ReadonlyArray<number>, bill: number): number[] | null {
  const now = normalizeBills(current)
  if (now.includes(bill)) {
    const next = now.filter((value) => value !== bill)
    return next.length === 0 ? null : next
  }
  return normalizeBills([...now, bill])
}

/** ¿Se puede guardar esta lista? Solo billetes que existen o que el bar ya usaba. */
export function billsAllowed(next: ReadonlyArray<number>, current: ReadonlyArray<number>): boolean {
  if (next.length === 0) return false
  const allowed = new Set(billChoices(current))
  return next.every((bill) => allowed.has(bill))
}
