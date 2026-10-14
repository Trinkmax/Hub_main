/**
 * El Resumen de Administración («la plata hoy»): las cuentas y los textos, sin
 * I/O ni `server-only`. Lo prueba `tests/lib/accounting-home.test.ts`.
 *
 * Contesta, en este orden: ¿cuánta plata hay? → ¿qué me toca hoy? → ¿cómo viene
 * el mes? → ¿qué tengo que pagar? → ¿por dónde entra y por dónde se va?
 *
 * No reescribe fórmulas que ya tienen su lugar: la venta del mes sale de
 * `projection.ts`, los gastos fijos de `recurring-status.ts`, «con / sin
 * factura» de `invoiced.ts`. Acá se arma lo que el Resumen muestra con eso.
 *
 * Reglas de texto (contrato de diseño §1): de vos, frases cortas, sin jerga;
 * nunca «ganancia» (ventas menos compras no lo es); `null` no es cero (un dato
 * que falta no se dibuja como `$ 0`); nunca un menos pelado («descubierto»,
 * «faltan», «menos»). Todo en centavos enteros y fechas `yyyy-MM-dd`.
 *
 * Links: los campos `path` son siempre relativos a `/<bar>/administracion`
 * (como `where.path` de la guía); los `href` de las acciones también, salvo que
 * se pase `base`, y entonces salen completos.
 */

import {
  buildCashDailySeries,
  type CashDailyAccount,
  formatAxisCents,
} from '@/lib/accounting/cash-daily'
import { isNotInvoicedVoucher } from '@/lib/accounting/invoiced'
import type { OnboardingData, OnboardingState } from '@/lib/accounting/onboarding'
import type { Projection, ProjectionSummary } from '@/lib/accounting/projection'
import type { DailyCloseCalendar, RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import type { IntegrationAttentionItem } from '@/lib/accounting/queries/integrations'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type {
  AccSummary,
  SummaryAttentionItem,
  SummaryTreasury,
} from '@/lib/accounting/queries/summary'
import {
  type RecurringPaymentFacts,
  type RecurringRowFacts,
  recurringLine,
  recurringTotals,
} from '@/lib/accounting/recurring-status'
import type { TreasuryKind } from '@/lib/accounting/types'
import {
  addDays,
  capitalizeFirst,
  daysBetween,
  eachIsoDay,
  endOfWeek,
  formatDayMonth,
  formatIsoDay,
  isRealIsoDay,
  monthName,
  startOfMonth,
  startOfWeek,
  WEEKDAY_NAMES_SHORT,
  weekdayName,
  weekdayOf,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

// ─── Comunes ─────────────────────────────────────────────────────────────────

/**
 * La hoja de acción rápida que abre un botón del Resumen. Es un subconjunto de
 * `AccountingAction` (`components/administracion/acciones/types`): se escribe
 * acá para que `lib/` no dependa de `components/`.
 */
export type HomeSheet = 'gasto' | 'pagar' | 'cobrar' | 'ajustar'

/** Lo que la hoja precarga (ids). Entra tal cual en `openAction(sheet, params)`. */
export type HomeSheetParams = { proveedor?: string; cliente?: string; caja?: string }

/** La única acción de una tarjeta: ir a una pantalla o abrir una hoja sobre el Resumen. */
export type HomeAction =
  | { kind: 'href'; href: string; label: string }
  | { kind: 'sheet'; sheet: HomeSheet; params: HomeSheetParams; label: string }

/** Los tonos de `StatusPill`: al día · por vencer · vencido · aviso · sin novedad. */
export type HomeTone = 'ok' | 'warn' | 'late' | 'info' | 'muted'

function pesos(cents: number): string {
  return formatCentsShort(Math.abs(cents))
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** «lunes 12/10». */
function weekdayAndDay(iso: string): string {
  const weekday = weekdayName(iso)
  return weekday ? `${weekday} ${formatDayMonth(iso)}` : formatDayMonth(iso)
}

/** Parte de un total, de 0 a 100 con un decimal (0 si no hay total). */
function percentOf(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0
  return Math.round((part * 1000) / total) / 10
}

function link(base: string, path: string, label: string): HomeAction {
  return { kind: 'href', href: `${base}${path}`, label }
}

function validDay(value: string | null | undefined): string | null {
  return typeof value === 'string' && isRealIsoDay(value) ? value : null
}

// ─── 1. La plata hoy ─────────────────────────────────────────────────────────

/** Los seis colores de la paleta de datos (`--adm-s1` … `--adm-s6`). */
export type AdmSlot = 1 | 2 | 3 | 4 | 5 | 6
export const ADM_SLOT_COUNT = 6

type TreasuryLike = Pick<SummaryTreasury, 'id' | 'kind'>

/**
 * El color de cada caja. Sale de su ORDEN en la lista (el de Ajustes), contando
 * TODAS las cajas de plata y no solo las que hoy tienen saldo: así una caja no
 * cambia de color porque otra quedó en cero («el color sigue a la cosa»). La
 * séptima en adelante no tiene color propio (`null` → neutro, «Otras»): la
 * paleta nunca se cicla. La tarjeta de la empresa no entra (no es plata).
 */
export function treasurySlots(treasuries: readonly TreasuryLike[]): Record<string, AdmSlot | null> {
  const out: Record<string, AdmSlot | null> = {}
  let position = 0
  for (const t of treasuries) {
    if (t.kind === 'credit_card') continue
    position += 1
    out[t.id] = position <= ADM_SLOT_COUNT ? (position as AdmSlot) : null
  }
  return out
}

/** Los tipos de caja que tienen tono propio en la barra del héroe. */
export type TreasuryToneKind = 'bank' | 'cash' | 'wallet'

/**
 * El tono de una caja en la barra «dónde está la plata»: el TIPO da el color
 * (banco, efectivo, billetera) y el escalón distingue dos cuentas del mismo
 * tipo (el mismo tono, más claro o más oscuro).
 */
export type TreasuryTone = { kind: TreasuryToneKind; step: 1 | 2 | 3 }

/** Cuántas cuentas del mismo tipo tienen escalón propio; la cuarta va en neutro. */
export const TREASURY_TONE_STEPS = 3

function toneKind(kind: TreasuryKind): TreasuryToneKind | null {
  return kind === 'bank' || kind === 'cash' || kind === 'wallet' ? kind : null
}

/**
 * El tono de cada caja. El color es un atributo de la cosa (qué tipo de caja
 * es), no de cuánta plata tiene hoy: un banco con el 98 % no pinta el héroe de
 * un color cualquiera, y una caja no cambia de tono porque otra quedó en cero.
 * El escalón sale del orden entre TODAS las del mismo tipo (el de Ajustes).
 * `null`: no tiene tono propio (un tipo «otra», o la cuarta del mismo tipo).
 */
export function treasuryTones(
  treasuries: readonly TreasuryLike[],
): Record<string, TreasuryTone | null> {
  const out: Record<string, TreasuryTone | null> = {}
  const seen: Record<TreasuryToneKind, number> = { bank: 0, cash: 0, wallet: 0 }
  for (const t of treasuries) {
    if (t.kind === 'credit_card') continue
    const kind = toneKind(t.kind)
    if (kind === null) {
      out[t.id] = null
      continue
    }
    seen[kind] += 1
    const step = seen[kind]
    out[t.id] = step === 1 || step === 2 || step === 3 ? { kind, step } : null
  }
  return out
}

export type TreasurySegment = {
  /** El id de la caja, u `otras` para las que no tienen color propio. */
  key: string
  treasuryId: string | null
  name: string
  kind: TreasuryKind | null
  /** El tono por tipo de caja (`null` en «Otras cajas» y en las que no tienen). */
  tone: TreasuryTone | null
  /** Saldo, siempre positivo. */
  cents: number
  /** Parte de la barra, de 0 a 100 con un decimal. */
  percent: number
  slot: AdmSlot | null
  /** «En camino» de esa caja (QR y transferencias que todavía no entraron). */
  pendingCents: number
  /** `/cajas/{id}`; `null` en «Otras cajas» (va a la lista). */
  path: string | null
  /** Cuántas cajas junta (1, o varias en «Otras cajas»). */
  count: number
}

export type TreasuryAside = {
  id: string
  name: string
  kind: TreasuryKind
  /** Lo que se debe (descubierto o tarjeta), en positivo. */
  cents: number
  slot: AdmSlot | null
  path: string
}

export type TreasuryBar = {
  /** Cajas, bancos y billeteras con saldo positivo, en el orden de Ajustes. */
  segments: TreasurySegment[]
  /** Σ de los segmentos (más que «disponible» si hay algún descubierto). */
  totalCents: number
  /** Aparte: cuentas en descubierto. No entran a la barra (no se dibuja plata negativa). */
  overdrawn: TreasuryAside[]
  /** Aparte: «en camino», el total. */
  pendingCents: number
  /** Aparte: la tarjeta de la empresa, que es una deuda. */
  cardDebtCents: number
  cards: TreasuryAside[]
  /** Ninguna caja tiene plata: no hay barra que dibujar. */
  isEmpty: boolean
}

/**
 * La barra «dónde está la plata»: un tramo por caja con saldo. Lo que no es
 * plata disponible va aparte y con su nombre: descubiertos, lo que está en
 * camino y la tarjeta de la empresa.
 */
export function treasurySegments(
  summary: Pick<AccSummary, 'treasuries' | 'pendingWalletCents' | 'cardDebtCents'>,
): TreasuryBar {
  const slots = treasurySlots(summary.treasuries)
  const tones = treasuryTones(summary.treasuries)
  const assets = summary.treasuries.filter((t) => t.kind !== 'credit_card')
  const positive = assets.filter((t) => t.balanceCents > 0)
  const totalCents = positive.reduce((sum, t) => sum + t.balanceCents, 0)

  const segments: TreasurySegment[] = []
  const rest: SummaryTreasury[] = []
  for (const t of positive) {
    const slot = slots[t.id] ?? null
    if (slot === null) {
      rest.push(t)
      continue
    }
    segments.push({
      key: t.id,
      treasuryId: t.id,
      name: t.name,
      kind: t.kind,
      tone: tones[t.id] ?? null,
      cents: t.balanceCents,
      percent: percentOf(t.balanceCents, totalCents),
      slot,
      pendingCents: Math.max(0, t.pendingWalletCents),
      path: `/cajas/${t.id}`,
      count: 1,
    })
  }
  if (rest.length > 0) {
    const cents = rest.reduce((sum, t) => sum + t.balanceCents, 0)
    const only = rest.length === 1 ? rest[0] : undefined
    segments.push({
      key: only ? only.id : 'otras',
      treasuryId: only ? only.id : null,
      name: only ? only.name : 'Otras cajas',
      kind: only ? only.kind : null,
      tone: only ? (tones[only.id] ?? null) : null,
      cents,
      percent: percentOf(cents, totalCents),
      slot: null,
      pendingCents: rest.reduce((sum, t) => sum + Math.max(0, t.pendingWalletCents), 0),
      path: only ? `/cajas/${only.id}` : null,
      count: rest.length,
    })
  }

  const aside = (t: SummaryTreasury, cents: number): TreasuryAside => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    cents,
    slot: slots[t.id] ?? null,
    path: `/cajas/${t.id}`,
  })

  return {
    segments,
    totalCents,
    overdrawn: assets.filter((t) => t.balanceCents < 0).map((t) => aside(t, -t.balanceCents)),
    pendingCents: Math.max(0, summary.pendingWalletCents),
    cardDebtCents: Math.max(0, summary.cardDebtCents),
    // En la tarjeta el saldo llega Debe − Haber: la deuda es negativa.
    cards: summary.treasuries
      .filter((t) => t.kind === 'credit_card' && t.balanceCents < 0)
      .map((t) => aside(t, -t.balanceCents)),
    isEmpty: segments.length === 0,
  }
}

/**
 * La oración debajo del número, por partes (cada una se muestra entera):
 * dónde está la plata, lo que está en descubierto, lo que está en camino y lo
 * que debe la tarjeta de la empresa. Solo aparece lo que corresponde.
 */
export function heroSentenceParts(
  summary: Pick<AccSummary, 'treasuries' | 'pendingWalletCents' | 'cardDebtCents'>,
): string[] {
  const assets = summary.treasuries.filter((t) => t.kind !== 'credit_card')
  const withMoney = assets.filter((t) => t.balanceCents > 0)
  const overdrawn = assets.filter((t) => t.balanceCents < 0)
  const parts: string[] = []

  const single = withMoney.length === 1 ? withMoney[0] : undefined
  if (assets.length === 0) parts.push('Todavía no hay cajas cargadas.')
  else if (single) parts.push(`Está toda en ${single.name}.`)
  else if (withMoney.length > 1) parts.push(`Repartida en ${withMoney.length} lugares.`)
  else if (overdrawn.length === 0) parts.push('No hay plata en ninguna caja.')

  const firstOverdrawn = overdrawn.length === 1 ? overdrawn[0] : undefined
  if (firstOverdrawn) {
    parts.push(
      `${firstOverdrawn.name} está en descubierto por ${pesos(firstOverdrawn.balanceCents)}.`,
    )
  } else if (overdrawn.length > 1) {
    const total = overdrawn.reduce((sum, t) => sum + t.balanceCents, 0)
    parts.push(`Hay ${overdrawn.length} cuentas en descubierto por ${pesos(total)}.`)
  }

  if (summary.pendingWalletCents > 0) {
    parts.push(
      `Hay ${pesos(summary.pendingWalletCents)} en camino (QR y transferencias que todavía no entraron).`,
    )
  }
  if (summary.cardDebtCents > 0) {
    const cards = summary.treasuries.filter((t) => t.kind === 'credit_card' && t.balanceCents < 0)
    parts.push(
      cards.length > 1
        ? `Las tarjetas de la empresa deben ${pesos(summary.cardDebtCents)}.`
        : `La tarjeta de la empresa debe ${pesos(summary.cardDebtCents)}.`,
    )
  }
  return parts
}

/** «Repartida en 3 lugares. Hay $ X en camino (…). La tarjeta de la empresa debe $ Y.» */
export function heroSentence(
  summary: Pick<AccSummary, 'treasuries' | 'pendingWalletCents' | 'cardDebtCents'>,
): string {
  return heroSentenceParts(summary).join(' ')
}

export type HeroState =
  | {
      kind: 'normal'
      /** `summary.availableCents`: puede ser negativo (todo en descubierto). */
      cents: number
      /** El número es un descubierto: se dice con palabras, nunca con un menos. */
      overdrawn: boolean
      sentence: string
    }
  | {
      /** No se muestra `$ 0`: todavía no se sabe cuánta plata hay. */
      kind: 'unknown'
      reason: 'opening_pending' | 'no_treasuries'
      title: string
      sentence: string
      /** `null` para quien solo lee. */
      action: HomeAction | null
    }

/**
 * Qué muestra el héroe. «Todavía no sé cuánta plata hay» cuando el cero no es
 * un dato: faltan los saldos iniciales y ninguna caja se movió (el bar recién
 * configurado), o no hay ninguna caja cargada. Con «Arrancar en cero» elegido
 * o con un movimiento cualquiera, el número ya es de verdad y se muestra.
 */
export function heroState(
  summary: Pick<
    AccSummary,
    'treasuries' | 'availableCents' | 'pendingWalletCents' | 'cardDebtCents'
  >,
  settings: Pick<AccountingSettings, 'openingStatus'> | null,
  opts: { canWrite?: boolean; base?: string } = {},
): HeroState {
  const canWrite = opts.canWrite ?? true
  const base = opts.base ?? ''
  const assets = summary.treasuries.filter((t) => t.kind !== 'credit_card')

  if (assets.length === 0) {
    return {
      kind: 'unknown',
      reason: 'no_treasuries',
      title: 'Todavía no hay cajas cargadas',
      sentence: canWrite
        ? 'Agregá la caja, el banco y la billetera para ver cuánta plata hay.'
        : 'Los dueños todavía no cargaron las cajas ni las cuentas.',
      action: canWrite ? link(base, '/ajustes?tab=cajas', 'Agregar una caja') : null,
    }
  }

  const untouched = assets.every((t) => t.balanceCents === 0 && t.lastMovementDate === null)
  if (settings?.openingStatus === 'pending' && untouched && summary.pendingWalletCents === 0) {
    return {
      kind: 'unknown',
      reason: 'opening_pending',
      title: 'Todavía no sé cuánta plata hay',
      sentence: canWrite
        ? 'Contame cuánto hay hoy en cada caja y empiezo a llevar la cuenta.'
        : 'Los dueños todavía no cargaron cuánto había en cada caja al empezar.',
      action: canWrite ? link(base, '/configurar', 'Cargar lo que hay') : null,
    }
  }

  return {
    kind: 'normal',
    cents: summary.availableCents,
    overdrawn: summary.availableCents < 0,
    sentence: heroSentence(summary),
  }
}

// ─── Hace 30 días ────────────────────────────────────────────────────────────

/** Los días que mira el héroe hacia atrás (y «Entró y salió»). */
export const HOME_CASH_DAYS = 30

/** El rango de `getCashDaily` para el Resumen: los últimos 30 días, hoy incluido. */
export function homeCashRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -(HOME_CASH_DAYS - 1)), to: today }
}

/** El rango de «En qué se va la plata»: del 1 del mes a hoy (como «Compras y gastos»). */
export function homeSpendingRange(today: string): { from: string; to: string } {
  return { from: startOfMonth(today), to: today }
}

export type BalanceTrend =
  | {
      kind: 'compared'
      /** Lo que había al cierre del día anterior al período. */
      beforeCents: number
      nowCents: number
      /** Hoy − antes. */
      diffCents: number
      direction: 'up' | 'down' | 'flat'
      /** «Hace 30 días había $ 1.200.000». */
      sentence: string
      /** «$ 350.000 más» · «$ 80.000 menos» · «Lo mismo». */
      diffText: string
    }
  | {
      /** Los libros arrancaron adentro del período: no hay con qué comparar. */
      kind: 'too_new'
      nowCents: number
      sentence: string
    }

/**
 * «Hace 30 días había $ X» y la diferencia en palabras. `account` es la fila
 * «todas las cajas» de `getCashDaily` (o una caja): su saldo anterior es el
 * del cierre del día previo al rango. Si los libros arrancaron adentro del
 * rango, «hace 30 días» todavía no existía: se dice eso en vez de comparar
 * contra un cero que no es un dato.
 */
export function balanceTrend(
  account: Pick<CashDailyAccount, 'openingCents' | 'closingCents'>,
  opts: { from: string; to: string; booksStartDate?: string | null },
): BalanceTrend {
  const start = validDay(opts.booksStartDate)
  const nowCents = account.closingCents
  if (start !== null && start >= opts.from) {
    return {
      kind: 'too_new',
      nowCents,
      sentence: `Llevás la cuenta desde el ${formatIsoDay(start)}: todavía no hay un mes para comparar.`,
    }
  }
  const days = daysBetween(opts.from, opts.to) + 1
  const beforeCents = account.openingCents
  const diffCents = nowCents - beforeCents
  const before =
    beforeCents < 0 ? `un descubierto de ${pesos(beforeCents)}` : formatCentsShort(beforeCents)
  return {
    kind: 'compared',
    beforeCents,
    nowCents,
    diffCents,
    direction: diffCents > 0 ? 'up' : diffCents < 0 ? 'down' : 'flat',
    sentence: `Hace ${count(days, 'día', 'días')} había ${before}`,
    diffText:
      diffCents === 0 ? 'Lo mismo' : `${pesos(diffCents)} ${diffCents > 0 ? 'más' : 'menos'}`,
  }
}

export type BalancePoint = { date: string; cents: number }

/**
 * Los puntos del saldo día por día para el área del héroe (un punto por día,
 * arrastrando el saldo). Los días anteriores al arranque de los libros no se
 * dibujan: una línea plana en cero ahí no es un dato.
 */
export function balancePoints(
  account: CashDailyAccount,
  opts: { from: string; to: string; booksStartDate?: string | null },
): BalancePoint[] {
  const start = validDay(opts.booksStartDate)
  const from = start !== null && start > opts.from ? start : opts.from
  if (from > opts.to) return []
  return buildCashDailySeries(account, { from, to: opts.to }).points.map((p) => ({
    date: p.day,
    cents: p.balanceCents,
  }))
}

// ─── 4. Entró y salió ────────────────────────────────────────────────────────

export type WeekBucket = {
  /** El lunes de la semana (`yyyy-MM-dd`). */
  key: string
  /** El primer y el último día de la semana que entran en el período. */
  from: string
  to: string
  /** «14 al 20/09» · «28/09 al 04/10» · «13/10» (un solo día). */
  label: string
  /** La misma semana para el eje de un gráfico: «14–20/9» · «28/9–4/10» · «13/10». */
  shortLabel: string
  inCents: number
  outCents: number
  /** La semana no entra entera en el período (la primera y la última). */
  partial: boolean
  /** Se dejó afuera el día en que arrancaron los libros (ver `weekBuckets`). */
  openingSkipped: boolean
}

function weekLabel(from: string, to: string): string {
  if (from === to) return formatDayMonth(from)
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${from.slice(8, 10)} al ${formatDayMonth(to)}`
    : `${formatDayMonth(from)} al ${formatDayMonth(to)}`
}

/** Día y mes sin ceros: «4/10». En el eje cada carácter cuenta. */
function dayMonthShort(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`
}

function weekShortLabel(from: string, to: string): string {
  if (from === to) return formatDayMonth(from)
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${Number(from.slice(8, 10))}–${dayMonthShort(to)}`
    : `${dayMonthShort(from)}–${dayMonthShort(to)}`
}

/**
 * Entró y salió por semana (de lunes a domingo). `days` son los días con
 * movimiento de «todas las cajas» de `getCashDaily`: ahí pasar plata de una
 * caja a otra ya no cuenta.
 *
 * El saldo inicial NO es plata que entró: `acc_report_cash_daily` lo trae
 * mezclado con lo del día en que arrancan los libros (no lo puede separar), así
 * que ese día se deja afuera entero y la semana lo avisa con `openingSkipped`.
 *
 * Con `from`/`to` salen todas las semanas del período, también las que no
 * tuvieron movimientos (en cero); sin ellos, de la primera a la última con dato.
 */
export function weekBuckets(
  days: ReadonlyArray<{ day: string; inCents: number; outCents: number }>,
  opts: { from?: string; to?: string; booksStartDate?: string | null } = {},
): WeekBucket[] {
  const valid = days.filter((d) => isRealIsoDay(d.day))
  const sorted = [...valid].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const from = validDay(opts.from) ?? sorted[0]?.day ?? null
  const to = validDay(opts.to) ?? sorted.at(-1)?.day ?? null
  if (from === null || to === null || from > to) return []
  const start = validDay(opts.booksStartDate)

  const buckets = new Map<string, WeekBucket>()
  for (const day of eachIsoDay(from, to)) {
    const key = startOfWeek(day)
    if (buckets.has(key)) continue
    const weekFrom = key < from ? from : key
    const weekEnd = endOfWeek(day)
    const weekTo = weekEnd > to ? to : weekEnd
    buckets.set(key, {
      key,
      from: weekFrom,
      to: weekTo,
      label: weekLabel(weekFrom, weekTo),
      shortLabel: weekShortLabel(weekFrom, weekTo),
      inCents: 0,
      outCents: 0,
      partial: weekFrom !== key || weekTo !== weekEnd,
      openingSkipped: false,
    })
  }
  for (const row of sorted) {
    if (row.day < from || row.day > to) continue
    const bucket = buckets.get(startOfWeek(row.day))
    if (!bucket) continue
    if (start !== null && row.day === start) {
      bucket.openingSkipped = true
      continue
    }
    bucket.inCents += Math.max(0, row.inCents)
    bucket.outCents += Math.max(0, row.outCents)
  }
  return [...buckets.values()]
}

export type InOutSummary = {
  inCents: number
  outCents: number
  hasMovements: boolean
  /** «Entró $ X y salió $ Y.» */
  sentence: string
  /** La aclaración del saldo inicial, si se dejó un día afuera. */
  note: string | null
}

/** Los totales de «Entró y salió» y su oración, de las semanas ya armadas. */
export function inOutSummary(buckets: readonly WeekBucket[]): InOutSummary {
  const inCents = buckets.reduce((sum, b) => sum + b.inCents, 0)
  const outCents = buckets.reduce((sum, b) => sum + b.outCents, 0)
  const hasMovements = inCents > 0 || outCents > 0
  return {
    inCents,
    outCents,
    hasMovements,
    sentence: hasMovements
      ? `Entró ${pesos(inCents)} y salió ${pesos(outCents)}.`
      : 'Todavía no entró ni salió plata de las cajas.',
    note: buckets.some((b) => b.openingSkipped)
      ? 'No cuenta el día en que arrancaste a llevar la cuenta: lo que había no es plata que entró.'
      : null,
  }
}

// ─── 3. Lo que tenés que pagar ───────────────────────────────────────────────

export type PayableTrancheKey = 'overdue' | 'week' | 'later'

export type PayableTranche = {
  key: PayableTrancheKey
  label: string
  cents: number
  /** Parte del total, de 0 a 100 con un decimal. */
  percent: number
}

export type PayablesTranches = {
  totalCents: number
  /** Siempre los tres, en este orden: vencido · vence esta semana · más adelante. */
  tranches: PayableTranche[]
  /** Proveedores con algo vencido. */
  partiesRed: number
  /** No se le debe nada a nadie. */
  isEmpty: boolean
  /**
   * El cero no es un dato: faltan los saldos iniciales y todavía no hay ninguna compra a pagar
   * cargada. No se muestra `$ 0` ni «no le debés nada» (el bar recién configurado).
   */
  unknown: boolean
  /** El título que afirma, sin importe. */
  title: string
  /** La oración del número: cuánto de eso ya venció o vence esta semana (`null` si nada). */
  sentence: string | null
  /** Con deuda cargada y los saldos iniciales pendientes: lo que todavía falta sumar. */
  note: string | null
}

/**
 * La deuda con proveedores en tres tramos. «Más adelante» es lo que queda:
 * incluye lo que no tiene vencimiento cargado. `null` si la base todavía no lo
 * calcula (se muestra «—», nunca `$ 0`).
 *
 * `openingPending`: los saldos iniciales siguen sin cargar (ahí va lo que el bar
 * ya debía al empezar). Con eso, un total en cero no es «no le debés nada»: es
 * «todavía no sé» (`unknown`); y un total con deuda avisa que falta lo de antes.
 */
export function payablesTranches(
  payables: AccSummary['payables'],
  opts: { openingPending?: boolean } = {},
): PayablesTranches | null {
  if (!payables) return null
  const openingPending = opts.openingPending === true
  const totalCents = Math.max(0, payables.totalCents)
  const overdue = Math.min(Math.max(0, payables.overdueCents), totalCents)
  const week = Math.min(Math.max(0, payables.dueWeekCents), totalCents - overdue)
  const later = totalCents - overdue - week
  const tranche = (key: PayableTrancheKey, label: string, cents: number): PayableTranche => ({
    key,
    label,
    cents,
    percent: percentOf(cents, totalCents),
  })
  const partiesRed = Math.max(0, payables.partiesRed)
  // El título afirma sin importe: el número del bloque es uno solo (el total) y lo
  // vencido se dice en su oración. Dos importes de siete cifras juntos no se leen.
  let title: string
  let sentence: string | null = null
  const unknown = openingPending && totalCents === 0
  if (unknown) {
    title = 'Todavía no sé cuánto debés'
    sentence = 'Lo que ya les debías a tus proveedores entra con los saldos iniciales.'
  } else if (totalCents === 0) title = 'No le debés nada a nadie'
  else if (overdue > 0) {
    title =
      partiesRed > 0
        ? `Tenés pagos vencidos con ${count(partiesRed, 'proveedor', 'proveedores')}`
        : 'Tenés pagos vencidos'
    sentence = overdue === totalCents ? 'Ya venció todo.' : `${pesos(overdue)} ya venció.`
  } else if (week > 0) {
    title = 'Tenés pagos que vencen esta semana'
    sentence = week === totalCents ? 'Vence todo esta semana.' : `${pesos(week)} vence esta semana.`
  } else title = 'Nada vence esta semana'
  return {
    totalCents,
    tranches: [
      tranche('overdue', 'Vencido', overdue),
      tranche('week', 'Vence esta semana', week),
      tranche('later', 'Más adelante', later),
    ],
    partiesRed,
    isEmpty: totalCents === 0,
    unknown,
    title,
    sentence,
    note:
      openingPending && totalCents > 0
        ? 'Es lo que cargaste hasta ahora: lo que debías de antes entra con los saldos iniciales.'
        : null,
  }
}

const PAYABLE_KINDS: ReadonlySet<string> = new Set(['payable_overdue', 'payable_due_week'])

/**
 * Los avisos de «pagar» (los `payable_*` del resumen), para los renglones con
 * [Pagar] de «Lo que tenés que pagar»: los primeros `max` y cuántos quedaron.
 *
 * La base manda los avisos topeados, así que contar solo la lista puede quedar
 * corto («hay 9 con algo vencido», 4 renglones y «4 más»). Con `partiesRed`
 * (los proveedores con algo vencido, que sí viene entero) `more` nunca es
 * menos que los vencidos que no se están mostrando.
 */
export function payableAttention(
  attention: readonly SummaryAttentionItem[],
  max = 4,
  partiesRed: number | null = null,
): { rows: SummaryAttentionItem[]; more: number } {
  const all = attention.filter((item) => PAYABLE_KINDS.has(item.kind))
  const rows = all.slice(0, Math.max(0, max))
  const listed = Math.max(0, all.length - rows.length)
  const overdueShown = rows.filter((item) => item.kind === 'payable_overdue').length
  const overdueLeft = partiesRed === null ? 0 : Math.max(0, partiesRed - overdueShown)
  return { rows, more: Math.max(listed, overdueLeft) }
}

/** Lo que queda para «Avisos»: todo menos lo que ya está en «pagar». */
export function noticeAttention(
  attention: readonly SummaryAttentionItem[],
): SummaryAttentionItem[] {
  return attention.filter((item) => !PAYABLE_KINDS.has(item.kind))
}

// ─── Gastos fijos del mes ────────────────────────────────────────────────────

/** Lo que el Resumen necesita de un gasto fijo (`RecurringExpenseRow` lo cumple). */
export type HomeRecurringRow = RecurringRowFacts &
  Pick<RecurringExpenseRow, 'id' | 'name' | 'daysToDue' | 'remindDaysBefore'>

/** Lo pagado de cada gasto fijo (`listRecurringPayments`), por id. */
export type RecurringPayments =
  | ReadonlyMap<string, RecurringPaymentFacts>
  | Readonly<Record<string, RecurringPaymentFacts>>

function paymentOf(
  payments: RecurringPayments | null | undefined,
  id: string,
): RecurringPaymentFacts | null {
  if (!payments) return null
  if (payments instanceof Map) return payments.get(id) ?? null
  return (payments as Readonly<Record<string, RecurringPaymentFacts>>)[id] ?? null
}

export type FixedProgress = {
  /**
   * - `empty`: no hay gastos fijos cargados.
   * - `no_amounts`: hay, pero ninguno suma (sin monto): no se muestra `$ 0`.
   * - `nothing_due`: este mes no vence ninguno.
   * - `progress`: hay algo que pagar o ya pagado este mes.
   */
  state: 'empty' | 'no_amounts' | 'nothing_due' | 'progress'
  /** «Ya pagaste». */
  paidCents: number
  /** «Te falta de gasto fijo» (el mismo «Falta pagar» de la pestaña Gastos fijos). */
  remainingCents: number
  /** Lo que falta de los que ya pasaron el vencimiento. */
  overdueCents: number
  /** Pagado + falta: el total del mes. */
  totalCents: number
  /** Parte pagada, de 0 a 100 entero (`null` sin total). */
  paidPercent: number | null
  /** Los que entran en la cuenta (con monto conocido). */
  countedRows: number
  /** De esos, los que todavía tienen algo sin pagar («faltan N»). */
  pendingRows: number
  overdueRows: number
  /** Vencen este mes y no tienen monto: no suman (igual que en la pestaña). */
  noAmountDue: number
  /** Activos sin monto, venzan cuando venzan (los 31 de un bar recién cargado). */
  missingAmount: number
  activeRows: number
  /** Aparte: lo que quedó sin pagar de vencimientos anteriores. */
  priorOpenCents: number
  /** La oración del bloque. */
  sentence: string
}

/**
 * Los gastos fijos del mes: pagado, falta, vencido y sin monto. Usa las mismas
 * cuentas que la pestaña Gastos fijos (`recurringLine` + `recurringTotals`),
 * así los dos lados dicen lo mismo. Para que coincidan del todo, pasale las
 * filas de `listRecurringExpenses(…, { includeInactive: true })` (un gasto en
 * cuotas que terminó este mes se apaga solo, pero lo que pagaste sigue
 * contando) y lo pagado de `listRecurringPayments`. Sin `payments`, lo ya
 * cargado cuenta como sin pagar.
 *
 * `today` se puede omitir: sale de los días al vencimiento que traen las filas.
 */
export function fixedProgress(
  rows: readonly HomeRecurringRow[],
  payments?: RecurringPayments | null,
  today?: string | null,
): FixedProgress {
  const first = rows[0]
  const day = validDay(today) ?? (first ? addDays(first.nextDueDate, -first.daysToDue) : null)
  const live = rows.filter((r) => r.active && !r.ended)
  const missingAmount = live.filter((r) => r.amountCents === null).length

  const lines =
    day === null ? [] : rows.map((r) => recurringLine(r, paymentOf(payments, r.id), day))
  const totals = recurringTotals(lines)
  const counted = lines.filter((l) => l.remainingCents !== null && l.paidCents !== null)
  const pendingRows = counted.filter((l) => (l.remainingCents ?? 0) > 0).length
  const overdueRows = counted.filter((l) => l.state === 'overdue').length
  const totalCents = totals.paidCents + totals.remainingCents

  let state: FixedProgress['state']
  if (live.length === 0 && totals.countedRows === 0) state = 'empty'
  else if (totals.countedRows > 0) state = 'progress'
  else if (missingAmount > 0) state = 'no_amounts'
  else state = 'nothing_due'

  let sentence: string
  if (state === 'empty') {
    sentence =
      rows.length > 0 ? 'No hay gastos fijos activos.' : 'Todavía no cargaste gastos fijos.'
  } else if (state === 'no_amounts') {
    sentence = `${count(missingAmount, 'gasto fijo sin monto: completalo', 'gastos fijos sin monto: completalos')} para saber cuánto te falta.`
  } else if (state === 'nothing_due') sentence = 'Este mes no vence ningún gasto fijo.'
  else if (totals.remainingCents === 0) {
    sentence = `Pagaste los ${pesos(totalCents)} de gastos fijos de este mes.`
  } else if (totals.paidCents === 0) {
    // El importe ya está arriba («Te falta de gasto fijo»): acá, cuántos son.
    sentence =
      pendingRows === 1
        ? 'Todavía no pagaste el de este mes.'
        : `Pagaste 0 de ${pendingRows} este mes.`
  } else {
    sentence = `Pagaste ${pesos(totals.paidCents)} de ${pesos(totalCents)}: ${
      pendingRows === 1 ? 'falta 1' : `faltan ${pendingRows}`
    }.`
  }

  return {
    state,
    paidCents: totals.paidCents,
    remainingCents: totals.remainingCents,
    overdueCents: totals.overdueCents,
    totalCents,
    paidPercent: totalCents > 0 ? Math.round((totals.paidCents * 100) / totalCents) : null,
    countedRows: totals.countedRows,
    pendingRows,
    overdueRows,
    noAmountDue: totals.noAmountCount,
    missingAmount,
    activeRows: live.length,
    priorOpenCents: totals.priorOpenCents,
    sentence,
  }
}

// ─── 3. El mes contra el objetivo ────────────────────────────────────────────

export type MonthPace = {
  /** «Te falta vender» (0 sin objetivos o si ya se llegó). */
  remainingCents: number
  /** Días que quedan para vender: los que vienen y el de hoy si todavía no tiene cierre. */
  daysLeft: number
  /** Lo que hay que vender por día para llegar (`null` si no falta nada o no quedan días). */
  perDayCents: number | null
  /** Días del mes con cierre cargado. */
  loadedDays: number
  /** Lo vendido por día cargado (`null` sin cierres). */
  averageCents: number | null
}

/**
 * El ritmo del mes: cuánto falta y cuánto por día en los días que quedan. Sale
 * de la proyección que ya arma la pantalla (`buildProjection`), sin otra cuenta
 * de lo vendido.
 */
export function monthPace(projection: Pick<Projection, 'summary' | 'days'>): MonthPace {
  const { summary, days } = projection
  const daysLeft = days.filter(
    (d) => d.moment === 'future' || (d.moment === 'today' && !d.hasClose),
  ).length
  const loadedDays = days.filter((d) => d.hasClose).length
  const remainingCents = summary.hasTargets ? summary.remainingCents : 0
  return {
    remainingCents,
    daysLeft,
    perDayCents: remainingCents > 0 && daysLeft > 0 ? Math.ceil(remainingCents / daysLeft) : null,
    loadedDays,
    averageCents: loadedDays > 0 ? Math.round(summary.soldCents / loadedDays) : null,
  }
}

/**
 * «Unos $ 312.000»: un importe redondeado para decirlo de corrido (al millar
 * desde $ 100.000, a la centena desde $ 10.000; más chico, tal cual).
 */
function roughly(cents: number): string {
  const whole = Math.abs(cents) / 100
  const step = whole >= 100_000 ? 1_000 : whole >= 10_000 ? 100 : 1
  return formatCentsShort(Math.round(whole / step) * step * 100)
}

/**
 * El título de «El mes contra el objetivo», que afirma: con objetivos, «Vas en
 * $ 7,6 M: el 54 % del objetivo de octubre»; sin objetivos, «Vas vendiendo
 * $ 7.592.582 en octubre». `month` es el nombre del mes en minúscula.
 *
 * Lo vendido es la venta neta de los cierres (sin las comisiones estimadas),
 * la misma cifra de Ventas › Proyección.
 */
export function monthTitle(summary: ProjectionSummary, month: string): string {
  const past = summary.monthState === 'past'
  const sold = formatCentsShort(summary.soldCents)

  if (summary.monthState === 'future') return `${capitalizeFirst(month)} todavía no empezó`
  if (summary.soldCents <= 0) {
    return past
      ? `No hay ventas cargadas en ${month}`
      : `Todavía no hay ventas cargadas en ${month}`
  }
  if (!summary.hasTargets) {
    return past ? `Vendiste ${sold} en ${month}` : `Vas vendiendo ${sold} en ${month}`
  }
  if (summary.remainingCents === 0) {
    return summary.surplusCents > 0
      ? `${past ? 'Pasaste' : 'Ya pasaste'} el objetivo de ${month} por ${pesos(summary.surplusCents)}`
      : `Llegaste justo al objetivo de ${month}`
  }
  const short = formatAxisCents(summary.soldCents)
  const percent = summary.monthPercent ?? 0
  return past
    ? `Vendiste ${short}: el ${percent} % del objetivo de ${month}`
    : `Vas en ${short}: el ${percent} % del objetivo de ${month}`
}

/**
 * La oración debajo del título: lo que falta y el ritmo por día que queda
 * («Para llegar faltan $ X: unos $ Y por día en los 18 días que quedan.»). Sin
 * objetivos, cómo viene el promedio de los días cargados.
 */
export function monthSentence(projection: Pick<Projection, 'summary' | 'days'>): string {
  const { summary } = projection
  const pace = monthPace(projection)

  if (summary.monthState === 'future') {
    return summary.hasTargets
      ? `El objetivo del mes es ${formatCentsShort(summary.monthTargetCents)}.`
      : 'Todavía no tiene objetivos cargados.'
  }
  const past = summary.monthState === 'past'

  if (!summary.hasTargets) {
    if (pace.loadedDays === 0 || pace.averageCents === null) {
      return past
        ? 'No se cargó ningún cierre del día.'
        : 'Cargá el cierre de ayer para empezar a ver cómo viene el mes.'
    }
    return `En ${count(pace.loadedDays, 'día con cierre', 'días con cierre')}: unos ${roughly(pace.averageCents)} por día.`
  }

  if (summary.remainingCents === 0) {
    return past
      ? `El objetivo era ${formatCentsShort(summary.monthTargetCents)}.`
      : `El objetivo del mes es ${formatCentsShort(summary.monthTargetCents)}.`
  }
  const missing = pesos(summary.remainingCents)
  if (past) return `Faltaron ${missing} para llegar al objetivo.`
  if (pace.perDayCents === null) return `Para llegar faltan ${missing} y ya no quedan días.`
  if (pace.daysLeft === 1) return `Para llegar faltan ${missing} y queda 1 día.`
  return `Para llegar faltan ${missing}: unos ${roughly(pace.perDayCents)} por día en los ${pace.daysLeft} días que quedan.`
}

export type MonthDayState = 'loaded' | 'missing' | 'today' | 'future' | 'before'

export type MonthDay = {
  date: string
  /** 1 a 31. */
  dayNumber: number
  /** «lun», «mar»… */
  weekday: string
  /**
   * `loaded` tiene cierre · `missing` ya pasó y falta · `today` el día de
   * servicio de hoy, todavía sin cierre (no falta) · `future` · `before` es
   * anterior al arranque de los libros (no hay nada que reclamar).
   */
  state: MonthDayState
  /** Es el día de servicio de hoy, tenga o no su cierre. */
  isToday: boolean
  /** Venta neta del día; `null` sin cierre (un día sin cargar no es un cero). */
  cents: number | null
  targetCents: number | null
  /** Vendido acumulado: llega hasta el último día cargado; después `null` (la línea se corta ahí). */
  soldAccumCents: number | null
  /** Objetivo acumulado; `null` si el mes no tiene objetivos. */
  targetAccumCents: number | null
  /** Para cargar el cierre de ese día (los que faltan y el de hoy); `null` en los demás. */
  path: string | null
}

export type MonthDays = {
  days: MonthDay[]
  /** Dónde está hoy en `days` (−1 si el mes no es el actual). */
  todayIndex: number
  loaded: number
  missing: number
  firstMissing: string | null
  /** «Faltan 6 cierres» · «Están todos los cierres cargados». */
  sentence: string
}

/**
 * El mes día por día, para las barras, la carrera contra el objetivo y la tira
 * de cierres: una sola lectura de qué día está cargado y cuál falta (la misma
 * que usa «Hoy te toca»). Sale de la proyección que ya arma la pantalla.
 */
export function monthDays(
  projection: Pick<Projection, 'summary' | 'days'>,
  opts: { booksStartDate?: string | null } = {},
): MonthDays {
  const start = validDay(opts.booksStartDate)
  const lastLoaded = projection.days.filter((d) => d.hasClose).at(-1)?.day ?? null
  let loaded = 0
  let missing = 0
  let firstMissing: string | null = null
  let todayIndex = -1

  const days = projection.days.map((d, index): MonthDay => {
    const isToday = d.moment === 'today'
    if (isToday) todayIndex = index
    let state: MonthDayState
    if (d.hasClose) state = 'loaded'
    else if (d.moment === 'future') state = 'future'
    else if (isToday) state = 'today'
    else if (start !== null && d.day < start) state = 'before'
    else state = 'missing'

    if (state === 'loaded') loaded += 1
    if (state === 'missing') {
      missing += 1
      firstMissing ??= d.day
    }
    return {
      date: d.day,
      dayNumber: Number(d.day.slice(8, 10)),
      weekday: WEEKDAY_NAMES_SHORT[weekdayOf(d.day)] ?? '',
      state,
      isToday,
      cents: d.hasClose ? d.netCents : null,
      targetCents: d.targetCents,
      soldAccumCents: lastLoaded !== null && d.day <= lastLoaded ? d.netAccumCents : null,
      targetAccumCents: projection.summary.hasTargets ? d.targetAccumCents : null,
      path: state === 'missing' || state === 'today' ? `/ventas/cierre?fecha=${d.day}` : null,
    }
  })

  let sentence: string
  if (missing > 0) sentence = missing === 1 ? 'Falta 1 cierre' : `Faltan ${missing} cierres`
  else if (loaded > 0) sentence = 'Están todos los cierres cargados'
  else sentence = 'Todavía no hay cierres este mes'

  return { days, todayIndex, loaded, missing, firstMissing, sentence }
}

// ─── 6. IVA del mes ──────────────────────────────────────────────────────────

export type IvaStrip =
  | {
      /** La SAS no es responsable inscripta, o la base todavía no lo calcula. */
      kind: 'not_registered' | 'unavailable'
      sentence: string
    }
  | {
      kind: 'to_pay' | 'in_favor' | 'zero'
      /** Lo que hay que pagar o lo que queda a favor, en positivo. */
      amountCents: number
      /** «IVA de octubre: a pagar $ 86.000». */
      sentence: string
      /** «Estimado: lo confirma la contadora.» · «Mes cerrado.» */
      note: string
      provisional: boolean
    }

/**
 * La franja del IVA del mes. Mientras el mes está abierto el número es una
 * estimación y se dice («estimado»): lo confirma la contadora al cerrarlo.
 */
export function ivaStrip(
  ivaMonth: AccSummary['ivaMonth'],
  opts: { registered: boolean },
): IvaStrip {
  if (!opts.registered) {
    return {
      kind: 'not_registered',
      sentence: 'La SAS no liquida IVA (no es responsable inscripta).',
    }
  }
  if (!ivaMonth)
    return { kind: 'unavailable', sentence: 'El IVA del mes todavía no está disponible.' }
  const month = monthName(Number(ivaMonth.month.slice(5, 7)))
  const title = month ? `IVA de ${month}` : 'IVA del mes'
  const kind = ivaMonth.toPayCents > 0 ? 'to_pay' : ivaMonth.inFavorCents > 0 ? 'in_favor' : 'zero'
  const amountCents =
    kind === 'to_pay' ? ivaMonth.toPayCents : kind === 'in_favor' ? ivaMonth.inFavorCents : 0
  return {
    kind,
    amountCents,
    sentence:
      kind === 'to_pay'
        ? `${title}: a pagar ${pesos(amountCents)}`
        : kind === 'in_favor'
          ? `${title}: a favor ${pesos(amountCents)}`
          : `${title}: no hay nada que pagar`,
    note: ivaMonth.provisional ? 'Estimado: lo confirma la contadora.' : 'Mes cerrado.',
    provisional: ivaMonth.provisional,
  }
}

// ─── 2. Hoy te toca ──────────────────────────────────────────────────────────

export type TodayItemId =
  | 'daily_close'
  | 'expense'
  | 'payables'
  | 'fixed'
  | 'import_review'
  | 'weekly_import'
  | 'arca_monthly'
  | 'month_close'

export type TodayItem = {
  id: TodayItemId
  title: string
  /** Una línea de estado. */
  status: string
  tone: HomeTone
  /** Hecha: va atenuada y con tilde. */
  done: boolean
  /** La única acción de la tarjeta; `null` si está hecha o si quien mira solo lee. */
  action: HomeAction | null
  /**
   * Los tipos de aviso que esta tarjeta ya cuenta (`SummaryAttentionKind` o
   * `IntegrationAttentionKind`): para no repetirlos en «Avisos».
   */
  covers: readonly string[]
}

/** Nunca más de cinco tarjetas: lo que no entra queda en «Avisos». */
export const TODAY_MAX_ITEMS = 5

/** La guía «Cómo arrancar»: el estado solo, o con sus datos (`getOnboarding`). */
export type HomeOnboarding =
  | OnboardingState
  | { state: OnboardingState; data?: Pick<OnboardingData, 'imports'> | null }

function onboardingParts(onboarding: HomeOnboarding | null | undefined): {
  state: OnboardingState | null
  data: Pick<OnboardingData, 'imports'> | null
} {
  if (!onboarding) return { state: null, data: null }
  if ('state' in onboarding) return { state: onboarding.state, data: onboarding.data ?? null }
  return { state: onboarding, data: null }
}

export type TodayInput = {
  /** `null` si el resumen no cargó: salen las tarjetas que no dependen de él. */
  summary: AccSummary | null
  /**
   * `openingStatus` es opcional: con los saldos iniciales pendientes, «no le debés nada» no se
   * afirma (ahí va lo que el bar ya debía al empezar).
   */
  settings:
    | (Pick<AccountingSettings, 'booksStartDate'> &
        Partial<Pick<AccountingSettings, 'openingStatus'>>)
    | null
  /**
   * De dónde sale el estado de los cierres: la proyección del mes (ya la pide
   * la página) y/o el calendario de cierres (mira además 30 días atrás). Con
   * las dos, manda el calendario.
   */
  projection?: Pick<Projection, 'days'> | null
  closeCalendar?: Pick<
    DailyCloseCalendar,
    'days' | 'firstMissingDate' | 'serviceDay' | 'booksStartDate'
  > | null
  recurring?: readonly HomeRecurringRow[] | null
  onboarding?: HomeOnboarding | null
  integration?: readonly IntegrationAttentionItem[] | null
  /** Hoy en Córdoba: lo de la plata y los vencimientos. */
  today: string
  /** El día de servicio (antes de las 5:00 es ayer). Sin él, sale de la proyección o de `today`. */
  serviceDay?: string | null
  /** `false`: la contadora. Mismas tarjetas de estado, sin ninguna acción. */
  canWrite: boolean
  /** `/<bar>/administracion`. Sin él, los links salen relativos a la sección. */
  base?: string
}

/** El resumen corta los avisos en 8: con la lista llena, puede faltar alguno. */
const ATTENTION_CAP = 8

type CloseFacts = {
  yesterday: string
  /** Ayer es anterior al arranque de los libros: todavía no hay cierre que cargar. */
  beforeStart: boolean
  /** El bar nunca cargó un cierre. */
  never: boolean
  /** Cuántos faltan (0 = ninguno). */
  missing: number
  /** `false`: faltan al menos esos (hay más atrás de lo que se alcanza a contar). */
  exact: boolean
  /** El primero que falta (`null` si no falta ninguno o no se sabe cuál). */
  first: string | null
  /** Ayer está cargado, con lo que se vendió si se sabe. */
  yesterdayLoaded: boolean
  yesterdayCents: number | null
  /** Hay con qué afirmar que no falta ninguno. */
  certain: boolean
}

function closeFacts(input: TodayInput): CloseFacts {
  const calendar = input.closeCalendar ?? null
  const projection = input.projection ?? null
  const summary = input.summary
  const projectionToday = projection?.days.find((d) => d.moment === 'today')?.day ?? null
  const serviceDay =
    validDay(input.serviceDay) ?? validDay(calendar?.serviceDay) ?? projectionToday ?? input.today
  const yesterday = addDays(serviceDay, -1)
  const start = validDay(calendar?.booksStartDate) ?? validDay(input.settings?.booksStartDate)

  // Cada día terminado del que se sabe algo: cargado (con lo vendido) o falta.
  const known = new Map<string, { loaded: boolean; cents: number | null }>()
  for (const d of projection?.days ?? []) {
    if (d.moment !== 'past') continue
    // Antes de arrancar los libros no hay cierre que reclamar.
    if (!d.hasClose && start !== null && d.day < start) continue
    known.set(d.day, {
      loaded: d.hasClose,
      // Lo vendido ese día por todos los canales (el bruto del cierre).
      cents: d.hasClose ? d.barCents + d.deliveryCents : null,
    })
  }
  for (const d of calendar?.days ?? []) {
    if (d.date >= serviceDay) continue
    if (d.status === 'loaded') known.set(d.date, { loaded: true, cents: d.totalCents })
    else if (d.status === 'missing') known.set(d.date, { loaded: false, cents: null })
  }

  const missingDays = [...known].filter(([, v]) => !v.loaded).map(([day]) => day)
  missingDays.sort()
  const notice = summary?.attention.find((a) => a.kind === 'missing_daily_close') ?? null
  const candidates = [
    validDay(calendar?.firstMissingDate),
    missingDays[0] ?? null,
    validDay(notice?.date),
  ].filter((d): d is string => d !== null)
  candidates.sort()
  const first = candidates[0] ?? null
  // El aviso de la base cuenta los últimos 30 días; lo demás, lo que se ve del mes.
  let missing = Math.max(missingDays.length, notice ? Math.max(1, notice.count ?? 1) : 0)
  // El primero que falta es de antes de lo que se alcanza a contar (el mes pasado) y la base
  // no dijo cuántos son: se sabe que faltan, no cuántos.
  const uncounted = first !== null && !missingDays.includes(first) && notice === null
  if (uncounted) missing = Math.max(missing, missingDays.length + 1)

  const y = known.get(yesterday)
  const summaryCertain =
    summary?.firstSteps.firstDailyClose === true && summary.attention.length < ATTENTION_CAP
  return {
    yesterday,
    beforeStart: start !== null && yesterday < start,
    never:
      summary !== null && !summary.firstSteps.firstDailyClose && known.size === missingDays.length,
    missing,
    exact: !uncounted,
    first,
    yesterdayLoaded: y?.loaded === true,
    yesterdayCents: y?.loaded ? y.cents : null,
    certain: y !== undefined || calendar !== null || summaryCertain,
  }
}

function closeItem(input: TodayInput, base: string): TodayItem {
  const facts = closeFacts(input)
  const covers = ['missing_daily_close'] as const
  const loadHref = (day: string | null) => (day ? `/ventas/cierre?fecha=${day}` : '/ventas/cierre')
  const act = (day: string | null, label: string): HomeAction | null =>
    input.canWrite ? link(base, loadHref(day), label) : null

  if (facts.beforeStart && facts.missing === 0) {
    return {
      id: 'daily_close',
      title: 'El cierre del día',
      status: 'Hoy es el primer día: el cierre de hoy se carga mañana.',
      tone: 'info',
      done: false,
      action: null,
      covers,
    }
  }

  // Sin ningún cierre todavía no se reclama un mes entero (la base tampoco avisa
  // hasta que exista el primero): se invita a empezar por el de ayer.
  if (facts.never) {
    return {
      id: 'daily_close',
      title: 'El cierre de ayer',
      status: 'Todavía no cargaste ninguno: empezá por el de ayer.',
      tone: 'warn',
      done: false,
      action: act(facts.yesterday, `Cargar el cierre del ${weekdayAndDay(facts.yesterday)}`),
      covers,
    }
  }

  if (facts.missing > 0) {
    const first = facts.first
    if (!facts.exact && first) {
      return {
        id: 'daily_close',
        title: 'Los cierres del día',
        status: `Faltan cierres: empezá por el ${formatDayMonth(first)}.`,
        tone: 'warn',
        done: false,
        action: act(first, `Cargar el del ${weekdayAndDay(first)}`),
        covers,
      }
    }
    if (facts.missing === 1) {
      const which = first ? `el del ${weekdayAndDay(first)}` : 'un cierre'
      return {
        id: 'daily_close',
        title:
          first === null || first === facts.yesterday ? 'El cierre de ayer' : 'El cierre del día',
        status: `Falta ${which}.`,
        tone: 'warn',
        done: false,
        action: act(
          first,
          first ? `Cargar el cierre del ${weekdayAndDay(first)}` : 'Cargar el cierre',
        ),
        covers,
      }
    }
    return {
      id: 'daily_close',
      title: 'Los cierres del día',
      status: first
        ? `Faltan ${facts.missing}: empezá por el ${formatDayMonth(first)}.`
        : `Faltan ${facts.missing}.`,
      tone: 'warn',
      done: false,
      action: act(first, first ? `Cargar el del ${weekdayAndDay(first)}` : 'Cargar un cierre'),
      covers,
    }
  }

  if (facts.yesterdayLoaded) {
    return {
      id: 'daily_close',
      title: 'El cierre de ayer',
      status:
        facts.yesterdayCents === null ? 'Cargado.' : `Cargado · ${pesos(facts.yesterdayCents)}`,
      tone: 'ok',
      done: true,
      action: null,
      covers,
    }
  }

  if (facts.certain) {
    return {
      id: 'daily_close',
      title: 'Los cierres del día',
      status: 'Al día: no falta ninguno.',
      tone: 'ok',
      done: true,
      action: null,
      covers,
    }
  }

  // No se pudo saber (no cargó nada de donde sale): se ofrece cargarlo, sin afirmar que falta.
  return {
    id: 'daily_close',
    title: 'El cierre de ayer',
    status: 'Lo que se vendió y cómo te pagaron.',
    tone: 'muted',
    done: false,
    action: act(facts.yesterday, `Cargar el cierre del ${weekdayAndDay(facts.yesterday)}`),
    covers,
  }
}

function expenseItem(input: TodayInput): TodayItem | null {
  // Es una invitación a cargar: quien solo lee no la ve.
  if (!input.canWrite) return null
  const never = input.summary !== null && !input.summary.firstSteps.firstExpense
  return {
    id: 'expense',
    title: '¿Compraste o pagaste algo hoy?',
    status: never
      ? 'Todavía no cargaste ningún gasto: empezá por el de hoy.'
      : 'El hielo, la verdulería, un flete: cargalo en el momento.',
    tone: 'muted',
    done: false,
    action: { kind: 'sheet', sheet: 'gasto', params: {}, label: 'Cargar un gasto' },
    covers: [],
  }
}

function payablesItem(input: TodayInput): TodayItem | null {
  const payables = input.summary?.payables
  if (!input.summary || !payables) return null
  const covers = ['payable_overdue', 'payable_due_week'] as const
  const overdue = Math.max(0, payables.overdueCents)
  const week = Math.max(0, payables.dueWeekCents)

  if (overdue === 0 && week === 0) {
    // Sin saldos iniciales y sin ninguna compra a pagar cargada, el cero no es un dato: la
    // tarjeta no se tilda ni afirma que no se debe nada (el héroe tampoco muestra «$ 0»).
    if (payables.totalCents <= 0 && input.settings?.openingStatus === 'pending') {
      return {
        id: 'payables',
        title: 'Pagos que vencen',
        status: input.canWrite
          ? 'Todavía no cargaste lo que debés: entra con los saldos iniciales.'
          : 'Los dueños todavía no cargaron lo que se debía al empezar.',
        tone: 'muted',
        done: false,
        action: null,
        covers,
      }
    }
    return {
      id: 'payables',
      title: 'Pagos que vencen',
      status:
        payables.totalCents > 0
          ? 'Nada vencido ni por vencer esta semana.'
          : 'No le debés nada a ningún proveedor.',
      tone: 'ok',
      done: true,
      action: null,
      covers,
    }
  }

  let status: string
  if (overdue > 0 && week > 0) {
    status = `${pesos(overdue)} vencido y ${pesos(week)} que vence esta semana.`
  } else if (overdue > 0) {
    const who =
      payables.partiesRed > 0
        ? ` con ${count(payables.partiesRed, 'proveedor', 'proveedores')}`
        : ''
    status = `${pesos(overdue)} vencido${who}.`
  } else {
    status = `Esta semana vencen ${pesos(week)}.`
  }

  // Con un solo proveedor en la lista, la hoja se abre con él ya elegido.
  const parties = new Set<string>()
  for (const item of input.summary.attention) {
    if (PAYABLE_KINDS.has(item.kind) && item.partyId) parties.add(item.partyId)
  }
  const [only] = parties
  const params: HomeSheetParams = parties.size === 1 && only ? { proveedor: only } : {}
  return {
    id: 'payables',
    title: 'Pagos que vencen',
    status,
    tone: overdue > 0 ? 'late' : 'warn',
    done: false,
    action: input.canWrite ? { kind: 'sheet', sheet: 'pagar', params, label: 'Pagar' } : null,
    covers,
  }
}

/**
 * Los gastos fijos que tocan: vencen dentro de su aviso (o ya vencieron) y
 * todavía no se cargaron ni se saltearon, la misma regla del aviso de la base.
 * Los ya cargados y sin pagar son deuda con el proveedor: van en «Pagos que
 * vencen», no acá (no se cuentan dos veces).
 */
function fixedItem(input: TodayInput, base: string): TodayItem | null {
  const rows = input.recurring
  if (!rows) return null
  const due = rows.filter(
    (r) => r.active && !r.ended && r.monthStatus === 'pending' && r.daysToDue <= r.remindDaysBefore,
  )
  if (due.length === 0) return null

  const late = due.filter((r) => r.daysToDue < 0).length
  const soon = due.length - late
  const amount = due.reduce((sum, r) => sum + (r.amountCents ?? 0), 0)
  const withoutAmount = due.filter((r) => r.amountCents === null).length
  const single = due.length === 1 ? due[0] : undefined

  let status: string
  if (single) {
    const when =
      single.daysToDue < 0
        ? `Venció el ${formatDayMonth(single.nextDueDate)}`
        : single.daysToDue === 0
          ? 'Vence hoy'
          : `Vence el ${weekdayAndDay(single.nextDueDate)}`
    status = `${when} · ${single.amountCents === null ? 'sin monto' : `aprox. ${pesos(single.amountCents)}`}`
  } else {
    const what =
      late > 0 && soon > 0
        ? `${count(late, 'vencido', 'vencidos')} y ${soon} por vencer`
        : late > 0
          ? `${late} vencidos`
          : `${soon} por vencer`
    const money =
      amount === 0
        ? 'sin monto'
        : `aprox. ${pesos(amount)}${withoutAmount > 0 ? ` (${withoutAmount} sin monto)` : ''}`
    status = `${what} · ${money}`
  }

  return {
    id: 'fixed',
    title: single ? `Gasto fijo: ${single.name}` : 'Gastos fijos',
    status,
    tone: late > 0 ? 'late' : 'warn',
    done: false,
    action: input.canWrite
      ? link(base, '/gastos-fijos', single ? 'Ver y pagar' : 'Ver gastos fijos')
      : null,
    covers: ['recurring_due'],
  }
}

function importReviewItem(input: TodayInput, base: string): TodayItem | null {
  if (!input.canWrite) return null
  const pending = (input.integration ?? []).filter((i) => i.kind === 'import_review')
  const first = pending[0]
  if (!first) return null
  return {
    id: 'import_review',
    title: 'Revisar lo que subiste',
    status: pending.length > 1 ? `${first.label} Y ${pending.length - 1} más.` : first.label,
    tone: 'warn',
    done: false,
    action: link(base, pending.length > 1 ? '/importar' : first.href, first.actionLabel),
    covers: ['import_review'],
  }
}

/**
 * Subir el reporte de Mercado Pago y los movimientos del banco: toca los lunes,
 * y cualquier día si el bar ya los venía subiendo y pasó más de una semana. Solo
 * por las cuentas que el bar tiene cargadas (sin banco, no se pide el banco).
 */
function weeklyImportItem(input: TodayInput, base: string): TodayItem | null {
  if (!input.canWrite) return null
  const { state, data } = onboardingParts(input.onboarding)
  if (!state) return null
  const monday = weekdayOf(input.today) === 1
  const kinds = new Set((input.summary?.treasuries ?? []).map((t) => t.kind))
  const used = (source: 'mp_release' | 'bank_statement') =>
    (data?.imports[source]?.lastBatchAt ?? null) !== null
  const todo = (id: 'mp_weekly' | 'bank_weekly') =>
    state.items.some((i) => i.id === id && i.status === 'todo')

  const wallet =
    todo('mp_weekly') &&
    (input.summary === null || kinds.has('wallet')) &&
    (monday || used('mp_release'))
  const bank =
    todo('bank_weekly') &&
    (input.summary === null || kinds.has('bank')) &&
    (monday || used('bank_statement'))
  if (!wallet && !bank) return null

  const both = wallet && bank
  return {
    id: 'weekly_import',
    title: both
      ? 'Subir Mercado Pago y el banco'
      : wallet
        ? 'Subir el reporte de Mercado Pago'
        : 'Subir los movimientos del banco',
    status: both
      ? 'Bajás los dos archivos y los subís: lo de la semana pasada.'
      : 'Bajás el archivo y lo subís: lo de la semana pasada.',
    tone: 'info',
    done: false,
    action: link(
      base,
      both ? '/importar' : wallet ? '/importar/mercado-pago' : '/importar/banco',
      both ? 'Ir a Importar' : 'Subir el archivo',
    ),
    covers: [],
  }
}

/** Del 11 en adelante ya están casi todas las facturas del mes anterior en ARCA. */
const ARCA_FROM_DAY = 11

function previousMonthName(today: string): string {
  return monthName(Number(addDays(startOfMonth(today), -1).slice(5, 7)))
}

/**
 * ¿El mes pasado entero es de antes de arrancar los libros? Entonces no hay compras de ese mes
 * para bajar de ARCA: lo que se debía de antes entra con los saldos iniciales, y una compra con
 * fecha anterior al arranque no se puede cargar. Es la misma regla de la guía («Bajar las
 * compras de ARCA: empieza el mes que viene») y la del cierre del mes.
 */
export function previousMonthBeforeBooks(
  today: string,
  booksStartDate: string | null | undefined,
): boolean {
  const start = validDay(booksStartDate)
  return start !== null && isRealIsoDay(today) && start > addDays(startOfMonth(today), -1)
}

/**
 * Los avisos de las integraciones que valen para este bar HOY: «Bajá Mis Comprobantes del mes
 * pasado» se saca mientras el mes pasado sea de antes de los libros (ni tarjeta en «Hoy te
 * toca» ni renglón en «Avisos»).
 */
export function integrationForBooks<T extends { kind: string }>(
  items: readonly T[],
  opts: { today: string; booksStartDate?: string | null },
): T[] {
  if (!previousMonthBeforeBooks(opts.today, opts.booksStartDate)) return [...items]
  return items.filter((item) => item.kind !== 'mc_prev_month')
}

function arcaMonthlyItem(input: TodayInput, base: string): TodayItem | null {
  if (!input.canWrite) return null
  if (previousMonthBeforeBooks(input.today, input.settings?.booksStartDate)) return null
  const notice = (input.integration ?? []).find((i) => i.kind === 'mc_prev_month')
  if (notice) {
    return {
      id: 'arca_monthly',
      title: 'Bajar las compras de ARCA',
      status: notice.label,
      tone: 'info',
      done: false,
      action: link(base, notice.href, notice.actionLabel),
      covers: ['mc_prev_month'],
    }
  }
  const { state } = onboardingParts(input.onboarding)
  const todo = state?.items.some((i) => i.id === 'arca_monthly' && i.status === 'todo') ?? false
  if (!todo || Number(input.today.slice(8, 10)) < ARCA_FROM_DAY) return null
  return {
    id: 'arca_monthly',
    title: 'Bajar las compras de ARCA',
    status: `Ya están casi todas las facturas de ${previousMonthName(input.today)}.`,
    tone: 'info',
    done: false,
    action: link(base, '/importar/arca', 'Subir las compras de ARCA'),
    covers: ['mc_prev_month'],
  }
}

function monthCloseItem(input: TodayInput, base: string): TodayItem | null {
  const act = input.canWrite ? link(base, '/libros/cierres', 'Revisar y cerrar') : null
  const ready = input.summary?.attention.find((a) => a.kind === 'month_ready') ?? null
  if (ready) {
    const warnings = ready.count ?? 0
    // La base manda el mes («Octubre 2026»); si no vino, el texto es una frase y no un nombre.
    const subject = ready.label.trim()
    return {
      id: 'month_close',
      title: subject && !subject.endsWith('.') ? `Cerrar ${subject}` : 'Cerrar el mes',
      status:
        warnings > 0
          ? `Está listo para cerrar, con ${count(warnings, 'aviso', 'avisos')}.`
          : 'Está listo para cerrar.',
      tone: 'info',
      done: false,
      action: act,
      covers: ['month_ready'],
    }
  }
  const { state } = onboardingParts(input.onboarding)
  const todo = state?.items.some((i) => i.id === 'month_close' && i.status === 'todo') ?? false
  if (!todo || Number(input.today.slice(8, 10)) < ARCA_FROM_DAY) return null
  return {
    id: 'month_close',
    title: 'Cerrar el mes pasado',
    status: `${capitalizeFirst(previousMonthName(input.today))} sigue abierto: revisalo con la contadora.`,
    tone: 'info',
    done: false,
    action: act,
    covers: ['month_ready'],
  }
}

/**
 * «Hoy te toca»: de 3 a 5 tarjetas, en orden. Las tres de todos los días (el
 * cierre de ayer, el gasto de hoy, lo que vence) y, solo cuando tocan, hasta
 * dos más: el gasto fijo por vencer, revisar o subir Mercado Pago y el banco,
 * bajar las compras de ARCA (del 11 en adelante) y cerrar el mes.
 *
 * Las hechas quedan en la lista (`done`): se muestran atenuadas y con tilde.
 * Quien solo lee recibe las de estado, sin ninguna acción.
 */
export function buildToday(input: TodayInput): TodayItem[] {
  const base = input.base ?? ''
  const fixed: Array<TodayItem | null> = [
    closeItem(input, base),
    expenseItem(input),
    payablesItem(input),
  ]
  const whenDue: Array<TodayItem | null> = [
    fixedItem(input, base),
    importReviewItem(input, base),
    weeklyImportItem(input, base),
    arcaMonthlyItem(input, base),
    monthCloseItem(input, base),
  ]
  const present = (item: TodayItem | null): item is TodayItem => item !== null
  return [...fixed.filter(present), ...whenDue.filter(present)].slice(0, TODAY_MAX_ITEMS)
}

// ─── Puesta en marcha ────────────────────────────────────────────────────────

export type SetupStepId = string

export type SetupStep = {
  /**
   * `opening`, `first_close`, `first_expense`, `sas_data`, `suppliers_category`,
   * `recurring_amounts`, `access` o el id de un ítem de «Día 1» de la guía.
   */
  id: SetupStepId
  title: string
  /** Qué falta o para qué sirve, en una línea. */
  detail: string | null
  done: boolean
  /** No cuenta para «N de M». */
  optional: boolean
  action: HomeAction | null
}

export type SetupStrip = {
  /** «Puesta en marcha · 4 de 12». */
  title: string
  done: number
  total: number
  /** No queda nada obligatorio: la franja se va. */
  complete: boolean
  /** Todos los pasos, primero lo que más conviene. */
  steps: SetupStep[]
  /** Lo próximo que conviene hacer: hasta tres pendientes. */
  next: SetupStep[]
  /** «Ver todo». */
  guideHref: string
}

export type SetupInput = {
  summary: Pick<AccSummary, 'firstSteps'> | null
  settings: Pick<AccountingSettings, 'openingStatus' | 'cuit'> | null
  onboarding?: HomeOnboarding | null
  recurring?: readonly HomeRecurringRow[] | null
  /** Proveedores activos y cuántos no tienen su categoría habitual (`getSupplierCategoryCount`). */
  suppliers?: { total: number; withoutCategory: number } | null
  canWrite: boolean
  base?: string
}

const SETUP_GUIDE_PATH = '/guias/como-arrancar'
const SETUP_NEXT_MAX = 3

/**
 * La franja «Puesta en marcha · N de M»: UNA lista que junta lo que antes
 * estaba en tres lados (los dos avisos de arriba —saldos iniciales y CUIT—,
 * «Primeros pasos» y la sección «Día 1» de la guía) y suma dos cosas que
 * ninguna decía: los proveedores sin categoría y los gastos fijos sin monto.
 *
 * El orden es el de «lo próximo que conviene»: primero lo que hace que los
 * números del Resumen sean de verdad, después el resto de la guía en su orden.
 *
 * Quien solo lee (la contadora) recibe únicamente lo que le cambia la lectura:
 * saldos iniciales y CUIT, dicho para ella y sin acciones.
 */
export function buildSetup(input: SetupInput): SetupStrip {
  const base = input.base ?? ''
  const { state } = onboardingParts(input.onboarding)
  const item = (id: string) => state?.items.find((i) => i.id === id) ?? null
  const guideHref = `${base}${SETUP_GUIDE_PATH}`

  const openingItem = item('opening')
  const openingDone = openingItem
    ? openingItem.status === 'done'
    : input.settings
      ? input.settings.openingStatus !== 'pending'
      : null
  const sasItem = item('sas_data')
  const cuitMissing = input.settings ? !input.settings.cuit : null
  const sasDone = sasItem ? sasItem.status === 'done' : cuitMissing === null ? null : !cuitMissing

  if (!input.canWrite) {
    const steps: SetupStep[] = []
    if (openingDone !== null) {
      steps.push({
        id: 'opening',
        title: openingDone ? 'Saldos iniciales cargados' : 'Faltan los saldos iniciales',
        detail: openingDone
          ? null
          : 'Los dueños todavía no cargaron lo que había al empezar los libros.',
        done: openingDone,
        optional: false,
        action: null,
      })
    }
    if (cuitMissing !== null) {
      steps.push({
        id: 'sas_data',
        title: cuitMissing ? 'Falta el CUIT de la SAS' : 'CUIT de la SAS cargado',
        detail: cuitMissing
          ? 'Pedíselo a los dueños: se carga en Ajustes › Datos de la SAS.'
          : null,
        done: !cuitMissing,
        optional: false,
        action: null,
      })
    }
    return stripOf(steps, guideHref)
  }

  const steps: SetupStep[] = []
  const used = new Set<string>()
  const push = (step: SetupStep) => {
    steps.push(step)
    used.add(step.id)
  }

  if (openingDone !== null) {
    push({
      id: 'opening',
      title: 'Cargá lo que hay hoy en cada caja',
      detail: openingDone
        ? null
        : 'Los saldos iniciales: cuánta plata hay y cuánto se debe. Sin eso, todo arranca en cero.',
      done: openingDone,
      optional: false,
      action: link(base, '/configurar', 'Cargar lo que hay'),
    })
  }
  if (input.summary) {
    push({
      id: 'first_close',
      title: 'Cargá tu primer cierre del día',
      detail: input.summary.firstSteps.firstDailyClose
        ? null
        : 'Lo que se vendió y cómo te pagaron: efectivo, QR, tarjetas y apps.',
      done: input.summary.firstSteps.firstDailyClose,
      optional: false,
      action: link(base, '/ventas/cierre', 'Cargar el cierre'),
    })
    push({
      id: 'first_expense',
      title: 'Cargá tu primer gasto',
      detail: input.summary.firstSteps.firstExpense
        ? null
        : 'Lo de todos los días: el hielo, la verdulería, un flete.',
      done: input.summary.firstSteps.firstExpense,
      optional: false,
      action: { kind: 'sheet', sheet: 'gasto', params: {}, label: 'Cargar un gasto' },
    })
  }
  if (sasDone !== null) {
    push({
      id: 'sas_data',
      title: 'Completá los datos de la SAS',
      detail: sasDone
        ? null
        : (sasItem?.pending ?? 'Falta el CUIT: los libros de IVA lo necesitan.'),
      done: sasDone,
      optional: false,
      action: link(base, '/ajustes?tab=sas', 'Completar'),
    })
  }
  if (input.suppliers && input.suppliers.total > 0) {
    const n = Math.max(0, input.suppliers.withoutCategory)
    push({
      id: 'suppliers_category',
      title: 'Decí en qué le comprás a cada proveedor',
      detail:
        n === 0
          ? null
          : `${count(n, 'proveedor no tiene', 'proveedores no tienen')} categoría: con eso, cada compra se ordena sola.`,
      done: n === 0,
      optional: false,
      // «Clasificar proveedores» (`?filtro=sin-clasificar`): deja solo los que faltan.
      action: link(
        base,
        '/compras?tab=proveedores&filtro=sin-clasificar',
        'Clasificar proveedores',
      ),
    })
  }
  const live = (input.recurring ?? []).filter((r) => r.active && !r.ended)
  if (live.length > 0) {
    const n = live.filter((r) => r.amountCents === null).length
    push({
      id: 'recurring_amounts',
      title: 'Poneles monto a los gastos fijos',
      detail:
        n === 0
          ? null
          : `${n} de ${live.length} no ${n === 1 ? 'tiene' : 'tienen'} monto: sin eso no sabés cuánto te falta pagar.`,
      done: n === 0,
      optional: false,
      // «Completar la planilla»: los montos de todos de corrido (`gastosFijosFillHref`).
      action: link(base, '/gastos-fijos/completar', 'Completar los montos'),
    })
  }

  if (state) {
    // El resto de «Día 1», en el orden de la guía (lo informativo no es un paso).
    for (const i of state.items) {
      if (i.section !== 'day1' || i.status === 'info' || used.has(i.id)) continue
      push({
        id: i.id,
        title: i.title,
        detail: i.status === 'done' ? null : (i.pending ?? i.what),
        done: i.status === 'done',
        optional: i.optional === true,
        action: i.where.path
          ? link(base, i.where.path, i.actionLabel ?? 'Ver cómo')
          : link(base, SETUP_GUIDE_PATH, 'Ver cómo'),
      })
    }
  } else if (input.summary) {
    // Sin la guía (todavía no está en la base): lo de «Primeros pasos».
    const { partnerGranted, accountantAdded } = input.summary.firstSteps
    const done = partnerGranted && accountantAdded
    push({
      id: 'access',
      title: 'Dales acceso a tu socio y a la contadora',
      detail: done
        ? null
        : !partnerGranted && !accountantAdded
          ? 'Faltan tu socio y la contadora.'
          : !partnerGranted
            ? 'Falta darle acceso a tu socio.'
            : 'Falta sumar a la contadora.',
      done,
      optional: false,
      action: link(base, '/ajustes?tab=accesos', 'Ir a Accesos'),
    })
  }

  return stripOf(steps, guideHref)
}

/**
 * Lo próximo de la puesta en marcha que la pantalla todavía NO ofrece en otro
 * lado. El héroe ya pide los saldos iniciales («Cargar lo que hay») y «Hoy te
 * toca» ya tiene la tarjeta del cierre y la del gasto: repetirlos en la franja
 * eran dos botones con nombres distintos para la misma cosa. Los pasos siguen
 * contando para «N de M»; solo no se vuelven a ofrecer.
 */
export function setupNext(
  strip: Pick<SetupStrip, 'steps'>,
  shown: { hero?: HeroState | null; today?: readonly TodayItem[] | null } = {},
  max = SETUP_NEXT_MAX,
): SetupStep[] {
  const covered = new Set<string>()
  const hero = shown.hero ?? null
  if (hero?.kind === 'unknown' && hero.reason === 'opening_pending' && hero.action !== null) {
    covered.add('opening')
  }
  for (const item of shown.today ?? []) {
    if (item.done || item.action === null) continue
    if (item.id === 'daily_close') covered.add('first_close')
    if (item.id === 'expense') covered.add('first_expense')
  }
  return strip.steps
    .filter((s) => !s.optional && !s.done && !covered.has(s.id))
    .slice(0, Math.max(0, max))
}

function stripOf(steps: SetupStep[], guideHref: string): SetupStrip {
  const required = steps.filter((s) => !s.optional)
  const done = required.filter((s) => s.done).length
  const total = required.length
  const pending = required.filter((s) => !s.done)
  return {
    title: total > 0 ? `Puesta en marcha · ${done} de ${total}` : 'Puesta en marcha',
    done,
    total,
    complete: pending.length === 0,
    steps,
    next: pending.slice(0, SETUP_NEXT_MAX),
    guideHref,
  }
}

// ─── 4. En qué se va la plata ────────────────────────────────────────────────

/** Los comprobantes que cuentan como «Compras y gastos» (los mismos del resumen). */
export const SPENDING_DOCUMENT_KINDS = [
  'purchase',
  'purchase_debit_note',
  'purchase_credit_note',
  'expense',
  'bank_expense',
] as const

/** Los renglones de un comprobante que dicen EN QUÉ se gastó. */
export const SPENDING_BASE_ROLES = ['net', 'gross', 'non_taxed', 'exempt', 'internal_tax'] as const
/** Los que son impuestos de esa compra: se reparten entre lo comprado. */
export const SPENDING_TAX_ROLES = ['vat', 'perception', 'other_tax'] as const

const BASE_ROLES: ReadonlySet<string> = new Set(SPENDING_BASE_ROLES)
const TAX_ROLES: ReadonlySet<string> = new Set(SPENDING_TAX_ROLES)

/** Un comprobante de compra o gasto vigente del período. */
export type SpendingDocument = {
  id: string
  kind: string
  voucherType: string | null
  /** Total con impuestos, siempre positivo (la nota de crédito resta por su tipo). */
  totalCents: number
}

export type SpendingLine = {
  documentId: string
  role: string
  side: 'debit' | 'credit'
  amountCents: number
  accountId: string
  vatRateBp: number | null
}

/** La cuenta de un renglón y la categoría donde cae (su grupo del plan de cuentas). */
export type SpendingAccount = {
  /** `expense`, `asset`… */
  type: string
  categoryKey: string
  categoryLabel: string
}

export type SpendingCategoryRow = {
  /** El id del grupo del plan (o `impuestos` / `sin_clasificar`). */
  key: string
  label: string
  /** Lo que salió por esa categoría, CON impuestos. Negativo si pesan más las notas de crédito. */
  cents: number
  /** Lo mismo sin impuestos (el número de los libros). */
  netCents: number
}

export type SpendingVoucherRow = {
  /** `factura_a`, `tique`, `sin_comprobante`… o `null` (un gasto bancario no lleva papel). */
  voucherType: string | null
  cents: number
  documents: number
}

export type SpendingTotals = {
  /** De la que más pesa a la que menos. */
  categories: SpendingCategoryRow[]
  vouchers: SpendingVoucherRow[]
  /** Σ de todo: el mismo «Compras y gastos» del resumen. */
  totalCents: number
  documents: number
}

export const SPENDING_TAXES_KEY = 'impuestos'
export const SPENDING_UNCLASSIFIED_KEY = 'sin_clasificar'
const TAXES_LABEL = 'Impuestos y percepciones'
const UNCLASSIFIED_LABEL = 'Sin categoría'

/**
 * Reparte `amount` centavos en partes proporcionales a `weights`, sin perder
 * ni inventar un centavo (los que sobran van a las partes con el resto más
 * grande). Con enteros grandes (`BigInt`): sin coma flotante. Si ningún peso
 * es positivo, todo va a la primera parte.
 */
export function allocateCents(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return []
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? BigInt(Math.round(x)) : 0n))
  const total = w.reduce((sum, x) => sum + x, 0n)
  const whole = Number.isFinite(amount) ? Math.trunc(amount) : 0
  if (total === 0n) return weights.map((_, i) => (i === 0 ? whole : 0))
  const negative = whole < 0
  const abs = BigInt(Math.abs(whole))
  const parts = w.map((x) => (abs * x) / total)
  let left = abs - parts.reduce((sum, x) => sum + x, 0n)
  const order = w
    .map((x, i) => ({ i, rest: (abs * x) % total }))
    .sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1))
  for (const { i } of order) {
    if (left <= 0n) break
    parts[i] = (parts[i] ?? 0n) + 1n
    left -= 1n
  }
  return parts.map((x) => (negative ? -Number(x) || 0 : Number(x)))
}

function signedOf(line: SpendingLine): number {
  return line.side === 'credit' ? -line.amountCents : line.amountCents
}

/** Un comprobante repartido en categorías: la suma es su total con signo. */
function allocateDocument(
  signedTotal: number,
  lines: readonly SpendingLine[],
  accounts: ReadonlyMap<string, SpendingAccount>,
): Map<string, SpendingCategoryRow> {
  const out = new Map<string, SpendingCategoryRow>()
  const add = (key: string, label: string, cents: number, netCents: number) => {
    const row = out.get(key) ?? { key, label, cents: 0, netCents: 0 }
    row.cents += cents
    row.netCents += netCents
    out.set(key, row)
  }

  let base = lines.filter((l) => BASE_ROLES.has(l.role))
  let taxes = lines.filter((l) => TAX_ROLES.has(l.role))
  if (base.length === 0) {
    // Un gasto bancario que es solo impuestos: los que van a una cuenta de gasto
    // dicen la categoría (los que se recuperan se reparten entre ellos).
    base = taxes.filter((l) => accounts.get(l.accountId)?.type === 'expense')
    taxes = taxes.filter((l) => !base.includes(l))
  }
  if (base.length === 0) {
    if (taxes.length > 0) add(SPENDING_TAXES_KEY, TAXES_LABEL, signedTotal, 0)
    else add(SPENDING_UNCLASSIFIED_KEY, UNCLASSIFIED_LABEL, signedTotal, 0)
    return out
  }

  const net = base.map(signedOf)
  const withTaxes = [...net]
  for (const tax of taxes) {
    // El IVA va a lo que se compró con esa alícuota; lo demás, a todo el comprobante.
    const sameRate =
      tax.role === 'vat' && tax.vatRateBp !== null
        ? base.map((l) => l.vatRateBp === tax.vatRateBp)
        : null
    const targeted = sameRate?.some(Boolean) ?? false
    const weights = net.map((cents, i) => (targeted && !sameRate?.[i] ? 0 : Math.abs(cents)))
    const shares = allocateCents(signedOf(tax), weights)
    for (let i = 0; i < withTaxes.length; i += 1) {
      withTaxes[i] = (withTaxes[i] ?? 0) + (shares[i] ?? 0)
    }
  }
  base.forEach((line, i) => {
    const account = accounts.get(line.accountId)
    add(
      account?.categoryKey ?? SPENDING_UNCLASSIFIED_KEY,
      account?.categoryLabel ?? UNCLASSIFIED_LABEL,
      withTaxes[i] ?? 0,
      net[i] ?? 0,
    )
  })

  // El total del comprobante manda: si los renglones no lo explican entero (un
  // redondeo, un renglón de un tipo nuevo), la diferencia va a su categoría principal.
  const explained = [...out.values()].reduce((sum, row) => sum + row.cents, 0)
  const gap = signedTotal - explained
  if (gap !== 0) {
    let main: SpendingCategoryRow | null = null
    for (const row of out.values()) {
      if (main === null || Math.abs(row.cents) > Math.abs(main.cents)) main = row
    }
    if (main) main.cents += gap
  }
  return out
}

/**
 * «En qué se va la plata»: los comprobantes de compra y gasto del período,
 * sumados por categoría y por el papel que tienen. Puro: `getMonthSpending` le
 * pasa las filas ya leídas.
 *
 * - **Categoría** = el grupo del plan de cuentas donde está la cuenta de cada
 *   renglón («Alimentos y bebidas», «Gastos del local»…), no la cuenta suelta
 *   ni un prefijo del código (el plan se puede editar).
 * - **Con impuestos**: el IVA y las percepciones de cada compra se reparten
 *   entre lo comprado, así cada categoría dice lo que de verdad salió por ella
 *   y la suma es el total de los comprobantes (el «Compras y gastos» del
 *   resumen). `netCents` guarda el número sin impuestos, el de los libros.
 * - **Signos**: la nota de crédito resta (sus renglones van al Haber).
 * - Los anulados y la factura mensual de comisiones no llegan acá: los filtra
 *   la lectura.
 */
export function aggregateSpending(
  documents: readonly SpendingDocument[],
  lines: readonly SpendingLine[],
  accounts: ReadonlyMap<string, SpendingAccount>,
): SpendingTotals {
  const byDocument = new Map<string, SpendingLine[]>()
  for (const line of lines) {
    const list = byDocument.get(line.documentId) ?? []
    list.push(line)
    byDocument.set(line.documentId, list)
  }

  const categories = new Map<string, SpendingCategoryRow>()
  const vouchers = new Map<string, SpendingVoucherRow>()
  let totalCents = 0
  for (const doc of documents) {
    const signedTotal = doc.kind === 'purchase_credit_note' ? -doc.totalCents : doc.totalCents
    totalCents += signedTotal

    const voucherKey = doc.voucherType ?? ''
    const voucher = vouchers.get(voucherKey) ?? {
      voucherType: doc.voucherType,
      cents: 0,
      documents: 0,
    }
    voucher.cents += signedTotal
    voucher.documents += 1
    vouchers.set(voucherKey, voucher)

    for (const part of allocateDocument(
      signedTotal,
      byDocument.get(doc.id) ?? [],
      accounts,
    ).values()) {
      const row = categories.get(part.key) ?? {
        key: part.key,
        label: part.label,
        cents: 0,
        netCents: 0,
      }
      row.cents += part.cents
      row.netCents += part.netCents
      categories.set(part.key, row)
    }
  }

  return {
    categories: [...categories.values()].sort(
      (a, b) => b.cents - a.cents || a.label.localeCompare(b.label, 'es'),
    ),
    vouchers: [...vouchers.values()].sort((a, b) => b.cents - a.cents),
    totalCents,
    documents: documents.length,
  }
}

export type SpendingBar = {
  key: string
  label: string
  cents: number
  netCents: number
  /** Parte de lo que muestran las barras, de 0 a 100 con un decimal. */
  percent: number
  /** La barra «Otros». */
  isOther: boolean
  /** Cuántas categorías junta (1, o varias en «Otros»). */
  count: number
}

export type SpendingView = {
  /** Hasta `max` categorías y, si hay más, «Otros» al final. */
  bars: SpendingBar[]
  /** Σ de las barras. */
  shownCents: number
  /** Σ de todo, con las notas de crédito restadas: el «Compras y gastos» del resumen. */
  totalCents: number
  /** Categorías que quedaron a favor (más notas de crédito que compras): no se dibujan. */
  creditCents: number
  isEmpty: boolean
  /** El título que afirma: «Lo que más se lleva: Alimentos y bebidas (67 %)». */
  title: string | null
}

export const SPENDING_MAX_CATEGORIES = 6

/**
 * Las barras de «En qué se va la plata»: las 6 categorías que más pesan y
 * «Otros» con el resto. Una categoría en negativo no es una barra: se informa
 * aparte (`creditCents`).
 */
export function spendingView(
  rows: readonly SpendingCategoryRow[],
  opts: { max?: number } = {},
): SpendingView {
  const max = Math.max(1, opts.max ?? SPENDING_MAX_CATEGORIES)
  const totalCents = rows.reduce((sum, r) => sum + r.cents, 0)
  const positive = rows
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label, 'es'))
  const shownCents = positive.reduce((sum, r) => sum + r.cents, 0)
  const creditCents = rows.reduce((sum, r) => sum + (r.cents < 0 ? -r.cents : 0), 0)

  const bar = (r: SpendingCategoryRow, isOther: boolean, n: number): SpendingBar => ({
    key: r.key,
    label: r.label,
    cents: r.cents,
    netCents: r.netCents,
    percent: percentOf(r.cents, shownCents),
    isOther,
    count: n,
  })
  const bars = positive.slice(0, max).map((r) => bar(r, false, 1))
  const rest = positive.slice(max)
  if (rest.length > 0) {
    bars.push(
      bar(
        {
          key: 'otros',
          label: 'Otros',
          cents: rest.reduce((sum, r) => sum + r.cents, 0),
          netCents: rest.reduce((sum, r) => sum + r.netCents, 0),
        },
        true,
        rest.length,
      ),
    )
  }

  const top = bars[0]
  return {
    bars,
    shownCents,
    totalCents,
    creditCents,
    isEmpty: bars.length === 0,
    title: top
      ? bars.length === 1
        ? `Todo fue a ${top.label}`
        : `Lo que más se lleva: ${top.label} (${Math.round(top.percent)} %)`
      : null,
  }
}

export type InvoicedSplit = {
  /** Con factura (facturas, tiques, recibos y sus notas). */
  invoicedCents: number
  /** Sin factura: remito o nada (`sin_comprobante`). */
  notInvoicedCents: number
  /** Ni una cosa ni la otra: lo que no lleva papel (gastos del banco). Va aparte. */
  otherCents: number
  invoicedDocuments: number
  notInvoicedDocuments: number
  otherDocuments: number
  /** Con + sin: lo que entra en la barra. */
  totalCents: number
  /** De 0 a 100 con un decimal (0 sin total). */
  invoicedPercent: number
  notInvoicedPercent: number
  isEmpty: boolean
  /** «El 95 % fue con factura y el 5 % sin factura.» */
  sentence: string
  /** La aclaración de lo que va aparte, si hay. */
  otherNote: string | null
}

/**
 * Con factura / sin factura de los egresos del período. La regla es la de
 * `invoiced.ts`, la misma del filtro de Comprobantes: sin factura es lo que se
 * guardó con `sin_comprobante`; un comprobante sin tipo (un gasto del banco) no
 * es ni una cosa ni la otra y va aparte.
 *
 * Es una forma de mirar los mismos egresos: los dos quedan registrados igual.
 */
export function invoicedSplit(rows: readonly SpendingVoucherRow[]): InvoicedSplit {
  let invoiced = 0
  let notInvoiced = 0
  let other = 0
  let invoicedDocuments = 0
  let notInvoicedDocuments = 0
  let otherDocuments = 0
  for (const row of rows) {
    if (row.voucherType === null || row.voucherType === '') {
      other += row.cents
      otherDocuments += row.documents
    } else if (isNotInvoicedVoucher(row.voucherType)) {
      notInvoiced += row.cents
      notInvoicedDocuments += row.documents
    } else {
      invoiced += row.cents
      invoicedDocuments += row.documents
    }
  }
  // Un mes con más notas de crédito que compras no es una barra en negativo.
  const invoicedCents = Math.max(0, invoiced)
  const notInvoicedCents = Math.max(0, notInvoiced)
  const otherCents = Math.max(0, other)
  const totalCents = invoicedCents + notInvoicedCents
  const invoicedPercent = percentOf(invoicedCents, totalCents)
  const notInvoicedPercent = totalCents > 0 ? Math.round((100 - invoicedPercent) * 10) / 10 : 0

  let sentence: string
  if (totalCents === 0) sentence = 'Todavía no cargaste compras ni gastos este mes.'
  else if (notInvoicedCents === 0) sentence = 'Todo lo que cargaste fue con factura.'
  else if (invoicedCents === 0) sentence = 'Todo lo que cargaste fue sin factura (remito o nada).'
  else {
    sentence = `El ${Math.round(invoicedPercent)} % fue con factura y el ${100 - Math.round(invoicedPercent)} % sin factura.`
  }

  return {
    invoicedCents,
    notInvoicedCents,
    otherCents,
    invoicedDocuments,
    notInvoicedDocuments,
    otherDocuments,
    totalCents,
    invoicedPercent,
    notInvoicedPercent,
    isEmpty: totalCents === 0,
    sentence,
    otherNote:
      otherCents > 0
        ? `Aparte hay ${pesos(otherCents)} de gastos del banco, que no llevan factura ni remito.`
        : null,
  }
}
