/**
 * Lógica pura de decisión de cupo y reordenamiento de waitlist.
 * Espejo del comportamiento de las RPCs en SQL — base de la suite de tests
 * y de la preview UI antes de llamar a la RPC.
 */

export type ReservationDecision =
  | { kind: 'confirmed' }
  | { kind: 'waitlist'; position: number }
  | { kind: 'rejected'; reason: 'capacity_reached' | 'guests_exceed_capacity' }

export function decideReservation(input: {
  capacity: number | null
  confirmedSeats: number
  currentMaxWaitlistPosition: number
  guests: number
  waitlistEnabled: boolean
}): ReservationDecision {
  if (input.guests < 1) return { kind: 'rejected', reason: 'capacity_reached' }
  if (input.capacity !== null && input.guests > input.capacity) {
    return { kind: 'rejected', reason: 'guests_exceed_capacity' }
  }

  // Capacity null = ilimitado.
  if (input.capacity === null) return { kind: 'confirmed' }

  if (input.confirmedSeats + input.guests <= input.capacity) {
    return { kind: 'confirmed' }
  }
  if (input.waitlistEnabled) {
    return { kind: 'waitlist', position: input.currentMaxWaitlistPosition + 1 }
  }
  return { kind: 'rejected', reason: 'capacity_reached' }
}

/**
 * Toma una lista de waitlist (id + position actual) ordenada por position
 * ascendente y devuelve nuevas posiciones 1..N densas.
 */
export function compactWaitlist<T extends { id: string; waitlist_position: number | null }>(
  list: T[],
): { id: string; new_position: number }[] {
  const ordered = [...list].sort(
    (a, b) => (a.waitlist_position ?? Infinity) - (b.waitlist_position ?? Infinity),
  )
  return ordered.map((row, i) => ({ id: row.id, new_position: i + 1 }))
}

/**
 * Decide a quién promover de la waitlist tras cancelar una confirmed.
 * Recorre por orden y devuelve el primero que entra en lo liberado.
 */
export function pickPromotion(input: {
  capacity: number | null
  confirmedSeatsAfterCancel: number
  waitlist: { id: string; guests_count: number }[]
}): { id: string; guests_count: number } | null {
  if (input.capacity === null) {
    // Capacity ilimitada — promovemos al primero sí o sí.
    return input.waitlist[0] ?? null
  }
  for (const candidate of input.waitlist) {
    if (input.confirmedSeatsAfterCancel + candidate.guests_count <= input.capacity) {
      return candidate
    }
  }
  return null
}
