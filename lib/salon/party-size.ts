/**
 * El TAMAÑO de cada mesa: cuántas personas entran en esa reserva.
 *
 * Lo pidieron los encargados el 23/09/2026 con esas palabras: "cuántas mesas de
 * 5 hay, cuántas de 4, cuántas de 3, cuántas de 2". No es lo mismo que los
 * cubiertos — 38 personas pueden ser 9 mesas o 19 — y es lo que define cómo se
 * arma el salón: seis mesas de 2 se juntan distinto que dos de 6.
 *
 * Los grupos son 1, 2, 3, 4, 5, 6 y "7 o más" (decisión del dueño). El último
 * es abierto a propósito: en la historia del HUB hay reservas de hasta 50
 * personas, y un chip por cada número dejaría una fila de veinte chips con 1
 * mesa cada uno. La distribución real al 23/09/2026 (reservas que ocupan mesa):
 * 1 → 11 · 2 → 271 · 3 → 57 · 4 → 51 · 5 → 13 · 6 → 18 · 7 o más → 96.
 *
 * Todo lo de acá es cálculo puro sobre filas ya traídas: sirve igual en un RSC
 * (la lista /reservas) que en el cliente (el tablero operativo).
 */

import { z } from 'zod'
import { coversOf, occupiesTable } from './services'
import type { ReservationWithJoins } from './types'

/** Los grupos, en el orden en que se leen. El valor viaja en la URL (`?mesa=`). */
export const PARTY_SIZE_BUCKETS = ['1', '2', '3', '4', '5', '6', '7mas'] as const

export type PartySizeBucket = (typeof PARTY_SIZE_BUCKETS)[number]

/** Desde cuántas personas entra todo en el último grupo. */
export const PARTY_SIZE_OPEN_FROM = 7

/** El borde: `?mesa=4`, `?mesa=7mas`. Cualquier otra cosa se ignora. */
export const partySizeBucketSchema = z.enum(PARTY_SIZE_BUCKETS)

export function isPartySizeBucket(value: unknown): value is PartySizeBucket {
  return typeof value === 'string' && (PARTY_SIZE_BUCKETS as ReadonlyArray<string>).includes(value)
}

/**
 * En qué grupo cae una cantidad de personas. `null` cuando no hay mesa que
 * armar (0 o un número roto): una reserva sin gente no es "una mesa de 0".
 */
export function partySizeBucket(guests: number): PartySizeBucket | null {
  if (!Number.isFinite(guests)) return null
  const people = Math.floor(guests)
  if (people < 1) return null
  if (people >= PARTY_SIZE_OPEN_FROM) return '7mas'
  return PARTY_SIZE_BUCKETS[people - 1] ?? null
}

// ──────────────────────────────────────────────────────────
// Textos (es-AR)
// ──────────────────────────────────────────────────────────

/** El título de la fila de chips. */
export const PARTY_SIZE_LEGEND = 'Personas por mesa'

/** El chip que saca el filtro. */
export const PARTY_SIZE_ALL_LABEL = 'Todas'
export const PARTY_SIZE_ALL_ARIA = 'mesas de cualquier tamaño'

/**
 * Lo que dice el chip. Solo el primero lleva la palabra "persona": con el
 * título de la fila arriba ("Personas por mesa"), repetirla siete veces es
 * ruido — pero sin ella en el 1 el chip se leería como un número suelto.
 */
export const PARTY_SIZE_LABELS: Record<PartySizeBucket, string> = {
  '1': '1 persona',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7mas': '7 o más',
}

/** Lo que el lector de pantalla tiene que decir del grupo: "mesas de 4 personas". */
export function partySizeAriaLabel(bucket: PartySizeBucket): string {
  if (bucket === '1') return 'mesas de 1 persona'
  if (bucket === '7mas') return 'mesas de 7 o más personas'
  return `mesas de ${bucket} personas`
}

function mesasLabel(n: number): string {
  return `${n} ${n === 1 ? 'mesa' : 'mesas'}`
}

function personasLabel(n: number): string {
  return `${n} ${n === 1 ? 'persona' : 'personas'}`
}

/**
 * El número del chip cuenta MESAS; las personas van en el título, porque las
 * dos preguntas conviven ("¿cuántas mesas de 4?" y "¿cuánta gente son?").
 */
export function partySizeCountLabel(count: PartySizeCount, opts?: { all?: boolean }): string {
  const base = `${mesasLabel(count.reservations)} · ${personasLabel(count.people)}`
  // El chip "Todas" puede no coincidir con el "N reservas" del encabezado: acá
  // se cuentan MESAS QUE SE ARMAN, y una cancelada o una que no vino sigue
  // listada pero no ocupa mesa. Se dice en el título en vez de cambiar el
  // criterio: el número de cada tamaño tiene que ser el mismo conjunto que se
  // ve al tocarlo.
  return opts?.all ? `${base} · no cuenta canceladas ni ausentes` : base
}

/**
 * El nombre accesible completo del chip. Con coma y no con "·": el punto medio
 * lo lee en voz alta cualquier lector de pantalla.
 */
export function partySizeChipAria(bucket: PartySizeBucket, count: PartySizeCount | null): string {
  return withCount(partySizeAriaLabel(bucket), count)
}

/** Lo mismo para el chip que saca el filtro. */
export function partySizeAllAria(count: PartySizeCount | null): string {
  return withCount(PARTY_SIZE_ALL_ARIA, count)
}

function withCount(base: string, count: PartySizeCount | null): string {
  if (!count) return base
  return `${base}: ${mesasLabel(count.reservations)}, ${personasLabel(count.people)}`
}

// ──────────────────────────────────────────────────────────
// Conteo y filtrado
// ──────────────────────────────────────────────────────────

/**
 * Lo mínimo para contar y filtrar por tamaño. Tiparlo por lo que se usa deja
 * que la página pida a la DB solo estas tres columnas en vez de traerse las
 * reservas enteras con sus joins para pintar unos chips.
 */
export type PartySizeCountable = Pick<
  ReservationWithJoins,
  'status' | 'estimated_guests' | 'actual_guests'
>

export type PartySizeCount = {
  /** Mesas: cuántas reservas de ese tamaño. */
  reservations: number
  /** La gente que suman esas mesas. */
  people: number
}

export type PartySizeTally = Record<PartySizeBucket, PartySizeCount>

export function emptyPartySizeTally(): PartySizeTally {
  return {
    '1': { reservations: 0, people: 0 },
    '2': { reservations: 0, people: 0 },
    '3': { reservations: 0, people: 0 },
    '4': { reservations: 0, people: 0 },
    '5': { reservations: 0, people: 0 },
    '6': { reservations: 0, people: 0 },
    '7mas': { reservations: 0, people: 0 },
  }
}

/**
 * Una reserva cancelada o que no vino NO es una mesa: no se arma, no ocupa
 * lugar y no tiene tamaño. Es la misma regla que usan los cubiertos del día
 * (`occupiesTable`), y la que hace que el número del chip sea exactamente la
 * cantidad de filas que se listan al tocarlo.
 */
export function matchesPartySize(r: PartySizeCountable, bucket: PartySizeBucket): boolean {
  return occupiesTable(r) && partySizeBucket(coversOf(r)) === bucket
}

/** Las filas de un tamaño. Sin tamaño elegido, la lista entera sin copiarla. */
export function filterByPartySize<T extends PartySizeCountable>(
  rows: T[],
  bucket: PartySizeBucket | null | undefined,
): T[] {
  if (!bucket) return rows
  return rows.filter((r) => matchesPartySize(r, bucket))
}

/**
 * Cuántas mesas y cuánta gente hay de cada tamaño. Cuenta solo las que ocupan
 * mesa; las canceladas y las no-show quedan afuera de los siete grupos.
 */
export function tallyPartySizes(rows: ReadonlyArray<PartySizeCountable>): PartySizeTally {
  const tally = emptyPartySizeTally()
  for (const r of rows) {
    if (!occupiesTable(r)) continue
    const people = coversOf(r)
    const bucket = partySizeBucket(people)
    if (!bucket) continue
    tally[bucket].reservations += 1
    tally[bucket].people += people
  }
  return tally
}

/** El total de los siete grupos, para el chip "Todas". */
export function totalPartySizes(tally: PartySizeTally): PartySizeCount {
  let reservations = 0
  let people = 0
  for (const bucket of PARTY_SIZE_BUCKETS) {
    reservations += tally[bucket].reservations
    people += tally[bucket].people
  }
  return { reservations, people }
}

/**
 * El mismo criterio, pero para PostgREST: la lista /reservas pagina en el
 * server, así que el tamaño tiene que filtrarse en la query (filtrar después
 * de traer la página daría 8 filas de 25 y un total que no coincide).
 *
 * Es `coalesce(actual_guests, estimated_guests)` escrito como lo entiende
 * PostgREST: o vinieron N, o todavía no se contaron y se esperaban N.
 * Verificado contra la base real: da las mismas filas que el `coalesce` en SQL.
 */
export function partySizePostgrestFilter(bucket: PartySizeBucket): string {
  const op = bucket === '7mas' ? `gte.${PARTY_SIZE_OPEN_FROM}` : `eq.${bucket}`
  return `actual_guests.${op},and(actual_guests.is.null,estimated_guests.${op})`
}
