/**
 * Progreso de las tareas largas de los importadores (subir filas, cargar
 * comprobantes de a 15) y el resumen de cómo terminó cada carga. Puro: lo usan
 * los componentes y los tests.
 */

import type { PostItemOutcome, PostItemResult } from '@/lib/imports/server/types'
import { groupThousands, NBSP } from '@/lib/money'

/** `1240` → `'1.240'` (miles con punto, sin `Intl`: igual en el server y en el cliente). */
export function formatCount(n: number): string {
  const v = Number.isFinite(n) ? Math.trunc(n) : 0
  const sign = v < 0 ? '-' : ''
  return `${sign}${groupThousands(String(Math.abs(v)))}`
}

/** `count(3, 'comprobante', 'comprobantes')` → `'3 comprobantes'` (espacio duro en el medio). */
export function count(n: number, one: string, many: string): string {
  return `${formatCount(n)}${NBSP}${n === 1 ? one : many}`
}

/** Porcentaje entero de 0 a 100 (sin total, 0). */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  const pct = Math.floor((Math.max(0, done) / total) * 100)
  return Math.min(100, Math.max(0, pct))
}

/** «Cargando 45 de 142…» (o el verbo que toque). */
export function progressText(verb: string, done: number, total: number): string {
  const d = Math.min(Math.max(0, done), Math.max(0, total))
  return `${verb} ${formatCount(d)} de ${formatCount(total)}…`
}

// ─── Cómo terminó una carga en tandas ────────────────────────────────────────

/** Lo que pasó con cada propuesta, agrupado para el resumen final. */
export type PostTally = {
  /** Quedaron cargadas (nuevas, reintentos que ya estaban hechos o ya cargadas antes). */
  posted: number
  /** Cambió algo desde la revisión: hay que mirar el asiento nuevo. */
  stale: number
  /** Les falta un dato (un aviso que aceptar, algo que cambió en la base). */
  needsInput: number
  /** No se pudieron cargar (con su motivo). */
  failed: number
  /** No se cargan (anuladas, ya cargadas en otro lado). */
  skipped: number
}

const BUCKET: Readonly<Record<PostItemOutcome, keyof PostTally>> = {
  posted: 'posted',
  replayed: 'posted',
  already_posted: 'posted',
  stale: 'stale',
  needs_input: 'needsInput',
  error: 'failed',
  not_found: 'failed',
  skipped: 'skipped',
}

export function emptyTally(): PostTally {
  return { posted: 0, stale: 0, needsInput: 0, failed: 0, skipped: 0 }
}

/** Suma los resultados de una tanda a lo que ya había. */
export function tallyResults(
  base: PostTally,
  results: readonly Pick<PostItemResult, 'outcome'>[],
): PostTally {
  const next = { ...base }
  for (const r of results) next[BUCKET[r.outcome]] += 1
  return next
}

/**
 * El resumen en palabras: «Se cargaron 140 comprobantes. 2 quedaron para
 * revisar.» Sin nada que decir de un grupo, no lo nombra.
 */
export function tallySummary(tally: PostTally, unit: readonly [string, string]): string {
  const parts: string[] = []
  if (tally.posted > 0) {
    parts.push(
      tally.posted === 1
        ? `Se cargó 1 ${unit[0]}.`
        : `Se cargaron ${count(tally.posted, unit[0], unit[1])}.`,
    )
  } else {
    parts.push(`No se cargó ningún ${unit[0]}.`)
  }
  const review = tally.stale + tally.needsInput
  if (review > 0) {
    parts.push(
      review === 1 ? '1 quedó para revisar.' : `${formatCount(review)} quedaron para revisar.`,
    )
  }
  if (tally.failed > 0) {
    parts.push(
      tally.failed === 1
        ? '1 no se pudo cargar: mirá el motivo en la lista.'
        : `${formatCount(tally.failed)} no se pudieron cargar: mirá el motivo en la lista.`,
    )
  }
  if (tally.skipped > 0) {
    parts.push(
      tally.skipped === 1
        ? '1 no se carga (ya estaba o se anuló).'
        : `${formatCount(tally.skipped)} no se cargan (ya estaban o se anularon).`,
    )
  }
  return parts.join(' ')
}
