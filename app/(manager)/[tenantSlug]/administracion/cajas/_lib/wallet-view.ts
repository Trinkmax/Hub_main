/**
 * Lo que muestra Caja, puro (sin React ni base): la tabla «cuánto hay en cada
 * cuenta» y la ficha de una caja. Lo prueba `tests/lib/administracion-cajas-vista.test.ts`.
 *
 * Tiene que decir LO MISMO que el Resumen, que es la otra pantalla donde se ve
 * cuánta plata hay. Por eso:
 * - el estado («todavía no sé cuánta plata hay», el total) sale de `heroState()`
 *   de `lib/accounting/home.ts`, con las cajas ACTIVAS;
 * - el total suma las activas que no son tarjeta de la empresa (una caja
 *   desactivada que todavía tiene plata se muestra aparte y no suma);
 * - el color de cada caja sale de su tipo (`treasuryTones`), calculado sobre
 *   esas mismas cajas activas, en el orden de Ajustes.
 */

import { type HeroState, heroState, type TreasuryTone, treasuryTones } from '@/lib/accounting/home'
import { TREASURY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type { SummaryTreasury } from '@/lib/accounting/queries/summary'
import type { TreasuryBalanceRow } from '@/lib/accounting/queries/treasury'
import { chargesBankTax } from '@/lib/accounting/taxes'
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

// ─── Los totales, igual que el Resumen ───────────────────────────────────────

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
 * El estado del conteo de UNA caja como se muestra en su fila y en su ficha:
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

// ─── La acción de cada fila ──────────────────────────────────────────────────

export type CajaRowAction = {
  /** `count` contar · `arrived` «ya me entró» · `pay_card` pagar el resumen. */
  kind: 'count' | 'arrived' | 'pay_card'
  label: string
  /** La hoja que abre, con `caja` puesta. */
  sheet: 'ajustar' | 'mover'
  /** El nombre entero, para lectores: «Contar Mercado Pago». */
  ariaLabel: string
  /** Le toca (hace más de una semana que no se cuenta, o tiene plata en camino): queda a la vista. */
  due: boolean
}

export type CajaAccountRow = {
  id: string
  name: string
  kind: TreasuryKind
  /** «Efectivo», «Banco», «Billetera». */
  kindLabel: string
  active: boolean
  /** «hoy» · «ayer» · «hace 3 días» · «07/10» · «Sin movimientos». */
  lastMovement: string
  lastMovementDate: string | null
  money: TreasuryMoney
  /** Faltan los saldos iniciales y esta cuenta nunca se movió: su cero no es un dato. */
  unknown: boolean
  /** Billeteras: lo vendido con QR y transferencia que todavía no entró. */
  pendingCents: number
  /** Cómo viene el conteo, en palabras (`null`: ya no se cuenta). */
  countText: string | null
  /** `null`: sin botón (quien solo lee, una cuenta desactivada, o falta decir cuánto hay). */
  action: CajaRowAction | null
  /** Para guardar cambios (`expectedUpdatedAt`). `null`: esta lectura no lo trajo. */
  updatedAt: string | null
  /** ¿Cobra el impuesto al cheque? `null`: no corresponde preguntarlo (efectivo y tarjeta). */
  bankTax: boolean | null
}

/** Lo de cada cuenta que no trae el reporte de saldos: sale del catálogo. */
export type CajaAccountMeta = {
  updatedAt: string | null
  chargesBankTax: boolean | null
}

export type CajaView = {
  /** `no_treasuries`: ninguna cuenta. `opening_pending`: hay cuentas, y ningún saldo es un dato. */
  status: 'normal' | 'opening_pending' | 'no_treasuries'
  /** Efectivo, bancos y billeteras en uso, en el orden de Ajustes: las que suman. */
  accounts: CajaAccountRow[]
  /** Lo que no suma: las tarjetas de la empresa (deuda) y las desactivadas que tienen saldo. */
  apart: CajaAccountRow[]
  /** La suma, con la doble raya, en positivo. `null`: todavía no se sabe. */
  total: { cents: number; overdrawn: boolean } | null
  /** Lo que hay que decir antes de la tabla, con su paso. `null`: nada. */
  notice: { title: string; sentence: string; action: { href: string; label: string } | null } | null
  /** Faltan los saldos iniciales: al crear una cuenta se avisa que lo que tiene se carga ahí. */
  openingPending: boolean
}

/** El último movimiento, para su columna: «hoy», «ayer», «hace 3 días», «07/10». */
export function lastMovementShort(date: string | null, today: string): string {
  const day = validDay(date)
  if (day === null) return 'Sin movimientos'
  const days = daysBetween(day, today)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return days <= CHECK_STALE_DAYS ? `hace ${days} días` : formatDayMonth(day)
}

/** Los tipos a los que tiene sentido preguntarles: el efectivo no pasa por un banco ni la tarjeta. */
const BANK_TAX_KINDS: ReadonlySet<TreasuryKind> = new Set(['bank', 'wallet', 'other'])

/**
 * La tabla de Caja: una fila por cuenta y el total. El total y el estado («todavía no sé cuánta
 * plata hay») salen de `heroState`, igual que en el Resumen: las dos pantallas dicen lo mismo.
 *
 * Cada fila ofrece una acción (contar, «ya me entró» o pagar el resumen); mientras falta decir con
 * cuánto se arrancó no ofrece ninguna: contar antes anotaría toda la plata como sobrante.
 */
export function cajaView(
  rows: readonly TreasuryBalanceRow[],
  meta: ReadonlyMap<string, CajaAccountMeta>,
  settings: Pick<AccountingSettings, 'openingStatus' | 'booksStartDate'> | null,
  opts: { today: string; canWrite?: boolean; base?: string },
): CajaView {
  const canWrite = opts.canWrite ?? true
  const base = opts.base ?? ''
  const hero = walletHero(rows, settings, { canWrite, base })
  const unknown = hero.kind === 'unknown'
  const since = settings?.booksStartDate ?? null

  const toRow = (row: TreasuryBalanceRow): CajaAccountRow => {
    const isCard = row.kind === 'credit_card'
    const pendingCents = row.kind === 'wallet' ? Math.max(0, row.pendingWalletCents) : 0
    const status = treasuryCountStatus(
      {
        kind: row.kind,
        active: row.active,
        lastCheckedOn: row.lastCheckedOn,
        hasMovements: row.lastMovementDate !== null,
      },
      { today: opts.today, since },
    )
    let action: CajaRowAction | null = null
    if (canWrite && row.active && !unknown) {
      if (isCard && row.balanceCents < 0) {
        action = {
          kind: 'pay_card',
          label: 'Pagar el resumen',
          sheet: 'mover',
          ariaLabel: `Pagar el resumen de ${row.name}`,
          due: false,
        }
      } else if (pendingCents > 0) {
        action = {
          kind: 'arrived',
          label: 'Ya me entró',
          sheet: 'ajustar',
          ariaLabel: `Ya me entró lo de ${row.name}`,
          due: true,
        }
      } else {
        action = {
          kind: 'count',
          label: 'Contar',
          sheet: 'ajustar',
          ariaLabel: `Contar ${row.name}`,
          due: status?.due === true,
        }
      }
    }
    const info = meta.get(row.treasuryId)
    return {
      id: row.treasuryId,
      name: row.name,
      kind: row.kind,
      kindLabel: TREASURY_KIND_LABELS[row.kind] ?? 'Cuenta',
      active: row.active,
      lastMovement: lastMovementShort(row.lastMovementDate, opts.today),
      lastMovementDate: row.lastMovementDate,
      money: treasuryMoney(row.kind, row.balanceCents),
      unknown: unknown && !isCard && row.active,
      pendingCents,
      countText: status?.text ?? null,
      action,
      updatedAt: info?.updatedAt ?? null,
      bankTax:
        info && BANK_TAX_KINDS.has(row.kind)
          ? chargesBankTax({ kind: row.kind, chargesBankTax: info.chargesBankTax })
          : null,
    }
  }

  const accounts = rows.filter((r) => r.active && r.kind !== 'credit_card').map(toRow)
  const apart = rows.filter((r) => !r.active || r.kind === 'credit_card').map(toRow)
  const openingPending = settings?.openingStatus === 'pending'

  if (hero.kind === 'unknown') {
    return {
      status: hero.reason,
      accounts,
      apart,
      total: null,
      notice: {
        title: hero.title,
        sentence: hero.sentence,
        // Sin cuentas no hay a dónde ir: se agrega la primera ahí mismo, en la tabla.
        action:
          hero.reason === 'opening_pending' && hero.action?.kind === 'href'
            ? { href: hero.action.href, label: hero.action.label }
            : null,
      },
      openingPending,
    }
  }

  const start = validDay(since)
  return {
    status: 'normal',
    accounts,
    apart,
    total: { cents: Math.abs(hero.cents), overdrawn: hero.overdrawn },
    notice: openingPending
      ? {
          title: 'Falta decir con cuánto arrancaste',
          sentence: start
            ? `Los números cuentan solo lo cargado desde el ${formatDayMonth(start)}.`
            : 'Los números cuentan solo lo que cargaste hasta ahora.',
          action: canWrite ? { href: `${base}/configurar`, label: 'Cargar lo que había' } : null,
        }
      : null,
    openingPending,
  }
}

// ─── Los movimientos del panel lateral ───────────────────────────────────────

/** Cuántos días mira el panel lateral de una cuenta (con hoy). Lo demás está en su ficha. */
export const ACCOUNT_SHEET_DAYS = 30

/** Cuántos renglones muestra, como mucho: es un vistazo, no un libro. */
export const ACCOUNT_SHEET_ROWS = 40

/** Una fila del panel lateral de una cuenta: Fecha · Concepto · Entró · Salió. */
export type AccountMovement = {
  key: string
  date: string
  title: string
  sub: string
  inCents: number
  outCents: number
  /** `/comprobantes/{id}`, después de `/<bar>/administracion`. */
  path: string | null
}

/** Lo que se lee para el panel lateral: lo más nuevo primero. */
export type AccountMovements = {
  movements: AccountMovement[]
  /** Hubo más de los que entran en una lectura: no se muestra una lista que no es la más nueva. */
  tooMany: boolean
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
 * Lo que había al arrancar, cuando cae adentro de un período: la suma de los
 * renglones de «Saldos iniciales» (los movimientos con `documentKind`
 * `opening`), como llegan de la base (Debe / Haber). `null` si en lo leído no
 * hay ninguno.
 */
export type OpeningMoves = { inCents: number; outCents: number }

export function openingMoves(
  lines: ReadonlyArray<{ documentKind: string | null; inCents: number; outCents: number }>,
): OpeningMoves | null {
  let inCents = 0
  let outCents = 0
  for (const line of lines) {
    if (line.documentKind !== 'opening') continue
    inCents += Math.max(0, line.inCents)
    outCents += Math.max(0, line.outCents)
  }
  return inCents > 0 || outCents > 0 ? { inCents, outCents } : null
}

/**
 * El número de la ficha de una caja y su cuenta. Los importes llegan como en
 * los reportes (Debe − Haber): en la tarjeta de la empresa el saldo es una
 * deuda en negativo, lo que entra son pagos y lo que sale, consumos.
 * `closingDay` es el día al que corresponde el saldo de cierre (hoy, si el
 * período todavía no terminó).
 *
 * `opening` es lo que había al arrancar, si cae adentro del período (el mes en
 * que arrancan los libros). NO es plata que entró: se dice aparte («Arrancó con
 * $ 3.000.000. En septiembre entraron…») y se descuenta de lo que entró, con
 * el mismo criterio que el dibujo de «Lo que entró y lo que salió» y que el
 * título de cada día. Sin eso, la tarjeta decía «entraron $ 33,8 M» arriba de
 * un dibujo que decía «Entró $ 30,8 M».
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
  opening?: OpeningMoves | null
}): CajaHeroView {
  const { kind, period } = input
  const card = kind === 'credit_card'
  const isToday = input.closingDay === input.today
  const when = isToday ? 'hoy' : `al ${formatDayMonth(input.closingDay)}`
  const lead = periodLead(period)
  const name = periodName(period)
  const money = (cents: number) => formatCentsShort(Math.abs(cents))
  const started = input.opening ?? null
  const inCents = Math.max(0, input.inCents - (started?.inCents ?? 0))
  const outCents = Math.max(0, input.outCents - (started?.outCents ?? 0))
  // Con lo que arrancó: lo de antes del período (casi siempre cero) más los saldos iniciales.
  const startCents = input.openingCents + (started ? started.inCents - started.outCents : 0)
  const moved = inCents > 0 || outCents > 0
  const note = 'Acá sí cuenta lo que pasaste desde otra caja o hacia otra caja.'

  if (card) {
    // La deuda, en positivo.
    const debt = -input.closingCents
    const startDebt = -startCents
    const label = debt < 0 ? `A favor ${when}` : isToday ? 'Debés hoy' : `Debías ${when}`
    const startLabel = startDebt < 0 ? 'Arrancó con plata a favor' : 'Arrancó debiendo'
    const startSentence =
      startDebt < 0
        ? `Arrancó con ${money(startDebt)} a favor.`
        : `Arrancó debiendo ${money(startDebt)}.`
    const flows = moved
      ? `${lead} hubo consumos por ${money(outCents)} y pagos por ${money(inCents)}.`
      : started
        ? `${lead} no hubo otros consumos ni pagos.`
        : `${lead} no hubo consumos ni pagos.`
    return {
      label,
      cents: Math.abs(debt),
      sentence: started ? `${startSentence} ${flows}` : flows,
      math: [
        started
          ? { key: 'antes', label: startLabel, value: money(startDebt) }
          : {
              key: 'antes',
              label:
                startDebt < 0 ? `Tenías a favor al empezar ${name}` : `Debías al empezar ${name}`,
              value: money(startDebt),
            },
        { key: 'consumos', label: 'Consumos', value: money(outCents), op: '+' },
        { key: 'pagos', label: 'Pagos', value: money(inCents), op: '−' },
        { key: 'total', label, value: money(debt), op: '=' },
      ],
      note,
    }
  }

  const overdrawn = input.closingCents < 0
  const label = overdrawn ? `Descubierto ${when}` : isToday ? 'Hay hoy' : `Había ${when}`
  const startLabel = startCents < 0 ? 'Arrancó con un descubierto de' : 'Arrancó con'
  const flows = moved
    ? `${lead} entraron ${money(inCents)} y salieron ${money(outCents)}.`
    : started
      ? `${lead} no hubo otros movimientos.`
      : `${lead} no hubo movimientos.`
  return {
    label,
    cents: Math.abs(input.closingCents),
    sentence: started ? `${startLabel} ${money(startCents)}. ${flows}` : flows,
    math: [
      started
        ? { key: 'antes', label: startLabel, value: money(startCents) }
        : {
            key: 'antes',
            label: startCents < 0 ? `Descubierto al empezar ${name}` : `Había al empezar ${name}`,
            value: money(startCents),
          },
      { key: 'entro', label: 'Entró', value: money(inCents), op: '+' },
      { key: 'salio', label: 'Salió', value: money(outCents), op: '−' },
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
