/**
 * «Plata por cobrar»: lo que te deben las tarjetas, las apps y los clientes,
 * dicho como el seguimiento de un envío (ya tendría que haber llegado · llega
 * esta semana · más adelante). Puro: lo prueba
 * `administracion-ventas-cobrar.test.ts`.
 *
 * Mercado Pago no está «atrasado»: lo cobrado con QR o transferencia queda
 * como plata por cobrar a la billetera con fecha del mismo día, pero esa plata
 * ya está en la app; lo que falta es contarla. Por eso los pagadores que son
 * una billetera con su caja van en un tramo aparte, que nunca es rojo.
 *
 * Los cortes son los de `lib/accounting/aging.ts`: lo que vence hoy todavía no
 * está atrasado, y «esta semana» son los próximos `due_soon_days` (7).
 */

import type { LedgerTone } from '@/components/administracion/kit'
import { DEFAULT_SOON_DAYS } from '@/lib/accounting/aging'
import type { OpenItemRow, PartyListRow } from '@/lib/accounting/queries/parties'
import {
  addDays,
  daysBetween,
  formatDayLabel,
  formatDayMonth,
  formatWeekdayDayMonth,
  isRealIsoDay,
  WEEKDAY_NAMES_SHORT,
  weekdayName,
  weekdayOf,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/** Los tramos, con una sola redacción en toda la sección (espejo de los de Compras). */
export const TRANCHE_LABELS = {
  late: 'Ya tendría que haber llegado',
  week: 'Llega esta semana',
  later: 'Más adelante',
  wallet: 'En Mercado Pago, falta contarla',
} as const
export type TrancheKey = keyof typeof TRANCHE_LABELS

export type ReceivableTranches = {
  /** Σ de lo que te deben (los cuatro tramos). */
  totalCents: number
  lateCents: number
  weekCents: number
  laterCents: number
  /** Lo que ya está en una billetera y falta contar. */
  walletCents: number
  /** Cuántos pagadores tienen algo atrasado (sin contar billeteras). */
  lateParties: number
}

type TrancheRow = Pick<PartyListRow, 'partyId' | 'debtCents' | 'overdueCents' | 'dueSoonCents'>

/**
 * Lo que te deben, partido por cuándo llega. `walletPartyIds` son los
 * pagadores que tienen su propia caja (Mercado Pago): todo lo suyo va al
 * tramo «falta contarla», esté o no vencido según la base.
 */
export function receivableTranches(
  rows: readonly TrancheRow[],
  walletPartyIds: ReadonlySet<string>,
): ReceivableTranches {
  const out: ReceivableTranches = {
    totalCents: 0,
    lateCents: 0,
    weekCents: 0,
    laterCents: 0,
    walletCents: 0,
    lateParties: 0,
  }
  for (const row of rows) {
    const debt = Math.max(0, row.debtCents)
    if (debt === 0) continue
    out.totalCents += debt
    if (walletPartyIds.has(row.partyId)) {
      out.walletCents += debt
      continue
    }
    const late = Math.min(debt, Math.max(0, row.overdueCents))
    const week = Math.min(debt - late, Math.max(0, row.dueSoonCents))
    out.lateCents += late
    out.weekCents += week
    out.laterCents += debt - late - week
    if (late > 0) out.lateParties += 1
  }
  return out
}

/** Quien tiene plata a favor (un cliente que pagó de más, una app a la que le debemos). */
export type Creditor = { name: string; cents: number; isCustomer: boolean }

/** Desde cuántos nombres «a favor de …» deja de nombrarlos uno por uno. */
const MAX_CREDITOR_NAMES = 3

/**
 * El cierre de la oración cuando alguien tiene plata a favor, dicho con su
 * nombre: «Además, a Mercado Pago le debemos $ 174.600.» Sin nombres (no se
 * pasaron), la cuenta igual: «Además hay $ X a favor de ellos.»
 */
function creditClause(cents: number, creditors: readonly Creditor[] | undefined): string {
  const amount = formatCentsShort(cents)
  const named = (creditors ?? []).filter((c) => c.cents > 0)
  if (named.length === 1) {
    const [only] = named
    if (only) {
      return only.isCustomer
        ? `Además, ${only.name} tiene ${amount} a favor.`
        : `Además, a ${only.name} le debemos ${amount}.`
    }
  }
  if (named.length > 1 && named.length <= MAX_CREDITOR_NAMES) {
    const names = named.map((c) => c.name)
    return `Además hay ${amount} a favor de ${names.slice(0, -1).join(', ')} y ${names.at(-1)}.`
  }
  if (named.length > MAX_CREDITOR_NAMES) {
    return `Además hay ${amount} a favor de ${named.length} de ellos (filtro «A favor»).`
  }
  return `Además hay ${amount} a favor de ellos.`
}

/** La oración del héroe de «Plata por cobrar». */
export function incomingSentence(
  tranches: ReceivableTranches,
  opts: { creditCents?: number; creditors?: readonly Creditor[] } = {},
): string {
  const parts: string[] = []
  if (tranches.lateCents > 0) {
    parts.push(`${formatCentsShort(tranches.lateCents)} ya tendrían que haber llegado.`)
  }
  if (tranches.weekCents > 0) {
    parts.push(`Esta semana llegan ${formatCentsShort(tranches.weekCents)}.`)
  }
  if (parts.length === 0 && tranches.laterCents > 0) {
    parts.push('Todavía no llegó la fecha de nada.')
  }
  if (tranches.walletCents > 0) {
    parts.push(
      `${formatCentsShort(tranches.walletCents)} ya están en Mercado Pago: falta contarla.`,
    )
  }
  if (parts.length === 0) parts.push('Todavía no llegó la fecha de nada.')
  if ((opts.creditCents ?? 0) > 0) {
    parts.push(creditClause(opts.creditCents ?? 0, opts.creditors))
  }
  return parts.join(' ')
}

export type IncomingStrip = { tone: 'late' | 'info' | 'muted'; word: string; sentence: string }

/** La franja «En camino» de «El mes»: una palabra y una oración. `null` si no te deben nada. */
export function incomingStrip(tranches: ReceivableTranches): IncomingStrip | null {
  if (tranches.lateCents > 0) {
    return {
      tone: 'late',
      word: 'Atrasado',
      sentence: `Hay ${formatCentsShort(tranches.lateCents)} que ya tendrían que haber llegado.`,
    }
  }
  if (tranches.weekCents > 0) {
    return {
      tone: 'info',
      word: 'Esta semana',
      sentence: `Esta semana te llegan ${formatCentsShort(tranches.weekCents)}.`,
    }
  }
  const dated = tranches.laterCents
  if (dated > 0) {
    return {
      tone: 'muted',
      word: 'En camino',
      sentence: `Tenés ${formatCentsShort(tranches.totalCents)} por cobrar: todavía no llegó la fecha.`,
    }
  }
  if (tranches.walletCents > 0) {
    return {
      tone: 'muted',
      word: 'Falta contar',
      sentence: `Hay ${formatCentsShort(tranches.walletCents)} en Mercado Pago que falta contar.`,
    }
  }
  return null
}

function arrivalWords(date: string, today: string): string {
  return date === today ? 'hoy' : `el ${formatWeekdayDayMonth(date)}`
}

type MetaRow = Pick<
  PartyListRow,
  'debtCents' | 'overdueCents' | 'nextDueDate' | 'creditCents' | 'active'
>

/**
 * El estado de un pagador en palabras, debajo de su nombre: «$ 1.479.954 ya
 * tendría que haber llegado», «Lo próximo llega el mar 13/10», «Ya está en tu
 * Mercado Pago: contala para anotarlo».
 */
export function receivableMeta(
  row: MetaRow,
  opts: { today: string; walletName?: string | null },
): string {
  const parts: string[] = []
  if (row.debtCents > 0) {
    if (opts.walletName) parts.push(`Ya está en tu ${opts.walletName}: contala para anotarlo`)
    else if (row.overdueCents > 0) {
      parts.push(`${formatCentsShort(row.overdueCents)} ya tendría que haber llegado`)
    } else if (row.nextDueDate) {
      parts.push(`Lo próximo llega ${arrivalWords(row.nextDueDate, opts.today)}`)
    } else parts.push('Sin fecha de llegada')
  } else if (row.creditCents > 0) parts.push('No te debe nada')
  if (!row.active) parts.push('desactivado')
  return parts.join(' · ')
}

export type ReceivableRail = {
  kind: 'late' | 'today' | 'date' | 'wallet' | 'none'
  label?: string
  value?: string
  unit?: string
  tone: LedgerTone
}

type RailRow = Pick<PartyListRow, 'debtCents' | 'overdueCents' | 'oldestDueDate' | 'nextDueDate'>

/**
 * El margen del renglón de un pagador: desde cuándo está atrasado o para
 * cuándo llega. Nunca un importe.
 */
export function receivableRail(
  row: RailRow,
  opts: { today: string; wallet?: boolean },
): ReceivableRail {
  if (row.debtCents <= 0) return { kind: 'none', value: '—', tone: 'muted' }
  if (opts.wallet) return { kind: 'wallet', unit: 'sin contar', tone: 'muted' }
  if (row.overdueCents > 0 && row.oldestDueDate && isRealIsoDay(row.oldestDueDate)) {
    const days = Math.max(1, daysBetween(row.oldestDueDate, opts.today))
    return {
      kind: 'late',
      value: String(days),
      unit: days === 1 ? 'día tarde' : 'días tarde',
      tone: 'late',
    }
  }
  const next = row.nextDueDate
  if (next && isRealIsoDay(next)) {
    if (next === opts.today) return { kind: 'today', label: 'llega', value: 'hoy', tone: 'ok' }
    return {
      kind: 'date',
      label: 'llega',
      value: next.slice(8, 10),
      unit: WEEKDAY_NAMES_SHORT[weekdayOf(next)] ?? '',
      tone: 'muted',
    }
  }
  return { kind: 'none', value: '—', tone: 'muted' }
}

// ─── Cuándo llega, día por día ───────────────────────────────────────────────

export type IncomingDay = { date: string; label: string; cents: number; count: number }

export type IncomingDays = {
  /** De hoy a +13 días, uno por día (los que no tienen nada van en cero). */
  days: IncomingDay[]
  totalCents: number
  /** El día que más entra; `null` si en la ventana no llega nada. */
  peak: IncomingDay | null
}

/** Las dos semanas que mira «Cuándo llega». */
export const INCOMING_WINDOW_DAYS = 14

/**
 * Lo que tiene que entrar cada día de las próximas dos semanas. Lo atrasado NO
 * entra (ya lo dice el héroe): la tira es lo que viene.
 */
export function incomingDays(
  items: readonly Pick<OpenItemRow, 'dueDate' | 'openCents'>[],
  today: string,
  windowDays: number = INCOMING_WINDOW_DAYS,
): IncomingDays {
  const days: IncomingDay[] = []
  const index = new Map<string, IncomingDay>()
  for (let i = 0; i < windowDays; i++) {
    const date = addDays(today, i)
    const day: IncomingDay = { date, label: formatDayLabel(date), cents: 0, count: 0 }
    days.push(day)
    index.set(date, day)
  }
  let totalCents = 0
  for (const item of items) {
    if (!item.dueDate || item.openCents <= 0) continue
    const day = index.get(item.dueDate)
    if (!day) continue
    day.cents += item.openCents
    day.count += 1
    totalCents += item.openCents
  }
  let peak: IncomingDay | null = null
  for (const day of days) {
    if (day.cents > 0 && (peak === null || day.cents > peak.cents)) peak = day
  }
  return { days, totalCents, peak }
}

/** El título de «Cuándo llega», que afirma. */
export function incomingTitle(incoming: Pick<IncomingDays, 'peak'>, today: string): string {
  const { peak } = incoming
  if (!peak) return 'En estas dos semanas no llega nada'
  const when =
    peak.date === today ? 'hoy' : `el ${weekdayName(peak.date)} ${formatDayMonth(peak.date)}`
  return `El día que más entra es ${when}: ${formatCentsShort(peak.cents)}`
}

// ─── La ficha de quien te debe ───────────────────────────────────────────────

export type OpenItemGroup<T> = {
  key: Exclude<TrancheKey, 'wallet'>
  title: string
  items: T[]
  totalCents: number
}

/**
 * Las partidas pendientes de un pagador, agrupadas por cuándo llegan. Devuelve
 * solo los grupos que tienen algo, en orden: atrasado, esta semana, más adelante.
 */
export function groupOpenItems<T extends Pick<OpenItemRow, 'dueDate' | 'openCents'>>(
  items: readonly T[],
  today: string,
  soonDays: number = DEFAULT_SOON_DAYS,
): OpenItemGroup<T>[] {
  const groups: Record<OpenItemGroup<T>['key'], T[]> = { late: [], week: [], later: [] }
  const limit = addDays(today, Math.max(0, soonDays))
  for (const item of items) {
    if (item.dueDate === null || item.dueDate > limit) groups.later.push(item)
    else if (item.dueDate < today) groups.late.push(item)
    else groups.week.push(item)
  }
  const byDue = (a: T, b: T) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
  return (['late', 'week', 'later'] as const)
    .map((key) => {
      const list = [...groups[key]].sort(byDue)
      return {
        key,
        title: TRANCHE_LABELS[key],
        items: list,
        totalCents: list.reduce((sum, item) => sum + item.openCents, 0),
      }
    })
    .filter((group) => group.items.length > 0)
}

type PositionFacts = {
  debtCents: number
  creditCents: number
  aging: { overdueCents: number; oldestDueDate: string | null; nextDueDate: string | null }
}

/** La oración del héroe de la ficha: qué está atrasado y cuándo llega lo próximo. */
export function partySentence(
  pos: PositionFacts,
  opts: { today: string; walletName?: string | null },
): string {
  if (pos.debtCents <= 0) return 'No te debe nada.'
  if (opts.walletName) {
    return `Esa plata ya está en tu ${opts.walletName}: contala para anotarla.`
  }
  const parts: string[] = []
  const { overdueCents, oldestDueDate, nextDueDate } = pos.aging
  if (overdueCents > 0) {
    const since = oldestDueDate ? ` (desde el ${formatDayMonth(oldestDueDate)})` : ''
    parts.push(`${formatCentsShort(overdueCents)} ya tendrían que haber llegado${since}.`)
  }
  if (nextDueDate) parts.push(`Lo próximo llega ${arrivalWords(nextDueDate, opts.today)}.`)
  if (parts.length === 0) parts.push('Todavía no tiene fecha de llegada.')
  return parts.join(' ')
}

/** Lo que tiene a favor, dicho según quién es: un cliente o una tarjeta o app. */
export function partyCreditSentence(
  pos: Pick<PositionFacts, 'creditCents'>,
  opts: { isCustomer: boolean },
): string | null {
  if (pos.creditCents <= 0) return null
  const amount = formatCentsShort(pos.creditCents)
  return opts.isCustomer
    ? `Tiene ${amount} a favor.`
    : `Le debemos ${amount}: se descuenta en la próxima liquidación.`
}

/** «tenía que llegar el 07/10» / «llega el mié 14/10» / «llega hoy», para una partida. */
export function itemArrival(dueDate: string | null, today: string): string {
  if (!dueDate) return 'sin fecha de llegada'
  if (dueDate < today) return `tenía que llegar el ${formatDayMonth(dueDate)}`
  return `llega ${arrivalWords(dueDate, today)}`
}

// ─── Las billeteras con su caja ──────────────────────────────────────────────

export type WalletBox = { treasuryId: string; name: string }

/**
 * Los pagadores que son una billetera con su propia caja (Mercado Pago): lo que
 * «te deben» ya está en la app y se anota contando esa caja. La clave es el id
 * del pagador.
 */
export function walletBoxes(
  rows: readonly Pick<PartyListRow, 'partyId' | 'partyKind'>[],
  treasuries: readonly { id: string; name: string; bankPartyId: string | null; active: boolean }[],
): Map<string, WalletBox> {
  const out = new Map<string, WalletBox>()
  for (const row of rows) {
    if (row.partyKind !== 'payment_wallet') continue
    const box = treasuries.find((t) => t.active && t.bankPartyId === row.partyId)
    if (box) out.set(row.partyId, { treasuryId: box.id, name: box.name })
  }
  return out
}

// ─── ¿Cuándo te paga cada medio? ─────────────────────────────────────────────

export type ArrivalStop = {
  key: string
  /** «En el momento», «Queda en Mercado Pago», «Al otro día», «A los 10 días». */
  label: string
  /** `true`: esa plata ya la tenés (entra a una caja o queda en la billetera). */
  inHand: boolean
  /** Los medios que paran ahí, en el orden del cierre del día. */
  methods: string[]
}

type StopMethod = {
  name: string
  kind: string
  settlementDays: number
  partyName: string | null
  treasuryName: string | null
  active: boolean
}

function daysLabel(days: number): string {
  if (days <= 0) return 'El mismo día'
  if (days === 1) return 'Al otro día'
  return `A los ${days} días`
}

/**
 * Las paradas de la plata según los medios de cobro del bar: lo que entra en
 * el momento, lo que queda en la billetera y lo que llega días después. Las
 * señas no figuran (esa plata ya se cobró antes).
 */
export function arrivalStops(methods: readonly StopMethod[]): ArrivalStop[] {
  const stops = new Map<string, ArrivalStop & { order: number }>()
  const add = (key: string, label: string, inHand: boolean, order: number, name: string) => {
    const stop = stops.get(key) ?? { key, label, inHand, methods: [], order }
    if (!stop.methods.includes(name)) stop.methods.push(name)
    stops.set(key, stop)
  }
  for (const method of methods) {
    if (!method.active) continue
    switch (method.kind) {
      case 'treasury':
        add('now', 'En el momento', true, 0, method.name)
        break
      case 'settled_now': {
        const where = method.partyName ?? method.treasuryName ?? 'la billetera'
        add(`wallet:${where}`, `Queda en ${where}`, true, 1, method.name)
        break
      }
      case 'receivable': {
        const days = Math.max(0, method.settlementDays)
        add(`days:${days}`, daysLabel(days), false, 10 + days, method.name)
        break
      }
      case 'customer_account':
        add('account', 'Cuando te paga el cliente', false, 10_000, method.name)
        break
      default:
        break
    }
  }
  return [...stops.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...stop }) => stop)
}
