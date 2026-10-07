/**
 * Piezas comunes del motor de imputación (Sprint 1, E.1 y E.7).
 *
 * Todo `build*` sigue el mismo camino:
 * 1. Controla la entrada (centavos enteros, partícipe, cajas, partidas) y corta
 *    con errores «de carga» si no se puede armar nada.
 * 2. Arma los renglones con `DocLineBuilder`: descarta los ceros, da vuelta
 *    el lado de un importe con signo y numera `line_no` en un orden fijo.
 * 3. `finalize` corre las MISMAS validaciones que la RPC (`validate.ts`), junta
 *    errores y avisos sin repetirlos, y si todo está bien devuelve la vista
 *    previa (`toEntryPreview`) y el hash de la propuesta (`hashProposalSync`).
 *
 * Puro y determinista: misma entrada y mismo contexto → exactamente lo mismo.
 * Nada de `Date.now()`, nada de orden de un `Map` que dependa de otra cosa que
 * el contexto ya cargado.
 */

import { sumSides } from '@/lib/accounting/balance'
import { vatRateLabel } from '@/lib/accounting/iva'
import { hashProposalSync, toEntryPreview } from '@/lib/accounting/preview'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  CommissionVatMode,
  DocLine,
  DocumentKind,
  FiscalAmountKey,
  FiscalAmounts,
  FiscalCounterparty,
  IsoDate,
  IvaCondition,
  LineKey,
  LineRole,
  MessageDetail,
  NewParty,
  PartyKey,
  PartyKind,
  PartyRates,
  PartyRef,
  PostingContext,
  PostingError,
  PostingMeta,
  PostingResult,
  PostingWarning,
  ProposedAllocation,
  ProposedBundle,
  ProposedDocument,
  Side,
  TaxIdType,
  TaxKind,
  VatRateBp,
  WarningKey,
} from '@/lib/accounting/types'
import { FISCAL_AMOUNT_KEYS, WARNING_KEYS } from '@/lib/accounting/types'
import {
  MAX_AMOUNT_CENTS,
  type ValidateOptions,
  validateBundle,
  validateDocument,
} from '@/lib/accounting/validate'
import { afipDocType, FINAL_CONSUMER } from '@/lib/accounting/voucher-types'
import { addDays, daysInMonth, maxIsoDay, parseIsoDay, toIsoDay } from '@/lib/dates'

// ─── Meta de los builders ────────────────────────────────────────────────────

/**
 * Lo que recibe todo `build*` además de la entrada y el contexto. `validate`
 * es opcional: lo que la página sabe y el `PostingContext` no trae (el primer
 * día abierto, el fin del ejercicio, los saldos compensables). Si no viene,
 * esas reglas las decide la RPC. Es compatible con `PostingMeta` (E.2): un
 * builder con esta firma sigue siendo un `PostingBuilder<Input>`.
 */
export type BuildMeta = PostingMeta & { validate?: ValidateOptions }

// ─── Errores y avisos ────────────────────────────────────────────────────────

export function postingError(
  key: PostingError['key'],
  field?: string,
  detail?: MessageDetail,
): PostingError {
  const e: PostingError = { key }
  if (field !== undefined) e.field = field
  if (detail !== undefined) e.detail = detail
  return e
}

export function postingWarning(
  key: WarningKey,
  document?: string,
  detail?: MessageDetail,
): PostingWarning {
  const w: PostingWarning = { key }
  if (document !== undefined) w.document = document
  if (detail !== undefined) w.detail = detail
  return w
}

function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key]
      }
      return sorted
    }
    return v
  })
}

/** Sin repetidos, en el orden en que aparecieron (los mismos datos = el mismo error). */
export function dedupeIssues<T extends PostingError | PostingWarning>(issues: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const issue of issues) {
    const id = stableKey(issue)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(issue)
  }
  return out
}

/** Una salida fallida del builder (atajo para los cortes tempranos). */
export function failed(errors: readonly PostingError[]): PostingResult {
  return { ok: false, errors: dedupeIssues(errors) }
}

/**
 * Los avisos aceptados que viajan en cada documento (`warnings_ack`). Van a
 * TODOS los documentos del bundle: un aviso que solo ve la base (posible
 * duplicado, caja negativa con lo que cargó otro dueño) vuelve con la clave y
 * el motor no sabe de cuál documento era. Aceptar de más no cambia nada.
 */
export function ackList(raw: readonly string[] | null | undefined): WarningKey[] {
  if (!raw) return []
  const allowed = new Set<string>(WARNING_KEYS)
  const out: WarningKey[] = []
  for (const key of raw) {
    if (allowed.has(key) && !out.includes(key as WarningKey)) out.push(key as WarningKey)
  }
  return out
}

// ─── Centavos de la entrada ──────────────────────────────────────────────────

type CentsEntry = readonly [field: string, value: number | null | undefined]

/**
 * Centavos de un formulario: enteros ≥ 0 y no más que el tope de un formulario.
 * El zod de cada formulario ya lo garantiza; esto es la red del motor, que
 * también corre con un estado a medio cargar (vista previa) y nunca tiene que
 * explotar con un dato raro.
 */
export function centsIssues(entries: readonly CentsEntry[]): PostingError[] {
  const errors: PostingError[] = []
  for (const [field, value] of entries) {
    if (value === null || value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push(postingError('invalid_bundle', field, { reason: 'amount_not_cents' }))
    } else if (value > MAX_AMOUNT_CENTS) {
      errors.push(postingError('amount_too_large', field))
    }
  }
  return errors
}

/** Igual que `centsIssues` pero admite negativos (saldos de un arqueo). */
export function signedCentsIssues(entries: readonly CentsEntry[]): PostingError[] {
  const errors: PostingError[] = []
  for (const [field, value] of entries) {
    if (value === null || value === undefined) continue
    if (!Number.isSafeInteger(value)) {
      errors.push(postingError('invalid_bundle', field, { reason: 'amount_not_cents' }))
    } else if (Math.abs(value) > MAX_AMOUNT_CENTS) {
      errors.push(postingError('amount_too_large', field))
    }
  }
  return errors
}

export function sumCents(values: Iterable<number>): Cents {
  let total = 0
  for (const v of values) total += v
  return total
}

// ─── Renglones ───────────────────────────────────────────────────────────────

/** Un renglón a emitir: lo obligatorio más cualquier metadato; `tag` sirve para buscar su `line_no`. */
export type LineSpec = Pick<DocLine, 'role' | 'accountId' | 'side' | 'amountCents'> &
  Partial<Omit<DocLine, 'lineNo' | 'role' | 'accountId' | 'side' | 'amountCents'>> & {
    tag?: string
  }

export type BuiltLines = {
  lines: DocLine[]
  /** `line_no` del renglón con ese `tag`, o `null` si quedó afuera (importe cero). */
  lineNoOf: (tag: string) => number | null
}

export const MEMO_MAX = 200
export const DESCRIPTION_MAX = 200

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

export function flipSide(side: Side): Side {
  return side === 'debit' ? 'credit' : 'debit'
}

/**
 * Emite los renglones de un documento (E.1): descarta los importes en cero
 * (un asiento nunca lleva líneas en cero), da vuelta el lado de un importe con
 * signo (`addSigned`) y numera `line_no` 1..n. Con `debitFirst` ordena el Debe
 * antes que el Haber manteniendo el orden de carga dentro de cada lado: así
 * quedan las notas de crédito (E6: el proveedor primero, después el neto y el
 * IVA) y los arqueos (E18: el faltante y después la caja).
 *
 * Un importe negativo o con decimales acá es un error del motor (la entrada ya
 * se controló): corta con `RangeError` en vez de guardar algo raro.
 */
export class DocLineBuilder {
  private readonly specs: LineSpec[] = []

  add(spec: LineSpec): this {
    if (!Number.isSafeInteger(spec.amountCents) || spec.amountCents < 0) {
      throw new RangeError(
        `Renglón ${spec.role} con un importe inválido: ${String(spec.amountCents)} (el motor ya tendría que haberlo controlado)`,
      )
    }
    this.specs.push(spec)
    return this
  }

  /** Importe con signo: positivo va del lado `positiveSide`, negativo del otro. */
  addSigned(
    spec: Omit<LineSpec, 'side' | 'amountCents'>,
    signedCents: Cents,
    positiveSide: Side,
  ): this {
    const side = signedCents >= 0 ? positiveSide : flipSide(positiveSide)
    return this.add({ ...spec, side, amountCents: Math.abs(signedCents) })
  }

  /** Cuántos renglones con importe hay cargados. */
  get size(): number {
    return this.specs.filter((s) => s.amountCents > 0).length
  }

  build(opts: { debitFirst?: boolean } = {}): BuiltLines {
    const kept = this.specs
      .map((spec, index) => ({ spec, index }))
      .filter(({ spec }) => spec.amountCents > 0)
    if (opts.debitFirst) {
      kept.sort((a, b) => {
        const sa = a.spec.side === 'debit' ? 0 : 1
        const sb = b.spec.side === 'debit' ? 0 : 1
        return sa !== sb ? sa - sb : a.index - b.index
      })
    }
    const tags = new Map<string, number>()
    const lines = kept.map(({ spec }, i): DocLine => {
      const lineNo = i + 1
      if (spec.tag !== undefined) tags.set(spec.tag, lineNo)
      return {
        lineNo,
        role: spec.role,
        accountId: spec.accountId,
        side: spec.side,
        amountCents: spec.amountCents,
        partyRef: spec.partyRef ?? null,
        dueDate: spec.dueDate ?? null,
        treasuryAccountId: spec.treasuryAccountId ?? null,
        salesMethodId: spec.salesMethodId ?? null,
        vatRateBp: spec.vatRateBp ?? null,
        baseCents: spec.baseCents ?? null,
        vatComputedCents: spec.vatComputedCents ?? null,
        taxKind: spec.taxKind ?? null,
        jurisdictionCode: spec.jurisdictionCode ?? null,
        channel: spec.channel ?? null,
        certificateNumber: spec.certificateNumber ?? null,
        reference: spec.reference ?? null,
        memo: truncate(spec.memo ?? '', MEMO_MAX),
      }
    })
    return { lines, lineNoOf: (tag) => tags.get(tag) ?? null }
  }
}

/** Σ Debe = Σ Haber, o el error `entry_not_balanced` con los dos totales (la RPC usa la misma clave). */
export function assertBalanced(doc: Pick<ProposedDocument, 'lines'>): PostingError | null {
  const sums = sumSides(doc.lines)
  if (sums.diff === 0n) return null
  return postingError('entry_not_balanced', 'lines', {
    debit_cents: Number(sums.debit),
    credit_cents: Number(sums.credit),
  })
}

// ─── Textos derivados (no entran al hash) ────────────────────────────────────

const KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  opening: 'Asiento de apertura',
  purchase: 'Compra',
  purchase_credit_note: 'Nota de crédito de proveedor',
  purchase_debit_note: 'Nota de débito de proveedor',
  expense: 'Gasto',
  payment: 'Pago',
  sales_close: 'Cierre del día',
  sales_invoice: 'Factura de venta',
  sales_credit_note: 'Nota de crédito de venta',
  sales_debit_note: 'Nota de débito de venta',
  collection: 'Cobro',
  transfer: 'Movimiento entre cuentas',
  bank_expense: 'Gasto bancario',
  cash_movement: 'Movimiento de caja',
  treasury_adjustment: 'Ajuste de saldo',
  manual: 'Asiento manual',
  reversal: 'Anulación',
  iva_settlement: 'Liquidación de IVA',
  fy_result: 'Refundición de resultados',
  fy_closing: 'Cierre patrimonial',
  fy_opening: 'Apertura del ejercicio',
}

/**
 * La descripción del comprobante (`acc_documents.description`, 1 a 200
 * caracteres): «Factura A 0003-00001290 · Coca-Cola (distribuidor)». Las
 * partes vacías se saltean; sin partes, la etiqueta del tipo.
 */
export function descriptionFor(
  kind: DocumentKind,
  ...parts: ReadonlyArray<string | null | undefined>
): string {
  const kept = parts.map((p) => (p ?? '').trim()).filter((p) => p !== '')
  const text = kept.length > 0 ? kept.join(' · ') : KIND_LABELS[kind]
  return truncate(text, DESCRIPTION_MAX)
}

export const TAX_KIND_LABELS: Readonly<Record<TaxKind, string>> = {
  iva: 'IVA',
  iibb: 'IIBB',
  ganancias: 'Ganancias',
  municipal: 'tasa municipal',
  internos: 'impuestos internos',
  ley_25413_credito: 'Ley 25.413 sobre créditos',
  ley_25413_debito: 'Ley 25.413 sobre débitos',
  sircreb: 'SIRCREB',
  sircupa: 'SIRCUPA',
  comision: 'Comisión',
  iva_comision: 'IVA de la comisión',
  percepcion_iva_comision: 'Percepción de IVA de la comisión',
  ret_iva: 'Retención de IVA',
  ret_iibb: 'Retención de IIBB',
  ret_ganancias: 'Retención de Ganancias',
  interes: 'Intereses',
  diferencia: 'Diferencia sin explicar',
  rendimiento: 'Rendimiento',
  otro: 'Otro',
}

export type MemoHint = {
  rateBp?: VatRateBp | null
  taxKind?: TaxKind | null
  jurisdictionCode?: number | null
  /** Texto ya armado (comprobante, caja, cliente): gana sobre lo genérico. */
  label?: string | null
}

/** La leyenda de un renglón en el diario: «Neto 21 %», «IVA 10,5 %», «Percepción de IIBB (904)». */
export function memoFor(role: LineRole, hint: MemoHint = {}): string {
  const label = hint.label?.trim()
  switch (role) {
    case 'net':
      return hint.rateBp !== null && hint.rateBp !== undefined
        ? `Neto ${vatRateLabel(hint.rateBp)}`
        : 'Neto gravado'
    case 'vat':
      return hint.rateBp !== null && hint.rateBp !== undefined
        ? `IVA ${vatRateLabel(hint.rateBp)}`
        : 'IVA'
    case 'gross':
      return label || 'Importe con IVA incluido'
    case 'non_taxed':
      return 'No gravado'
    case 'exempt':
      return 'Exento'
    case 'internal_tax':
      return 'Impuestos internos'
    case 'perception': {
      const tax = hint.taxKind ? TAX_KIND_LABELS[hint.taxKind] : 'impuesto'
      const where = hint.jurisdictionCode ? ` (${hint.jurisdictionCode})` : ''
      return `Percepción de ${tax}${where}`
    }
    case 'other_tax':
    case 'deduction':
    case 'compensation':
    case 'adjustment_split':
      return label || (hint.taxKind ? TAX_KIND_LABELS[hint.taxKind] : 'Otro concepto')
    case 'write_off':
      return label || 'Diferencia dada por cancelada'
    case 'cash_diff':
      return label || 'Diferencia de caja'
    case 'vat_pending_release':
      return label || 'IVA de comisiones documentado'
    default:
      return label || ''
  }
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

/**
 * Fecha contable por defecto: la del comprobante, o el primer día abierto si
 * su mes está cerrado («Septiembre está cerrado: lo cargamos el 01/10», H.5).
 */
export function accountingDateFor(issueDate: IsoDate, meta: BuildMeta): IsoDate {
  const firstOpen = meta.validate?.firstOpenDate
  return firstOpen ? maxIsoDay(issueDate, firstOpen) : issueDate
}

/**
 * El primer día ≥ `from` cuyo número de día es `day` (recortado al último del
 * mes): el vencimiento de una DDJJ de IIBB cargada el 31/10 con día 15 es el
 * 15/11; cargada el 10/11, también el 15/11.
 */
export function nextDayOfMonthOnOrAfter(from: IsoDate, day: number): IsoDate {
  const civil = parseIsoDay(from)
  if (!civil) throw new RangeError(`Fecha inválida: ${from}`)
  const inMonth = toIsoDay(
    civil.year,
    civil.month,
    Math.min(day, daysInMonth(civil.year, civil.month)),
  )
  if (inMonth >= from) return inMonth
  const nextYear = civil.month === 12 ? civil.year + 1 : civil.year
  const nextMonth = civil.month === 12 ? 1 : civil.month + 1
  return toIsoDay(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
}

/** El día `day` del mes siguiente al de `date` (recortado al último del mes): vencimiento del IVA. */
export function dayOfNextMonth(date: IsoDate, day: number): IsoDate {
  const civil = parseIsoDay(date)
  if (!civil) throw new RangeError(`Fecha inválida: ${date}`)
  const year = civil.month === 12 ? civil.year + 1 : civil.year
  const month = civil.month === 12 ? 1 : civil.month + 1
  return toIsoDay(year, month, Math.min(day, daysInMonth(year, month)))
}

export function addDaysSafe(date: IsoDate, days: number): IsoDate {
  return addDays(date, Math.max(0, Math.trunc(days)))
}

// ─── Partícipes ──────────────────────────────────────────────────────────────

/** Lo que el motor necesita de un partícipe, exista en la base o venga nuevo en el bundle. */
export type PartyInfo = {
  key: PartyKey
  isNew: boolean
  kind: PartyKind
  /** Razón social: la que va a la foto del libro IVA. */
  legalName: string
  /** Nombre de fantasía si tiene, si no la razón social: el de las descripciones. */
  displayName: string
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  paymentTermDays: number
  payableAccountId: string
  receivableAccountId: string
  commissionVatMode: CommissionVatMode
  rates: PartyRates
  active: boolean
}

const NO_RATES: PartyRates = {
  commissionBp: null,
  iibbWithholdingBp: null,
  vatWithholdingBp: null,
  incomeTaxWithholdingBp: null,
  sircupaBp: null,
}

/**
 * Busca un partícipe. Los nuevos todavía no tienen cuentas de control: la RPC
 * les asigna Proveedores («le debemos») y Deudores por ventas («nos debe»),
 * igual que `resolveParty` de validate.ts.
 */
export function partyInfo(
  key: PartyKey,
  ctx: Pick<PostingContext, 'parties' | 'sys'>,
  newParties: readonly NewParty[] = [],
): PartyInfo | null {
  if ('id' in key) {
    const p = ctx.parties.get(key.id)
    if (!p) return null
    return {
      key: { id: p.id },
      isNew: false,
      kind: p.kind,
      legalName: p.name,
      displayName: p.tradeName ?? p.name,
      taxIdType: p.taxIdType,
      taxId: p.taxId,
      ivaCondition: p.ivaCondition,
      paymentTermDays: p.paymentTermDays,
      payableAccountId: p.payableAccountId,
      receivableAccountId: p.receivableAccountId,
      commissionVatMode: p.commissionVatMode,
      rates: p.rates,
      active: p.active,
    }
  }
  const np = newParties.find((n) => n.ref === key.ref)
  if (!np) return null
  return {
    key: { ref: np.ref },
    isNew: true,
    kind: np.kind,
    legalName: np.name,
    displayName: np.tradeName ?? np.name,
    taxIdType: np.taxIdType,
    taxId: np.taxId,
    ivaCondition: np.ivaCondition,
    paymentTermDays: np.paymentTermDays,
    payableAccountId: ctx.sys.payable_suppliers.id,
    receivableAccountId: ctx.sys.receivable_customers.id,
    commissionVatMode: 'none',
    rates: NO_RATES,
    active: true,
  }
}

/**
 * El partícipe de sistema de una deuda (Personal, ARCA, ARCA · seguridad
 * social, Sindicato): el activo cuya cuenta «le debemos» es la de esa deuda,
 * del tipo esperado si hay más de uno (el orden del contexto desempata). Los
 * partícipes del contexto no traen su `system_key`: la cuenta los identifica.
 */
export function partyForPayable(
  ctx: Pick<PostingContext, 'parties' | 'sys'>,
  key: SystemAccountKey,
  preferredKind: PartyKind,
): PartyRef | null {
  const accountId = ctx.sys[key].id
  const candidates = [...ctx.parties.values()].filter(
    (p) => p.active && p.payableAccountId === accountId,
  )
  return candidates.find((p) => p.kind === preferredKind) ?? candidates[0] ?? null
}

/** Lo que manda el zod de «proveedor nuevo en línea» (`newPartySchema`). */
export type NewPartyFields = {
  name: string
  kind: PartyKind
  ivaCondition: IvaCondition
  taxId: string | null
  paymentTermDays: number
  defaultAccountId: string | null
}

/** Ref del primer partícipe nuevo de un bundle (`^[a-z0-9_]{1,20}$`). */
export const NEW_PARTY_REF = 'p1'

/** El proveedor nuevo del formulario como `NewParty` del bundle (CUIT si vino, si no sin identificación). */
export function newPartyFrom(
  fields: NewPartyFields,
  fallbackAccountId: string | null = null,
  ref: string = NEW_PARTY_REF,
): NewParty {
  return {
    ref,
    kind: fields.kind,
    name: fields.name.trim(),
    tradeName: null,
    taxIdType: fields.taxId ? 'cuit' : 'none',
    taxId: fields.taxId ?? null,
    ivaCondition: fields.ivaCondition,
    paymentTermDays: fields.paymentTermDays,
    defaultAccountId: fields.defaultAccountId ?? fallbackAccountId,
  }
}

/**
 * La foto de la contraparte para el libro IVA (la RPC la vuelve a tomar del
 * partícipe y exige que coincida). Sin CUIT la fila igual se arma: la
 * validación avisa `party_tax_id_required` en el campo, con el nombre.
 */
export function counterpartyFor(party: PartyInfo): FiscalCounterparty {
  const docType = afipDocType(party.taxIdType)
  return {
    party: party.key,
    name: party.legalName,
    docType,
    docNumber: docType === 99 ? '0' : (party.taxId ?? '0'),
    ivaCondition: party.ivaCondition,
  }
}

/** Ventas B a consumidor final sin identificar: «Consumidor final», documento 99, «0». */
export function finalConsumerCounterparty(): FiscalCounterparty {
  return {
    party: null,
    name: FINAL_CONSUMER.name,
    docType: FINAL_CONSUMER.docType,
    docNumber: FINAL_CONSUMER.docNumber,
    ivaCondition: FINAL_CONSUMER.ivaCondition,
  }
}

/** Importes de una fila del libro IVA: solo las columnas con algo (como el payload). */
export function fiscalAmounts(values: Partial<Record<FiscalAmountKey, Cents>>): FiscalAmounts {
  const out: FiscalAmounts = {}
  for (const key of FISCAL_AMOUNT_KEYS) {
    const v = values[key]
    if (v !== undefined && v !== 0) out[key] = v
  }
  return out
}

// ─── Documento ───────────────────────────────────────────────────────────────

/** Un documento con los valores por defecto de un comprobante simple. */
export function proposedDocument(
  partial: Pick<
    ProposedDocument,
    'ref' | 'kind' | 'issueDate' | 'accountingDate' | 'description' | 'totalCents' | 'lines'
  > &
    Partial<ProposedDocument>,
): ProposedDocument {
  return {
    entryKind: 'standard',
    voucherType: null,
    afipVoucherCode: null,
    party: null,
    dueDate: null,
    pointOfSale: null,
    number: null,
    shift: null,
    notes: null,
    controlAccountId: null,
    relatedDocument: null,
    replacesDocumentId: null,
    correctsDocumentId: null,
    recurringExpenseId: null,
    settlesCommissions: false,
    countedCents: null,
    expectedBookCents: null,
    warningsAck: [],
    overrideReason: null,
    fiscalVouchers: [],
    ...partial,
  }
}

export function bundleOf(
  meta: PostingMeta,
  documents: ProposedDocument[],
  allocations: ProposedAllocation[] = [],
  newParties: NewParty[] = [],
): ProposedBundle {
  return { clientRef: meta.clientRef, newParties, documents, allocations }
}

// ─── Cierre de todo builder ──────────────────────────────────────────────────

export type FinalizeExtra = {
  /** Errores «blandos» del builder (total de control, IVA fuera de tolerancia…): se suman a los de la validación. */
  errors?: readonly PostingError[]
  /** Avisos del builder (`vat_diff`, `write_off`, `invoiced_exceeds_sold`). */
  warnings?: readonly PostingWarning[]
  /**
   * Documentos que genera su propia RPC (liquidación de IVA, anulación, cierre
   * de ejercicio): no pasan por `validateBundle` (que los rechaza con
   * `kind_not_allowed`), se validan uno por uno.
   */
  rpcOnly?: boolean
}

/**
 * Valida el bundle con las mismas reglas que la RPC y arma el resultado (E.7):
 * con errores, `{ ok: false }` con todos juntos y sin repetir; si no, el
 * bundle, los avisos, la vista previa y el hash.
 */
export function finalize(
  bundle: ProposedBundle,
  ctx: PostingContext,
  meta: BuildMeta,
  extra: FinalizeExtra = {},
): PostingResult {
  const errors: PostingError[] = [...(extra.errors ?? [])]
  const warnings: PostingWarning[] = [...(extra.warnings ?? [])]

  // Un documento sin renglones (todo en cero) no tiene asiento: no hay nada más que mirar.
  if (bundle.documents.some((d) => d.lines.length === 0)) {
    errors.push(postingError('amount_required', 'lines'))
    return failed(errors)
  }

  if (extra.rpcOnly) {
    for (const doc of bundle.documents) {
      const issues = validateDocument(doc, ctx, bundle.newParties, meta.validate)
      errors.push(...issues.errors)
      warnings.push(...issues.warnings)
    }
  } else {
    const issues = validateBundle(bundle, ctx, meta.validate)
    errors.push(...issues.errors)
    warnings.push(...issues.warnings)
  }
  for (const doc of bundle.documents) {
    const unbalanced = assertBalanced(doc)
    if (unbalanced) errors.push(unbalanced)
  }

  if (errors.length > 0) return failed(errors)
  return {
    ok: true,
    bundle,
    warnings: dedupeIssues(warnings),
    preview: toEntryPreview(bundle, ctx),
    hash: hashProposalSync(bundle),
  }
}

// ─── Payload de `acc_post_bundle` (C.3.1) ────────────────────────────────────

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

export type RpcLineKey = { line_id: string } | { doc: string; line_no: number }

/** El `p_bundle` de `acc_post_bundle`. El `clientRef` viaja aparte, como `p_client_ref`. */
export type AccPostBundlePayload = {
  preview_hash: string
  new_parties: JsonObject[]
  documents: JsonObject[]
  allocations: JsonObject[]
}

function partyJson(key: PartyKey | null): Json {
  if (key === null) return null
  return 'id' in key ? { id: key.id } : { ref: key.ref }
}

function relatedJson(related: ProposedDocument['relatedDocument']): Json {
  if (related === null) return null
  return 'id' in related ? { id: related.id } : { ref: related.ref }
}

function lineKeyJson(key: LineKey): Json {
  return 'lineId' in key ? { line_id: key.lineId } : { doc: key.doc, line_no: key.lineNo }
}

/** Un renglón en snake_case, sin las claves en `null` («los renglones omiten las claves en null»). */
function lineJson(line: DocLine): JsonObject {
  const out: JsonObject = {
    line_no: line.lineNo,
    role: line.role,
    account_id: line.accountId,
    side: line.side,
    amount_cents: line.amountCents,
  }
  const optional: Array<[string, Json]> = [
    ['party', partyJson(line.partyRef)],
    ['due_date', line.dueDate],
    ['treasury_account_id', line.treasuryAccountId],
    ['sales_method_id', line.salesMethodId],
    ['vat_rate_bp', line.vatRateBp],
    ['base_cents', line.baseCents],
    ['vat_computed_cents', line.vatComputedCents],
    ['tax_kind', line.taxKind],
    ['jurisdiction_code', line.jurisdictionCode],
    ['channel', line.channel],
    ['certificate_number', line.certificateNumber],
    ['reference', line.reference],
    ['memo', line.memo.trim() === '' ? null : line.memo],
  ]
  for (const [key, value] of optional) if (value !== null) out[key] = value
  return out
}

/**
 * La propuesta del motor como la espera `acc_post_bundle` (C.3.1): mismas
 * claves, en snake_case, con el hash de la vista previa. Es una traducción 1:1
 * (nada se recalcula): lo que se firmó es lo que se manda.
 */
export function toRpcPayload(bundle: ProposedBundle, previewHash: string): AccPostBundlePayload {
  return {
    preview_hash: previewHash,
    new_parties: bundle.newParties.map((p) => ({
      ref: p.ref,
      kind: p.kind,
      name: p.name,
      trade_name: p.tradeName,
      tax_id_type: p.taxIdType,
      tax_id: p.taxId,
      iva_condition: p.ivaCondition,
      payment_term_days: p.paymentTermDays,
      default_account_id: p.defaultAccountId,
    })),
    documents: bundle.documents.map((d) => ({
      ref: d.ref,
      kind: d.kind,
      entry_kind: d.entryKind,
      voucher_type: d.voucherType,
      afip_voucher_code: d.afipVoucherCode,
      party: partyJson(d.party),
      issue_date: d.issueDate,
      accounting_date: d.accountingDate,
      due_date: d.dueDate,
      point_of_sale: d.pointOfSale,
      number: d.number,
      shift: d.shift,
      description: d.description,
      notes: d.notes,
      total_cents: d.totalCents,
      control_account_id: d.controlAccountId,
      related_document: relatedJson(d.relatedDocument),
      replaces_document_id: d.replacesDocumentId,
      corrects_document_id: d.correctsDocumentId,
      recurring_expense_id: d.recurringExpenseId,
      settles_commissions: d.settlesCommissions,
      counted_cents: d.countedCents,
      expected_book_cents: d.expectedBookCents,
      warnings_ack: [...d.warningsAck],
      override_reason: d.overrideReason,
      lines: d.lines.map(lineJson),
      fiscal_vouchers: d.fiscalVouchers.map((fv) => {
        const amounts: JsonObject = {}
        for (const key of FISCAL_AMOUNT_KEYS) {
          const v = fv.amounts[key]
          if (v !== undefined && v !== 0) amounts[key] = v
        }
        return {
          book: fv.book,
          voucher_type: fv.voucherType,
          afip_voucher_code: fv.afipVoucherCode,
          is_credit_note: fv.isCreditNote,
          voucher_date: fv.voucherDate,
          point_of_sale: fv.pointOfSale,
          number_from: fv.numberFrom,
          number_to: fv.numberTo,
          channel: fv.channel,
          counterparty: {
            party: partyJson(fv.counterparty.party),
            name: fv.counterparty.name,
            doc_type: fv.counterparty.docType,
            doc_number: fv.counterparty.docNumber,
            iva_condition: fv.counterparty.ivaCondition,
          },
          amounts,
        }
      }),
    })),
    allocations: bundle.allocations.map((a) => ({
      debit: lineKeyJson(a.debit),
      credit: lineKeyJson(a.credit),
      amount_cents: a.amountCents,
      kind: a.kind,
    })),
  }
}
