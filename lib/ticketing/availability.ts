import type { FunctionState, PublicFunction } from './types'

/**
 * Cuántos lugares le quedan a una función y cómo se dice.
 *
 * La cuenta de ocupados y guardados la hace la base (ticketing_event_seats):
 * acá solo se interpreta, así la cartelera, la página de la película y la
 * compra dicen siempre lo mismo.
 */

export function seatsLeft(capacity: number, taken: number, held: number): number {
  return Math.max(0, capacity - taken - held)
}

/**
 * Desde cuándo se avisa «Últimos N»: el 20 % del cupo, con techo de 10 y
 * piso de 1. En una función de 50 son 10 lugares; en una de 120 también 10
 * (24 sería mucho para hablar de «últimos»); en una de 4, el último.
 */
export function lastSeatsThreshold(capacity: number): number {
  return Math.max(1, Math.min(10, Math.ceil(capacity * 0.2)))
}

/**
 * `minParty` es el mínimo de personas de la película: con menos lugares que
 * eso (Cine y degustación se vende de a 2 y queda 1), para la venta online la
 * función ya está agotada.
 */
export function functionState(left: number, capacity: number, minParty = 1): FunctionState {
  if (left <= 0 || left < minParty) return 'sold_out'
  if (left <= lastSeatsThreshold(capacity)) return 'last'
  return 'available'
}

/** «Agotado» · «Último lugar» · «Últimos 4» · null (hay de sobra: no se dice). */
export function availabilityLabel(fn: Pick<PublicFunction, 'left' | 'state'>): string | null {
  if (fn.state === 'sold_out') return 'Agotado'
  if (fn.state === 'last') return fn.left === 1 ? 'Último lugar' : `Últimos ${fn.left}`
  return null
}

/**
 * ¿Todavía se vende? Hasta la hora de inicio, en el reloj del bar. `nowLocal`
 * es «YYYY-MM-DD HH:MM» en la zona del bar (ver dates.ts).
 */
export function isOnSale(date: string, time: string, nowLocal: string): boolean {
  return `${date} ${time.slice(0, 5)}` > nowLocal
}

/** La primera función con lugar, para preseleccionarla. */
export function firstAvailable(functions: PublicFunction[]): PublicFunction | null {
  return functions.find((f) => f.state !== 'sold_out') ?? null
}

/** Todas agotadas (o ninguna a la venta). */
export function allSoldOut(functions: PublicFunction[]): boolean {
  return functions.every((f) => f.state === 'sold_out')
}

/** Máximo de personas que se pueden elegir para una función. */
export function maxSelectable(fn: Pick<PublicFunction, 'left'>, maxPartySize: number): number {
  return Math.max(0, Math.min(fn.left, maxPartySize))
}

/**
 * Por qué no se puede comprar para esa cantidad de personas, o null si se
 * puede: «Se reserva desde 2 personas.» / «Para más de 10 personas,
 * escribinos.».
 */
export function partySizeError(partySize: number, min: number, max: number): string | null {
  if (partySize < min) return `Se reserva desde ${min} personas.`
  if (partySize > max) return `Para más de ${max} personas, escribinos.`
  return null
}
