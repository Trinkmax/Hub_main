/**
 * Atribución de mozos a una sesión: split equitativo entre todos los que
 * tuvieron acción sobre la mesa.
 *
 * Política MVP — toda acción cuenta igual:
 *   - cualquier evento en `table_session_events` con `created_by_user_id NOT NULL`
 *     (session_opened, session_paid, session_abandoned, party_size_changed,
 *      alias_changed, session_merged, session_split, session_moved, etc.)
 *   - cualquier ticket con `created_by_user_id NOT NULL` (staff ticket).
 *
 * Cuando refinemos qué acciones cuentan, este helper es el único punto a tocar.
 */

export type WithStaffUser = { created_by_user_id: string | null }

/**
 * Devuelve el set de user_ids (Set para fácil intersect, pero la API expone
 * array para serialización JSON).
 */
export function staffForSession(events: WithStaffUser[], tickets: WithStaffUser[]): string[] {
  const set = new Set<string>()
  for (const e of events) {
    if (e.created_by_user_id) set.add(e.created_by_user_id)
  }
  for (const t of tickets) {
    if (t.created_by_user_id) set.add(t.created_by_user_id)
  }
  return Array.from(set)
}

/**
 * Reparte `total` entre N mozos. Si N=0 devuelve 0 (no crash, no atribución
 * — caso raro: sesión sin acciones de staff, que en práctica no debería
 * existir post-activación pero defendemos por las dudas).
 */
export function splitShare(total: number, staffCount: number): number {
  if (staffCount <= 0) return 0
  return total / staffCount
}

/**
 * Acumulador por user_id. Cada sesión aporta `share = total / staffCount` al
 * agregado del mozo. La cardinalidad de mesas atendidas (sessions_count) es el
 * conteo crudo: si un mozo participó en la sesión, cuenta como 1 mesa para él.
 */
export type StaffAccumulator = {
  user_id: string
  sessions_count: number
  party_size_share: number
  revenue_share_cents: number
  items_share: number
}

export function accumulateSession(
  acc: Map<string, StaffAccumulator>,
  staffUserIds: string[],
  partySize: number | null,
  totalCents: number,
  itemsTotalQuantity: number,
): void {
  const n = staffUserIds.length
  if (n === 0) return
  const partyShare = splitShare(partySize ?? 0, n)
  const revShare = splitShare(totalCents, n)
  const itemsShare = splitShare(itemsTotalQuantity, n)
  for (const uid of staffUserIds) {
    const cur = acc.get(uid) ?? {
      user_id: uid,
      sessions_count: 0,
      party_size_share: 0,
      revenue_share_cents: 0,
      items_share: 0,
    }
    cur.sessions_count += 1
    cur.party_size_share += partyShare
    cur.revenue_share_cents += revShare
    cur.items_share += itemsShare
    acc.set(uid, cur)
  }
}
