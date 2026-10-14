import type {
  MonthStripMonth,
  MonthStripState,
} from '@/components/administracion/charts/month-strip'
import {
  addDays,
  capitalizeFirst,
  daysBetween,
  formatDate,
  formatIsoDay,
  isoDayInCordoba,
  MONTH_NAMES_SHORT,
  monthName,
  monthOf,
} from '@/lib/dates'

/**
 * Los meses de los libros como los ve un socio: qué pestaña es cada uno
 * (cerrado, falta cerrar, en curso, no empezó), cuál se abre sin `?mes=` y qué
 * dice el título del mes elegido. Puro: sale del período y de la fecha, sin
 * lecturas. Lo usan `/libros` y «Fin de mes», y lo prueban los tests.
 *
 * Por qué acá y no en la página: el título de `/libros` AFIRMA algo
 * («Septiembre terminó y falta cerrarlo») y decide cuál es EL botón de la
 * pantalla; esa regla tiene que ser una sola y poder probarse sin la base.
 */

/** Lo que hace falta de un período (las filas de `listFiscalYears` lo cumplen). */
export type MonthPeriod = {
  id: string
  kind: 'month' | 'fy_adjustments' | 'fy_opening'
  /** Primer día del mes (`yyyy-MM-01`). */
  month: string
  startsOn: string
  endsOn: string
  status: 'open' | 'closed'
  closedAt: string | null
  closedByName: string | null
}

/** «octubre»: el mes en minúscula, para armar oraciones. */
export function monthNoun(month: string): string {
  return monthName(Number(month.slice(5, 7)))
}

/** «Octubre». */
export function monthTitle(month: string): string {
  return capitalizeFirst(monthNoun(month))
}

/** «Oct»: el nombre corto de la pestaña. */
export function monthShort(month: string): string {
  return capitalizeFirst(MONTH_NAMES_SHORT[Number(month.slice(5, 7)) - 1] ?? '')
}

/** Solo los meses calendario, en orden (sin «Apertura» ni «Ajustes de cierre»). */
export function monthPeriods<T extends MonthPeriod>(periods: readonly T[]): T[] {
  return periods
    .filter((p) => p.kind === 'month')
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
}

/** Cómo está un mes hoy. */
export function monthState(period: MonthPeriod, today: string): MonthStripState {
  if (period.status === 'closed') return 'closed'
  if (period.startsOn > today) return 'future'
  if (period.endsOn < today) return 'to_close'
  return 'current'
}

/** «Cerrado el 05/10/2026 por Franco» (lo que no entra en la pestaña). */
export function closedLine(period: Pick<MonthPeriod, 'closedAt' | 'closedByName'>): string {
  const when = period.closedAt ? ` el ${formatDate(period.closedAt)}` : ''
  const who = period.closedByName ? ` por ${period.closedByName}` : ''
  return `Cerrado${when}${who}`
}

/** «Lo cerró Franco el 05/10/2026.» */
export function closedSentence(period: Pick<MonthPeriod, 'closedAt' | 'closedByName'>): string {
  const when = period.closedAt ? ` el ${formatDate(period.closedAt)}` : ''
  return period.closedByName
    ? `Lo cerró ${period.closedByName}${when}.`
    : when
      ? `Se cerró${when}.`
      : 'Ya está cerrado.'
}

/**
 * Las pestañas del año, una por mes del ejercicio. `hrefFor` arma el link de
 * cada mes (`?mes=`); un mes que no empezó nunca lleva link. `alertIds` son los
 * períodos que cambiaron después de cerrarse (punto rojo + «Aviso»).
 */
export function monthStripModel(
  periods: readonly MonthPeriod[],
  opts: {
    today: string
    /** `yyyy-MM` del mes que se está viendo. */
    selected: string | null
    hrefFor: (month: string) => string
    alertIds?: ReadonlySet<string>
  },
): MonthStripMonth[] {
  return monthPeriods(periods).map((period) => {
    const key = monthOf(period.month)
    const state = monthState(period, opts.today)
    const title =
      state === 'closed'
        ? closedLine(period)
        : state === 'to_close'
          ? `Terminó el ${formatIsoDay(period.endsOn)} y sigue abierto`
          : state === 'current'
            ? `Se puede cerrar desde el ${formatIsoDay(addDays(period.endsOn, 1))}`
            : undefined
    return {
      key,
      label: monthShort(key),
      state,
      title,
      href: state === 'future' ? undefined : opts.hrefFor(key),
      selected: key === opts.selected,
      alert: opts.alertIds?.has(period.id) ?? false,
    }
  })
}

/** Cuántos días se queda la pantalla en un mes recién cerrado (el paso 3: mandar los libros). */
export const JUST_CLOSED_DAYS = 10

/**
 * El mes que se abre sin `?mes=`, para quien cierra: ① el primer mes abierto
 * que ya terminó (el que toca cerrar); ② si no hay, el último cerrado si se
 * cerró hace 10 días o menos (así, al cerrar, la pantalla se queda en ese mes
 * con «Mandale los libros» abierto); ③ si no, el mes de hoy.
 */
export function focusMonth(periods: readonly MonthPeriod[], today: string): string {
  const months = monthPeriods(periods)
  const toClose = months.find((p) => p.status === 'open' && p.endsOn < today)
  if (toClose) return monthOf(toClose.month)
  const lastClosed = [...months].reverse().find((p) => p.status === 'closed')
  if (lastClosed?.closedAt) {
    const closedDay = isoDayInCordoba(lastClosed.closedAt)
    if (closedDay) {
      const age = daysBetween(closedDay, today)
      if (age >= 0 && age <= JUST_CLOSED_DAYS) return monthOf(lastClosed.month)
    }
  }
  return monthOf(today)
}

/** El primer mes abierto anterior a `month` (los meses se cierran en orden). */
export function earlierOpenMonth<T extends MonthPeriod>(
  periods: readonly T[],
  month: string,
): T | null {
  const ym = month.slice(0, 7)
  return monthPeriods(periods).find((p) => p.status === 'open' && monthOf(p.month) < ym) ?? null
}

export type MonthHeadline = {
  kind: 'current' | 'to_close' | 'blocked' | 'closed' | 'unavailable'
  /** La afirmación: «Septiembre terminó y falta cerrarlo». */
  title: string
  sentence: string | null
  /** EL botón del mes (solo quien carga). */
  action: { label: string; href: string; emphasis: 'primary' | 'outline' } | null
  /** Un link de texto (la contadora: «Ver qué le falta para cerrarse»). */
  link: { label: string; href: string } | null
}

/**
 * El título del mes elegido en `/libros`: qué pasa con ese mes y cuál es el
 * paso siguiente. `unavailable` es el texto de `monthAvailabilityMessage` para
 * un mes sin libros (anterior al arranque, o que no empezó).
 */
export function monthHeadline(input: {
  /** `yyyy-MM`. */
  month: string
  period: MonthPeriod | null
  /** El primer mes abierto ANTERIOR a este, si hay. */
  earlierOpen: MonthPeriod | null
  today: string
  canWrite: boolean
  /** `/<bar>/administracion/libros`. */
  booksPath: string
  unavailable?: string | null
}): MonthHeadline {
  const { month, period, earlierOpen, today, canWrite, booksPath } = input
  const name = monthTitle(month)
  const noun = monthNoun(month)
  const closeHref = `${booksPath}/cierres?mes=${month}`

  if (!period || monthState(period, today) === 'future') {
    return {
      kind: 'unavailable',
      title: input.unavailable ?? `${name} ${month.slice(0, 4)} no tiene libros.`,
      sentence: null,
      action: null,
      link: null,
    }
  }

  if (period.status === 'closed') {
    return {
      kind: 'closed',
      title: `${name} está cerrado`,
      sentence: canWrite
        ? `${closedSentence(period)} Ya le podés mandar los libros a tu contadora.`
        : closedSentence(period),
      action: canWrite
        ? {
            label: 'Mandarle los libros a mi contadora',
            href: `${closeHref}#paso-3`,
            emphasis: 'primary',
          }
        : null,
      link: null,
    }
  }

  const readerLink = { label: 'Ver qué le falta para cerrarse', href: closeHref }
  const finished = period.endsOn < today

  if (!finished) {
    const from = formatIsoDay(addDays(period.endsOn, 1))
    const after = earlierOpen ? `, una vez cerrado ${monthNoun(earlierOpen.month)}` : ''
    return {
      kind: 'current',
      title: `${name} está en curso`,
      sentence: canWrite
        ? `Se puede cerrar desde el ${from}${after}. Lo que cargues con fecha de ${noun} entra en este mes.`
        : 'Sigue abierto: lo cierran los dueños.',
      action: canWrite
        ? { label: 'Ver cómo viene el fin de mes', href: closeHref, emphasis: 'outline' }
        : null,
      link: canWrite ? null : readerLink,
    }
  }

  if (earlierOpen) {
    const earlier = monthOf(earlierOpen.month)
    return {
      kind: 'blocked',
      title: `Antes de ${noun} hay que cerrar ${monthNoun(earlier)}`,
      sentence: canWrite
        ? 'Los meses se cierran en orden.'
        : 'Sigue abierto: lo cierran los dueños, en orden.',
      action: canWrite
        ? {
            label: `Ir a ${monthNoun(earlier)}`,
            href: `${booksPath}?mes=${earlier}`,
            emphasis: 'primary',
          }
        : null,
      link: canWrite ? null : readerLink,
    }
  }

  return {
    kind: 'to_close',
    title: `${name} terminó y falta cerrarlo`,
    sentence: canWrite
      ? 'Revisá los avisos y cerralo; después le mandás los libros a tu contadora.'
      : 'Sigue abierto: lo cierran los dueños.',
    action: canWrite
      ? { label: `Revisar y cerrar ${noun}`, href: closeHref, emphasis: 'primary' }
      : null,
    link: canWrite ? null : readerLink,
  }
}
