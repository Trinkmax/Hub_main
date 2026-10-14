/**
 * «La billetera»: qué muestra la portada de Cajas y bancos. Puro (sin React ni
 * base); lo prueba `tests/lib/administracion-cajas-vista.test.ts`.
 *
 * Tiene que decir LO MISMO que el Resumen, que es la otra pantalla donde se ve
 * cuánta plata hay. Por eso:
 * - el estado («todavía no sé cuánta plata hay», el total, la oración) sale de
 *   `heroState()` de `lib/accounting/home.ts`, con las cajas ACTIVAS;
 * - el total suma las activas que no son tarjeta de la empresa (una caja
 *   desactivada que todavía tiene plata se muestra aparte y no suma);
 * - el color de cada caja sale de su tipo (`treasuryTones`), calculado sobre
 *   esas mismas cajas activas, en el orden de Ajustes.
 *
 * Contar una caja es lo que se hace con ella, así que cada tarjeta ofrece UNA
 * acción y en toda la pantalla hay un solo botón relleno: el de la primera
 * caja a la que le toca algo (tiene plata en camino o hace más de una semana
 * que no se cuenta).
 */

import { type HeroState, heroState, type TreasuryTone, treasuryTones } from '@/lib/accounting/home'
import { TREASURY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type { SummaryTreasury } from '@/lib/accounting/queries/summary'
import type { TreasuryBalanceRow } from '@/lib/accounting/queries/treasury'
import type { TreasuryKind } from '@/lib/accounting/types'
import { daysBetween, formatDayMonth, isRealIsoDay, monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/** Cuántos días sin contar hacen que una caja pida que la cuenten. */
export const CHECK_STALE_DAYS = 7

// ─── El estado del conteo ────────────────────────────────────────────────────

export type CountStatus = {
  /** Los tonos de `StatusPill`: contada hace poco · toca contarla · todavía nada que avisar. */
  tone: 'ok' | 'warn' | 'muted'
  text: string
  /** Le toca: cuenta como «sin contar esta semana». */
  due: boolean
}

function validDay(value: string | null | undefined): string | null {
  return typeof value === 'string' && isRealIsoDay(value) ? value : null
}

/**
 * Cómo viene el conteo de una caja. Ámbar SOLO cuando de verdad toca: un bar
 * que recién cargó sus saldos no tiene que ver tres avisos el primer día.
 *
 * - Nunca se contó y no tuvo movimientos → gris (no hay nada que controlar).
 * - Nunca se contó, con movimientos, y los libros tienen una semana o menos →
 *   gris (la primera semana).
 * - Nunca se contó, con movimientos, y los libros ya tienen más de una semana →
 *   ámbar.
 * - Contada hoy, ayer o hace hasta 7 días → verde.
 * - Hace más de 7 días → ámbar, con la fecha.
 *
 * `since` es el día en que arrancan los libros; si no se sabe, no se avisa.
 */
export function countStatus(input: {
  lastCheckedOn: string | null
  today: string
  hasMovements: boolean
  since: string | null
}): CountStatus {
  const last = validDay(input.lastCheckedOn)
  if (last === null) {
    const since = validDay(input.since)
    const oldBooks = since !== null && daysBetween(since, input.today) > CHECK_STALE_DAYS
    const due = input.hasMovements && oldBooks
    return { tone: due ? 'warn' : 'muted', text: 'Todavía no la contaste', due }
  }
  const days = daysBetween(last, input.today)
  if (days > CHECK_STALE_DAYS) {
    return {
      tone: 'warn',
      text: `La contaste por última vez el ${formatDayMonth(last)}`,
      due: true,
    }
  }
  const text = days <= 0 ? 'Contada hoy' : days === 1 ? 'Contada ayer' : `Contada hace ${days} días`
  return { tone: 'ok', text, due: false }
}

/** «Último movimiento: hoy» · «…ayer» · «…el 07/10» · «Sin movimientos todavía». */
export function lastMovementText(date: string | null, today: string): string {
  const day = validDay(date)
  if (day === null) return 'Sin movimientos todavía'
  const days = daysBetween(day, today)
  if (days <= 0) return 'Último movimiento: hoy'
  if (days === 1) return 'Último movimiento: ayer'
  return `Último movimiento: el ${formatDayMonth(day)}`
}

/** «Efectivo» · «Billetera · alias hub.bar» · «Banco · Banco de la Nación Argentina». */
export function treasuryDetail(row: {
  kind: TreasuryKind
  alias?: string | null
  bankName?: string | null
}): string {
  const kind = TREASURY_KIND_LABELS[row.kind] ?? 'Cuenta'
  const alias = (row.alias ?? '').trim()
  const bank = (row.bankName ?? '').trim()
  const extra = alias !== '' ? `alias ${alias}` : bank !== '' ? bank : null
  return extra ? `${kind} · ${extra}` : kind
}

// ─── Lo que se lee de un saldo ───────────────────────────────────────────────

export type TreasuryMoney = {
  /** La plata, siempre en positivo y sin centavos. `null`: no va número («Sin deuda»). */
  amount: string | null
  /** Lo que aclara el número: «Descubierto», «Debés», «A favor». */
  label: string | null
  /** Lo que va en lugar del número: «Sin deuda». */
  words: string | null
}

/**
 * Un saldo (Debe − Haber, como llega de los reportes) dicho sin un menos
 * pelado: «$ 394.757», «Descubierto $ 12.000»; en la tarjeta de la empresa,
 * «Debés $ 80.000», «A favor $ 1.500» o «Sin deuda».
 */
export function treasuryMoney(kind: TreasuryKind, balanceCents: number): TreasuryMoney {
  const amount = formatCentsShort(Math.abs(balanceCents))
  if (kind === 'credit_card') {
    if (balanceCents < 0) return { amount, label: 'Debés', words: null }
    if (balanceCents > 0) return { amount, label: 'A favor', words: null }
    return { amount: null, label: null, words: 'Sin deuda' }
  }
  if (balanceCents < 0) return { amount, label: 'Descubierto', words: null }
  return { amount, label: null, words: null }
}

// ─── La acción de cada tarjeta ───────────────────────────────────────────────

export type WalletCardAction = {
  /** `count` contar · `arrived` «ya me entró» · `pay_card` pagar el resumen. */
  kind: 'count' | 'arrived' | 'pay_card'
  label: string
  /** La hoja que abre, con `caja` puesta. */
  sheet: 'ajustar' | 'mover'
  /** El nombre entero, para lectores: «Contar Mercado Pago». */
  ariaLabel: string
  /** El único botón relleno de la pantalla. */
  filled: boolean
}

export type WalletCardView = {
  id: string
  name: string
  kind: TreasuryKind
  /** «Efectivo», «Billetera · alias hub.bar». */
  detail: string
  /** El color por tipo de caja, el del Resumen. `null`: neutro. */
  tone: TreasuryTone | null
  /** `/…/cajas/{id}`. */
  href: string
  money: TreasuryMoney
  /** Billeteras: lo vendido con QR y transferencia que todavía no entró. */
  pendingCents: number
  /** `null` en una caja desactivada: ya no se cuenta. */
  status: CountStatus | null
  footer: string
  /** `null`: sin botón (quien solo lee, o una caja desactivada). */
  action: WalletCardAction | null
  /** Desactivada con saldo: va gris y no suma. */
  muted: boolean
}

export type WalletSlot = {
  id: string
  name: string
  kind: TreasuryKind
  detail: string
  tone: TreasuryTone | null
}

export type WalletMathRow = { key: string; label: string; value: string; op: '+' | '−' }

export type WalletView =
  | {
      /** No hay ninguna caja cargada. */
      kind: 'no_treasuries'
      title: string
      sentence: string
      action: { href: string; label: string } | null
    }
  | {
      /** El bar recién arrancado: faltan los saldos iniciales y nada se movió. Ningún «$ 0». */
      kind: 'opening_pending'
      title: string
      sentence: string
      action: { href: string; label: string } | null
      /** Las cajas, como casilleros que esperan su monto. */
      slots: WalletSlot[]
      /** La primera caja de efectivo y la primera billetera, para explicar qué entra sola. */
      cashName: string | null
      walletName: string | null
      addHref: string
    }
  | {
      kind: 'normal'
      /** «Plata disponible hoy» o, en descubierto, «Hoy estás en descubierto por». */
      label: string
      /** En positivo: el descubierto lo dice la etiqueta. */
      cents: number
      sentence: string
      /** El estado del conteo de todas, en una píldora. */
      countPill: { tone: 'ok' | 'warn' | 'muted'; text: string }
      /** Cajas, bancos y billeteras activas, en el orden de Ajustes. */
      cards: WalletCardView[]
      /** Tarjetas de la empresa: van aparte (son deuda). */
      companyCards: WalletCardView[]
      /** Desactivadas que todavía tienen saldo. */
      inactive: WalletCardView[]
      /** «¿Cómo se calcula?»: un renglón por caja que suma. */
      math: WalletMathRow[]
      /** Ya hay movimientos pero falta decir con cuánto arrancó. */
      openingMissing: { since: string | null; href: string } | null
      /** Hay algo que no es efectivo: se pueden cargar gastos del banco. */
      hasNonCash: boolean
      hasWallet: boolean
      hasBank: boolean
      /** El día del último movimiento de cualquier caja (`null` si ninguna se movió). */
      lastMovementDate: string | null
    }

type Options = { today: string; canWrite?: boolean; base?: string }

function asSummary(row: TreasuryBalanceRow): SummaryTreasury {
  return {
    id: row.treasuryId,
    name: row.name,
    kind: row.kind,
    accountCode: row.accountCode,
    balanceCents: row.balanceCents,
    pendingWalletCents: row.pendingWalletCents,
    lastCheckedOn: row.lastCheckedOn,
    lastMovementDate: row.lastMovementDate,
  }
}

/** Los mismos totales que arma `acc_report_summary`, con las cajas activas. */
export function walletTotals(rows: readonly TreasuryBalanceRow[]): {
  availableCents: number
  pendingWalletCents: number
  cardDebtCents: number
} {
  const active = rows.filter((r) => r.active)
  return {
    availableCents: active
      .filter((r) => r.kind !== 'credit_card')
      .reduce((sum, r) => sum + r.balanceCents, 0),
    pendingWalletCents: active.reduce((sum, r) => sum + r.pendingWalletCents, 0),
    cardDebtCents: active
      .filter((r) => r.kind === 'credit_card')
      .reduce((sum, r) => sum + Math.max(0, -r.balanceCents), 0),
  }
}

/** El estado del héroe con los saldos de Cajas: el mismo cálculo que el Resumen. */
export function walletHero(
  rows: readonly TreasuryBalanceRow[],
  settings: Pick<AccountingSettings, 'openingStatus'> | null,
  opts: { canWrite?: boolean; base?: string } = {},
): HeroState {
  const active = rows.filter((r) => r.active).map(asSummary)
  return heroState({ treasuries: active, ...walletTotals(rows) }, settings, opts)
}

/** El color de cada caja activa (por tipo), con la MISMA lista que usa el Resumen. */
export function walletTones(
  rows: readonly Pick<TreasuryBalanceRow, 'treasuryId' | 'kind' | 'active'>[],
): Record<string, TreasuryTone | null> {
  return treasuryTones(
    rows.filter((r) => r.active).map((r) => ({ id: r.treasuryId, kind: r.kind })),
  )
}

/**
 * La tarjeta de la empresa no entra en «sin contar esta semana» (el Resumen
 * tampoco la avisa): su estado se dice igual, pero nunca en ámbar.
 */
function quiet(status: CountStatus | null): CountStatus | null {
  if (status === null || !status.due) return status
  return { ...status, tone: 'muted', due: false }
}

/**
 * El estado del conteo de UNA caja como se muestra en su tarjeta y en su ficha:
 * `null` si está desactivada (ya no se cuenta) y sin ámbar en la tarjeta de la
 * empresa.
 */
export function treasuryCountStatus(
  treasury: {
    kind: TreasuryKind
    active: boolean
    lastCheckedOn: string | null
    hasMovements: boolean
  },
  opts: { today: string; since: string | null },
): CountStatus | null {
  if (!treasury.active) return null
  const status = countStatus({
    lastCheckedOn: treasury.lastCheckedOn,
    today: opts.today,
    hasMovements: treasury.hasMovements,
    since: opts.since,
  })
  return treasury.kind === 'credit_card' ? quiet(status) : status
}

function countPill(cards: readonly WalletCardView[]): {
  tone: 'ok' | 'warn' | 'muted'
  text: string
} {
  const due = cards.filter((c) => c.status?.due).length
  if (due > 0) return { tone: 'warn', text: `${due} sin contar esta semana` }
  const counted = cards.filter((c) => c.status?.tone === 'ok').length
  if (counted === 0) return { tone: 'muted', text: 'Todavía no contaste ninguna' }
  if (counted === cards.length) return { tone: 'ok', text: 'Todas contadas esta semana' }
  return { tone: 'muted', text: `${counted} de ${cards.length} contadas esta semana` }
}

export function walletView(
  rows: readonly TreasuryBalanceRow[],
  settings: Pick<AccountingSettings, 'openingStatus' | 'booksStartDate'> | null,
  opts: Options,
): WalletView {
  const canWrite = opts.canWrite ?? true
  const base = opts.base ?? ''
  const hero = walletHero(rows, settings, { canWrite, base })
  const active = rows.filter((r) => r.active)
  const tones = walletTones(rows)
  const action = (state: Extract<HeroState, { kind: 'unknown' }>) =>
    state.action?.kind === 'href' ? { href: state.action.href, label: state.action.label } : null

  if (hero.kind === 'unknown') {
    if (hero.reason === 'no_treasuries') {
      return {
        kind: 'no_treasuries',
        title: hero.title,
        sentence: hero.sentence,
        action: action(hero),
      }
    }
    return {
      kind: 'opening_pending',
      title: hero.title,
      sentence: hero.sentence,
      action: action(hero),
      slots: active.map((r) => ({
        id: r.treasuryId,
        name: r.name,
        kind: r.kind,
        detail: treasuryDetail(r),
        tone: tones[r.treasuryId] ?? null,
      })),
      cashName: active.find((r) => r.kind === 'cash')?.name ?? null,
      walletName: active.find((r) => r.kind === 'wallet')?.name ?? null,
      addHref: `${base}/ajustes?tab=cajas`,
    }
  }

  const since = settings?.booksStartDate ?? null
  const card = (row: TreasuryBalanceRow): WalletCardView => {
    const isCard = row.kind === 'credit_card'
    const status = treasuryCountStatus(
      {
        kind: row.kind,
        active: row.active,
        lastCheckedOn: row.lastCheckedOn,
        hasMovements: row.lastMovementDate !== null,
      },
      { today: opts.today, since },
    )
    const pendingCents = row.kind === 'wallet' ? Math.max(0, row.pendingWalletCents) : 0
    let cardAction: WalletCardAction | null = null
    if (canWrite && row.active) {
      if (isCard && row.balanceCents < 0) {
        cardAction = {
          kind: 'pay_card',
          label: 'Pagar el resumen',
          sheet: 'mover',
          ariaLabel: `Pagar el resumen de ${row.name}`,
          filled: false,
        }
      } else if (pendingCents > 0) {
        cardAction = {
          kind: 'arrived',
          label: 'Ya me entró',
          sheet: 'ajustar',
          ariaLabel: `Ya me entró lo de ${row.name}`,
          filled: false,
        }
      } else {
        cardAction = {
          kind: 'count',
          label: 'Contar',
          sheet: 'ajustar',
          ariaLabel: `Contar ${row.name}`,
          filled: false,
        }
      }
    }
    return {
      id: row.treasuryId,
      name: row.name,
      kind: row.kind,
      detail: treasuryDetail(row),
      tone: row.active ? (tones[row.treasuryId] ?? null) : null,
      href: `${base}/cajas/${row.treasuryId}`,
      money: treasuryMoney(row.kind, row.balanceCents),
      pendingCents,
      status,
      footer: row.active
        ? lastMovementText(row.lastMovementDate, opts.today)
        : 'Desactivada · no suma a lo disponible',
      action: cardAction,
      muted: !row.active,
    }
  }

  const cards = active.filter((r) => r.kind !== 'credit_card').map(card)
  const companyCards = active.filter((r) => r.kind === 'credit_card').map(card)
  const inactive = rows.filter((r) => !r.active).map(card)

  // Un solo botón relleno: el de la primera caja (en orden) a la que le toca algo.
  const first = cards.find((c) => c.action !== null && (c.pendingCents > 0 || c.status?.due))
  if (first?.action) first.action = { ...first.action, filled: true }

  const moved = active
    .map((r) => r.lastMovementDate)
    .filter((d): d is string => d !== null)
    .sort()

  return {
    kind: 'normal',
    // Un descubierto se dice con palabras, nunca con un menos.
    label: hero.overdrawn ? 'Hoy estás en descubierto por' : 'Plata disponible hoy',
    cents: Math.abs(hero.cents),
    sentence: hero.sentence,
    countPill: countPill(cards),
    cards,
    companyCards,
    inactive,
    math: cards.map((c) => {
      const row = active.find((r) => r.treasuryId === c.id)
      const cents = row?.balanceCents ?? 0
      return {
        key: c.id,
        label: cents < 0 ? `${c.name} (descubierto)` : c.name,
        value: formatCentsShort(Math.abs(cents)),
        op: cents < 0 ? '−' : '+',
      }
    }),
    openingMissing:
      settings?.openingStatus === 'pending'
        ? { since: validDay(settings.booksStartDate), href: `${base}/configurar` }
        : null,
    hasNonCash: active.some((r) => r.kind !== 'cash'),
    hasWallet: active.some((r) => r.kind === 'wallet'),
    hasBank: active.some((r) => r.kind === 'bank'),
    lastMovementDate: moved.at(-1) ?? null,
  }
}

// ─── La ficha de una caja («la tarjeta abierta») ─────────────────────────────

/** Qué mueve a cada tipo de caja: sola (lo que se carga en otro lado) y a mano. */
export const TREASURY_MOVES: Readonly<Record<TreasuryKind, string>> = {
  cash: 'Sube sola con el cierre del día y baja con cada gasto o pago que hagas con esta caja.',
  wallet:
    'Lo que cobrás con QR o transferencia queda en camino y entra acá cuando lo confirmás con «Ya me entró» o subiendo el reporte.',
  bank: 'Sube cuando depositás o te entran las tarjetas y las apps; baja con los pagos y con lo que cobra el banco.',
  credit_card: 'Sube con cada compra que pagás con la tarjeta y baja cuando pagás el resumen.',
  other: 'Sube y baja con lo que cargues en esta cuenta.',
}

/** El período de la ficha, como lo resuelve `resolveRange`. */
export type CajaPeriod = {
  kind: 'month' | 'range'
  /** `yyyy-MM`, con `kind: 'month'`. */
  month: string | null
  from: string
  to: string
}

function monthWordOf(period: CajaPeriod): string | null {
  if (period.kind !== 'month' || !period.month) return null
  return monthName(Number(period.month.slice(5, 7))) || null
}

/** «En octubre» · «Del 01/08 al 13/10». */
export function periodLead(period: CajaPeriod): string {
  const month = monthWordOf(period)
  if (month) return `En ${month}`
  if (period.from === period.to) return `El ${formatDayMonth(period.from)}`
  return `Del ${formatDayMonth(period.from)} al ${formatDayMonth(period.to)}`
}

/** «octubre» · «el período»: para «Movimientos de octubre» y «al empezar octubre». */
export function periodName(period: CajaPeriod): string {
  return monthWordOf(period) ?? 'el período'
}

export type CajaHeroView = {
  /** «Hay hoy» · «Había al 30/09» · «Descubierto hoy» · «Debés hoy». */
  label: string
  /** En positivo: el sentido lo dice la etiqueta. */
  cents: number
  /** «En octubre entraron $ X y salieron $ Y.» */
  sentence: string
  /** La cuenta de «¿Cómo se calcula?»: lo que había, lo que entró, lo que salió. */
  math: Array<{ key: string; label: string; value: string; op?: '+' | '−' | '=' }>
  note: string
}

/**
 * El número de la ficha de una caja y su cuenta. Los importes llegan como en
 * los reportes (Debe − Haber): en la tarjeta de la empresa el saldo es una
 * deuda en negativo, lo que entra son pagos y lo que sale, consumos.
 * `closingDay` es el día al que corresponde el saldo de cierre (hoy, si el
 * período todavía no terminó).
 */
export function cajaHero(input: {
  kind: TreasuryKind
  period: CajaPeriod
  openingCents: number
  inCents: number
  outCents: number
  closingCents: number
  closingDay: string
  today: string
}): CajaHeroView {
  const { kind, period } = input
  const card = kind === 'credit_card'
  const isToday = input.closingDay === input.today
  const when = isToday ? 'hoy' : `al ${formatDayMonth(input.closingDay)}`
  const lead = periodLead(period)
  const name = periodName(period)
  const money = (cents: number) => formatCentsShort(Math.abs(cents))
  const moved = input.inCents > 0 || input.outCents > 0
  const note = 'Acá sí cuenta lo que pasaste desde otra caja o hacia otra caja.'

  if (card) {
    // La deuda, en positivo.
    const debt = -input.closingCents
    const openingDebt = -input.openingCents
    const label = debt < 0 ? `A favor ${when}` : isToday ? 'Debés hoy' : `Debías ${when}`
    return {
      label,
      cents: Math.abs(debt),
      sentence: moved
        ? `${lead} hubo consumos por ${money(input.outCents)} y pagos por ${money(input.inCents)}.`
        : `${lead} no hubo consumos ni pagos.`,
      math: [
        {
          key: 'antes',
          label:
            openingDebt < 0 ? `Tenías a favor al empezar ${name}` : `Debías al empezar ${name}`,
          value: money(openingDebt),
        },
        { key: 'consumos', label: 'Consumos', value: money(input.outCents), op: '+' },
        { key: 'pagos', label: 'Pagos', value: money(input.inCents), op: '−' },
        { key: 'total', label, value: money(debt), op: '=' },
      ],
      note,
    }
  }

  const overdrawn = input.closingCents < 0
  const label = overdrawn ? `Descubierto ${when}` : isToday ? 'Hay hoy' : `Había ${when}`
  return {
    label,
    cents: Math.abs(input.closingCents),
    sentence: moved
      ? `${lead} entraron ${money(input.inCents)} y salieron ${money(input.outCents)}.`
      : `${lead} no hubo movimientos.`,
    math: [
      {
        key: 'antes',
        label:
          input.openingCents < 0 ? `Descubierto al empezar ${name}` : `Había al empezar ${name}`,
        value: money(input.openingCents),
      },
      { key: 'entro', label: 'Entró', value: money(input.inCents), op: '+' },
      { key: 'salio', label: 'Salió', value: money(input.outCents), op: '−' },
      { key: 'total', label, value: money(input.closingCents), op: '=' },
    ],
    note,
  }
}

export type CajaEmpty = {
  title: string
  text: string
  /** `close` cargar el cierre · `move` mover plata · `opening` cargar lo que hay · `null` sin acción. */
  action: 'close' | 'move' | 'opening' | null
}

/**
 * La ficha de una caja que nunca tuvo movimientos: qué la mueve sola y el paso
 * que sigue. `methods` son los medios de cobro que entran a esta caja («lo
 * cobrado con: Efectivo»); si ninguno apunta acá, esa aclaración no va. Con los
 * saldos iniciales pendientes, el paso de todas es cargar lo que hay.
 */
export function cajaEmpty(input: {
  kind: TreasuryKind
  name: string
  methods: readonly string[]
  openingPending: boolean
}): CajaEmpty {
  const title = `Todavía no pasó nada por ${input.name}`
  const with_ = input.methods.length > 0 ? ` (lo cobrado con: ${input.methods.join(', ')})` : ''
  const text =
    input.kind === 'cash'
      ? `Sube sola con el cierre del día${with_} y baja con cada gasto o pago que hagas con esta caja.`
      : TREASURY_MOVES[input.kind]
  const own: CajaEmpty['action'] =
    input.kind === 'cash' || input.kind === 'wallet'
      ? 'close'
      : input.kind === 'bank'
        ? 'move'
        : null
  return { title, text, action: input.openingPending ? 'opening' : own }
}
