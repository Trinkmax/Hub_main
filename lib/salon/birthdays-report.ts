/**
 * «Cumpleaños» de Cómo nos fue: cuántos cumples tuvo el mes, día por día, con
 * cuánta gente, y qué cerró la pauta de cumpleaños que corre todo el mes.
 *
 * Este archivo hace TODAS las cuentas y arma TODOS los textos de la pestaña y
 * de su planilla: los componentes solo dibujan lo que sale de acá.
 *
 * Reglas (las dos primeras son decisiones del dueño, 23/09/2026):
 *
 * 1. **Un cumple = una reserva `kind = 'birthday'` en pie** (sin canceladas ni
 *    las que no vinieron). Entran TODAS, también las reservadas dentro de un
 *    evento: un cumple es un cumple. Se dice cuántas fueron dentro de uno.
 * 2. **La pauta se mide contra los cumples RESERVADOS en el mes**
 *    (`created_at` en el calendario del bar), sean para la fecha que sean. Es
 *    lo que producen los mensajes de ese mes: de los 58 festejados en
 *    septiembre, 12 se reservaron en agosto con los mensajes de agosto. El
 *    calendario y los totales, en cambio, van por el día del FESTEJO.
 * 3. **Personas = las contadas al cerrar cada mesa; si no se cerró, las
 *    reservadas** (`actual_guests ?? estimated_guests`), el mismo criterio que
 *    la cuenta de la noche y las comisiones. Si no coincide con lo reservado,
 *    se dice.
 * 4. **El cierre nunca pasa de 100 %** y es un techo: cuenta todos los cumples
 *    reservados, también los que llegaron por otro lado. Si hay más cumples
 *    que mensajes, se dice en palabras.
 * 5. **Lo que falta no es cero.** Sin fila: «Sin cargar». Sin mensajes:
 *    «Faltan cargar los mensajes». Ninguno se dibuja como un 0.
 * 6. **El mes en curso habla en «Por ahora»**; un mes que no empezó, en futuro.
 * 7. **Pantalla = CSV.** Mismos números, por los mismos formateadores que la
 *    pauta de eventos (`event-marketing.ts`).
 *
 * Puro: sin DB ni React.
 */

import { rowsToCsv } from '@/lib/stats/csv'
import {
  csvFormulaGuard,
  csvPercent,
  csvUsd,
  decimalEsAr,
  formatCount,
  formatLoadedAt,
  formatPercent,
  formatPerThousand,
  formatUsd,
  type MarketingPhase,
  monthNameOf,
  phaseOf,
  weekdayDayMonth,
} from './event-marketing'

// ─── Tipos ─────────────────────────────────────────────────────────────────

/** Una reserva de cumpleaños como llega de PostgREST (números a veces como string). */
export type BirthdayReservationRow = {
  id: string
  reservation_date: string
  created_at: string
  status: string
  estimated_guests: number | string | null
  actual_guests: number | string | null
  scheduled_event_id: string | null
}

/** Una fila de `birthday_marketing`, ya en unidades (salvo los centavos, que dicen serlo). */
export type BirthdayMarketingRow = {
  /** `YYYY-MM`. */
  ym: string
  adSpendUsdCents: number
  messages: number | null
  reach: number | null
  notes: string | null
  updatedAt: string
  /** Ya abreviado con `shortName` ('Nacho B.'). */
  updatedByName: string | null
}

export type BirthdayMonthPhase = 'past' | 'current' | 'future'

export type BirthdayDay = {
  /** `YYYY-MM-DD`. */
  day: string
  dayOfMonth: number
  /** `'sáb 20/09'`. */
  label: string
  phase: MarketingPhase
  birthdays: number
  guests: number
  /** De esos cumples, cuántos fueron dentro de un evento. */
  inEvents: number
  /** Cancelados o que no vinieron ese día. No cuentan como cumple. */
  fallen: number
}

export type BirthdayTile = {
  key: string
  label: string
  /** `null` = `—` con el motivo en `hint`. */
  value: string | null
  hint: string
}

/** Los cumples RESERVADOS en el mes: contra esto se mide la pauta (regla 2). */
export type BookedSummary = {
  birthdays: number
  guests: number
  /** Para qué mes se reservaron, en orden: `[{ ym: '2026-09', count: 46 }, …]`. */
  byMonth: Array<{ ym: string; count: number }>
}

export type BirthdayPautaReport = {
  sentence: string
  tiles: BirthdayTile[]
  /** «343 conversaciones no terminaron en un cumple reservado.» */
  gap: string | null
  /** Qué falta cargar para que la cuenta cierre. */
  missing: string | null
  ficha: Array<{ label: string; value: string }>
}

export type MonthBirthdayReport = {
  ym: string
  /** `'Septiembre de 2026'`. */
  monthLabel: string
  /** `'septiembre'`. */
  monthName: string
  phase: BirthdayMonthPhase
  truncated: boolean
  /** Celdas vacías antes del día 1 en una grilla que arranca el lunes. */
  leadingBlanks: number
  days: BirthdayDay[]
  /** El día con más cumples, para escalar el color del calendario. */
  maxBirthdaysInDay: number
  totals: {
    birthdays: number
    guests: number
    reservedGuests: number
    inEvents: number
    cancelled: number
    noShow: number
    /** Días antes de hoy. */
    celebrated: number
    /** De hoy en adelante. */
    upcoming: number
  }
  /** La oración de arriba. */
  headline: string
  /** Los tres números grandes: cumpleaños, personas, promedio. */
  tiles: BirthdayTile[]
  /** Aclaraciones debajo de los números (eventos, caídas, base de personas, día pico). */
  notes: string[]
  booked: BookedSummary
  /** «En septiembre se reservaron 57 cumples: 46 para septiembre y 11 para octubre.» */
  bookedLine: string
  marketing: BirthdayMarketingRow | null
  /** `null` sin pauta cargada. */
  pauta: BirthdayPautaReport | null
  howItsCalculated: string[]
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

const FALLEN = new Set(['cancelled', 'no_show'])

function toInt(value: number | string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

/** Lo contado si la mesa se cerró; lo reservado si no (regla 3). */
function billable(row: BirthdayReservationRow): number {
  return row.actual_guests === null || row.actual_guests === undefined
    ? toInt(row.estimated_guests)
    : toInt(row.actual_guests)
}

function cumples(n: number): string {
  return n === 1 ? '1 cumple' : `${formatCount(n)} cumples`
}

function cumpleanos(n: number): string {
  return n === 1 ? '1 cumpleaños' : `${formatCount(n)} cumpleaños`
}

function personas(n: number): string {
  return n === 1 ? '1 persona' : `${formatCount(n)} personas`
}

function mensajes(n: number): string {
  return n === 1 ? '1 mensaje' : `${formatCount(n)} mensajes`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `17.25` → `'17,3'` · `18` → `'18'`. Un decimal solo si hace falta. */
export function formatAverage(v: number): string {
  const text = decimalEsAr(v, 1, true)
  return text.endsWith(',0') ? text.slice(0, -2) : text
}

function monthPhase(ym: string, today: string): BirthdayMonthPhase {
  const current = today.slice(0, 7)
  if (ym < current) return 'past'
  if (ym === current) return 'current'
  return 'future'
}

function monthDays(ym: string): string[] {
  const year = Number(ym.slice(0, 4))
  const month = Number(ym.slice(5, 7))
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}

/** Lunes = 0 … domingo = 6, para una grilla que arranca el lunes. */
function mondayIndex(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number)
  const sunday0 = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return (sunday0 + 6) % 7
}

function monthLabelOf(ym: string): { monthName: string; monthLabel: string } {
  const name = monthNameOf(ym)
  return name
    ? { monthName: name, monthLabel: `${capitalize(name)} de ${ym.slice(0, 4)}` }
    : { monthName: ym, monthLabel: ym }
}

// ─── Los cumples reservados en el mes ────────────────────────────────────────

/** Los reservados en el mes (regla 2), en pie, agrupados por el mes del festejo. */
export function summarizeBooked(rows: ReadonlyArray<BirthdayReservationRow>): BookedSummary {
  const byMonth = new Map<string, number>()
  let birthdays = 0
  let guests = 0
  for (const row of rows) {
    if (FALLEN.has(row.status)) continue
    birthdays += 1
    guests += billable(row)
    const ym = row.reservation_date.slice(0, 7)
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1)
  }
  return {
    birthdays,
    guests,
    byMonth: [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ym, count]) => ({ ym, count })),
  }
}

/** «En septiembre se reservaron 57 cumples: 46 para septiembre y 11 para octubre.» */
export function bookedLine(ym: string, booked: BookedSummary, phase: BirthdayMonthPhase): string {
  const { monthName } = monthLabelOf(ym)
  if (phase === 'future') return `${capitalize(monthName)} todavía no empezó.`
  if (booked.birthdays === 0) {
    return phase === 'current'
      ? `Por ahora no se reservó ningún cumple en ${monthName}.`
      : `En ${monthName} no se reservó ningún cumple.`
  }
  const verb = booked.birthdays === 1 ? 'se reservó' : 'se reservaron'
  const head =
    phase === 'current'
      ? `Por ahora, en ${monthName} ${verb} ${cumples(booked.birthdays)} (${personas(booked.guests)})`
      : `En ${monthName} ${verb} ${cumples(booked.birthdays)} (${personas(booked.guests)})`
  // Si todos son del mismo mes, el desglose no agrega nada.
  if (booked.byMonth.length <= 1) {
    const only = booked.byMonth[0]
    return only && only.ym !== ym
      ? `${head}, todos para ${monthLabelOf(only.ym).monthName}.`
      : `${head}.`
  }
  const parts = booked.byMonth.map(
    ({ ym: target, count }) => `${formatCount(count)} para ${monthLabelOf(target).monthName}`,
  )
  const list = `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
  return `${head}: ${list}.`
}

/** `Cargó Nacho B. · 23/09 14:32`, o `Cargada el 23/09 14:32` si no sabemos quién. */
export function birthdayLoadedByLabel(row: BirthdayMarketingRow): string {
  const at = formatLoadedAt(row.updatedAt)
  return row.updatedByName ? `Cargó ${row.updatedByName} · ${at}` : `Cargada el ${at}`
}

// ─── La pauta ────────────────────────────────────────────────────────────────

/**
 * Las cuentas de la pauta de cumpleaños, ya redactadas. La usan la pestaña y
 * la vista previa del formulario, así que la previa no puede decir otra cosa
 * que la pantalla después de guardar.
 */
export function birthdayPautaReport(
  booked: BookedSummary,
  values: { adSpendUsd: number; messages: number | null; reach: number | null },
  phase: BirthdayMonthPhase,
): BirthdayPautaReport {
  const spend = values.adSpendUsd
  const spendText = formatUsd(spend)
  const { messages, reach } = values
  const live = phase !== 'past'
  const n = booked.birthdays

  // La oración de arriba.
  const pusimos = live
    ? `Por ahora: pusimos ${spendText} en la pauta de cumpleaños`
    : `Pusimos ${spendText} en la pauta de cumpleaños`
  const reservados =
    n === 0
      ? live
        ? 'todavía no se reservó ningún cumple'
        : 'no se reservó ningún cumple'
      : `${live ? 'van' : n === 1 ? 'se reservó' : 'se reservaron'} ${cumples(n)}${live ? ' reservados' : ''} (${personas(booked.guests)})`
  let sentence: string
  if (messages === null) sentence = `${pusimos}. Faltan cargar los mensajes.`
  else if (messages === 0) sentence = `${pusimos}, no escribió nadie y ${reservados}.`
  else {
    const llegaron = messages === 1 ? 'llegó 1 mensaje' : `llegaron ${mensajes(messages)}`
    sentence = `${pusimos}, ${llegaron} y ${reservados}.`
  }

  const tiles: BirthdayTile[] = []

  // Por mensaje.
  tiles.push(
    messages === null
      ? { key: 'perMessage', label: 'Por mensaje', value: null, hint: 'faltan cargar los mensajes' }
      : messages === 0
        ? { key: 'perMessage', label: 'Por mensaje', value: null, hint: 'no escribió nadie' }
        : {
            key: 'perMessage',
            label: 'Por mensaje',
            value: formatUsd(spend / messages),
            hint: `${spendText} ÷ ${mensajes(messages)}`,
          },
  )

  // De cierre (regla 4).
  let closing: BirthdayTile
  if (messages === null)
    closing = {
      key: 'closing',
      label: 'De cierre',
      value: null,
      hint: 'faltan cargar los mensajes',
    }
  else if (messages === 0)
    closing = {
      key: 'closing',
      label: 'De cierre',
      value: null,
      hint: 'sin mensajes no hay cierre',
    }
  else if (n > messages)
    closing = {
      key: 'closing',
      label: 'De cierre',
      value: null,
      hint: `${cumples(n)} y ${mensajes(messages)}: parte llegó por otro lado`,
    }
  else
    closing = {
      key: 'closing',
      label: 'De cierre',
      value: formatPercent(n / messages),
      hint:
        n === 0
          ? `ningún cumple de ${mensajes(messages)}`
          : `${cumples(n)} de ${mensajes(messages)}`,
    }
  tiles.push(closing)

  // Por cumple y por persona.
  tiles.push(
    n === 0
      ? { key: 'perBirthday', label: 'Por cumple', value: null, hint: 'ningún cumple reservado' }
      : {
          key: 'perBirthday',
          label: 'Por cumple',
          value: formatUsd(spend / n),
          hint: `${spendText} ÷ ${cumples(n)}`,
        },
  )
  tiles.push(
    booked.guests === 0
      ? { key: 'perGuest', label: 'Por persona', value: null, hint: 'ninguna persona reservada' }
      : {
          key: 'perGuest',
          label: 'Por persona',
          value: formatUsd(spend / booked.guests),
          hint: `${spendText} ÷ ${personas(booked.guests)}`,
        },
  )

  // Lo que falta cerrar: las conversaciones que no terminaron en un cumple.
  let gap: string | null = null
  if (messages !== null && messages > 0 && n <= messages) {
    const open = messages - n
    gap =
      open === 0
        ? 'Todos los mensajes terminaron en un cumple reservado.'
        : `${live ? 'Por ahora, ' : ''}${
            open === 1
              ? '1 conversación no terminó'
              : `${formatCount(open)} conversaciones no terminaron`
          } en un cumple reservado.`
  }

  const ficha: Array<{ label: string; value: string }> = []
  if (reach !== null && reach > 0) {
    ficha.push({ label: 'Alcance', value: formatCount(reach) })
    ficha.push({ label: 'Cada 1.000 alcanzados', value: formatUsd((spend / reach) * 1000) })
    if (messages !== null) {
      const ratio = messages / reach
      ficha.push({
        label: 'Escribió',
        value: `${formatPercent(ratio)} (${formatPerThousand(ratio)})`,
      })
    }
  }

  return {
    sentence,
    tiles,
    gap,
    missing: messages === null ? 'Faltan cargar los mensajes para sacar el cierre.' : null,
    ficha,
  }
}

// ─── El mes ──────────────────────────────────────────────────────────────────

export const BIRTHDAYS_HOW_ITS_CALCULATED: readonly string[] = [
  'Cumpleaños: reservas marcadas como cumpleaños que siguen en pie (sin las canceladas ni las que no vinieron). Entran también las que están dentro de un evento.',
  'El calendario y los totales van por el día del festejo.',
  'Personas: las contadas al cerrar cada mesa; si la mesa no se cerró, las reservadas.',
  'La pauta se compara con los cumpleaños RESERVADOS en el mes, sean para la fecha que sean: es lo que producen los mensajes de ese mes. Por eso puede no coincidir con los festejados.',
  'De cierre: cumples reservados sobre mensajes. Cuenta todos los cumples reservados, también los que llegaron por otro lado, así que es lo máximo que pudo cerrar la pauta.',
  'Mensajes: Meta no vuelve a contar a quien escribe de nuevo dentro de los 7 días.',
  'Las reservas se toman como están ahora: si se cancela una, estos números cambian.',
]

export function buildMonthBirthdayReport(input: {
  ym: string
  today: string
  /** Los cumples con fecha de festejo en el mes, caídos incluidos. */
  celebrated: ReadonlyArray<BirthdayReservationRow>
  /** Los cumples reservados en el mes (regla 2), para la fecha que sea. */
  bookedInMonth: ReadonlyArray<BirthdayReservationRow>
  marketing: BirthdayMarketingRow | null
  truncated: boolean
}): MonthBirthdayReport {
  const { ym, today } = input
  const { monthName, monthLabel } = monthLabelOf(ym)
  const phase = monthPhase(ym, today)
  const dayList = monthDays(ym)

  const byDay = new Map<string, BirthdayDay>(
    dayList.map((day) => [
      day,
      {
        day,
        dayOfMonth: Number(day.slice(8, 10)),
        label: weekdayDayMonth(day),
        phase: phaseOf(day, today),
        birthdays: 0,
        guests: 0,
        inEvents: 0,
        fallen: 0,
      },
    ]),
  )

  let reservedGuests = 0
  let cancelled = 0
  let noShow = 0
  for (const row of input.celebrated) {
    const cell = byDay.get(row.reservation_date)
    if (!cell) continue
    if (FALLEN.has(row.status)) {
      cell.fallen += 1
      if (row.status === 'cancelled') cancelled += 1
      else noShow += 1
      continue
    }
    cell.birthdays += 1
    cell.guests += billable(row)
    reservedGuests += toInt(row.estimated_guests)
    if (row.scheduled_event_id) cell.inEvents += 1
  }

  const days = dayList.map((d) => byDay.get(d) as BirthdayDay)
  const birthdays = days.reduce((s, d) => s + d.birthdays, 0)
  const guests = days.reduce((s, d) => s + d.guests, 0)
  const inEvents = days.reduce((s, d) => s + d.inEvents, 0)
  const celebrated = days.filter((d) => d.day < today).reduce((s, d) => s + d.birthdays, 0)
  const upcoming = birthdays - celebrated
  const maxBirthdaysInDay = days.reduce((m, d) => Math.max(m, d.birthdays), 0)
  const average = birthdays > 0 ? guests / birthdays : null

  // La oración de arriba.
  let headline: string
  if (birthdays === 0) {
    headline =
      phase === 'past'
        ? `En ${monthName} no hubo cumpleaños.`
        : phase === 'current'
          ? `Por ahora ${monthName} no tiene ningún cumpleaños reservado.`
          : `Todavía no hay cumpleaños reservados en ${monthName}.`
  } else if (phase === 'past') {
    headline = `En ${monthName} se ${birthdays === 1 ? 'festejó' : 'festejaron'} ${cumpleanos(birthdays)} con ${personas(guests)}.`
  } else if (phase === 'current') {
    const split =
      upcoming === 0
        ? ''
        : celebrated === 0
          ? ', todos de hoy en adelante'
          : `: ${formatCount(celebrated)} ya se ${celebrated === 1 ? 'festejó' : 'festejaron'} y ${formatCount(upcoming)} ${upcoming === 1 ? 'es' : 'son'} de hoy en adelante`
    headline = `Por ahora, ${monthName} tiene ${cumpleanos(birthdays)} con ${personas(guests)}${split}.`
  } else {
    headline = `${capitalize(monthName)} ya tiene ${cumpleanos(birthdays)} ${birthdays === 1 ? 'reservado' : 'reservados'}, con ${personas(guests)}.`
  }

  const tiles: BirthdayTile[] = [
    {
      key: 'birthdays',
      label: 'Cumpleaños',
      value: formatCount(birthdays),
      hint: birthdays === 0 ? 'en pie' : `${birthdays === 1 ? 'reserva' : 'reservas'} en pie`,
    },
    {
      key: 'guests',
      label: 'Personas',
      value: formatCount(guests),
      hint: 'entre todos los cumples',
    },
    {
      key: 'average',
      label: 'Por cumple',
      value: average === null ? null : formatAverage(average),
      hint: average === null ? 'sin cumples no hay promedio' : 'personas en promedio',
    },
  ]

  const notes: string[] = []
  if (inEvents > 0) {
    notes.push(
      inEvents === birthdays
        ? `${inEvents === 1 ? 'Fue' : 'Todos fueron'} dentro de un evento.`
        : `${formatCount(inEvents)} ${inEvents === 1 ? 'fue' : 'fueron'} dentro de un evento.`,
    )
  }
  if (cancelled + noShow > 0) {
    const parts: string[] = []
    if (cancelled > 0)
      parts.push(`${formatCount(cancelled)} ${cancelled === 1 ? 'se canceló' : 'se cancelaron'}`)
    if (noShow > 0) parts.push(`${formatCount(noShow)} no ${noShow === 1 ? 'vino' : 'vinieron'}`)
    notes.push(`No cuentan ${cumples(cancelled + noShow)} que se cayeron: ${parts.join(' y ')}.`)
  }
  if (birthdays > 0 && reservedGuests !== guests) {
    notes.push(
      `Las personas son las contadas al cerrar cada mesa; donde no se cerró, las reservadas (${personas(reservedGuests)} reservadas en total).`,
    )
  }
  if (maxBirthdaysInDay >= 2) {
    const peak = days.find((d) => d.birthdays === maxBirthdaysInDay)
    const ties = days.filter((d) => d.birthdays === maxBirthdaysInDay).length
    if (peak && ties === 1) {
      notes.push(
        `El día con más cumples ${peak.phase === 'past' ? 'fue' : 'es'} el ${peak.label}: ${formatCount(maxBirthdaysInDay)}.`,
      )
    }
  }

  const booked = summarizeBooked(input.bookedInMonth)
  const pauta = input.marketing
    ? birthdayPautaReport(
        booked,
        {
          adSpendUsd: input.marketing.adSpendUsdCents / 100,
          messages: input.marketing.messages,
          reach: input.marketing.reach,
        },
        phase,
      )
    : null

  return {
    ym,
    monthLabel,
    monthName,
    phase,
    truncated: input.truncated,
    leadingBlanks: dayList[0] ? mondayIndex(dayList[0]) : 0,
    days,
    maxBirthdaysInDay,
    totals: {
      birthdays,
      guests,
      reservedGuests,
      inEvents,
      cancelled,
      noShow,
      celebrated,
      upcoming,
    },
    headline,
    tiles,
    notes,
    booked,
    bookedLine: bookedLine(ym, booked, phase),
    marketing: input.marketing,
    pauta,
    howItsCalculated: [...BIRTHDAYS_HOW_ITS_CALCULATED],
  }
}

// ─── Planilla ────────────────────────────────────────────────────────────────

export const BIRTHDAY_EXPORT_HEADERS: readonly string[] = [
  'Fecha',
  'Día',
  'Cumpleaños',
  'Personas',
  'Personas por cumple',
  'Dentro de un evento',
  'Se cayeron',
]

/** El promedio como en pantalla (`formatAverage`): `14` y no `14,0`, sin puntos de miles. */
const csvAverage = (v: number) => {
  const text = decimalEsAr(v, 1, false)
  return text.endsWith(',0') ? text.slice(0, -2) : text
}

/**
 * La planilla del mes: un renglón por día, el total, y abajo la pauta en dos
 * columnas (dato; valor). Mismos números que la pantalla (regla 7).
 */
export function monthBirthdaysToCsv(report: MonthBirthdayReport): string {
  const rows: string[][] = report.days.map((d) => [
    d.day,
    d.label,
    String(d.birthdays),
    String(d.guests),
    d.birthdays > 0 ? csvAverage(d.guests / d.birthdays) : '',
    String(d.inEvents),
    String(d.fallen),
  ])
  const { totals } = report
  rows.push([
    'Total del mes',
    '',
    String(totals.birthdays),
    String(totals.guests),
    totals.birthdays > 0 ? csvAverage(totals.guests / totals.birthdays) : '',
    String(totals.inEvents),
    String(totals.cancelled + totals.noShow),
  ])

  const pair = (label: string, value: string) => [label, value, '', '', '', '', '']
  rows.push(pair('', ''))
  rows.push(pair('Pauta de cumpleaños', ''))
  rows.push(pair('Cumples reservados en el mes', String(report.booked.birthdays)))
  rows.push(pair('Personas de esos cumples', String(report.booked.guests)))
  for (const { ym, count } of report.booked.byMonth) {
    rows.push(pair(`  para ${monthLabelOf(ym).monthName}`, String(count)))
  }
  const m = report.marketing
  if (m) {
    const spend = m.adSpendUsdCents / 100
    const n = report.booked.birthdays
    rows.push(pair('Pauta USD', csvUsd(spend)))
    rows.push(pair('Mensajes', m.messages === null ? '' : String(m.messages)))
    rows.push(pair('Alcance', m.reach === null ? '' : String(m.reach)))
    rows.push(pair('Costo por mensaje USD', m.messages ? csvUsd(spend / m.messages) : ''))
    rows.push(pair('% de cierre', m.messages && n <= m.messages ? csvPercent(n / m.messages) : ''))
    rows.push(pair('Costo por cumple USD', n > 0 ? csvUsd(spend / n) : ''))
    rows.push(
      pair(
        'Costo por persona USD',
        report.booked.guests > 0 ? csvUsd(spend / report.booked.guests) : '',
      ),
    )
    rows.push(
      pair(
        'Conversaciones sin cumple reservado',
        m.messages !== null && n <= m.messages ? String(m.messages - n) : '',
      ),
    )
    rows.push(pair('Nota', m.notes ? csvFormulaGuard(m.notes) : ''))
  } else {
    rows.push(pair('Pauta USD', 'sin cargar'))
  }

  return rowsToCsv([...BIRTHDAY_EXPORT_HEADERS], rows, { separator: ';', bom: true })
}
