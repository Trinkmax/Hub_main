/**
 * Helpers para aplicar payloads de Supabase Realtime sobre arrays de state
 * sin re-fetchear la vista completa.
 *
 * Uso típico dentro de un useEffect:
 *
 * ```ts
 * subscribeChanges({
 *   channel: `kitchen-${tenantId}`,
 *   events: [{
 *     event: '*', table: 'tickets',
 *     filter: `tenant_id=eq.${tenantId}`,
 *     onChange: (payload) => setTickets(prev => mergeRow(prev, payload, t => t.id, keepActive))
 *   }],
 * })
 * ```
 *
 * Si el row no pasa el predicate `accept` (ej: cambió a status="done" y ya no
 * pertenece a la cola), lo removemos del array — equivale a un DELETE virtual.
 */

export type RealtimeRowEvent<Row> =
  | { eventType: 'INSERT'; new: Row; old?: undefined }
  | { eventType: 'UPDATE'; new: Row; old: Partial<Row> }
  | { eventType: 'DELETE'; new?: undefined; old: Partial<Row> }

export type AnyRealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new?: Record<string, unknown>
  old?: Record<string, unknown>
}

/**
 * Aplica un payload de Realtime sobre un array de rows.
 * - `getId`: extrae el id estable del row (usualmente `r => r.id`).
 * - `accept`: opcional. Predicate que decide si el row sigue perteneciendo
 *   al array después del cambio. Si retorna `false` para un INSERT/UPDATE,
 *   el row es removido (o no agregado). Útil para "filtros virtuales" que
 *   no podemos expresar en el server-side filter (ej: status whitelist).
 */
export function mergeRow<Row>(
  prev: Row[],
  payload: AnyRealtimePayload,
  getId: (row: Row) => string,
  accept?: (row: Row) => boolean,
): Row[] {
  if (payload.eventType === 'DELETE') {
    const oldId = (payload.old as { id?: string } | undefined)?.id
    if (!oldId) return prev
    return prev.filter((row) => getId(row) !== oldId)
  }

  const next = payload.new as Row | undefined
  if (!next) return prev

  if (accept && !accept(next)) {
    // El row no califica más para esta vista — comportamos como DELETE.
    const nextId = getId(next)
    return prev.filter((row) => getId(row) !== nextId)
  }

  if (payload.eventType === 'INSERT') {
    const nextId = getId(next)
    if (prev.some((row) => getId(row) === nextId)) return prev
    return [...prev, next]
  }

  // UPDATE
  const nextId = getId(next)
  let found = false
  const merged = prev.map((row) => {
    if (getId(row) === nextId) {
      found = true
      return next
    }
    return row
  })
  // Si no estaba (cambió de estado y antes no pasaba el filter), pero ahora sí,
  // lo agregamos.
  if (!found) return [...merged, next]
  return merged
}
