/**
 * «Cómo se movió la plata» (Cajas y bancos › Saldos): del reporte por día de
 * `acc_report_cash_daily` a la serie del gráfico. Puro (sin React ni base).
 *
 * - La base manda SOLO los días con movimiento de cada caja y su saldo
 *   anterior: acá se completan los demás días arrastrando el saldo.
 * - Los saldos llegan Debe − Haber. En la tarjeta de la empresa eso es una
 *   deuda en negativo: se da vuelta y se lee como deuda (igual que en
 *   «Movimientos de una caja»), y lo que la hace subir son los consumos.
 * - «Todas las cajas» ya viene sumada de la base (cajas de activo, sin las
 *   tarjetas, como «Plata disponible»), sin contar la plata que se mueve de
 *   una caja a otra.
 */

import type { TreasuryKind } from '@/lib/accounting/types'
import {
  addDays,
  addMonthsToYearMonth,
  eachIsoDay,
  endOfMonth,
  formatRange,
  monthOf,
  PERIOD_PRESET_LABELS,
  startOfMonth,
} from '@/lib/dates'
import { formatCents, formatCentsShort, MINUS_SIGN, NBSP } from '@/lib/money'

// ─── Lo que manda la base ────────────────────────────────────────────────────

/** Un día con movimiento, como en los reportes: entró = Debe, salió = Haber, saldo = Debe − Haber. */
export type CashDailyDay = {
  day: string
  inCents: number
  outCents: number
  /** Saldo al cierre de ese día. */
  balanceCents: number
}

export type CashDailyAccount = {
  /** `null` = todas las cajas juntas. */
  treasuryId: string | null
  name: string
  /** `null` en «todas las cajas». */
  kind: TreasuryKind | null
  active: boolean
  /** Saldo al cierre del día anterior al período. */
  openingCents: number
  /** Saldo al cierre del último día del período. */
  closingCents: number
  /** Solo los días con movimiento, en orden. */
  days: CashDailyDay[]
}

export type CashDailyReport = {
  from: string
  to: string
  total: CashDailyAccount
  accounts: CashDailyAccount[]
}

/** Lo máximo que acepta la base por llamada. */
export const CASH_DAILY_MAX_DAYS = 366

// ─── Período y caja, desde la URL ────────────────────────────────────────────

/** `?periodo=` del gráfico: sin nada, los últimos 30 días. */
export const CASH_CHART_RANGE_PARAM = 'periodo'
/** `?grafico=<id de la caja>`: sin nada, todas. (`?caja=` es de las acciones rápidas.) */
export const CASH_CHART_ACCOUNT_PARAM = 'grafico'
export const CASH_CHART_ALL = 'todas'

export const CASH_CHART_RANGE_KEYS = ['ultimos-30-dias', 'este-mes', 'mes-pasado'] as const
export type CashChartRangeKey = (typeof CASH_CHART_RANGE_KEYS)[number]
export const CASH_CHART_DEFAULT_RANGE: CashChartRangeKey = 'ultimos-30-dias'

export type CashChartRange = {
  key: CashChartRangeKey
  from: string
  to: string
  /** «13/09 – 12/10/2026». */
  label: string
}

export type CashChartRangeOption = { key: CashChartRangeKey; label: string }

export const CASH_CHART_RANGE_OPTIONS: readonly CashChartRangeOption[] = CASH_CHART_RANGE_KEYS.map(
  (key) => ({ key, label: PERIOD_PRESET_LABELS[key] }),
)

function isRangeKey(value: string): value is CashChartRangeKey {
  return (CASH_CHART_RANGE_KEYS as readonly string[]).includes(value)
}

/**
 * El período del gráfico. «Este mes» llega hasta hoy (los días que faltan no
 * se dibujan); «Mes pasado» es el mes entero. Un valor que no es ninguno de
 * los tres cae en los últimos 30 días: el chip activo y las fechas del resumen
 * dicen siempre qué se está mirando.
 */
export function resolveCashChartRange(
  raw: string | null | undefined,
  today: string,
): CashChartRange {
  const value = (raw ?? '').trim()
  const key = isRangeKey(value) ? value : CASH_CHART_DEFAULT_RANGE
  let from: string
  let to = today
  if (key === 'este-mes') {
    from = startOfMonth(today)
  } else if (key === 'mes-pasado') {
    const month = addMonthsToYearMonth(monthOf(today), -1)
    from = startOfMonth(month)
    to = endOfMonth(month)
  } else {
    from = addDays(today, -29)
  }
  return { key, from, to, label: formatRange(from, to) }
}

// ─── La serie del gráfico ────────────────────────────────────────────────────

/** `card`: la tarjeta de la empresa, que se lee como deuda. */
export type CashDailyMode = 'money' | 'card'

export type CashDailyLabels = {
  /** Lo que hace subir la línea. */
  up: string
  /** Lo que la hace bajar. */
  down: string
  balance: string
}

export const CASH_DAILY_LABELS: Readonly<Record<CashDailyMode, CashDailyLabels>> = {
  money: { up: 'Entró', down: 'Salió', balance: 'Saldo' },
  card: { up: 'Consumos', down: 'Pagos', balance: 'Deuda' },
}

export type CashDailyPoint = {
  day: string
  /** Lo que hizo subir el saldo ese día: lo que entró (en la tarjeta, los consumos). */
  upCents: number
  /** Lo que lo hizo bajar: lo que salió (en la tarjeta, los pagos). */
  downCents: number
  /** Saldo al cierre del día, ya como se lee (en la tarjeta, la deuda en positivo). */
  balanceCents: number
  /** Si ese día hubo movimientos (si no, el saldo es el del día anterior). */
  moved: boolean
}

export type CashDailySeries = {
  mode: CashDailyMode
  /** Un punto por día del período, sin huecos. */
  points: CashDailyPoint[]
  /** Saldo con el que arrancó el período (el del cierre del día anterior). */
  openingCents: number
  /** Saldo del último día: el mismo que muestra la pantalla para esa caja. */
  closingCents: number
  /** Todo lo que subió y bajó en el período. */
  upCents: number
  downCents: number
  hasMovements: boolean
}

/** `-0` no es un saldo. */
function flip(cents: number, sign: 1 | -1): number {
  return sign === 1 ? cents : -cents || 0
}

/**
 * Un punto por día del período: los días sin movimiento arrastran el saldo
 * del anterior (el primero, el saldo con el que arrancó). El saldo de un día
 * con movimiento es el que calculó la base, no una suma hecha acá.
 */
export function buildCashDailySeries(
  account: CashDailyAccount,
  range: { from: string; to: string },
): CashDailySeries {
  const mode: CashDailyMode = account.kind === 'credit_card' ? 'card' : 'money'
  const sign = mode === 'card' ? -1 : 1
  const byDay = new Map(account.days.map((d) => [d.day, d]))
  let balance = account.openingCents
  let upCents = 0
  let downCents = 0
  let hasMovements = false
  const points = eachIsoDay(range.from, range.to, CASH_DAILY_MAX_DAYS).map(
    (day): CashDailyPoint => {
      const row = byDay.get(day)
      if (row) balance = row.balanceCents
      const up = row ? (sign === 1 ? row.inCents : row.outCents) : 0
      const down = row ? (sign === 1 ? row.outCents : row.inCents) : 0
      upCents += up
      downCents += down
      if (row) hasMovements = true
      return {
        day,
        upCents: up,
        downCents: down,
        balanceCents: flip(balance, sign),
        moved: row !== undefined,
      }
    },
  )
  return {
    mode,
    points,
    openingCents: flip(account.openingCents, sign),
    closingCents: flip(balance, sign),
    upCents,
    downCents,
    hasMovements,
  }
}

// ─── Textos ──────────────────────────────────────────────────────────────────

function pesos(cents: number): string {
  return formatCentsShort(Math.abs(cents))
}

/** Un saldo de caja dentro de una frase: «$ 1.200» o «un descubierto de $ 1.200». */
function moneyPhrase(cents: number): string {
  return cents < 0 ? `un descubierto de ${pesos(cents)}` : pesos(cents)
}

/** La deuda de la tarjeta dentro de una frase (positivo = se debe). */
function debtPhrase(cents: number): string {
  if (cents > 0) return `una deuda de ${pesos(cents)}`
  if (cents < 0) return `${pesos(cents)} a favor`
  return 'sin deuda'
}

/**
 * El saldo de un día como texto, sin menos pelado: «$ 1.234,50» o
 * «Descubierto $ 1.234,50»; en la tarjeta, la deuda («$ X»), «A favor $ X» o
 * «Sin deuda».
 */
export function cashDailyBalanceText(
  mode: CashDailyMode,
  cents: number,
  decimals: 0 | 2 = 2,
): string {
  const amount = formatCents(Math.abs(cents), { decimals })
  if (mode === 'card') {
    if (cents > 0) return amount
    return cents < 0 ? `A favor ${amount}` : 'Sin deuda'
  }
  return cents < 0 ? `Descubierto ${amount}` : amount
}

/**
 * El gráfico dicho en palabras, para leerlo sin verlo: «Empezó en $ X y hoy
 * hay $ Y. En el período entró $ A y salió $ B.» Con `endsToday: false` (el
 * mes pasado) dice cómo terminó. Sin movimientos, solo la primera frase.
 */
export function cashDailySummary(series: CashDailySeries, opts: { endsToday: boolean }): string {
  const { openingCents: start, closingCents: end } = series
  let first: string
  if (series.mode === 'card') {
    const startText = start === 0 ? 'sin deuda' : `con ${debtPhrase(start)}`
    const endText = opts.endsToday
      ? end > 0
        ? `hoy la deuda es de ${pesos(end)}`
        : end < 0
          ? `hoy hay ${pesos(end)} a favor`
          : 'hoy no hay deuda'
      : end === 0
        ? 'terminó sin deuda'
        : `terminó con ${debtPhrase(end)}`
    first = `Empezó ${startText} y ${endText}.`
  } else {
    const startText = start < 0 ? `con ${moneyPhrase(start)}` : `en ${moneyPhrase(start)}`
    const endText = opts.endsToday
      ? `hoy hay ${moneyPhrase(end)}`
      : end < 0
        ? `terminó con ${moneyPhrase(end)}`
        : `terminó en ${moneyPhrase(end)}`
    first = `Empezó ${startText} y ${endText}.`
  }
  if (!series.hasMovements) return first
  const second =
    series.mode === 'card'
      ? `En el período hubo consumos por ${pesos(series.upCents)} y pagos por ${pesos(series.downCents)}.`
      : `En el período entró ${pesos(series.upCents)} y salió ${pesos(series.downCents)}.`
  return `${first} ${second}`
}

// ─── Lo que recibe la pantalla ───────────────────────────────────────────────

/** Una opción del selector con todo lo que el gráfico necesita para dibujarla. */
export type CashDailyView = {
  /** `todas` o el id de la caja: lo que viaja en `?grafico=`. */
  value: string
  label: string
  series: CashDailySeries
  summary: string
  /** Aclaración de cómo leerlo, si hace falta. */
  note: string | null
}

const TRANSFERS_NOTE = 'Mover plata de una caja a otra no cuenta como entrada ni como salida.'
const CARD_NOTE = 'Es una deuda: sube con los consumos y baja con los pagos.'

/**
 * «Todas las cajas» primero y después cada caja (en el orden de la pantalla),
 * ya con su serie y su resumen: el selector cambia de una a otra sin volver a
 * pedir nada.
 */
export function buildCashDailyViews(
  report: CashDailyReport,
  opts: { today: string },
): CashDailyView[] {
  const range = { from: report.from, to: report.to }
  const endsToday = report.to === opts.today
  const hasCards = report.accounts.some((a) => a.kind === 'credit_card')
  const view = (
    value: string,
    label: string,
    account: CashDailyAccount,
    note: string | null,
  ): CashDailyView => {
    const series = buildCashDailySeries(account, range)
    return { value, label, series, summary: cashDailySummary(series, { endsToday }), note }
  }
  const views: CashDailyView[] = [
    view(
      CASH_CHART_ALL,
      'Todas las cajas',
      report.total,
      hasCards ? `${TRANSFERS_NOTE} Las tarjetas de la empresa van aparte.` : TRANSFERS_NOTE,
    ),
  ]
  for (const account of report.accounts) {
    if (account.treasuryId === null) continue
    views.push(
      view(
        account.treasuryId,
        account.active ? account.name : `${account.name} (desactivada)`,
        account,
        account.kind === 'credit_card' ? CARD_NOTE : null,
      ),
    )
  }
  return views
}

function oneDecimal(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text.replace('.', ',')
}

/**
 * Importes cortos para el eje del gráfico: «$ 850», «$ 12,5 mil», «$ 4,3 M»,
 * «−$ 2 M». A mano (sin `Intl`), como el resto de la plata.
 */
export function formatAxisCents(cents: number): string {
  if (!Number.isFinite(cents)) return ''
  const value = Math.abs(cents) / 100
  let body: string
  if (value >= 999_500) body = `${oneDecimal(value / 1_000_000)}${NBSP}M`
  else if (value >= 1_000) {
    const thousands = value / 1_000
    body = `${thousands >= 100 ? String(Math.round(thousands)) : oneDecimal(thousands)}${NBSP}mil`
  } else body = String(Math.round(value))
  const shownZero = body === '0'
  return `${cents < 0 && !shownZero ? MINUS_SIGN : ''}$${NBSP}${body}`
}
