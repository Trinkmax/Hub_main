/**
 * La ficha de un comprobante, en palabras. Todo lo que la pantalla DICE sale
 * de acá: el título, la píldora, el número con su oración y su botón, los
 * renglones del papel con su sello y su letra chica, y el mapa de lo que el
 * papel tiene unido (o le falta). Los componentes solo dibujan.
 *
 * Puro (sin React, sin I/O): recibe el `DocumentDetail` que ya lee la página y
 * un contexto con lo demás que la página pudo averiguar. Devuelve centavos y
 * textos; la pantalla formatea la plata con `lib/money`.
 *
 * Por qué existe: la ficha vieja mostraba el comprobante en idioma de
 * contadora (roles, códigos de cuenta, «imputación») y repartía sus uniones en
 * cinco tarjetas. Acá se contesta, en el orden en que lo pregunta un socio:
 * ¿qué es? → ¿qué pasó con la plata y qué me toca? → ¿con qué está unido y qué
 * le falta? → ¿cómo lo arreglo si está mal?
 *
 * Reglas de vocabulario (las fija `administracion-comprobante-ficha.test.ts`):
 * «sin factura» nunca se dice de otra manera; la plata «entra», «llega» o
 * «está en camino»; las uniones se «separan»; contar una caja es «conteo». El
 * título nunca sale de `doc.description` entero: ese texto es histórico y
 * todavía trae palabras que la sección ya no usa.
 *
 * La lógica contable no vive acá: qué se puede anular, pagar o cobrar lo sigue
 * decidiendo `documentActions` (`document-view.ts`), sin cambios.
 */

import { documentActions } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-view'
import { attachmentsBlock } from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/[id]/_lib/attachments-view'
import { ivaSummary } from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva'
import { closeTicketProps } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-ticket-props'
import type { ActionParams } from '@/components/administracion/acciones/types'
import { pct, percentLabel } from '@/components/administracion/charts/scale'
import { type PaperStamp, voucherStamp } from '@/components/administracion/voucher-stamp'
import { dueBucket, dueLabel } from '@/lib/accounting/aging'
import type { GuideLinkId } from '@/lib/accounting/guides'
import type { DocumentOrigin } from '@/lib/accounting/queries/document-origin'
import type {
  AllocationDetail,
  DocumentDetail,
  DocumentLink,
  FiscalVoucherDetail,
  RecurringExpenseRow,
} from '@/lib/accounting/queries/documents'
import {
  DOCUMENT_KIND_LABELS,
  documentKindLabel,
  entryKindLabel,
  vatRateLabel,
} from '@/lib/accounting/queries/labels'
import type { DocumentKind, TreasuryKind } from '@/lib/accounting/types'
import { isVoucherType, VOUCHER_CATALOG } from '@/lib/accounting/voucher-types'
import {
  daysBetween,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatIsoDay,
  formatMonthLabel,
  formatWeekdayDayMonth,
  monthName,
  weekdayName,
} from '@/lib/dates'
import { formatCuit, formatVoucherNumber, formatVoucherRange } from '@/lib/fiscal'
import { formatCents, formatCentsShort } from '@/lib/money'

// ─── Lo que recibe ───────────────────────────────────────────────────────────

/**
 * Lo que la página averiguó además del comprobante. Cada dato puede faltar
 * (su lectura falló o no hacía falta pedirla): la ficha se dibuja igual.
 */
export type StoryContext = {
  /** Hoy en el bar (`yyyy-MM-dd`). */
  today: string
  /** Puede cargar (un socio). La contadora mira: no se le ofrece ningún gesto. */
  canWrite: boolean
  /** El tipo de cada caja, para saber cuál es la tarjeta de la empresa. `null`: no se pudo leer. */
  treasuryKinds: ReadonlyMap<string, TreasuryKind> | null
  /**
   * El gasto fijo del comprobante: su fila, `null` si ya no está en la lista,
   * `'error'` si no se pudo leer y `undefined` si el comprobante no es de uno.
   */
  recurring: RecurringExpenseRow | null | 'error' | undefined
  /** Los gastos fijos del mes, para preguntar «¿Era el alquiler?». Vacío = no preguntar. */
  candidates: readonly RecurringExpenseRow[]
  /** El archivo importado del que salió, si salió de uno. */
  origin: DocumentOrigin | null
  /** Cuántas fotos o PDF tiene. `null`: no se pudo leer. */
  attachments: number | null
  /** El estado de la autorización de ARCA, si el comprobante tiene una. */
  arca?: LinkState | null
}

type Line = DocumentDetail['lines'][number]

// ─── Texto con links adentro ─────────────────────────────────────────────────

/** Otro comprobante nombrado dentro de una oración: se dibuja como link a su ficha. */
export type DocRef = { id: string; text: string }
/** Una oración que puede nombrar otros comprobantes. */
export type Rich = ReadonlyArray<string | DocRef>

/** La oración sin links (para tests, `aria-label` y títulos). */
export function richText(rich: Rich): string {
  return rich.map((part) => (typeof part === 'string' ? part : part.text)).join('')
}

function refOf(link: DocumentLink): DocRef {
  return { id: link.id, text: `${link.title} #${link.seq}` }
}

// ─── Piezas chicas ───────────────────────────────────────────────────────────

/** Un importe dentro de una oración: sin centavos si es redondo. */
function money(cents: number): string {
  return cents % 100 === 0 ? formatCentsShort(cents) : formatCents(cents)
}

function hasNumber(text: string): boolean {
  return /\d/.test(text)
}

function norm(text: string | null | undefined): string {
  return (text ?? '').trim().toLocaleLowerCase('es')
}

/** Un nombre largo dentro de un rótulo corto: se corta con «…» (entero está en el encabezado). */
export function clip(text: string, max: number): string {
  const clean = text.trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

const LABEL_NAME_MAX = 32
const TOTAL_NAME_MAX = 22

const PAYABLE_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_debit_note',
  'iva_settlement',
])
const RECEIVABLE_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'sales_invoice',
  'sales_debit_note',
])
const PURCHASE_PAPER_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
  'bank_expense',
])
const SALES_PAPER_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
])
/** Sus partícipes tienen la ficha del proveedor. */
const SUPPLIER_SIDE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
  'payment',
])
/** Sus partícipes tienen la ficha de quien te debe. */
const CUSTOMER_SIDE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'sales_invoice',
  'sales_credit_note',
  'sales_debit_note',
  'collection',
])
/** Los renglones que dicen «en qué» fue la plata. */
const BASE_ROLES: ReadonlySet<string> = new Set(['net', 'gross', 'non_taxed', 'exempt'])
const TAX_ROLES: ReadonlySet<string> = new Set(['perception', 'other_tax', 'internal_tax'])

function isVoided(doc: Pick<DocumentDetail, 'status'>): boolean {
  return doc.status === 'voided'
}

/** La anulación con fecha posterior que sigue en pie, si hay. */
function liveReversal(doc: Pick<DocumentDetail, 'reversedBy'>): DocumentLink | null {
  return doc.reversedBy?.status === 'posted' ? doc.reversedBy : null
}

/** El comprobante cuenta hoy: ni anulado ni anulado con fecha posterior. */
function isLive(doc: Pick<DocumentDetail, 'status' | 'reversedBy'>): boolean {
  return !isVoided(doc) && liveReversal(doc) === null
}

function isSalesSide(kind: DocumentKind): boolean {
  return CUSTOMER_SIDE.has(kind) || kind === 'sales_close'
}

/** La categoría del comprobante: el renglón de mayor importe entre los que dicen «en qué». */
function mainCategory(doc: Pick<DocumentDetail, 'lines'>): { id: string; name: string } | null {
  let best: Line | null = null
  for (const line of doc.lines) {
    if (!BASE_ROLES.has(line.role)) continue
    if (best === null || line.amountCents > best.amountCents) best = line
  }
  return best?.accountName ? { id: best.accountId, name: best.accountName } : null
}

function treasuryLines(doc: Pick<DocumentDetail, 'lines'>): Line[] {
  return doc.lines.filter((line) => line.role === 'treasury')
}

function sumOf(lines: readonly Line[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0)
}

function isCard(line: Line, ctx: Pick<StoryContext, 'treasuryKinds'>): boolean {
  return (
    line.treasuryAccountId !== null &&
    ctx.treasuryKinds?.get(line.treasuryAccountId) === 'credit_card'
  )
}

/** «Caja» si es una sola; «2 cajas» si salió o entró por varias; `null` si no tocó ninguna. */
function treasuryWords(lines: readonly Line[]): string | null {
  const names = [...new Set(lines.map((line) => line.treasuryName ?? '').filter(Boolean))]
  if (names.length === 0) return lines.length > 0 ? 'una caja' : null
  return names.length === 1 ? (names[0] ?? null) : `${names.length} cajas`
}

function activeAllocations(doc: Pick<DocumentDetail, 'allocations'>): AllocationDetail[] {
  return doc.allocations.filter((a) => a.voidedOn === null)
}

/** «Pago #6», «Factura A 0003-00001100 #2»; sin comprobante del otro lado, «Unión hecha a mano». */
function allocationLabel(a: AllocationDetail): string {
  if (!a.otherDocumentId || !a.otherDocumentTitle) return 'Unión hecha a mano'
  return a.otherDocumentSeq
    ? `${a.otherDocumentTitle} #${a.otherDocumentSeq}`
    : a.otherDocumentTitle
}

/** «la» Factura A 0003-00001100, «el» Tique 0001-00000012: el artículo del otro comprobante. */
function articleFor(title: string): 'la' | 'el' {
  return /^(factura|nota|compra|liquidación|boleta|ddjj)/i.test(title.trim()) ? 'la' : 'el'
}

// ─── ¿Qué es? El título ──────────────────────────────────────────────────────

/** Lo que el motor escribe en la descripción y no es un detalle de la persona. */
const GENERIC_SEGMENTS: ReadonlySet<string> = new Set(
  [
    ...Object.values(DOCUMENT_KIND_LABELS),
    ...Object.values(VOUCHER_CATALOG).map((info) => info.label),
    'Sin comprobante',
    'Nota de crédito',
    'Nota de débito',
    'Otro egreso',
    'Otro ingreso',
    'faltante',
    'sobrante',
  ].map(norm),
)
const GENERIC_PREFIXES = ['ajuste de saldo', 'cierre del día', 'turno ', 'anulación de '] as const
/** «0003-00001290»: el número de otro comprobante (lo que pagó un pago, por ejemplo). */
const VOUCHER_NUMBER_RE = /\b\d{4,5}-\d{8}\b/

/**
 * Lo que la persona escribió al cargar («Hielo», «evento corporativo», «Cambio
 * para la caja»), rescatado de la descripción que guardó el motor. Se descarta
 * todo lo que la ficha ya dice por otro lado: el tipo, el papel, el partícipe,
 * la categoría, la caja. `null` si no queda nada.
 */
export function descriptionExtra(
  doc: Pick<DocumentDetail, 'kind' | 'title' | 'description' | 'partyName' | 'lines'>,
): string | null {
  // El asiento manual se titula con su descripción entera: no hay «detalle» aparte.
  if (doc.kind === 'manual') return null
  const known = new Set<string>([norm(doc.title), norm(doc.partyName)])
  for (const line of doc.lines) {
    known.add(norm(line.accountName))
    known.add(norm(line.partyName))
    known.add(norm(line.treasuryName))
  }
  known.delete('')
  const kept = doc.description
    .split(' · ')
    .map((segment) => segment.trim())
    .filter((segment) => {
      const key = norm(segment)
      if (key === '') return false
      if (known.has(key) || GENERIC_SEGMENTS.has(key)) return false
      if (GENERIC_PREFIXES.some((prefix) => key.startsWith(prefix))) return false
      if (segment.includes(' → ')) return false
      return !VOUCHER_NUMBER_RE.test(segment)
    })
  return kept.length > 0 ? kept.join(' · ') : null
}

export type HeadingPart =
  | { key: 'kind' | 'paper' | 'day' | 'seq'; text: string }
  /** El partícipe: link a su ficha (`supplier` = proveedor, `customer` = quien te debe). */
  | { key: 'party'; text: string; partyId: string | null; side: 'supplier' | 'customer' | null }

export type DocumentHeading = {
  /** El `h1`: lo que es, con los datos del comprobante. */
  title: string
  /** La línea de abajo: solo lo que el título no dijo. */
  parts: HeadingPart[]
}

/** A dónde entró o de dónde salió la plata de un movimiento de una sola caja. */
function movementDirection(doc: Pick<DocumentDetail, 'lines'>): 'in' | 'out' | null {
  const line = treasuryLines(doc)[0]
  if (!line) return null
  return line.side === 'debit' ? 'in' : 'out'
}

/** El otro lado de «Otra entrada o salida»: quién o en qué. */
function counterpartName(doc: Pick<DocumentDetail, 'partyName' | 'lines'>): string | null {
  if (doc.partyName) return doc.partyName
  const line = doc.lines.find((l) => l.role !== 'treasury' && l.accountName)
  return line?.accountName ?? null
}

/** El nombre del tipo para quien no es contador (el de la base dice «Ajuste de saldo»). */
function friendlyKind(doc: Pick<DocumentDetail, 'kind' | 'lines' | 'countedCents'>): string {
  if (doc.kind === 'cash_movement') {
    return movementDirection(doc) === 'in' ? 'Otra entrada' : 'Otra salida'
  }
  if (doc.kind === 'treasury_adjustment') return 'Conteo de caja'
  // Contar una billetera y anotar lo que entró es, para quien lo hizo, un conteo.
  if (doc.kind === 'collection' && doc.countedCents !== null) return 'Conteo'
  return documentKindLabel(doc.kind)
}

function builtTitle(doc: DocumentDetail): { title: string; saysParty: boolean; saysDay: boolean } {
  const party = doc.partyName
  const withParty = (prefix: string, fallback: string) =>
    party
      ? { title: `${prefix} ${party}`, saysParty: true, saysDay: false }
      : { title: fallback, saysParty: false, saysDay: false }
  const plain = (title: string) => ({ title, saysParty: false, saysDay: false })
  const firstTreasury = treasuryLines(doc)[0]?.treasuryName ?? null

  switch (doc.kind) {
    case 'purchase':
      return withParty('Compra a', 'Compra')
    case 'purchase_credit_note':
      return withParty('Nota de crédito de', 'Nota de crédito')
    case 'purchase_debit_note':
      return withParty('Nota de débito de', 'Nota de débito')
    case 'expense': {
      const extra = descriptionExtra(doc)
      if (extra) return plain(`Gasto · ${extra}`)
      if (party) return { title: `Gasto · ${party}`, saysParty: true, saysDay: false }
      const category = mainCategory(doc)
      return plain(category ? `Gasto · ${category.name}` : 'Gasto')
    }
    case 'bank_expense':
      return plain(firstTreasury ? `Gasto bancario · ${firstTreasury}` : 'Gasto bancario')
    case 'payment':
      return withParty('Pago a', 'Pago')
    case 'collection':
      if (doc.countedCents !== null) {
        const where = firstTreasury ?? party
        if (!where) return plain('Conteo de caja')
        return { title: `Conteo de ${where}`, saysParty: where === party, saysDay: false }
      }
      return withParty('Cobro de', 'Cobro')
    case 'sales_close': {
      const day = `${weekdayName(doc.issueDate)} ${formatIsoDay(doc.issueDate)}`.trim()
      const shift = doc.shift ? ` · turno ${doc.shift}` : ''
      return { title: `Cierre del día ${day}${shift}`, saysParty: false, saysDay: true }
    }
    case 'sales_invoice':
      return withParty('Factura de venta a', 'Factura de venta')
    case 'sales_credit_note':
      return withParty('Nota de crédito a', 'Nota de crédito de venta')
    case 'sales_debit_note':
      return withParty('Nota de débito a', 'Nota de débito de venta')
    case 'transfer': {
      const lines = treasuryLines(doc)
      const from = lines.find((l) => l.side === 'credit')?.treasuryName
      const to = lines.find((l) => l.side === 'debit')?.treasuryName
      return plain(from && to ? `Plata de ${from} a ${to}` : 'Movimiento entre cuentas')
    }
    case 'cash_movement': {
      const other = counterpartName(doc)
      const kind = friendlyKind(doc)
      if (!other) return plain(kind)
      return { title: `${kind} · ${other}`, saysParty: other === party, saysDay: false }
    }
    case 'treasury_adjustment':
      return plain(firstTreasury ? `Conteo de ${firstTreasury}` : 'Conteo de caja')
    case 'manual':
      return plain(doc.description.trim() || documentKindLabel(doc.kind))
    default:
      return plain(documentKindLabel(doc.kind))
  }
}

/**
 * El título y su línea de abajo. Si el comprobante tiene número («Factura A
 * 0003-00001290»), ese es el título y abajo va qué es y de quién; si no, el
 * título se arma con los datos («Compra a La Serenísima», «Gasto · Hielo») y
 * abajo va solo lo que falta decir.
 */
export function documentHeading(doc: DocumentDetail): DocumentHeading {
  const numbered = hasNumber(doc.title)
  const built = numbered ? { title: doc.title, saysParty: false, saysDay: false } : builtTitle(doc)
  const parts: HeadingPart[] = []

  // Qué es: solo si el título no lo dijo (un número de factura no dice si es compra o venta).
  if (numbered || doc.kind === 'manual') {
    parts.push({ key: 'kind', text: documentKindLabel(doc.kind) })
  }
  // El papel: «Sin factura», o el comprobante sin número («Tique»).
  if (doc.voucherType === 'sin_comprobante') {
    parts.push({ key: 'paper', text: 'Sin factura' })
  } else if (
    !numbered &&
    doc.voucherType &&
    norm(doc.title) !== norm(documentKindLabel(doc.kind))
  ) {
    parts.push({ key: 'paper', text: doc.title })
  }
  if (doc.partyName && !built.saysParty) {
    parts.push({
      key: 'party',
      text: doc.partyName,
      partyId: doc.partyId,
      side: SUPPLIER_SIDE.has(doc.kind)
        ? 'supplier'
        : CUSTOMER_SIDE.has(doc.kind)
          ? 'customer'
          : null,
    })
  }
  if (!built.saysDay) {
    parts.push({
      key: 'day',
      text: `${weekdayName(doc.issueDate)} ${formatIsoDay(doc.issueDate)}`.trim(),
    })
  }
  // Sola, la referencia no se entiende: «Comprobante #47».
  parts.push({ key: 'seq', text: parts.length === 0 ? `Comprobante #${doc.seq}` : `#${doc.seq}` })
  return { title: built.title, parts }
}

// ─── La píldora ──────────────────────────────────────────────────────────────

export type StoryTone = 'ok' | 'warn' | 'late' | 'info' | 'muted'
export type DocumentBadge = { tone: StoryTone; text: string }

/**
 * UNA píldora de estado, o ninguna: lo normal no se anuncia (no hay «Vigente»).
 * El texto es el mismo de las listas (`dueLabel`).
 */
export function documentBadge(
  doc: Pick<
    DocumentDetail,
    'kind' | 'status' | 'reversedBy' | 'paymentStatus' | 'dueDate' | 'openCents'
  >,
  today: string,
): DocumentBadge | null {
  if (isVoided(doc)) return { tone: 'late', text: 'Anulado' }
  if (liveReversal(doc)) return { tone: 'late', text: 'Anulado con fecha posterior' }
  const tracked =
    doc.paymentStatus === 'unpaid' ||
    doc.paymentStatus === 'partial' ||
    doc.paymentStatus === 'paid'
  if (!tracked || doc.kind === 'sales_close') return null
  const settled = doc.paymentStatus === 'paid'
  const group = RECEIVABLE_KINDS.has(doc.kind) ? 'receivables' : 'payables'
  const text = dueLabel(doc.dueDate, today, { settled, group })
  switch (dueBucket(doc.dueDate, today, undefined, settled)) {
    case 'settled':
    case 'current':
      return { tone: 'ok', text }
    case 'overdue':
      return { tone: 'late', text }
    case 'today':
    case 'soon':
      return { tone: 'warn', text }
    case 'no-due':
      return { tone: 'muted', text }
  }
}

/** «venció ayer, el 12/10.» · «vence hoy.» · «vence el 21/10, en 8 días.» · «no tiene vencimiento.» */
export function dueSentence(dueDate: string | null, today: string): string {
  if (!dueDate) return 'no tiene vencimiento.'
  const days = daysBetween(today, dueDate)
  // De otro año, el día va con su año: «15/12/2025».
  const day =
    dueDate.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(dueDate) : formatIsoDay(dueDate)
  if (days === 0) return 'vence hoy.'
  if (days === 1) return `vence mañana, el ${day}.`
  if (days > 1) return `vence el ${day}, en ${days} días.`
  if (days === -1) return `venció ayer, el ${day}.`
  return `venció el ${day}, hace ${-days} días.`
}

// ─── El cierre del día, en plata ─────────────────────────────────────────────

export type CloseIncomingRow = {
  key: string
  /** El renglón del asiento (la partida que se cobra). `null`: no se pudo ubicar. */
  lineId: string | null
  /** «Débito», «QR Mercado Pago». */
  medium: string
  partyId: string | null
  partyName: string | null
  cents: number
  openCents: number
  tone: StoryTone
  /** «Llegó» · «Llega el jue 08/10» · «Tendría que haber llegado el 07/10». */
  status: string
  /** Lo vendido en cuenta corriente: lo debe un cliente, no «llega» solo. */
  customer: boolean
}

export type CloseMoney = {
  soldCents: number
  /** Lo que entró a una caja en el momento (el efectivo contado). */
  cashCents: number
  /** «Caja», «2 cajas» o `null` si no entró nada a ninguna. */
  cashWords: string | null
  /** Lo que quedó en camino (tarjetas, billeteras, apps, cuenta corriente). */
  incomingCents: number
  arrivedCents: number
  pendingCents: number
  /** Lo que ya se había cobrado como seña. */
  advanceCents: number
  /** Vendido en efectivo − contado: positivo = faltó en la caja. */
  diffCents: number
  rows: CloseIncomingRow[]
}

/** Así separa el motor el medio del cliente en la leyenda de una cuenta corriente. */
const CUSTOMER_MEMO_MARK = ' · '

function mediumOf(line: Line): string {
  const fromMemo = line.memo?.split(CUSTOMER_MEMO_MARK)[0]?.trim()
  return line.salesMethodName || fromMemo || line.partyName || 'Otro medio'
}

function isCustomerLine(line: Line): boolean {
  if (line.role !== 'receivable' || !line.memo) return false
  return line.memo !== line.salesMethodName && line.memo.includes(CUSTOMER_MEMO_MARK)
}

function incomingStatus(
  input: { cents: number; open: number; due: string; customer: boolean; instant: boolean },
  today: string,
): { tone: StoryTone; status: string } {
  const { cents, open, due, customer, instant } = input
  const missing = `faltan ${money(open)}`
  if (customer) {
    if (open === 0) return { tone: 'ok', status: 'Pagó' }
    if (open < cents) return { tone: 'warn', status: `Pagó una parte: ${missing}` }
    return due < today
      ? { tone: 'warn', status: `Tendría que haber pagado el ${formatDayMonth(due)}` }
      : { tone: 'muted', status: 'Todavía no pagó' }
  }
  // QR y transferencias: no «llegan» en una fecha; están en camino hasta que se cuenta la billetera.
  if (instant) {
    if (open === 0) return { tone: 'ok', status: 'Ya entró' }
    if (open < cents) return { tone: 'warn', status: `Entró una parte: ${missing}` }
    return { tone: 'muted', status: 'En camino' }
  }
  if (open === 0) return { tone: 'ok', status: 'Llegó' }
  if (open < cents) return { tone: 'warn', status: `Llegó una parte: ${missing}` }
  if (due < today) {
    // Ámbar y no rojo: suele ser plata que ya está y falta anotar.
    return { tone: 'warn', status: `Tendría que haber llegado el ${formatDayMonth(due)}` }
  }
  return {
    tone: 'muted',
    status: due === today ? 'Llega hoy' : `Llega el ${formatWeekdayDayMonth(due)}`,
  }
}

/**
 * Qué pasó con la plata de un cierre: cuánto entró a la caja, cuánto quedó en
 * camino, cuánto de eso ya llegó y cuánto falta, renglón por renglón. Mismas
 * cuentas que el ticket del cierre (`closeTicketProps`), con el asiento como
 * fuente de lo que falta cobrar.
 */
export function closeMoney(
  doc: Pick<DocumentDetail, 'lines' | 'entry' | 'accountingDate' | 'totalCents'>,
  today: string,
): CloseMoney {
  const entryByNo = new Map((doc.entry?.lines ?? []).map((line) => [line.lineNo, line]))
  const cashLines = doc.lines.filter((l) => l.role === 'treasury' && l.side === 'debit')
  let advanceCents = 0
  let diffCents = 0
  let incomingCents = 0
  let pendingCents = 0
  const rows: CloseIncomingRow[] = []

  for (const line of doc.lines) {
    if (line.role === 'advance' && line.side === 'debit') advanceCents += line.amountCents
    else if (line.role === 'cash_diff') {
      diffCents += line.side === 'debit' ? line.amountCents : -line.amountCents
    } else if (line.role === 'receivable' && line.side === 'debit') {
      const entry = entryByNo.get(line.lineNo)
      const cents = line.amountCents
      const open = Math.min(cents, Math.max(0, entry?.openCents ?? cents))
      const due = line.dueDate ?? entry?.dueDate ?? doc.accountingDate
      const customer = isCustomerLine(line)
      const state = incomingStatus(
        { cents, open, due, customer, instant: due <= doc.accountingDate },
        today,
      )
      incomingCents += cents
      pendingCents += open
      rows.push({
        key: line.id,
        lineId: entry?.id ?? null,
        medium: mediumOf(line),
        partyId: line.partyId ?? entry?.partyId ?? null,
        partyName: line.partyName ?? entry?.partyName ?? null,
        cents,
        openCents: open,
        customer,
        ...state,
      })
    }
  }

  return {
    soldCents: doc.totalCents,
    cashCents: sumOf(cashLines),
    cashWords: treasuryWords(cashLines),
    incomingCents,
    arrivedCents: incomingCents - pendingCents,
    pendingCents,
    advanceCents,
    diffCents,
    rows,
  }
}

function closeSentence(m: CloseMoney): string {
  const cash = m.cashWords ?? 'la caja'
  const arrived =
    m.pendingCents === 0
      ? 'ya llegó todo.'
      : m.arrivedCents === 0
        ? 'todavía no llegó nada.'
        : `ya llegaron ${money(m.arrivedCents)} y faltan ${money(m.pendingCents)}.`
  const tail =
    m.diffCents > 0
      ? ` En la caja faltaron ${money(m.diffCents)}.`
      : m.diffCents < 0
        ? ` En la caja sobraron ${money(-m.diffCents)}.`
        : ''
  if (m.incomingCents === 0) {
    return m.cashCents > 0
      ? `Entró todo a ${cash}.${tail}`
      : `Este cierre no tiene importes.${tail}`
  }
  if (m.cashCents === 0) return `Quedó todo en camino: ${arrived}${tail}`
  return `Entraron ${money(m.cashCents)} a ${cash} y quedaron ${money(m.incomingCents)} en camino: ${arrived}${tail}`
}

// ─── ① Qué pasó con la plata ─────────────────────────────────────────────────

export type HeroAction = {
  /** La hoja que abre. */
  action: 'pagar' | 'cobrar'
  label: string
  params: ActionParams
}

export type HeroMeter = {
  valueCents: number
  totalCents: number
  /** Para lectores: «Pagado» / «Cobrado». */
  label: string
  tone: 'default' | 'in'
  /** «Pagaste el 41 %», escrito al lado. */
  text: string
}

export type HeroSplitSegment = {
  key: 'cash' | 'arrived' | 'pending'
  label: string
  cents: number
  swatch: string
  hatched?: boolean
}

export type HeroMathRow = { key: string; label: string; cents: number; op?: '+' | '−' | '=' }

export type DocumentHero = {
  /** Qué es el número, en palabras: «Le debés a La Serenísima». */
  label: string
  cents: number
  /** Atenuado: el comprobante ya no cuenta (anulado). */
  muted: boolean
  /** UNA oración. Puede nombrar otro comprobante (link). */
  sentence: Rich
  /** La línea de ayuda de quien pagó y no lo anotó. Solo para quien carga. */
  help: string | null
  /** El botón del momento. `null` para la contadora y cuando no hay nada que hacer. */
  action: HeroAction | null
  meter: HeroMeter | null
  split: readonly HeroSplitSegment[] | null
  explain: { rows: readonly HeroMathRow[]; note: string | null } | null
}

type HeroCore = Pick<DocumentHero, 'label' | 'cents' | 'sentence'> &
  Partial<Pick<DocumentHero, 'meter' | 'split' | 'explain'>>

function heroOf(core: HeroCore, rest: Partial<DocumentHero> = {}): DocumentHero {
  return {
    muted: false,
    help: null,
    action: null,
    meter: null,
    split: null,
    explain: null,
    ...core,
    ...rest,
  }
}

/** La partida que se paga o se cobra: el primer renglón con partícipe que sigue abierto. */
function openLine(doc: Pick<DocumentDetail, 'entry'>) {
  return doc.entry?.lines.find((l) => l.partyId && (l.openCents ?? 0) > 0) ?? null
}

function payablesHero(doc: DocumentDetail, ctx: StoryContext): DocumentHero {
  const sales = RECEIVABLE_KINDS.has(doc.kind)
  const who = doc.partyName ? clip(doc.partyName, LABEL_NAME_MAX) : null
  const total = doc.totalCents
  const open = doc.openCents ?? 0
  const paid = Math.max(0, total - open)
  const active = activeAllocations(doc)

  const settle = documentActions(doc, ctx.canWrite).settle
  const line = openLine(doc)
  const action: HeroAction | null =
    settle && line && doc.partyId
      ? settle === 'pagar'
        ? {
            action: 'pagar',
            label: 'Pagar',
            params: { proveedor: doc.partyId, partida: line.id },
          }
        : {
            action: 'cobrar',
            label: 'Me entró plata',
            params: { cliente: doc.partyId, partida: line.id },
          }
      : null
  // «Lo pagué y no lo anoté»: el paso que hoy se hace a mano y nadie avisa.
  const help =
    action && doc.dueDate !== null && doc.dueDate <= ctx.today
      ? sales
        ? '¿Ya te pagó? Tocá «Me entró plata» y elegí a dónde entró.'
        : '¿Ya lo pagaste? Tocá «Pagar» y elegí con qué: no hace falta cargarlo de nuevo.'
      : null
  const due = dueSentence(doc.dueDate, ctx.today)

  if (doc.paymentStatus === 'paid') {
    if (sales) {
      return heroOf({
        label: 'Cobrada',
        cents: total,
        sentence: [`${doc.partyName ?? 'El cliente'} ya te pagó todo.`],
      })
    }
    const to = doc.partyName ? ` a ${doc.partyName}` : ''
    const only = active.length === 1 ? active[0] : undefined
    const bundled =
      only?.otherDocumentId && doc.bundleSiblings.some((s) => s.id === only.otherDocumentId)
    if (only?.otherDocumentId && bundled) {
      return heroOf({
        label: 'Pagada',
        cents: total,
        sentence: [
          'La pagaste en el momento, con ',
          { id: only.otherDocumentId, text: allocationLabel(only) },
          '.',
        ],
      })
    }
    const byCreditNote = active.length > 0 && active.every((a) => a.kind === 'credit_note')
    if (byCreditNote) {
      return heroOf({
        label: 'Pagada',
        cents: total,
        sentence: [`Ya no le debés nada${to}: se descontó con una nota de crédito.`],
      })
    }
    const last = active.reduce<string | null>(
      (latest, a) => (latest === null || a.appliedOn > latest ? a.appliedOn : latest),
      null,
    )
    return heroOf({
      label: 'Pagada',
      cents: total,
      sentence: [
        `Ya le pagaste todo${to}.${last ? ` El último pago fue el ${formatDayMonth(last)}.` : ''}`,
      ],
    })
  }

  if (doc.paymentStatus === 'partial') {
    const percent = Math.round(pct(paid, total))
    const rows: HeroMathRow[] = [
      { key: 'total', label: 'Total del papel', cents: total },
      ...active.map((a) => ({
        key: a.id,
        label: `${allocationLabel(a)} del ${formatDayMonth(a.appliedOn)}`,
        cents: a.amountCents,
        op: '−' as const,
      })),
      { key: 'open', label: sales ? 'Falta cobrar' : 'Falta pagar', cents: open, op: '=' as const },
    ]
    return heroOf(
      {
        label: who
          ? `${sales ? 'Te falta cobrarle a' : 'Te falta pagarle a'} ${who}`
          : sales
            ? 'Falta cobrar'
            : 'Falta pagar',
        cents: open,
        sentence: [
          `De ${money(total)} ya ${sales ? 'cobraste' : 'pagaste'} ${money(paid)}: ${due}`,
        ],
        meter: {
          valueCents: paid,
          totalCents: total,
          label: sales ? 'Cobrado' : 'Pagado',
          tone: sales ? 'in' : 'default',
          text: `${sales ? 'Cobraste' : 'Pagaste'} el ${percentLabel(percent, paid > 0)}`,
        },
        explain: { rows, note: null },
      },
      { action, help },
    )
  }

  // Sin nada anotado.
  return heroOf(
    {
      label: who
        ? `${sales ? 'Te debe' : 'Le debés a'} ${who}`
        : sales
          ? 'Falta cobrar'
          : 'Falta pagar',
      cents: open > 0 ? open : total,
      sentence: [`Todavía no hay ningún ${sales ? 'cobro' : 'pago'} anotado: ${due}`],
    },
    { action, help },
  )
}

function closeHero(doc: DocumentDetail, ctx: StoryContext): DocumentHero {
  const m = closeMoney(doc, ctx.today)
  const cash = m.cashWords ?? 'la caja'
  const segments: HeroSplitSegment[] = [
    { key: 'cash', label: `Entró a ${cash}`, cents: m.cashCents, swatch: 'bg-adm-s1' },
    { key: 'arrived', label: 'Ya llegó', cents: m.arrivedCents, swatch: 'bg-adm-s4' },
    {
      key: 'pending',
      label: 'Sigue en camino',
      cents: m.pendingCents,
      swatch: 'bg-adm-neutral',
      hatched: true,
    },
  ]
  const rows: HeroMathRow[] = [{ key: 'sold', label: 'Vendido', cents: m.soldCents }]
  if (m.cashCents > 0) {
    rows.push({ key: 'cash', label: `Entró a ${cash}`, cents: m.cashCents, op: '−' })
  }
  if (m.advanceCents > 0) {
    rows.push({ key: 'advance', label: 'Ya cobrado como seña', cents: m.advanceCents, op: '−' })
  }
  if (m.diffCents > 0) {
    rows.push({ key: 'diff', label: 'Faltó en la caja', cents: m.diffCents, op: '−' })
  } else if (m.diffCents < 0) {
    rows.push({ key: 'diff', label: 'Sobró en la caja', cents: -m.diffCents, op: '+' })
  }
  rows.push({ key: 'arrived', label: 'Ya llegó', cents: m.arrivedCents, op: '−' })
  rows.push({ key: 'pending', label: 'Sigue en camino', cents: m.pendingCents, op: '=' })

  const canCollect = ctx.canWrite && isLive(doc) && m.pendingCents > 0
  return heroOf(
    {
      label: 'Se vendió',
      cents: m.soldCents,
      sentence: [closeSentence(m)],
      split: m.incomingCents > 0 ? segments.filter((s) => s.cents > 0) : null,
      explain:
        m.incomingCents > 0
          ? { rows, note: 'Lo que está en camino todavía no es plata en mano.' }
          : null,
    },
    // Cada renglón del mapa tiene su «Ya llegó», con su partida elegida: este abre la hoja en blanco.
    { action: canCollect ? { action: 'cobrar', label: 'Me entró plata', params: {} } : null },
  )
}

function collectionHero(doc: DocumentDetail): DocumentHero {
  const inLines = treasuryLines(doc).filter((l) => l.side === 'debit')
  const where = treasuryWords(inLines)
  const entered = sumOf(inLines)
  const deductions = sumOf(doc.lines.filter((l) => l.role === 'deduction'))
  const gross = sumOf(doc.lines.filter((l) => l.role === 'control' && l.side === 'credit'))
  const who = doc.partyName ?? 'quien te pagó'
  const label = where ? `Entraron a ${clip(where, LABEL_NAME_MAX)}` : 'Cobro'
  const cents = where ? entered : doc.totalCents

  if (doc.countedCents !== null && doc.expectedBookCents !== null) {
    const base = `Contaste ${money(doc.countedCents)} y el sistema decía ${money(doc.expectedBookCents)}: la diferencia es lo que entró`
    return heroOf({
      label,
      cents,
      sentence: [
        deductions > 0
          ? `${base}, ya sin los ${money(deductions)} que te descontó ${who}.`
          : `${base}.`,
      ],
    })
  }
  if (deductions > 0 && gross > 0) {
    const share = percentLabel(Math.round(pct(deductions, gross)), true)
    return heroOf({
      label,
      cents,
      sentence: [
        `${doc.partyName ?? 'Quien te pagó'} te liquidó ${money(gross)} y te descontó ${money(deductions)} (${share}) entre comisión, impuestos y retenciones.`,
      ],
    })
  }
  const open = doc.openCents ?? 0
  const rest =
    open > 0 ? ` ${money(open)} quedaron a cuenta: todavía no están unidos a ninguna venta.` : ''
  return heroOf({
    label,
    cents,
    sentence: [`Te pagó ${doc.partyName ?? 'alguien que no quedó anotado'}.${rest}`],
  })
}

function paymentHero(doc: DocumentDetail): DocumentHero {
  const outLines = treasuryLines(doc).filter((l) => l.side === 'credit')
  const where = treasuryWords(outLines)
  const label = where ? `Salieron de ${clip(where, LABEL_NAME_MAX)}` : 'Usaste saldo a favor'
  const active = activeAllocations(doc)
  const open = doc.openCents ?? 0
  const to = doc.partyName ? ` a ${doc.partyName}` : ''
  const of = doc.partyName ? ` de ${doc.partyName}` : ''

  if (active.length === 0) {
    return heroOf({
      label,
      cents: doc.totalCents,
      sentence: [`Es un pago a cuenta: todavía no está unido a ninguna factura${of}.`],
    })
  }
  if (open > 0) {
    return heroOf({
      label,
      cents: doc.totalCents,
      sentence: [
        `Para pagarle${to}. Quedaron ${money(open)} a cuenta: se descuentan de la próxima factura.`,
      ],
    })
  }
  const only = active.length === 1 ? active[0] : undefined
  if (only?.otherDocumentId && only.otherDocumentTitle) {
    return heroOf({
      label,
      cents: doc.totalCents,
      sentence: [
        `Para pagarle${to} ${articleFor(only.otherDocumentTitle)} `,
        { id: only.otherDocumentId, text: allocationLabel(only) },
        '.',
      ],
    })
  }
  const count = new Set(active.map((a) => a.otherDocumentId ?? a.id)).size
  return heroOf({
    label,
    cents: doc.totalCents,
    sentence: [count === 1 ? `Para pagarle${to}.` : `Para pagarle${to} ${count} comprobantes.`],
  })
}

/**
 * El número, su oración y el botón del momento. La etiqueta y el número dicen
 * lo que movió («Salieron de Caja · $ 45.000»); lo pendiente manda sobre el
 * total. Vencido NO pinta el número de rojo: el estado va en la píldora.
 */
export function documentHero(doc: DocumentDetail, ctx: StoryContext): DocumentHero {
  if (isVoided(doc)) {
    const who = doc.voidedByName ?? 'alguien del equipo'
    const when = doc.voidedAt ? ` el ${formatDateTime(doc.voidedAt)}` : ''
    const why = doc.voidReason ? `: «${doc.voidReason}»` : ''
    const sentence: Array<string | DocRef> = [
      `Lo anuló ${who}${when}${why}. Ya no cuenta en los libros.`,
    ]
    if (doc.replacedBy) sentence.push(' Lo reemplazó ', refOf(doc.replacedBy), '.')
    return heroOf({ label: 'Anulado', cents: doc.totalCents, sentence }, { muted: true })
  }
  const reversal = liveReversal(doc)
  if (reversal) {
    return heroOf(
      {
        label: 'Anulado con fecha posterior',
        cents: doc.totalCents,
        sentence: [
          `Se anuló el ${formatIsoDay(reversal.accountingDate)} con `,
          refOf(reversal),
          '. Este queda en su mes, que está cerrado.',
        ],
      },
      { muted: true },
    )
  }

  const who = doc.partyName ? clip(doc.partyName, LABEL_NAME_MAX) : null
  const total = doc.totalCents

  switch (doc.kind) {
    case 'purchase':
    case 'purchase_debit_note':
    case 'iva_settlement':
    case 'sales_invoice':
    case 'sales_debit_note':
      // Sin partida que seguir (no debería pasar): se dice lo que es, sin inventar una deuda.
      if (doc.paymentStatus === 'none' || doc.paymentStatus === 'voided') {
        return heroOf({ label: friendlyKind(doc), cents: total, sentence: [] })
      }
      return payablesHero(doc, ctx)

    case 'expense': {
      const lines = treasuryLines(doc)
      const card = lines.length > 0 && lines.every((l) => isCard(l, ctx))
      const where = treasuryWords(lines)
      const category = mainCategory(doc)?.name
      if (card) {
        return heroOf({
          label: `Lo pagaste con ${clip(where ?? 'la tarjeta', LABEL_NAME_MAX)}`,
          cents: total,
          sentence: ['Quedó en la tarjeta: todavía no salió plata de ninguna caja.'],
        })
      }
      return heroOf({
        label: where ? `Salieron de ${clip(where, LABEL_NAME_MAX)}` : 'Gasto',
        cents: total,
        sentence: [`El ${formatDayMonth(doc.issueDate)}${category ? `, en ${category}` : ''}.`],
      })
    }

    case 'bank_expense': {
      const where = treasuryWords(treasuryLines(doc))
      return heroOf({
        label: where ? `Salieron de ${clip(where, LABEL_NAME_MAX)}` : 'Gasto bancario',
        cents: total,
        sentence: ['Comisiones e impuestos que te cobró el banco o la billetera.'],
      })
    }

    case 'purchase_credit_note': {
      // Sin saldo que seguir (no debería pasar): no se afirma que «ya se usó».
      if (doc.openCents === null) {
        return heroOf({ label: friendlyKind(doc), cents: total, sentence: [] })
      }
      const open = doc.openCents
      const used = Math.max(0, total - open)
      if (open <= 0) {
        return heroOf({
          label: 'Ya se usó',
          cents: total,
          sentence: [
            `Se descontó de lo que le debías${doc.partyName ? ` a ${doc.partyName}` : ''}.`,
          ],
        })
      }
      return heroOf({
        label: who ? `A tu favor con ${who}` : 'A tu favor',
        cents: open,
        sentence: [
          used > 0
            ? `De ${money(total)} ya se usaron ${money(used)}. El resto se descuenta solo en el próximo pago que le hagas.`
            : 'Se descuenta sola en el próximo pago que le hagas.',
        ],
      })
    }

    case 'payment':
      return paymentHero(doc)

    case 'sales_close':
      return closeHero(doc, ctx)

    case 'sales_credit_note':
      return heroOf({
        label: who ? `A favor de ${who}` : 'A favor del cliente',
        cents: total,
        sentence: ['Descuenta lo que te debe.'],
      })

    case 'collection':
      return collectionHero(doc)

    case 'transfer': {
      const lines = treasuryLines(doc)
      const from = lines.find((l) => l.side === 'credit')?.treasuryName
      const to = lines.find((l) => l.side === 'debit')?.treasuryName
      return heroOf({
        label: from && to ? `Pasaste de ${from} a ${to}` : 'Moviste plata',
        cents: total,
        sentence: ['No es gasto ni venta: la plata cambió de lugar.'],
      })
    }

    case 'cash_movement': {
      const where = treasuryWords(treasuryLines(doc))
      const direction = movementDirection(doc)
      const other = counterpartName(doc)
      const verb = direction === 'in' ? 'Entraron a' : 'Salieron de'
      return heroOf({
        label: where ? `${verb} ${clip(where, LABEL_NAME_MAX)}` : friendlyKind(doc),
        cents: total,
        sentence: other ? [`${other}.`] : [],
      })
    }

    case 'treasury_adjustment': {
      const where = treasuryWords(treasuryLines(doc)) ?? 'la caja'
      const short =
        doc.countedCents !== null && doc.expectedBookCents !== null
          ? doc.countedCents < doc.expectedBookCents
          : movementDirection(doc) === 'out'
      const counted =
        doc.countedCents !== null && doc.expectedBookCents !== null
          ? [
              `Contaste ${money(doc.countedCents)} y el sistema decía ${money(doc.expectedBookCents)}.`,
            ]
          : []
      return heroOf({
        label: `${short ? 'Faltaban en' : 'Sobraban en'} ${clip(where, LABEL_NAME_MAX)}`,
        cents: total,
        sentence: counted,
      })
    }

    default:
      return heroOf({
        label: documentKindLabel(doc.kind),
        cents: total,
        sentence: ['Es un asiento de los libros: lo arma la contadora o el sistema.'],
      })
  }
}

// ─── ② El papel ──────────────────────────────────────────────────────────────

function closeStamp(doc: DocumentDetail): PaperStamp | null {
  const split = closeTicketProps([doc], { today: doc.accountingDate, arrivals: false }).split
  if (!split) return null
  switch (split.kind) {
    case 'none':
      return { tone: 'sin', text: 'Sin factura' }
    case 'mixed':
      return { tone: 'factura', text: `${split.invoicedPercent} % con factura` }
    case 'all':
      return { tone: 'factura', text: 'Todo con factura' }
    case 'empty':
    case 'over':
      return null
  }
}

/**
 * El sello del papel: el MISMO que mostró la carga (`voucherStamp`). Un cierre
 * del día sella su reparto («Sin factura» · «76 % con factura» · «Todo con
 * factura»), como el ticket del cierre. Sin tipo de comprobante (un pago, un
 * pase entre cajas) no hay sello.
 */
export function documentStamp(doc: DocumentDetail): PaperStamp | null {
  if (doc.kind === 'sales_close') return closeStamp(doc)
  return voucherStamp(doc.voucherType)
}

export type PaperRow = {
  key: string
  label: string
  hint?: string
  cents: number
  /** Un descuento: se muestra restando. */
  minus?: boolean
}

export type DocumentPaper = {
  /** Quién emitió el papel (o qué es, si no hay un tercero). */
  title: string
  /** Qué papel es: «Factura A 0003-00001290», «Pago». `null` si el título ya lo dijo. */
  word: string | null
  /** El día del papel: «12/10/2026». */
  day: string
  /** «CUIT 30-71234567-8». `null`: no hay número que mostrar (nunca «CUIT —»). */
  taxId: string | null
  stamp: PaperStamp | null
  rows: PaperRow[]
  /** Renglones que no entraron (están enteros en «Ver cómo queda en los libros»). */
  more: number
  total: { label: string; cents: number; hint: string | null }
  /** Lo que escribió la persona: el detalle rescatado y la nota tal cual. */
  detail: { extra: string | null; notes: string | null } | null
  /** La letra chica: una oración. */
  note: string | null
  /** «Cargó Lucía · 12/10/2026 21:04 · #2». */
  footer: string
}

const PAPER_MAX_ROWS = 8

function rateText(line: Line): string {
  return line.vatRateBp === null ? '' : ` ${vatRateLabel(line.vatRateBp)}`
}

/** Renglones iguales (misma categoría, rol y alícuota) se suman. */
function mergeRows(entries: ReadonlyArray<{ group: string; row: PaperRow }>): {
  rows: PaperRow[]
  more: number
} {
  const byGroup = new Map<string, PaperRow>()
  for (const { group, row } of entries) {
    const found = byGroup.get(group)
    if (found) found.cents += row.cents
    else byGroup.set(group, { ...row })
  }
  const all = [...byGroup.values()]
  return {
    rows: all.slice(0, PAPER_MAX_ROWS),
    more: Math.max(0, all.length - PAPER_MAX_ROWS),
  }
}

function lineGroup(line: Line, extra = ''): string {
  return [
    line.role,
    line.accountId,
    line.vatRateBp ?? '',
    line.taxKind ?? '',
    line.side,
    extra,
  ].join('|')
}

function purchaseRows(doc: DocumentDetail): Array<{ group: string; row: PaperRow }> {
  const netAccounts = new Set(
    doc.lines.filter((l) => BASE_ROLES.has(l.role)).map((l) => l.accountId),
  )
  const creditNote = doc.kind === 'purchase_credit_note'
  const taxLabels = doc.lines.filter((l) => TAX_ROLES.has(l.role)).map((l) => l.roleLabel)
  const out: Array<{ group: string; row: PaperRow }> = []
  for (const line of doc.lines) {
    if (BASE_ROLES.has(line.role)) {
      const hint =
        line.role === 'net'
          ? `Neto${rateText(line)}`
          : line.role === 'non_taxed'
            ? 'No gravado'
            : line.role === 'exempt'
              ? 'Exento'
              : undefined
      out.push({
        group: lineGroup(line),
        row: {
          key: line.id,
          label: line.accountName || line.roleLabel,
          hint,
          cents: line.amountCents,
        },
      })
    } else if (line.role === 'vat') {
      out.push({
        group: lineGroup(line),
        row: {
          key: line.id,
          label: `IVA${rateText(line)}`,
          // Las dos frases del ticket de «Nuevo gasto». Una nota de crédito no recupera nada.
          hint: creditNote
            ? undefined
            : netAccounts.has(line.accountId)
              ? 'Va al costo'
              : 'Lo recuperás',
          cents: line.amountCents,
        },
      })
    } else if (TAX_ROLES.has(line.role)) {
      const repeated = taxLabels.filter((label) => label === line.roleLabel).length > 1
      const hint = line.certificateNumber
        ? `Certificado ${line.certificateNumber}`
        : (line.reference ?? (repeated ? line.accountName : undefined))
      out.push({
        group: lineGroup(line, line.certificateNumber ?? line.reference ?? ''),
        row: {
          key: line.id,
          label: line.roleLabel,
          hint: hint || undefined,
          cents: line.amountCents,
        },
      })
    }
  }
  return out
}

function salesRows(doc: DocumentDetail): Array<{ group: string; row: PaperRow }> {
  const out: Array<{ group: string; row: PaperRow }> = []
  for (const line of doc.lines) {
    if (line.role === 'control' || line.role === 'treasury' || line.role === 'receivable') continue
    if (line.role === 'vat') {
      out.push({
        group: lineGroup(line),
        row: { key: line.id, label: `IVA${rateText(line)}`, cents: line.amountCents },
      })
    } else if (TAX_ROLES.has(line.role)) {
      out.push({
        group: lineGroup(line),
        row: { key: line.id, label: line.roleLabel, cents: line.amountCents },
      })
    } else {
      out.push({
        group: lineGroup(line),
        row: {
          key: line.id,
          label: line.accountName || line.roleLabel,
          hint: 'Neto',
          cents: line.amountCents,
        },
      })
    }
  }
  return out
}

function counterpartHint(line: Line): string | undefined {
  const memo = line.memo?.trim()
  if (!memo) return undefined
  const same = [line.accountName, line.treasuryName, line.roleLabel].some(
    (v) => norm(v) === norm(memo),
  )
  return same ? undefined : memo
}

/** El pasado de `ticketTotalLabel` de «Nuevo gasto»: «Salieron de Caja» / «Con Visa». */
function paidFromLabel(doc: DocumentDetail, ctx: Pick<StoryContext, 'treasuryKinds'>): string {
  const lines = treasuryLines(doc)
  const where = treasuryWords(lines)
  if (!where) return 'Total'
  const name = clip(where, TOTAL_NAME_MAX)
  return lines.every((l) => isCard(l, ctx)) ? `Con ${name}` : `Salieron de ${name}`
}

function paperBody(
  doc: DocumentDetail,
  ctx: Pick<StoryContext, 'treasuryKinds'>,
): Pick<DocumentPaper, 'rows' | 'more' | 'total'> {
  const total = doc.totalCents
  const plain = (line: Line, label: string, hint?: string): { group: string; row: PaperRow } => ({
    group: lineGroup(line, label),
    row: { key: line.id, label, hint, cents: line.amountCents },
  })

  if (PURCHASE_PAPER_KINDS.has(doc.kind)) {
    const merged = mergeRows(purchaseRows(doc))
    if (doc.kind === 'purchase_credit_note') {
      return {
        ...merged,
        total: {
          label: 'A tu favor',
          cents: total,
          hint: doc.partyName ? `Descuenta lo que le debés a ${doc.partyName}` : null,
        },
      }
    }
    if (doc.kind === 'expense' || doc.kind === 'bank_expense') {
      return { ...merged, total: { label: paidFromLabel(doc, ctx), cents: total, hint: null } }
    }
    return {
      ...merged,
      total: {
        label: 'Total',
        cents: total,
        hint: doc.dueDate ? `Vence el ${formatDayMonth(doc.dueDate)}` : null,
      },
    }
  }

  if (SALES_PAPER_KINDS.has(doc.kind)) {
    const who = doc.partyName
    return {
      ...mergeRows(salesRows(doc)),
      total: {
        label: 'Total',
        cents: total,
        hint: !who
          ? null
          : doc.kind === 'sales_credit_note'
            ? `A favor de ${who}`
            : `A cobrarle a ${who}`,
      },
    }
  }

  switch (doc.kind) {
    case 'payment': {
      const entries = doc.lines.flatMap((line) => {
        if (line.role === 'treasury') {
          return [
            plain(line, `Salió de ${line.treasuryName ?? 'una caja'}`, line.reference ?? undefined),
          ]
        }
        if (
          line.role === 'deduction' ||
          line.role === 'write_off' ||
          line.role === 'compensation'
        ) {
          return [plain(line, line.roleLabel)]
        }
        return []
      })
      return { ...mergeRows(entries), total: { label: 'Total pagado', cents: total, hint: null } }
    }

    case 'collection': {
      const entries: Array<{ group: string; row: PaperRow }> = []
      if (doc.expectedBookCents !== null && doc.countedCents !== null) {
        entries.push(
          {
            group: 'expected',
            row: { key: 'expected', label: 'Según el sistema había', cents: doc.expectedBookCents },
          },
          { group: 'counted', row: { key: 'counted', label: 'Contaste', cents: doc.countedCents } },
        )
      }
      const gross = sumOf(doc.lines.filter((l) => l.role === 'control' && l.side === 'credit'))
      if (gross > 0) {
        entries.push({
          group: 'gross',
          row: { key: 'gross', label: 'Te liquidaron', cents: gross },
        })
      }
      for (const line of doc.lines) {
        if (line.role === 'deduction') {
          entries.push({
            group: ['deduction', line.accountId, line.taxKind ?? ''].join('|'),
            row: { key: line.id, label: line.roleLabel, cents: line.amountCents, minus: true },
          })
        } else if (line.role === 'write_off' || line.role === 'compensation') {
          entries.push(plain(line, line.roleLabel))
        }
      }
      const inLines = treasuryLines(doc).filter((l) => l.side === 'debit')
      const where = treasuryWords(inLines)
      return {
        ...mergeRows(entries),
        total: where
          ? {
              label: `Entraron a ${clip(where, TOTAL_NAME_MAX)}`,
              cents: sumOf(inLines),
              hint: null,
            }
          : { label: 'Total', cents: total, hint: null },
      }
    }

    case 'transfer': {
      const lines = treasuryLines(doc)
      // Primero de dónde salió, después a dónde entró.
      const entries = [
        ...lines
          .filter((line) => line.side === 'credit')
          .map((line) =>
            plain(line, `Salió de ${line.treasuryName ?? 'una caja'}`, line.reference ?? undefined),
          ),
        ...lines
          .filter((line) => line.side === 'debit')
          .map((line) =>
            plain(line, `Entró a ${line.treasuryName ?? 'una caja'}`, line.reference ?? undefined),
          ),
      ]
      return { ...mergeRows(entries), total: { label: 'Total movido', cents: total, hint: null } }
    }

    case 'cash_movement': {
      // Los renglones dicen en qué fue; el total, de dónde salió o a dónde entró (si no, los
      // dos lados del mismo importe se leen como una suma).
      const notes = norm(doc.notes)
      const entries = doc.lines
        .filter((line) => line.role !== 'treasury')
        .map((line) => {
          const hint = counterpartHint(line)
          return plain(
            line,
            line.accountName || line.roleLabel,
            hint && norm(hint) !== notes ? hint : undefined,
          )
        })
      const lines = treasuryLines(doc)
      const where = treasuryWords(lines)
      const label = !where
        ? 'Total'
        : `${movementDirection(doc) === 'in' ? 'Entraron a' : 'Salieron de'} ${clip(where, TOTAL_NAME_MAX)}`
      return { ...mergeRows(entries), total: { label, cents: total, hint: null } }
    }

    case 'treasury_adjustment': {
      const entries: Array<{ group: string; row: PaperRow }> = []
      if (doc.expectedBookCents !== null) {
        entries.push({
          group: 'expected',
          row: { key: 'expected', label: 'Según el sistema había', cents: doc.expectedBookCents },
        })
      }
      if (doc.countedCents !== null) {
        entries.push({
          group: 'counted',
          row: { key: 'counted', label: 'Contaste', cents: doc.countedCents },
        })
      }
      for (const line of doc.lines) {
        if (line.role === 'treasury') continue
        entries.push(plain(line, line.accountName || 'Diferencia', counterpartHint(line)))
      }
      return { ...mergeRows(entries), total: { label: 'Diferencia', cents: total, hint: null } }
    }

    default: {
      // Asientos de los libros: cada renglón con su lado. Enteros están en «los libros».
      const entries = doc.lines.map((line) =>
        plain(line, line.accountName || line.roleLabel, line.side === 'debit' ? 'Debe' : 'Haber'),
      )
      return { ...mergeRows(entries), total: { label: 'Total', cents: total, hint: null } }
    }
  }
}

function liveFiscal(doc: Pick<DocumentDetail, 'fiscalVouchers'>): FiscalVoucherDetail[] {
  return doc.fiscalVouchers.filter((v) => !v.voided && !v.isReversal)
}

function voucherFamily(voucherType: string | null): string | null {
  return isVoucherType(voucherType) ? VOUCHER_CATALOG[voucherType].family : null
}

/**
 * La letra chica: qué pasó con el Libro IVA, o por qué este papel no es un
 * gasto ni una venta nuevos. Son tres niveles y no dos: sin factura (no entra
 * al Libro IVA), con papel pero con el IVA al costo, y con IVA que se recupera.
 */
export function paperNote(doc: DocumentDetail): string | null {
  switch (doc.kind) {
    case 'payment':
      return 'Es solo el pago: lo que compraste ya está contado en la factura.'
    case 'collection':
      return 'Es plata de ventas que ya estaban contadas: no suma como venta de nuevo.'
    case 'transfer':
      return 'No es gasto ni venta: la plata cambió de lugar.'
    case 'sales_close':
      return 'Con factura o sin factura, todo queda registrado en los libros.'
    default:
      break
  }
  const family = voucherFamily(doc.voucherType)
  if (family === 'sin_comprobante') {
    return 'Quedó en tus números, sin factura. No entra al Libro IVA.'
  }
  if (family === 'ddjj') return 'Es un impuesto: no va al Libro IVA.'
  const row = liveFiscal(doc)[0]
  if (row) {
    const month = monthName(Number(row.periodMonth.slice(5, 7)))
    if (row.book === 'sales') return `Entró al Libro IVA ventas de ${month}.`
    if (doc.kind === 'purchase_credit_note') return `Entró al Libro IVA de ${month}.`
    return ivaSummary(row.amounts).computableCents > 0
      ? `Entró al Libro IVA de ${month} y recuperás el IVA.`
      : `Entró al Libro IVA de ${month}. El IVA fue al costo.`
  }
  if (family === 'tique' && isLive(doc)) {
    return 'Quedó como gasto con tique. Sin comercio o sin número no entra al Libro IVA.'
  }
  return null
}

/** «CUIT 30-71234567-8»; con otro largo, «Doc. …». `null` si no hay (nunca «CUIT —»). */
function taxIdText(docNumber: string | null): string | null {
  if (!docNumber || docNumber === '0') return null
  return docNumber.length === 11 ? `CUIT ${formatCuit(docNumber)}` : `Doc. ${docNumber}`
}

/** «Cargó Lucía · 12/10/2026 21:04 · #2»: el «cajero» del tique. */
export function paperFooter(
  doc: Pick<DocumentDetail, 'createdByName' | 'createdAt' | 'seq'>,
): string {
  return [
    `Cargó ${doc.createdByName || 'alguien del equipo'}`,
    formatDateTime(doc.createdAt),
    `#${doc.seq}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Lo que escribió la persona al cargar; `null` si no escribió nada. */
export function paperDetail(doc: DocumentDetail): DocumentPaper['detail'] {
  const extra = descriptionExtra(doc)
  const notes = doc.notes?.trim() || null
  // Un gasto ya lleva su detalle en el título: en el papel va igual (es lo que escribió).
  return extra === null && notes === null ? null : { extra, notes }
}

/**
 * El papel, como quedó guardado: el mismo que se vio antes de guardar. No vale
 * para el cierre del día, que tiene su propio ticket (`CloseTicket` con
 * `closeTicketProps`): de acá el cierre toma solo el detalle y el pie.
 */
export function documentPaper(
  doc: DocumentDetail,
  ctx: Pick<StoryContext, 'treasuryKinds'>,
): DocumentPaper {
  const category = doc.kind === 'expense' ? mainCategory(doc)?.name : null
  const treasury = treasuryLines(doc)[0]?.treasuryName ?? null
  const kindTitle =
    doc.kind === 'treasury_adjustment' && treasury ? `Conteo de ${treasury}` : friendlyKind(doc)
  const title = doc.partyName ?? category ?? kindTitle
  const hasVoucher = Boolean(doc.voucherType) && doc.voucherType !== 'sin_comprobante'
  const word = hasVoucher ? doc.title : friendlyKind(doc)
  return {
    title,
    word: norm(word) === norm(title) ? null : word,
    day: formatIsoDay(doc.issueDate),
    taxId: taxIdText(doc.partyDocNumber),
    stamp: documentStamp(doc),
    ...paperBody(doc, ctx),
    detail: paperDetail(doc),
    note: paperNote(doc),
    footer: paperFooter(doc),
  }
}

// ─── ③ Con qué está unido ────────────────────────────────────────────────────

/** `auto`: se une solo · `you`: lo unís vos · `none`: no es una unión (otros papeles). */
export type LinkHow = 'auto' | 'you' | 'none'
/** `linked` unido · `missing` falta · `ask` vale preguntarlo · `off` no aplica y vale decirlo. */
export type LinkState = 'linked' | 'missing' | 'ask' | 'off'

type NodeBase = {
  /** El nombre fijo de la unión: «Pago», «Foto», «Libro IVA». */
  what: string
  how: LinkHow
  state: LinkState
  /** El límite que explica la guía (`#vinculo-…`), si esta unión tiene uno. */
  limit: GuideLinkId | null
}

export type TreasuryRow = {
  key: string
  direction: 'in' | 'out'
  /** «Salió de Caja» · «Entró a Banco Nación» · «Quedó en Visa». */
  text: string
  treasuryId: string | null
  cents: number
  reference: string | null
}

/** Lo que hace falta para ofrecer «Separar» en una unión. */
export type SeparateInfo = {
  allocationId: string
  /** «Pago #6». */
  paymentLabel: string
  /** «Factura A 0003-00001100». */
  invoiceLabel: string
  amountCents: number
  partyName: string | null
}

export type AllocationRow = {
  key: string
  /** El otro comprobante. `null`: una unión hecha a mano. */
  documentId: string | null
  label: string
  /** «el 03/10/2026»: cuándo se unió. `null` si esa fecha confundiría con la del otro papel. */
  meta: string | null
  cents: number
  /** «Se cargó junto con esta compra.» */
  note: string | null
  separate: SeparateInfo | null
}

export type IncomingAction = { label: string; params: ActionParams }

export type LinkNode =
  | (NodeBase & { id: 'caja'; rows: TreasuryRow[] })
  | (NodeBase & {
      id: 'pago'
      rows: AllocationRow[]
      /** «Pago #6 · $ 500.000 · separado el 03/10/2026: quedó a cuenta.» */
      separated: string[]
      /** Sin ninguna unión: qué falta y qué va a pasar. */
      empty: { title: string; hint: string } | null
      /** «Falta pagar $ 710.000». */
      footer: string | null
      note: string | null
    })
  | (NodeBase & {
      id: 'aplicado'
      /** La factura que corrige una nota de crédito. */
      corrects: DocRef | null
      rows: AllocationRow[]
      /** Lo que no entra a la vista (se abre con «y N más»). */
      more: AllocationRow[]
      separated: string[]
      empty: { title: string; hint: string } | null
      /** Lo que quedó sin unir. */
      rest: {
        title: string
        hint: string
        partyId: string | null
        partyName: string | null
        side: 'supplier' | 'customer' | null
      } | null
    })
  | (NodeBase & {
      id: 'en-camino'
      cash: TreasuryRow[]
      rows: Array<CloseIncomingRow & { action: IncomingAction | null }>
      /** «Con qué llegó»: un renglón por comprobante. */
      arrivals: AllocationRow[]
    })
  | (NodeBase & {
      id: 'gasto-fijo'
      /** El renglón de la planilla. `null`: no hay a dónde llevar. */
      recurringId: string | null
      /** El nombre, o la pregunta «¿Era «Alquiler del local»? …». */
      title: string
      text: string
      /** «Ir a Gastos fijos»: en la pregunta y cuando no se pudo leer el nombre. */
      listLink: boolean
    })
  | (NodeBase & {
      id: 'foto'
      /** Quien carga puede sumar y quitar. */
      canEdit: boolean
      /** La lista no se pudo leer. */
      error: boolean
      /** Qué foto conviene, cuando falta. */
      emptyText: string
    })
  | (NodeBase & {
      id: 'importado'
      batchId: string
      /** «Archivo de ARCA». */
      title: string
      text: string
      note: string | null
    })
  | (NodeBase & {
      id: 'libro-iva'
      groups: IvaGroup[]
      /** Sin fila en el Libro IVA: por qué. */
      off: { title: string; hint: string | null; guide: boolean } | null
    })
  | (NodeBase & { id: 'arca' })
  | (NodeBase & { id: 'otros'; rows: Array<{ key: string; rich: Rich }> })
  | (NodeBase & {
      id: 'libros'
      entryId: string
      /** «Asiento N° 21, provisorio». */
      title: string
      /** «Octubre 2026: abierto. El número queda fijo al cerrar el mes.» */
      period: { text: string; closed: boolean } | null
      facts: string[]
      /** Solo para la contadora: «Común · 12/10/2026». */
      detail: string | null
    })

export type LinkNodeId = LinkNode['id']

export type IvaVoucherView = {
  id: string
  /** «Factura A 0003-00001290», «0003-00000101 a 0003-00000150». */
  label: string
  date: string
  counterparty: string
  netCents: number
  vatCents: number
  perceptionsCents: number
  otherCents: number
  totalCents: number
  /** Lo que se ve sin abrir: «Neto» e «IVA», o el «Total» si el papel no discrimina IVA. */
  summary: Array<{ label: string; cents: number }>
  reversal: boolean
  voided: boolean
}

export type IvaGroup = {
  key: string
  book: 'purchases' | 'sales'
  /** `yyyy-MM`, para el link al libro. */
  month: string
  /** «Libro IVA compras de octubre 2026». */
  title: string
  vouchers: IvaVoucherView[]
}

const SEPARABLE_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_debit_note',
  'payment',
])

/**
 * ¿Se ofrece «Separar» en esta unión? Solo a quien carga, del lado de las
 * compras, sobre un comprobante y una unión vigentes, y solo si la unión se
 * hizo después (un pago que se guardó junto con su compra se deshace anulando;
 * una nota de crédito sigue diciendo «Corrige a…»; las de una anulación las
 * protege la base).
 */
export function canSeparate(
  doc: Pick<DocumentDetail, 'kind' | 'status' | 'reversedBy' | 'bundleSiblings'>,
  allocation: Pick<AllocationDetail, 'kind' | 'voidedOn' | 'otherDocumentId'>,
  canWrite: boolean,
): boolean {
  if (!canWrite || !isLive(doc)) return false
  if (!SEPARABLE_KINDS.has(doc.kind)) return false
  if (allocation.voidedOn !== null) return false
  if (allocation.kind !== 'payment' && allocation.kind !== 'manual') return false
  const other = allocation.otherDocumentId
  return !(other && doc.bundleSiblings.some((s) => s.id === other))
}

/**
 * Los gastos fijos de este mes que siguen sin cargar y se parecen a este
 * comprobante: mismo proveedor o, si el gasto fijo no tiene proveedor, misma
 * categoría. Es para preguntar «¿Era el alquiler?»: cargarlo como un gasto
 * cualquiera deja mal «Te falta de gasto fijo» y hoy nadie lo avisa.
 */
export function recurringCandidates(
  doc: Pick<
    DocumentDetail,
    'kind' | 'status' | 'reversedBy' | 'recurringExpenseId' | 'accountingDate' | 'partyId' | 'lines'
  >,
  rows: readonly RecurringExpenseRow[],
  today: string,
): RecurringExpenseRow[] {
  if (doc.kind !== 'purchase' && doc.kind !== 'expense') return []
  if (!isLive(doc) || doc.recurringExpenseId) return []
  if (doc.accountingDate.slice(0, 7) !== today.slice(0, 7)) return []
  const category = mainCategory(doc)?.id ?? null
  return rows.filter((row) => {
    if (!row.active || row.monthStatus !== 'pending') return false
    if (row.partyId) return doc.partyId !== null && row.partyId === doc.partyId
    return category !== null && row.accountId === category
  })
}

function allocationRow(
  doc: DocumentDetail,
  a: AllocationDetail,
  ctx: Pick<StoryContext, 'canWrite'>,
  /** La fecha de la unión: vale en lo que llegó (un pago, un cobro), no en lo que se canceló. */
  dated = true,
): AllocationRow {
  const label = allocationLabel(a)
  const bundled = Boolean(
    a.otherDocumentId && doc.bundleSiblings.some((s) => s.id === a.otherDocumentId),
  )
  const isPayment = doc.kind === 'payment'
  const mine = hasNumber(doc.title) ? doc.title : `${friendlyKind(doc)} #${doc.seq}`
  return {
    key: a.id,
    documentId: a.otherDocumentId,
    label,
    meta: dated ? `el ${formatIsoDay(a.appliedOn)}` : null,
    cents: a.amountCents,
    note: bundled
      ? isPayment
        ? 'Se cargó junto con este pago.'
        : 'Se cargó junto con esta compra.'
      : null,
    separate: canSeparate(doc, a, ctx.canWrite)
      ? {
          allocationId: a.id,
          paymentLabel: isPayment ? `Pago #${doc.seq}` : label,
          invoiceLabel: isPayment ? label : mine,
          amountCents: a.amountCents,
          partyName: doc.partyName,
        }
      : null,
  }
}

function separatedText(a: AllocationDetail): string {
  const when = a.voidedOn ? formatIsoDay(a.voidedOn) : ''
  return `${allocationLabel(a)} · ${formatCents(a.amountCents)} · separado el ${when}: quedó a cuenta.`
}

/** Los renglones de caja de un comprobante que no es un cierre. */
function treasuryRows(
  doc: DocumentDetail,
  ctx: Pick<StoryContext, 'treasuryKinds'>,
): TreasuryRow[] {
  const byKey = new Map<string, TreasuryRow>()
  for (const line of treasuryLines(doc)) {
    const direction = line.side === 'debit' ? 'in' : 'out'
    const key = `${line.treasuryAccountId ?? line.id}|${direction}`
    const name = line.treasuryName ?? 'una caja'
    const found = byKey.get(key)
    if (found) {
      found.cents += line.amountCents
      continue
    }
    byKey.set(key, {
      key,
      direction,
      text:
        direction === 'in'
          ? `Entró a ${name}`
          : isCard(line, ctx)
            ? `Quedó en ${name}`
            : `Salió de ${name}`,
      treasuryId: line.treasuryAccountId,
      cents: line.amountCents,
      reference: line.reference,
    })
  }
  // Primero de dónde salió, después a dónde entró (un pase entre cajas se lee en ese orden).
  return [...byKey.values()].sort(
    (a, b) => Number(a.direction === 'in') - Number(b.direction === 'in'),
  )
}

/** Los que rara vez tienen un papel para fotografiar: la foto se ofrece, pero no «falta». */
const PHOTO_OPTIONAL: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'opening',
  'manual',
  'iva_settlement',
  'treasury_adjustment',
])

/** Qué foto conviene sumar, según el papel. Nunca se confunde «sin foto» con «sin factura». */
export function photoHint(doc: Pick<DocumentDetail, 'kind' | 'voucherType'>): string {
  const tail = 'No cambia ningún número: es el respaldo si un día te lo piden.'
  if (PHOTO_OPTIONAL.has(doc.kind)) {
    return `Si hay un papel de respaldo, subilo acá. ${tail}`
  }
  const lead = (() => {
    if (doc.voucherType === 'sin_comprobante') {
      return 'Aunque sea sin factura, la foto del remito o del papelito sirve de respaldo.'
    }
    switch (doc.kind) {
      case 'payment':
      case 'transfer':
        return 'Subí el comprobante de la transferencia o el recibo.'
      case 'sales_close':
        return 'Sacale una foto al cierre de caja y al cierre de lote del posnet.'
      case 'collection':
        return 'Subí la liquidación.'
      case 'bank_expense':
      case 'cash_movement':
        return 'Subí el comprobante o el resumen donde figura.'
      default:
        return 'Sacale una foto a la factura, el tique o el remito, o subí el PDF.'
    }
  })()
  return `${lead} ${tail}`
}

const IMPORT_SHORT: Readonly<Record<string, string>> = {
  arca_recibidos: 'ARCA',
  arca_emitidos: 'ARCA',
  mp_release: 'Mercado Pago',
  bank_statement: 'Banco',
}

function voucherNumberText(v: FiscalVoucherDetail): string {
  const number =
    v.numberTo !== null && v.numberTo !== v.numberFrom
      ? formatVoucherRange(v.pointOfSale, v.numberFrom, v.numberTo)
      : formatVoucherNumber(v.pointOfSale, v.numberFrom)
  const label = isVoucherType(v.voucherType) ? VOUCHER_CATALOG[v.voucherType].label : ''
  return `${label} ${number}`.trim()
}

function ivaGroups(doc: Pick<DocumentDetail, 'fiscalVouchers'>): IvaGroup[] {
  const groups = new Map<string, IvaGroup>()
  for (const v of doc.fiscalVouchers) {
    const month = v.periodMonth.slice(0, 7)
    const key = `${v.book}|${month}`
    const summary = ivaSummary(v.amounts)
    const view: IvaVoucherView = {
      id: v.id,
      label: voucherNumberText(v),
      date: v.voucherDate,
      counterparty: v.counterpartyName || 'Consumidor final',
      netCents: summary.netCents,
      vatCents: summary.vatCents,
      perceptionsCents: summary.perceptionsCents,
      otherCents: summary.otherCents,
      totalCents: summary.totalCents,
      summary:
        summary.netCents !== 0 || summary.vatCents !== 0
          ? [
              { label: 'Neto', cents: summary.netCents },
              { label: 'IVA', cents: summary.vatCents },
            ]
          : [{ label: 'Total, con el IVA adentro', cents: summary.totalCents }],
      reversal: v.isReversal,
      voided: v.voided,
    }
    const found = groups.get(key)
    if (found) found.vouchers.push(view)
    else {
      groups.set(key, {
        key,
        book: v.book,
        month,
        title: `Libro IVA ${v.book === 'purchases' ? 'compras' : 'ventas'} de ${formatMonthLabel(month).toLocaleLowerCase('es')}`,
        vouchers: [view],
      })
    }
  }
  return [...groups.values()]
}

function ivaNode(doc: DocumentDetail): Extract<LinkNode, { id: 'libro-iva' }> | null {
  const base = { id: 'libro-iva' as const, what: 'Libro IVA', how: 'auto' as const, limit: null }
  const groups = ivaGroups(doc)
  if (groups.length > 0) {
    const live = doc.fiscalVouchers.some((v) => !v.voided)
    return { ...base, state: live ? 'linked' : 'off', groups, off: null }
  }
  const family = voucherFamily(doc.voucherType)
  if (family === 'sin_comprobante') {
    return {
      ...base,
      state: 'off',
      groups,
      off: {
        title: 'No entra al Libro IVA.',
        hint: 'Es sin factura. Queda en tus números igual.',
        guide: true,
      },
    }
  }
  if (family === 'tique') {
    return {
      ...base,
      state: 'off',
      groups,
      off: {
        title: 'No entró al Libro IVA.',
        hint: isLive(doc)
          ? 'Le falta el comercio o el número. Para que entre, anulalo y cargalo con esos datos.'
          : null,
        guide: false,
      },
    }
  }
  if (family === 'ddjj') {
    return {
      ...base,
      state: 'off',
      groups,
      off: { title: 'No va al Libro IVA: es un impuesto.', hint: null, guide: false },
    }
  }
  if (doc.kind === 'sales_close') {
    return {
      ...base,
      state: 'off',
      groups,
      off: {
        title: 'No entra al Libro IVA.',
        hint: 'Todo lo de este día fue sin factura. Queda en tus números igual.',
        guide: true,
      },
    }
  }
  return null
}

function booksNode(
  doc: DocumentDetail,
  ctx: Pick<StoryContext, 'canWrite'>,
): Extract<LinkNode, { id: 'libros' }> | null {
  const entry = doc.entry
  if (!entry) return null
  // El mismo número que el diario y la página del asiento (provisorio mientras el mes está abierto).
  const title =
    entry.number !== null
      ? `Asiento N° ${entry.number}`
      : entry.status === 'voided'
        ? 'Asiento anulado'
        : entry.provisionalNumber !== null
          ? `Asiento N° ${entry.provisionalNumber}, provisorio`
          : 'Asiento sin número todavía'
  let period: { text: string; closed: boolean } | null = null
  if (doc.period) {
    const year = doc.period.month.slice(0, 4)
    const name =
      doc.period.kind === 'fy_adjustments'
        ? `Ajustes de cierre ${year}`
        : doc.period.kind === 'fy_opening'
          ? `Apertura ${year}`
          : formatMonthLabel(doc.period.month)
    const closed = doc.period.status === 'closed'
    const numbering =
      !closed && entry.number === null && entry.status !== 'voided'
        ? ' El número queda fijo al cerrar el mes.'
        : ''
    period = { text: `${name}: ${closed ? 'cerrado' : 'abierto'}.${numbering}`, closed }
  }
  const facts: string[] = []
  if (doc.accountingDate !== doc.issueDate) {
    facts.push(`En los libros va con fecha ${formatIsoDay(doc.accountingDate)}.`)
  }
  if (doc.overrideReason) {
    facts.push(`Se guardó con un aviso aceptado: «${doc.overrideReason}».`)
  }
  return {
    id: 'libros',
    what: 'Los libros',
    how: 'auto',
    state: 'linked',
    limit: null,
    entryId: entry.id,
    title,
    period,
    facts,
    detail: ctx.canWrite
      ? null
      : `${entryKindLabel(entry.kind)} · ${formatIsoDay(entry.entryDate)}`,
  }
}

function othersNode(doc: DocumentDetail): Extract<LinkNode, { id: 'otros' }> | null {
  const rows: Array<{ key: string; rich: Rich }> = []
  const creditNote = doc.kind === 'purchase_credit_note' || doc.kind === 'sales_credit_note'
  if (doc.replaces) rows.push({ key: 'replaces', rich: ['Reemplaza a ', refOf(doc.replaces), '.'] })
  if (doc.replacedBy) {
    rows.push({ key: 'replacedBy', rich: ['Lo reemplazó ', refOf(doc.replacedBy), '.'] })
  }
  if (doc.reverses) rows.push({ key: 'reverses', rich: ['Anula a ', refOf(doc.reverses), '.'] })
  if (doc.reversedBy) {
    rows.push({
      key: 'reversedBy',
      rich: [
        'Lo anuló ',
        refOf(doc.reversedBy),
        ` el ${formatIsoDay(doc.reversedBy.accountingDate)}${
          doc.reversedBy.status === 'voided' ? ' (esa anulación después se anuló)' : ''
        }.`,
      ],
    })
  }
  if (doc.corrects) rows.push({ key: 'corrects', rich: ['Corrige a ', refOf(doc.corrects), '.'] })
  // La factura que corrige una nota de crédito ya va primera en «Qué descontó».
  if (doc.related && !creditNote) {
    rows.push({ key: 'related', rich: ['Corresponde a ', refOf(doc.related), '.'] })
  }
  if (doc.bundleSiblings.length > 0) {
    const rich: Array<string | DocRef> = ['Se guardó junto con ']
    doc.bundleSiblings.forEach((sibling, index) => {
      if (index > 0) rich.push(', ')
      rich.push(refOf(sibling))
      if (sibling.status === 'voided') rich.push(' (anulado)')
    })
    rich.push('.')
    rows.push({ key: 'bundle', rich })
  }
  return rows.length > 0
    ? { id: 'otros', what: 'Otros papeles', how: 'none', state: 'linked', limit: null, rows }
    : null
}

function recurringNode(
  doc: DocumentDetail,
  ctx: StoryContext,
): Extract<LinkNode, { id: 'gasto-fijo' }> | null {
  if (doc.kind !== 'purchase' && doc.kind !== 'expense') return null
  const base = { id: 'gasto-fijo' as const, what: 'Gasto fijo', how: 'you' as const }
  if (doc.recurringExpenseId) {
    const row = ctx.recurring
    if (row && row !== 'error') {
      const mine = row.lastDocumentId === doc.id && row.loadedDue
      return {
        ...base,
        state: 'linked',
        limit: 'gasto-fijo',
        recurringId: row.id,
        title: row.name,
        text: mine
          ? `Con este comprobante quedó cargado el vencimiento del ${formatDayMonth(row.loadedDue)}.`
          : 'Es uno de los comprobantes de este gasto fijo.',
        listLink: false,
      }
    }
    return {
      ...base,
      state: 'linked',
      limit: 'gasto-fijo',
      recurringId: null,
      title: row === null ? 'Un gasto fijo que ya no está en la lista.' : 'Un gasto fijo',
      text: row === null ? '' : 'No pudimos leer cuál. Está en la lista de gastos fijos.',
      listLink: row !== null,
    }
  }
  // La pregunta es para quien puede corregirlo.
  if (!ctx.canWrite || ctx.candidates.length === 0) return null
  const first = ctx.candidates[0]
  if (!first) return null
  const several = ctx.candidates.length > 1
  const group = first.partyId
    ? (doc.partyName ?? 'ese proveedor')
    : `«${mainCategory(doc)?.name ?? 'esa categoría'}»`
  return {
    ...base,
    state: 'ask',
    limit: 'gasto-fijo',
    recurringId: null,
    title: several
      ? `¿Era un gasto fijo? Hay ${ctx.candidates.length} de ${group} sin cargar este mes.`
      : `¿Era «${first.name}»? Vence el ${formatDayMonth(first.nextDueDate)} y sigue sin cargar.`,
    text: 'Eso se elige al cargar: hoy no se puede unir después. Si era, anulá este comprobante y cargalo desde Gastos fijos.',
    listLink: true,
  }
}

/**
 * El mapa de vínculos: cada cosa que este papel tiene unida, o que le falta,
 * en un orden fijo (no se reordena por lo que falta). Un nodo que no aplica a
 * este tipo de comprobante no se dibuja.
 */
export function documentLinks(doc: DocumentDetail, ctx: StoryContext): LinkNode[] {
  const nodes: LinkNode[] = []
  const live = isLive(doc)
  const active = activeAllocations(doc)
  const voided = doc.allocations.filter((a) => a.voidedOn !== null)
  const sales = isSalesSide(doc.kind)

  // 1 · Caja
  if (doc.kind !== 'sales_close') {
    const rows = treasuryRows(doc, ctx)
    if (rows.length > 0) {
      nodes.push({ id: 'caja', what: 'Caja', how: 'auto', state: 'linked', limit: null, rows })
    }
  }

  // 2 · Pago (o cobro): lo que otros comprobantes cancelaron de este
  const owes = PAYABLE_KINDS.has(doc.kind) || RECEIVABLE_KINDS.has(doc.kind)
  const applied =
    doc.kind === 'payment' ||
    doc.kind === 'collection' ||
    doc.kind === 'purchase_credit_note' ||
    doc.kind === 'sales_credit_note'
  const other =
    !owes &&
    !applied &&
    doc.kind !== 'sales_close' &&
    (doc.allocations.length > 0 || doc.openCents !== null)
  if (owes || other) {
    const open = doc.openCents ?? 0
    const empty = active.length === 0
    // Un comprobante anulado ya no espera ningún pago: no le «falta» nada.
    if (!(empty && !live) && !(other && doc.allocations.length === 0)) {
      nodes.push({
        id: 'pago',
        what: other ? 'Pagos y cobros' : sales ? 'Cobro' : 'Pago',
        how: 'you',
        state: empty ? 'missing' : 'linked',
        limit: sales && owes ? 'cierre-cajas' : null,
        rows: active.map((a) => allocationRow(doc, a, ctx)),
        separated: voided.map(separatedText),
        empty: empty
          ? sales
            ? {
                title: 'Sin cobro anotado todavía.',
                hint: 'Cuando te pague, el cobro queda unido acá.',
              }
            : {
                title: 'Sin pago anotado todavía.',
                hint: 'Cuando lo pagues, el pago queda unido acá.',
              }
          : null,
        footer:
          !empty && live && open > 0
            ? `${sales ? 'Falta cobrar' : 'Falta pagar'} ${formatCents(open)}`
            : null,
        note:
          sales && owes && live
            ? 'Para cambiar a qué venta va un cobro, anulá el cobro y cargalo de nuevo.'
            : null,
      })
    }
  }

  // 3 · Qué pagó / de qué ventas es / qué descontó
  if (applied) {
    // Sin fecha: la de la unión no es la de la factura ni la del cierre que canceló.
    const rows = active.map((a) => allocationRow(doc, a, ctx, false))
    const creditNote = doc.kind === 'purchase_credit_note' || doc.kind === 'sales_credit_note'
    const open = live ? (doc.openCents ?? 0) : 0
    const who = doc.partyName
    const collection = doc.kind === 'collection'
    const side = SUPPLIER_SIDE.has(doc.kind)
      ? 'supplier'
      : CUSTOMER_SIDE.has(doc.kind)
        ? 'customer'
        : null
    const emptyText = collection
      ? {
          title: 'No está unido a ninguna venta.',
          hint: `Queda a cuenta${who ? ` de ${who}` : ''} hasta que haya una venta que cubrir.`,
        }
      : {
          title: 'No está unido a ninguna factura.',
          hint: `Queda como saldo a favor${who ? ` con ${who}` : ''} y se usa solo en el próximo pago.`,
        }
    const corrects = creditNote && doc.related ? refOf(doc.related) : null
    const nothing = rows.length === 0 && corrects === null
    if (!(nothing && !live)) {
      nodes.push({
        id: 'aplicado',
        what:
          doc.kind === 'payment' ? 'Qué pagó' : collection ? 'De qué ventas es' : 'Qué descontó',
        how: 'you',
        // Un pago a cuenta es válido: cajita hueca, sin «Falta».
        state: nothing ? 'ask' : 'linked',
        limit: collection && (nothing || open > 0) ? 'cierre-cajas' : null,
        corrects,
        rows: rows.slice(0, 5),
        more: rows.slice(5),
        separated: voided.map(separatedText),
        empty: nothing ? emptyText : null,
        rest:
          !nothing && open > 0
            ? {
                title: `Quedaron ${formatCents(open)} a cuenta`,
                hint: collection
                  ? 'Todavía no están unidos a ninguna venta.'
                  : `Se descuentan solos de la próxima factura${who ? ` de ${who}` : ''}.`,
                partyId: doc.partyId,
                partyName: who,
                side,
              }
            : null,
      })
    }
  }

  // 4 · Cajas y en camino (el cierre del día)
  if (doc.kind === 'sales_close') {
    const m = closeMoney(doc, ctx.today)
    const cash: TreasuryRow[] = []
    for (const line of doc.lines) {
      if (line.role !== 'treasury' || line.side !== 'debit') continue
      const key = line.treasuryAccountId ?? line.id
      const found = cash.find((row) => row.key === key)
      if (found) found.cents += line.amountCents
      else {
        cash.push({
          key,
          direction: 'in',
          text: `Entró a ${line.treasuryName ?? 'una caja'}`,
          treasuryId: line.treasuryAccountId,
          cents: line.amountCents,
          reference: null,
        })
      }
    }
    // Con qué llegó: un renglón por comprobante (un cobro puede traer varios medios).
    const arrivals = new Map<string, AllocationRow>()
    for (const a of active) {
      const key = a.otherDocumentId ?? a.id
      const found = arrivals.get(key)
      if (found) found.cents += a.amountCents
      else arrivals.set(key, { ...allocationRow(doc, a, ctx), key, note: null, separate: null })
    }
    nodes.push({
      id: 'en-camino',
      what: 'Cajas y en camino',
      how: 'auto',
      state: 'linked',
      limit: 'cierre-cajas',
      cash,
      rows: m.rows.map((row) => ({
        ...row,
        action:
          ctx.canWrite && live && row.openCents > 0 && row.lineId && row.partyId
            ? {
                label: row.customer ? 'Ya pagó' : 'Ya llegó',
                params: { cliente: row.partyId, partida: row.lineId },
              }
            : null,
      })),
      arrivals: [...arrivals.values()],
    })
  }

  // 5 · Gasto fijo
  const recurring = recurringNode(doc, ctx)
  if (recurring) nodes.push(recurring)

  // 6 · Foto
  const photo = attachmentsBlock(doc, ctx.canWrite, ctx.attachments)
  if (photo.show) {
    const count = ctx.attachments
    nodes.push({
      id: 'foto',
      what: 'Foto',
      how: 'you',
      state:
        count === null
          ? 'off'
          : count > 0
            ? 'linked'
            : // A un papel que ya no cuenta (anulado con fecha posterior) no le «falta» nada:
              // la foto se sigue ofreciendo, sin píldora.
              PHOTO_OPTIONAL.has(doc.kind) || !live
              ? 'ask'
              : 'missing',
      limit: null,
      canEdit: photo.canEdit,
      error: count === null,
      emptyText: photoHint(doc),
    })
  }

  // 7 · Archivo importado
  if (ctx.origin) {
    const from = IMPORT_SHORT[ctx.origin.source] ?? 'un archivo'
    const who = ctx.origin.uploadedByName
    const when = formatDate(ctx.origin.uploadedAt)
    const uploaded = `${who ? `Lo subió ${who}` : 'Se subió'}${when ? ` el ${when}` : ''}.`
    nodes.push({
      id: 'importado',
      what: 'Archivo importado',
      how: 'auto',
      state: 'linked',
      limit: 'importado',
      batchId: ctx.origin.batchId,
      title: ctx.origin.fileName === null ? `Importado de ${from}` : `Archivo de ${from}`,
      text: uploaded,
      note:
        ctx.origin.role === 'previous'
          ? 'Como se anuló, su línea volvió a quedar para revisar en ese archivo.'
          : null,
    })
  }

  // 8 · Libro IVA
  const iva = ivaNode(doc)
  if (iva) nodes.push(iva)

  // 9 · ARCA
  if (ctx.arca) {
    nodes.push({ id: 'arca', what: 'ARCA', how: 'auto', state: ctx.arca, limit: null })
  }

  // 10 · Otros papeles
  const others = othersNode(doc)
  if (others) nodes.push(others)

  // 11 · Los libros
  const books = booksNode(doc, ctx)
  if (books) nodes.push(books)

  return nodes
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/**
 * El título del mapa: dice qué FALTA («Le faltan el pago y la foto»), no
 * cuántas cosas hay. En un cierre, cuánta plata falta llegar. Un pago a cuenta
 * y la pregunta del gasto fijo no cuentan: no son faltas.
 */
export function linksTitle(
  nodes: readonly LinkNode[],
  doc: Pick<
    DocumentDetail,
    'kind' | 'status' | 'reversedBy' | 'lines' | 'entry' | 'accountingDate' | 'totalCents'
  >,
  today: string,
): string {
  if (!isLive(doc)) return 'Con qué estaba unido'
  if (doc.kind === 'sales_close') {
    const pending = closeMoney(doc, today).pendingCents
    return pending > 0
      ? `De este día todavía faltan llegar ${money(pending)}`
      : 'De este día ya llegó toda la plata'
  }
  const missing: string[] = []
  for (const node of nodes) {
    if (node.state !== 'missing') continue
    if (node.id === 'pago') missing.push(node.what === 'Cobro' ? 'el cobro' : 'el pago')
    else if (node.id === 'foto') missing.push('la foto')
  }
  if (missing.length === 0) return 'Con qué está unido'
  return `${missing.length === 1 ? 'Le falta' : 'Le faltan'} ${joinAnd(missing)}`
}

// ─── ④ Lo que hay que saber antes de anular ──────────────────────────────────

/**
 * Hasta dos avisos que se suman al diálogo de anulación: anular NO devuelve el
 * vencimiento de un gasto fijo (lo comprobamos en la base) y, si el
 * comprobante vino de un archivo, su línea vuelve a quedar para revisar.
 */
export function voidNotes(
  doc: Pick<DocumentDetail, 'recurringExpenseId'>,
  ctx: Pick<StoryContext, 'recurring' | 'origin'>,
): string[] {
  const notes: string[] = []
  if (doc.recurringExpenseId) {
    const row = ctx.recurring
    const name = row && row !== 'error' ? `del gasto fijo «${row.name}»` : 'de un gasto fijo'
    notes.push(
      `Es ${name}: al anularlo, el vencimiento no vuelve solo. Después corregí el «Próximo vencimiento» en Gastos fijos.`,
    )
  }
  if (ctx.origin) {
    notes.push('Vino de un archivo importado: su línea vuelve a quedar para revisar.')
  }
  return notes
}
