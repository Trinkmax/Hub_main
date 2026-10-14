/**
 * La libreta de proveedores («Compras y pagos»), lo puro: qué renglones se ven
 * y en qué grupo, cuántos hay en cada filtro, qué dice el margen de cada uno
 * («vencido hace 12 días») y cómo se lee el estado de un comprobante en
 * palabras. Sin I/O: lo usan la pestaña (servidor) y la hoja «Pagar» (cliente).
 * Lo prueba `tests/lib/administracion-libreta.test.ts`.
 *
 * Por qué acá y no en la pestaña: el héroe, los contadores de las píldoras y la
 * lista salen de UNA sola lectura (`listParties` sin filtro ni búsqueda), así
 * que coinciden siempre. El filtro y la búsqueda usan los mismos predicados de
 * esa lectura (`matchesPartyFilter` / `matchesPartyQuery`), que llegan por
 * parámetro para que este archivo no arrastre código de servidor.
 */

import type { LedgerTone } from '@/components/administracion/kit/ledger'
import type { PayablesTranches } from '@/lib/accounting/home'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import type { PartyListFilter, PartyListRow } from '@/lib/accounting/queries/parties'
import { daysBetween, formatDayMonth, MONTH_NAMES_SHORT, monthName, monthRange } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import {
  isVisibleSupplier,
  SUPPLIER_FILTERS,
  type SupplierClassification,
  type SupplierFilterValue,
  type SupplierTotals,
  supplierClassification,
  supplierTotals,
} from './suppliers'

/** Cuántos renglones «sin deuda» se ven antes de «Ver los N que faltan». */
export const SETTLED_PREVIEW = 12

/** Lo que vence dentro de estos días es «esta semana» (el mismo corte de la base). */
export const SOON_DAYS = 7

/** La ficha de un proveedor, lo que hace falta para su categoría (`PartyClassification`). */
export type LibretaInfo = {
  kind: string
  systemKey: string | null
  active: boolean
  defaultAccountId: string | null
  defaultAccountName: string | null
  updatedAt: string
}

/** Un renglón de la libreta: el saldo, su ficha (`null` si no se pudo leer) y si tiene categoría. */
export type LibretaEntry = {
  row: PartyListRow
  info: LibretaInfo | null
  state: SupplierClassification | null
}

/** Los predicados de `lib/accounting/queries/parties` (el filtro y la búsqueda de `listParties`). */
export type LibretaPredicates = {
  filter: (row: PartyListRow, filter: PartyListFilter) => boolean
  query: (row: PartyListRow, q: string) => boolean
}

export type LibretaView = {
  /** Cuántos hay en cada píldora, con la búsqueda aplicada (lo que se ve al tocarla). */
  counts: Record<SupplierFilterValue, number>
  /** «Les debés»: lo más vencido primero. */
  debt: LibretaEntry[]
  /** «Tenés a favor»: sin deuda y con algo a favor. */
  credit: LibretaEntry[]
  /** «Sin deuda»: lo que se ve de entrada… */
  settled: LibretaEntry[]
  /** …y lo que queda detrás de «Ver los N que faltan» (vacío con búsqueda u otro filtro). */
  settledMore: LibretaEntry[]
  /** Todos los que entran en el filtro, en el orden en que se dibujan. */
  shown: LibretaEntry[]
  /** Σ de los que se ven (el pie de la hoja). */
  totals: SupplierTotals
  /** La deuda más grande de los que se ven: el largo entero de la barrita. */
  maxDebtCents: number
}

function entryOf(
  row: PartyListRow,
  classes: ReadonlyMap<string, LibretaInfo> | null,
): LibretaEntry {
  const info = classes?.get(row.partyId) ?? null
  return { row, info, state: info ? supplierClassification(info) : null }
}

/** El orden de `listParties`: más vencido → más deuda → nombre. */
function byUrgency(a: LibretaEntry, b: LibretaEntry): number {
  return (
    b.row.overdueCents - a.row.overdueCents ||
    b.row.debtCents - a.row.debtCents ||
    a.row.partyName.localeCompare(b.row.partyName, 'es')
  )
}

/**
 * La libreta ya armada: los renglones del filtro y la búsqueda de la URL, en
 * sus tres grupos, y el contador de cada píldora.
 *
 * `rows` son TODOS los del grupo (lo que devuelve `listParties` sin filtro).
 * Si las fichas no se pudieron leer (`classes: null`), la libreta se arma
 * igual, sin categoría: «Sin categoría» queda en cero.
 */
export function libretaView(input: {
  rows: readonly PartyListRow[]
  classes: ReadonlyMap<string, LibretaInfo> | null
  filter: SupplierFilterValue
  q: string
  match: LibretaPredicates
  /** Cuántos «sin deuda» se ven de entrada (`SETTLED_PREVIEW`). */
  preview?: number
}): LibretaView {
  const q = input.q.trim()
  const found = input.rows.filter((row) => input.match.query(row, q))
  const entries = found.map((row) => entryOf(row, input.classes))

  const inFilter = (entry: LibretaEntry, value: SupplierFilterValue): boolean => {
    const def = SUPPLIER_FILTERS.find((f) => f.value === value) ?? SUPPLIER_FILTERS[0]
    if (!input.match.filter(entry.row, def.filter)) return false
    if (!isVisibleSupplier(entry.row, def.filter)) return false
    return !def.unclassifiedOnly || entry.state === 'unclassified'
  }

  const counts = Object.fromEntries(
    SUPPLIER_FILTERS.map((f) => [f.value, entries.filter((e) => inFilter(e, f.value)).length]),
  ) as Record<SupplierFilterValue, number>

  const visible = entries.filter((e) => inFilter(e, input.filter)).sort(byUrgency)
  const debt = visible.filter((e) => e.row.debtCents > 0)
  const credit = visible.filter((e) => e.row.debtCents <= 0 && e.row.creditCents > 0)
  const rest = visible.filter((e) => e.row.debtCents <= 0 && e.row.creditCents <= 0)
  // Solo se pliega la lista entera: con una búsqueda o un filtro, lo que se pidió está a la vista.
  const folds = input.filter === 'todos' && q === ''
  const preview = Math.max(1, input.preview ?? SETTLED_PREVIEW)
  const settled = folds ? rest.slice(0, preview) : rest
  const settledMore = folds ? rest.slice(preview) : []
  const shown = [...debt, ...credit, ...rest]

  return {
    counts,
    debt,
    credit,
    settled,
    settledMore,
    shown,
    totals: supplierTotals(shown.map((e) => e.row)),
    maxDebtCents: debt.reduce((max, e) => Math.max(max, e.row.debtCents), 0),
  }
}

/** Con fantasía: «Fantasía (Razón social)». Es el `title` del renglón y su nombre a la vista. */
export function supplierDisplayName(row: { partyName: string; tradeName: string | null }): string {
  return row.tradeName && row.tradeName !== row.partyName
    ? `${row.tradeName} (${row.partyName})`
    : row.partyName
}

/** Como se lo nombra en un aviso, un botón o un diálogo: el de fantasía, si tiene. */
export function supplierShortName(row: { partyName: string; tradeName: string | null }): string {
  return row.tradeName && row.tradeName !== row.partyName ? row.tradeName : row.partyName
}

// ─── El margen: desde cuándo o para cuándo ───────────────────────────────────

/** Lo que dice el margen de un renglón (`LedgerRail`): rótulo arriba, valor grande, unidad abajo. */
export type RailWords = {
  label: string
  value: string | number
  unit?: string
  tone: LedgerTone
}

function daysUnit(n: number): string {
  return n === 1 ? 'día' : 'días'
}

/**
 * El margen de UNA compra por su vencimiento: «vencido hace 12 días», «vence
 * hoy», «vence en 5 días», «vence el 30/10», «sin fecha». Las mismas palabras
 * en la libreta, en la hoja del proveedor y en «Pagar».
 */
export function dueRail(dueDate: string | null, today: string, soonDays = SOON_DAYS): RailWords {
  if (!dueDate) return { label: 'sin', value: 'fecha', tone: 'muted' }
  const late = daysBetween(dueDate, today)
  if (late > 0) return { label: 'vencido hace', value: late, unit: daysUnit(late), tone: 'late' }
  if (late === 0) return { label: 'vence', value: 'hoy', tone: 'warn' }
  if (late === -1) return { label: 'vence', value: 'mañana', tone: 'warn' }
  if (-late <= soonDays) return { label: 'vence en', value: -late, unit: 'días', tone: 'warn' }
  return { label: 'vence el', value: formatDayMonth(dueDate), tone: 'muted' }
}

type RailRow = Pick<
  PartyListRow,
  'debtCents' | 'creditCents' | 'overdueCents' | 'dueSoonCents' | 'oldestDueDate' | 'nextDueDate'
>

/**
 * El margen de un proveedor: lo más urgente de todo lo que se le debe. Nunca
 * un importe (la plata va a la derecha). `null` = margen vacío (sin deuda ni
 * nada a favor).
 */
export function ledgerRail(row: RailRow, today: string): RailWords | null {
  if (row.overdueCents > 0) {
    const late = row.oldestDueDate ? daysBetween(row.oldestDueDate, today) : 0
    // La base dice que hay algo vencido pero no desde cuándo: se dice igual, sin inventar días.
    if (late <= 0) return { label: 'con algo', value: 'vencido', tone: 'late' }
    return { label: 'vencido hace', value: late, unit: daysUnit(late), tone: 'late' }
  }
  if (row.dueSoonCents > 0) {
    if (!row.nextDueDate) return { label: 'vence', value: 'pronto', tone: 'warn' }
    const days = Math.max(0, daysBetween(today, row.nextDueDate))
    if (days === 0) return { label: 'vence', value: 'hoy', tone: 'warn' }
    if (days === 1) return { label: 'vence', value: 'mañana', tone: 'warn' }
    return { label: 'vence en', value: days, unit: 'días', tone: 'warn' }
  }
  if (row.debtCents > 0) {
    return row.nextDueDate
      ? { label: 'vence el', value: formatDayMonth(row.nextDueDate), tone: 'muted' }
      : { label: 'sin', value: 'fecha', tone: 'muted' }
  }
  if (row.creditCents > 0) return { label: 'a tu', value: 'favor', tone: 'ok' }
  return null
}

/** El margen-fecha de un comprobante: el mes arriba y el día grande («oct» · «08»). */
export function dateRail(iso: string): { label: string; value: string } {
  const month = Number(iso.slice(5, 7))
  return { label: MONTH_NAMES_SHORT[month - 1] ?? '', value: iso.slice(8, 10) }
}

// ─── El héroe ────────────────────────────────────────────────────────────────

/**
 * La oración del número «Le debés a proveedores»: a cuántos y qué tan urgente
 * es. La urgencia sale de `payablesTranches` (la frase del Resumen), así las dos
 * pantallas dicen lo mismo de la misma deuda.
 */
export function libretaSentence(
  debtors: number,
  tranches: Pick<PayablesTranches, 'sentence' | 'title' | 'isEmpty'>,
): string {
  if (tranches.isEmpty || debtors <= 0) return ''
  const who = debtors === 1 ? 'A 1 proveedor.' : `A ${debtors} proveedores.`
  // Con algo vencido o por vencer hay una oración; si no, el título ya es la frase entera.
  const urgency = tranches.sentence ?? `${tranches.title}.`
  return `${who} ${urgency}`
}

// ─── El período, en palabras ─────────────────────────────────────────────────

type PeriodLike = {
  active: string | null
  chips: ReadonlyArray<{ key: string; value: string }>
  from: string
  to: string
}

/** ¿El rango es un mes calendario entero? Devuelve su nombre («octubre»). */
function wholeMonthName(from: string, to: string): string | null {
  const range = monthRange(from.slice(0, 7))
  return range.from === from && range.to === to ? monthName(Number(from.slice(5, 7))) : null
}

/**
 * El período como arranque de una oración: «En octubre», «En los últimos 90
 * días», «En lo que va del año», «Del 01/08 al 13/10». Con `lower`, para usarlo
 * en medio de una frase («…en octubre»).
 */
export function periodLead(period: PeriodLike, opts: { lower?: boolean } = {}): string {
  const chip = period.chips.find((c) => c.value === period.active)
  let text: string
  if (chip?.key === 'ultimos-90') text = 'En los últimos 90 días'
  else if (chip?.key === 'este-anio') text = 'En lo que va del año'
  else if (chip?.key === 'este-mes' || chip?.key === 'mes-pasado') {
    text = `En ${monthName(Number(period.from.slice(5, 7)))}`
  } else {
    const month = wholeMonthName(period.from, period.to)
    text = month
      ? `En ${month}`
      : period.from === period.to
        ? `El ${formatDayMonth(period.from)}`
        : `Del ${formatDayMonth(period.from)} al ${formatDayMonth(period.to)}`
  }
  return opts.lower ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

// ─── El estado de un comprobante, en palabras ────────────────────────────────

export type DocumentRowTone = 'ok' | 'warn' | 'late' | 'info' | 'muted'

export type DocumentRowState = {
  /** «Pagada», «Falta pagar $ 120.000», «Vencida hace 3 días»… */
  text: string
  tone: DocumentRowTone
  /** La aclaración, en gris al lado: «de $ 500.000», «falta $ 120.000», «vence el 30/10». */
  note: string | null
  /** Anulado: el renglón va atenuado y el importe tachado. */
  voided: boolean
  /** Le queda algo por pagar a un proveedor: lleva [Pagarle]. */
  payable: boolean
}

type DocumentRowLike = Pick<
  DocumentListRow,
  'kind' | 'status' | 'paymentStatus' | 'openCents' | 'totalCents' | 'dueDate' | 'partyId'
>

/**
 * Lo que se lee a la derecha de un comprobante de compra: su estado con
 * palabras de dueño (ni «Impaga» ni «Sin aplicar»).
 */
export function documentRowState(row: DocumentRowLike, today: string): DocumentRowState {
  const base = { note: null, voided: false, payable: false }
  if (row.status === 'voided') return { ...base, text: 'Anulado', tone: 'muted', voided: true }
  if (row.kind === 'expense') return { ...base, text: 'Pagado en el momento', tone: 'muted' }

  const open = row.openCents ?? 0
  if (row.kind === 'purchase_credit_note') {
    return open > 0
      ? { ...base, text: `A tu favor, sin usar: ${formatCentsShort(open)}`, tone: 'info' }
      : { ...base, text: 'Ya descontada', tone: 'muted' }
  }

  const payable = row.partyId !== null && open > 0
  if (row.paymentStatus === 'paid') return { ...base, text: 'Pagada', tone: 'ok' }
  if (row.paymentStatus === 'partial') {
    return {
      ...base,
      text: `Falta pagar ${formatCentsShort(open)}`,
      tone: 'warn',
      note: `de ${formatCentsShort(row.totalCents)}`,
      payable,
    }
  }
  if (row.paymentStatus === 'unpaid') {
    const late = row.dueDate ? daysBetween(row.dueDate, today) : null
    if (late !== null && late > 0) {
      return {
        ...base,
        text: `Vencida hace ${late} ${daysUnit(late)}`,
        tone: 'late',
        // «Falta $ X» solo si no es el total: sin ningún pago repetiría el importe de al lado.
        note: open !== row.totalCents ? `falta ${formatCentsShort(open)}` : null,
        payable,
      }
    }
    if (late === 0) return { ...base, text: 'Vence hoy', tone: 'warn', payable }
    if (late === -1) return { ...base, text: 'Vence mañana', tone: 'warn', payable }
    if (late !== null && -late <= SOON_DAYS) {
      return { ...base, text: `Vence en ${-late} días`, tone: 'warn', payable }
    }
    return {
      ...base,
      text: 'Falta pagar',
      tone: 'muted',
      note: row.dueDate ? `vence el ${formatDayMonth(row.dueDate)}` : null,
      payable,
    }
  }
  // Un comprobante que no deja deuda (una boleta ya paga, un asiento): nada que avisar.
  return { ...base, text: '', tone: 'muted' }
}

// ─── Pagos ───────────────────────────────────────────────────────────────────

type PaymentRowLike = Pick<DocumentListRow, 'status' | 'totalCents'>

/**
 * La línea de arriba de «Pagos»: «hiciste 3 pagos por $ 1.147.250». Solo
 * cuando la página trae TODO lo del período y no hay búsqueda: nunca un total a
 * medias. `null` = no se dice nada.
 */
export function paymentsHeadline(input: {
  rows: readonly PaymentRowLike[]
  totalRows: number
  searching: boolean
}): { count: number; cents: number } | null {
  if (input.searching || input.rows.length === 0) return null
  if (input.totalRows !== input.rows.length) return null
  const live = input.rows.filter((r) => r.status !== 'voided')
  if (live.length === 0) return null
  return { count: live.length, cents: live.reduce((sum, r) => sum + r.totalCents, 0) }
}

/** «con Caja» / «con 2 medios»: con qué se pagó, en gris. */
export function paymentMeansText(means: ReadonlyArray<{ label: string }> | null): string | null {
  if (!means || means.length === 0) return null
  const first = means[0]
  return means.length === 1 && first ? `con ${first.label}` : `con ${means.length} medios`
}

/** «pagó Factura A 0003-00001100 (+2)» / «quedó a cuenta»: qué canceló el pago. */
export function paymentAppliedText(
  appliedTo: ReadonlyArray<{ label: string }> | null,
): string | null {
  if (!appliedTo) return null
  const first = appliedTo[0]
  if (!first) return 'quedó a cuenta'
  const rest = appliedTo.length - 1
  return rest > 0 ? `pagó ${first.label} (+${rest})` : `pagó ${first.label}`
}
