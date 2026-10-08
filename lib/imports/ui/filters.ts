/**
 * Los filtros de la revisión de un lote (`importar/[batchId]`): qué propuestas
 * se ven según `?ver=` y `?falta=`, con los números de cada pestaña. Puro: lo
 * usan la página (server) y los tests.
 */

import {
  NEED_KEYS,
  type NeedKey,
  PROPOSAL_STATUSES,
  type ProposalStatus,
} from '@/lib/imports/server/types'

export const REVIEW_FILTERS = ['revisar', 'listas', 'cargadas', 'no-se-cargan', 'todos'] as const
export type ReviewFilter = (typeof REVIEW_FILTERS)[number]

export const REVIEW_FILTER_COPY: Readonly<
  Record<ReviewFilter, { label: string; shortLabel?: string; statuses: readonly ProposalStatus[] }>
> = {
  revisar: {
    label: 'Para revisar',
    shortLabel: 'Revisar',
    statuses: ['needs_input', 'stale', 'error'],
  },
  listas: { label: 'Listas para cargar', shortLabel: 'Listas', statuses: ['ready', 'posting'] },
  cargadas: { label: 'Cargadas', statuses: ['posted'] },
  'no-se-cargan': { label: 'No se cargan', statuses: ['skipped', 'voided'] },
  todos: { label: 'Todos', statuses: [] },
}

/** Etiqueta corta de cada cosa que falta (los chips de «Para revisar»). */
export const NEED_SHORT_TEXT: Readonly<Record<NeedKey, string>> = {
  new_supplier: 'Proveedor nuevo',
  supplier_account: 'En qué gastás',
  supplier_inactive: 'Proveedor desactivado',
  condition_mismatch: 'Condición frente al IVA',
  other_taxes_as: 'Otros tributos',
  vat_rate: 'Sin alícuota de IVA',
  unsupported_voucher: 'Tipo que no se importa',
  receipt: 'Recibos',
  foreign_currency: 'Moneda extranjera',
  total_gap: 'El total no cierra',
  possible_duplicate: 'Posible repetido',
  mp_invoice: 'Factura de Mercado Pago',
  channel_method: 'Medio del cierre',
  pick_party: 'A quién corresponde',
  pick_treasury: 'La otra cuenta',
  counterpart_account: 'Qué es',
  unknown_tax: 'Impuesto que no conocemos',
  estimated_deductions: 'Descuentos estimados',
  accept_warning: 'Avisos',
  engine_error: 'No se pudo armar',
  manual: 'Se carga a mano',
}

export function isReviewFilter(value: unknown): value is ReviewFilter {
  return typeof value === 'string' && (REVIEW_FILTERS as readonly string[]).includes(value)
}

export function isNeedKey(value: unknown): value is NeedKey {
  return typeof value === 'string' && (NEED_KEYS as readonly string[]).includes(value)
}

/** Cuántas propuestas hay en cada pestaña (con el `byStatus` del resumen). */
export function filterCounts(
  byStatus: Readonly<Partial<Record<ProposalStatus, number>>>,
): Record<ReviewFilter, number> {
  const sum = (statuses: readonly ProposalStatus[]) =>
    statuses.reduce((acc, s) => acc + (byStatus[s] ?? 0), 0)
  const all = sum(PROPOSAL_STATUSES)
  return {
    revisar: sum(REVIEW_FILTER_COPY.revisar.statuses),
    listas: sum(REVIEW_FILTER_COPY.listas.statuses),
    cargadas: sum(REVIEW_FILTER_COPY.cargadas.statuses),
    'no-se-cargan': sum(REVIEW_FILTER_COPY['no-se-cargan'].statuses),
    todos: all,
  }
}

export type ResolvedReviewFilter = {
  filter: ReviewFilter
  /** Estados para `listImportProposals` (vacío = todos). */
  statuses: readonly ProposalStatus[]
  /** Solo las que necesitan esto (siempre dentro de «Para revisar»). */
  need: NeedKey | null
}

/**
 * La pestaña de la URL, o la que más sirve si no viene: «Para revisar» si hay
 * algo pendiente, «Listas» si hay para cargar, «Todos» si no. `?falta=` solo
 * vale con algo pendiente de ese tipo y deja la pestaña en «Para revisar».
 */
export function resolveReviewFilter(
  query: { ver?: string | null; falta?: string | null },
  counts: Readonly<Record<ReviewFilter, number>>,
  needs: Readonly<Partial<Record<NeedKey, number>>> = {},
): ResolvedReviewFilter {
  const need = isNeedKey(query.falta) && (needs[query.falta] ?? 0) > 0 ? query.falta : null
  if (need) return { filter: 'revisar', statuses: REVIEW_FILTER_COPY.revisar.statuses, need }
  let filter: ReviewFilter
  if (isReviewFilter(query.ver)) filter = query.ver
  else if (counts.revisar > 0) filter = 'revisar'
  else if (counts.listas > 0) filter = 'listas'
  else filter = 'todos'
  return { filter, statuses: REVIEW_FILTER_COPY[filter].statuses, need: null }
}

/** Los chips de «Para revisar»: cada cosa que falta con su número, la más común primero. */
export function needChips(
  needs: Readonly<Partial<Record<NeedKey, number>>>,
): Array<{ key: NeedKey; label: string; count: number }> {
  return NEED_KEYS.flatMap((key) => {
    const n = needs[key] ?? 0
    return n > 0 ? [{ key, label: NEED_SHORT_TEXT[key], count: n }] : []
  }).sort((a, b) => b.count - a.count || NEED_KEYS.indexOf(a.key) - NEED_KEYS.indexOf(b.key))
}

/** Página de la URL (`?pagina=`): entero ≥ 1 y dentro del total. */
export function pageFromQuery(raw: string | null | undefined, total: number, size: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  const last = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, last)
}
