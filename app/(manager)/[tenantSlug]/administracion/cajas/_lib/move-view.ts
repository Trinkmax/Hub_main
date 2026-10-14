/**
 * «Cómo se movió la plata»: el título que AFIRMA («Hay $ 31.409.348 más que
 * hace 30 días», no «Saldo por día») y los tramos del dibujo de lo que entró y
 * salió. Puro; lo prueba `tests/lib/administracion-cajas-vista.test.ts`.
 *
 * Las series y sus oraciones ya salen de `lib/accounting/cash-daily.ts`; acá
 * solo se arma lo que la pantalla agrega.
 */

import type { InOutBucket } from '@/components/administracion/charts/in-out-bars'
import { labelIndexes } from '@/components/administracion/charts/scale'
import type { CashDailySeries } from '@/lib/accounting/cash-daily'
import { capitalizeFirst, formatDayLabel, isRealIsoDay, monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/** Contra qué se compara el saldo: lo dice el período elegido. */
export type MoveFrame =
  /** «…que hace 30 días». */
  | { kind: 'days'; days: number }
  /** El mes en curso, hasta hoy: «…que al empezar octubre». */
  | { kind: 'month_to_date'; month: string }
  /** Un mes que ya terminó: «Septiembre terminó con…». */
  | { kind: 'past_month'; month: string }
  /** Un rango cualquiera: «…que al empezar el período». */
  | { kind: 'range'; endsToday: boolean }

function monthWord(month: string): string {
  // `yyyy-MM` o un día de ese mes.
  return monthName(Number(month.slice(5, 7))) || 'el mes'
}

/**
 * El título de «Cómo se movió»: cuánto cambió y contra cuándo.
 *
 * - `subject`: con el nombre de la caja («Caja tiene $ 120.000 más…»); sin
 *   él, «Hay $ X más…» (la píldora de al lado ya dice de qué caja se habla).
 * - `tooNew`: los libros arrancaron adentro del período, así que el saldo de
 *   antes no es un dato y no se compara contra un cero.
 * - En una tarjeta de la empresa lo que se mueve es la deuda.
 */
export function moveTitle(input: {
  series: Pick<CashDailySeries, 'mode' | 'openingCents' | 'closingCents'>
  frame: MoveFrame
  tooNew?: boolean
  /** El nombre de la caja, o de la tarjeta. */
  subject?: string | null
}): string {
  const { series, frame } = input
  const subject = (input.subject ?? '').trim()
  const diff = series.closingCents - series.openingCents
  const amount = formatCentsShort(Math.abs(diff))

  if (series.mode === 'card') {
    const debt = subject ? `La deuda de ${subject}` : 'La deuda'
    if (input.tooNew) return subject ? `Así viene la deuda de ${subject}` : 'Así viene la deuda'
    if (diff === 0) return `${debt} no cambió`
    return `${debt} ${diff > 0 ? 'subió' : 'bajó'} ${amount}`
  }

  if (input.tooNew) {
    return subject
      ? `Así viene ${subject} desde que arrancaste`
      : 'Así viene la plata desde que arrancaste'
  }

  const more = diff > 0 ? 'más' : 'menos'
  if (frame.kind === 'past_month' || (frame.kind === 'range' && !frame.endsToday)) {
    const when = frame.kind === 'past_month' ? monthWord(frame.month) : 'el período'
    // «Septiembre terminó con…» · «Caja terminó septiembre con…».
    const start = subject ? `${subject} terminó ${when}` : `${capitalizeFirst(when)} terminó`
    if (diff === 0) return `${start} con lo mismo que empezó`
    return `${start} con ${amount} ${more} de lo que empezó`
  }

  const against =
    frame.kind === 'days'
      ? `hace ${frame.days} ${frame.days === 1 ? 'día' : 'días'}`
      : frame.kind === 'month_to_date'
        ? `al empezar ${monthWord(frame.month)}`
        : 'al empezar el período'
  const has = subject ? `${subject} tiene` : 'Hay'
  if (diff === 0) return `${has} lo mismo que ${against}`
  return `${has} ${amount} ${more} que ${against}`
}

export type DayBuckets = {
  buckets: InOutBucket[]
  /** La aclaración del día de arranque, si quedó adentro del dibujo. */
  note: string | null
}

/** La misma aclaración que «Entró y salió» del Resumen (`inOutSummary`). */
export const OPENING_DAY_NOTE =
  'No cuenta el día en que arrancaste a llevar la cuenta: lo que había no es plata que entró.'

/**
 * La aclaración cuando la pantalla SÍ sabe separar lo que había al arrancar (la
 * ficha de una caja trae sus movimientos): se descuenta eso solo, y lo demás
 * de ese día se cuenta.
 */
export const OPENING_NOTE =
  'No cuenta lo que había al arrancar: no es plata que entró. La tarjeta de arriba lo dice aparte.'

/** Lo que había al arrancar, como llega de la base (Debe / Haber). */
type OpeningAmounts = { inCents: number; outCents: number }

/** Hasta cuántos días se rotulan todos en el eje de «entró y salió». */
const MAX_DAY_LABELS_ALL = 10
/** Con más días, cuántos llevan su número. */
const DAY_LABELS = 7

/**
 * Un tramo por día para «Lo que entró y lo que salió cada día», con los MISMOS
 * días que el dibujo del saldo de arriba (`balancePoints`): así las columnas
 * caen una debajo de la otra.
 *
 * El saldo inicial no es plata que entró: la base lo trae mezclado con lo del
 * día en que arrancan los libros, así que ese día va en cero y deja la nota.
 * Los días anteriores al arranque no se dibujan.
 *
 * Con `opening` (lo que había al arrancar, que la ficha de una caja conoce
 * porque trae sus movimientos) ese día no se pierde entero: se le descuenta
 * solo eso, y lo que se vendió o se pagó ese mismo día se dibuja. Es la misma
 * cuenta que hace la tarjeta de la ficha (`cajaHero`).
 *
 * En una tarjeta de la empresa «entró» son los pagos (bajan la deuda) y
 * «salió», los consumos.
 */
export function dayBuckets(
  series: Pick<CashDailySeries, 'mode' | 'points'>,
  opts: { booksStartDate?: string | null; opening?: OpeningAmounts | null } = {},
): DayBuckets {
  const start =
    typeof opts.booksStartDate === 'string' && isRealIsoDay(opts.booksStartDate)
      ? opts.booksStartDate
      : null
  const exact = opts.opening ?? null
  const card = series.mode === 'card'
  let skipped = false
  const buckets: InOutBucket[] = []
  for (const point of series.points) {
    if (start !== null && point.day < start) continue
    const isOpening = start !== null && point.day === start
    if (isOpening && point.moved) skipped = true
    // Como llegan de la base: en la tarjeta, lo que «entra» (Debe) son los pagos.
    const dayIn = card ? point.downCents : point.upCents
    const dayOut = card ? point.upCents : point.downCents
    const inCents = !isOpening ? dayIn : exact ? Math.max(0, dayIn - exact.inCents) : 0
    const outCents = !isOpening ? dayOut : exact ? Math.max(0, dayOut - exact.outCents) : 0
    buckets.push({
      key: point.day,
      label: formatDayLabel(point.day) || point.day,
      // En el eje, solo el número del día: cada carácter cuenta.
      shortLabel: String(Number(point.day.slice(8, 10))),
      inCents,
      outCents,
      emptyText: 'Sin movimientos',
    })
  }
  // Con un mes de días, el número de cada uno no entra en el celular y se pisan:
  // quedan unos siete, siempre con el último (hoy). El día igual se lee al tocar.
  const labeled = new Set(
    buckets.length <= MAX_DAY_LABELS_ALL
      ? buckets.map((_, i) => i)
      : labelIndexes(buckets.length, DAY_LABELS, [buckets.length - 1]),
  )
  return {
    buckets: buckets.map((bucket, i) => (labeled.has(i) ? bucket : { ...bucket, shortLabel: '' })),
    note: skipped ? (exact ? OPENING_NOTE : OPENING_DAY_NOTE) : null,
  }
}

/**
 * Lo mismo para el dibujo por semana (`weekBuckets` deja afuera, entero, el día
 * en que arrancan los libros y marca esa semana con `openingSkipped`): si la
 * pantalla sabe cuánto había al arrancar, a esa semana se le devuelve lo demás
 * de ese día. `openingDay` es lo que entró y salió ese día según la base.
 */
export function restoreOpeningDay<
  T extends { inCents: number; outCents: number; openingSkipped: boolean },
>(
  weeks: readonly T[],
  openingDay: OpeningAmounts | null | undefined,
  opening: OpeningAmounts | null | undefined,
): T[] {
  if (!openingDay || !opening) return [...weeks]
  return weeks.map((week) =>
    week.openingSkipped
      ? {
          ...week,
          inCents: week.inCents + Math.max(0, openingDay.inCents - opening.inCents),
          outCents: week.outCents + Math.max(0, openingDay.outCents - opening.outCents),
        }
      : week,
  )
}
