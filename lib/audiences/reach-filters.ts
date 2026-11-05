import type { AudienceFilter } from './schemas'

/**
 * A cuántos les llega de verdad una lista: los que aceptan promos y no están en «No contactar», igual que
 * `materializeBroadcast` al mandar. Puro: lo usan las pantallas de Mensajería y Tex.
 */

const OPT_IN: AudienceFilter = {
  kind: 'condition',
  field: 'opt_in_marketing',
  op: 'is_true',
  value: null,
}

/** Los de la lista que aceptan promos: el primer filtro de `materializeBroadcast`. */
export function optedInFilter(filter: AudienceFilter): AudienceFilter {
  return { kind: 'group', op: 'AND', nodes: [filter, OPT_IN] }
}

/** De esos, los que están en «No contactar»: para restarlos. La condición no existe en el constructor. */
export function blockedFilter(filter: AudienceFilter, blockedIds: string[]): AudienceFilter {
  return {
    kind: 'group',
    op: 'AND',
    nodes: [filter, OPT_IN, { kind: 'static_list', customer_ids: blockedIds }],
  }
}

export type AudienceReach = {
  /** Los de la lista, hoy. */
  total: number
  /** Los que reciben: aceptan promos y no están en «No contactar». */
  reach: number
}

export function reachOf(total: number, optedIn: number, blocked: number): AudienceReach {
  return { total, reach: Math.max(0, optedIn - blocked) }
}
