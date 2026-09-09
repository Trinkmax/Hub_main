/**
 * Reporte de señas: cuánta plata entra por señas y en qué día.
 *
 * Lo pidió el dueño así: "el dinero que ingresa por señas, cuánto ingresó por
 * día, teniendo en cuenta TODAS las reservas". Ese "todas" es literal y es lo
 * que separa este agregador del resto de los de salón:
 *
 * - **No se descarta nada por estado.** `covers.ts`, `month-capacity.ts` y
 *   `getRangeReservationTotals` sacan las canceladas y las no-show porque
 *   cuentan CUBIERTOS (gente que se sienta). Acá contamos PLATA, y la seña de
 *   una reserva que se cayó entró igual. Suma al total y además queda en su
 *   propio bucket para que nadie confunda "lo que entró" con "reservas en pie".
 * - **No se filtra por zona.** `event_floating` es gente real que pagó seña.
 *
 * La otra decisión del dueño es que el día se puede leer con dos criterios
 * (`DepositBasis`), y no son intercambiables: en el HUB, septiembre 2026 da
 * $3.291.266 por fecha de reserva y $2.637.266 por fecha de carga. La pantalla
 * tiene que decir siempre cuál está activo.
 *
 * Puro: sin DB ni React. `getDepositsByDay` (lib/salon/queries.ts) le pasa las
 * filas crudas y este archivo hace todas las cuentas, así que se testea con
 * fixtures.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import { eachIsoDayInclusive, isoDayInCordoba } from './date-presets'
import type { SalonReservationStatus } from './types'

/**
 * Criterio de fecha del reporte.
 * - `reservation`: el día en que la gente viene (`reservation_date`, un `date`
 *   puro que ya está en el calendario del bar).
 * - `created`: el día en que se cargó la reserva (`created_at`, timestamptz,
 *   pasado a America/Argentina/Cordoba).
 */
export type DepositBasis = 'reservation' | 'created'

export const DEPOSIT_BASIS_LABELS: Record<DepositBasis, string> = {
  reservation: 'Día de la reserva',
  created: 'Día de carga',
}

/**
 * Estados cuya seña se muestra aparte: la reserva se cayó. La plata suma al
 * total igual (el bar en general se la queda), pero se pinta separada.
 *
 * La DB no registra devoluciones: `deposit_cents` es la única columna de plata
 * de seña en todo el schema. Si una seña se devolvió, este reporte no puede
 * saberlo — por eso el corte es "vigente / caída", no "cobrado / devuelto".
 */
export const FALLEN_DEPOSIT_STATUSES = ['cancelled', 'no_show'] as const

/** Fila mínima del reporte: exactamente lo que trae el `.select()` de la query. */
export type DepositSourceRow = {
  /** `yyyy-MM-dd` — `date` puro, sin hora ni zona. */
  reservation_date: string
  /** ISO timestamptz tal cual lo devuelve PostgREST. */
  created_at: string
  /** Centavos. `bigint` en la DB: PostgREST lo puede mandar como string. */
  deposit_cents: number | string
  status: SalonReservationStatus
}

export type DepositDay = {
  /** `yyyy-MM-dd` en el calendario del bar. */
  day: string
  /** Señas de reservas en pie: pending, arrived, seated, closed. */
  active_cents: number
  /** cancelled + no_show. Suma al `total_cents`, se pinta aparte. */
  fallen_cents: number
  cancelled_cents: number
  no_show_cents: number
  /** `active_cents + fallen_cents`. */
  total_cents: number
  /** Reservas del día, con seña y sin seña. */
  reservations: number
  /** Reservas con `deposit_cents > 0`. */
  with_deposit: number
}

export type DepositTotals = {
  active_cents: number
  fallen_cents: number
  cancelled_cents: number
  no_show_cents: number
  total_cents: number
  reservations: number
  with_deposit: number
  /** Días del rango con al menos un peso de seña. */
  days_with_deposit: number
  /** El día más alto del rango; `null` si no entró un peso. */
  top_day: { day: string; total_cents: number } | null
  /**
   * Promedio y mediana, calculados SOLO sobre los días con seña.
   *
   * Van los dos porque difieren mucho: en el HUB el promedio diario es
   * $104.473 y la mediana $44.000 (2,4x). Un solo día de cumpleaños con una
   * seña de $254.300 corre el promedio; mostrarlo como "lo típico" mentiría.
   */
  avg_day_cents: number
  median_day_cents: number
}

export type DepositsReport = {
  basis: DepositBasis
  /** `yyyy-MM-dd` inclusive. */
  from: string
  /** `yyyy-MM-dd` inclusive. */
  to: string
  /** Un bucket por día del rango, en orden ascendente, incluidos los días en cero. */
  days: DepositDay[]
  totals: DepositTotals
  /** La lectura tocó el techo de filas: el total puede estar incompleto. */
  truncated: boolean
}

function isFallen(status: SalonReservationStatus): boolean {
  return (FALLEN_DEPOSIT_STATUSES as ReadonlyArray<string>).includes(status)
}

function emptyDay(day: string): DepositDay {
  return {
    day,
    active_cents: 0,
    fallen_cents: 0,
    cancelled_cents: 0,
    no_show_cents: 0,
    total_cents: 0,
    reservations: 0,
    with_deposit: 0,
  }
}

/** Mediana de una lista YA ordenada. Par → promedio de los dos del medio. */
function median(sorted: ReadonlyArray<number>): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

/**
 * Suma las señas por día. Puro y determinístico.
 *
 * Devuelve el rango DENSO (un bucket por día, con ceros incluidos) para que el
 * gráfico tenga eje continuo: entre la primera y la última reserva del HUB, el
 * 74% de los días de calendario no tiene ninguna. Un día en cero y un día que
 * no existe no son lo mismo, y con el rango denso la pantalla puede distinguir
 * "hubo reservas y ninguna dejó seña" de "no hubo nada".
 */
export function aggregateDepositsByDay(input: {
  basis: DepositBasis
  from: string
  to: string
  rows: ReadonlyArray<DepositSourceRow>
  truncated?: boolean
}): DepositsReport {
  const buckets = new Map<string, DepositDay>()
  for (const day of eachIsoDayInclusive(input.from, input.to)) {
    buckets.set(day, emptyDay(day))
  }

  for (const row of input.rows) {
    // `reservation_date` NO se parsea a Date: `new Date('2026-09-05')` es
    // medianoche UTC y en Córdoba (UTC-3) se lee como el 4. El string ya es el
    // día del bar. `created_at` sí necesita la conversión de zona.
    const day = input.basis === 'created' ? isoDayInCordoba(row.created_at) : row.reservation_date
    let bucket = buckets.get(day)
    if (!bucket) {
      // Fuera del rango pedido: la query ya filtra, pero el reducer no confía
      // en su input. (Comparar los `yyyy-MM-dd` como strings alcanza: ordenan
      // igual que las fechas.)
      if (day < input.from || day > input.to) continue
      // Dentro del rango pero sin bucket: el relleno de días con cero se corta
      // en `eachIsoDayInclusive`, y sin esto un rango más largo que ese tope
      // dejaría plata afuera EN SILENCIO — justo lo que un reporte de plata no
      // puede hacer. El eje del gráfico puede quedar ralo; el total, nunca mal.
      bucket = emptyDay(day)
      buckets.set(day, bucket)
    }

    // `deposit_cents` es bigint: PostgREST lo puede mandar como string y
    // `acc += row.deposit_cents` concatenaría en vez de sumar.
    const parsed = Number(row.deposit_cents ?? 0)
    const cents = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

    bucket.reservations += 1
    if (cents > 0) bucket.with_deposit += 1
    bucket.total_cents += cents
    if (isFallen(row.status)) {
      bucket.fallen_cents += cents
      if (row.status === 'cancelled') bucket.cancelled_cents += cents
      else bucket.no_show_cents += cents
    } else {
      bucket.active_cents += cents
    }
  }

  // Ordenado siempre: los buckets creados al vuelo entran al final del Map.
  const days = Array.from(buckets.values()).sort((a, b) => (a.day < b.day ? -1 : 1))

  const totals: DepositTotals = {
    active_cents: 0,
    fallen_cents: 0,
    cancelled_cents: 0,
    no_show_cents: 0,
    total_cents: 0,
    reservations: 0,
    with_deposit: 0,
    days_with_deposit: 0,
    top_day: null,
    avg_day_cents: 0,
    median_day_cents: 0,
  }

  const dailyAmounts: number[] = []
  for (const day of days) {
    totals.active_cents += day.active_cents
    totals.fallen_cents += day.fallen_cents
    totals.cancelled_cents += day.cancelled_cents
    totals.no_show_cents += day.no_show_cents
    totals.total_cents += day.total_cents
    totals.reservations += day.reservations
    totals.with_deposit += day.with_deposit
    if (day.total_cents > 0) {
      dailyAmounts.push(day.total_cents)
      if (!totals.top_day || day.total_cents > totals.top_day.total_cents) {
        totals.top_day = { day: day.day, total_cents: day.total_cents }
      }
    }
  }

  // Promedio y mediana solo sobre los días que tuvieron seña: promediar contra
  // los 31 del mes diría que un mes de $3M "rinde" lo mismo que uno repartido.
  totals.days_with_deposit = dailyAmounts.length
  if (dailyAmounts.length > 0) {
    const sum = dailyAmounts.reduce((acc, n) => acc + n, 0)
    totals.avg_day_cents = Math.round(sum / dailyAmounts.length)
    totals.median_day_cents = median([...dailyAmounts].sort((a, b) => a - b))
  }

  return {
    basis: input.basis,
    from: input.from,
    to: input.to,
    days,
    totals,
    truncated: input.truncated ?? false,
  }
}

/** Cabeceras de la planilla, en castellano, como en `lib/salon/export.ts`. */
export const DEPOSITS_EXPORT_HEADERS = [
  'Fecha',
  'Reservas',
  'Con seña',
  'Seña vigente ($)',
  'Canceladas ($)',
  'No vino ($)',
  'Total ($)',
] as const

/**
 * La planilla del reporte: `;` + BOM para que Excel en español la abra en
 * columnas y con tildes, y plata en PESOS ENTEROS SIN SÍMBOLO — con `$` o con
 * punto de miles, Excel es-AR lo lee como texto y el dueño no puede sumarlo.
 *
 * A diferencia del CSV de reservas (`lib/salon/export.ts`, que deja la celda
 * vacía cuando no hay seña), acá el 0 se escribe: la planilla es una serie
 * temporal y un hueco rompería cualquier gráfico o promedio hecho en Excel.
 */
export function depositsToCsv(report: DepositsReport): string {
  const pesos = (cents: number): string => String(Math.round(cents / 100))
  return rowsToCsv(
    [...DEPOSITS_EXPORT_HEADERS],
    report.days.map((d) => [
      d.day,
      String(d.reservations),
      String(d.with_deposit),
      pesos(d.active_cents),
      pesos(d.cancelled_cents),
      pesos(d.no_show_cents),
      pesos(d.total_cents),
    ]),
    { separator: ';', bom: true },
  )
}

/** `senas-hub-2026-09-01_2026-09-30.csv` / `senas-hub-carga-…csv`. */
export function depositsExportFilename(
  slug: string,
  report: Pick<DepositsReport, 'basis' | 'from' | 'to'>,
): string {
  // El criterio va en el nombre: los dos archivos del mismo mes traen números
  // distintos y sin esto quedan pisándose en la carpeta de Descargas.
  const criterio = report.basis === 'created' ? 'carga-' : ''
  return `senas-${slug}-${criterio}${report.from}_${report.to}.csv`
}
