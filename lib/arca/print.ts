/**
 * La factura impresa de un comprobante emitido con CAE (diseño §3.2.6): todo lo
 * que dibuja `app/print/factura/…`, ya en texto.
 *
 * - **Datos obligatorios** (RG 1415): letra y código en el recuadro, «ORIGINAL»,
 *   emisor (razón social, domicilio comercial, condición frente al IVA, CUIT,
 *   Ingresos Brutos e inicio de actividades), punto de venta y número, fecha,
 *   receptor (documento, nombre, condición frente al IVA y domicilio), el detalle
 *   y los importes (discriminados en la A; solo el total en la B), CAE y su
 *   vencimiento.
 * - **QR** (RG 4892, especificación versión 1): `{base}?p={JSON en base64}`. La
 *   base sale de `ARCA_QR_BASE_URL` (`lib/arca/vouchers.ts`): la especificación
 *   dice `www.arca.gob.ar/fe/qr/` y su ejemplo usa `www.afip.gob.ar` (A
 *   CONFIRMAR, P-T11); se cambia en un solo lugar.
 * - **Leyendas**: a un consumidor final, el «Régimen de Transparencia Fiscal al
 *   Consumidor (Ley 27.743)» con el IVA contenido y los otros impuestos nacionales
 *   indirectos (RG 5614/2024; en $ 0 hasta que la contadora diga otra cosa,
 *   P-C9); en una A a un monotributista (condición 6, 13 o 16), la leyenda de la
 *   Ley 27.618 (RG 5003/2021).
 *
 * Los importes salen del pedido que se le mandó a ARCA (`acc_arca_vouchers.request`,
 * lo que ARCA autorizó), no de los libros: `readCaeRecord` lo vuelve a leer.
 *
 * Puro: sin red ni base. Lo usan la página de impresión y los tests.
 */

import { AFIP_ALIQUOT_ID, vatRateLabel } from '@/lib/accounting/iva'
import type { AfipDocType, IsoDate, VatRateBp } from '@/lib/accounting/types'
import { VAT_RATE_VALUES } from '@/lib/accounting/types'
import { formatIsoDay, isRealIsoDay } from '@/lib/dates'
import { formatCuit, padDocNumber, padPv } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import type { ArcaEnvironment } from './endpoints'
import { parseAmountToCents, type WsfeAliquot, type WsfeAmounts } from './importes'
import {
  ARCA_QR_BASE_URL,
  type CbteTipo,
  condicionIvaReceptor,
  isCbteTipo,
  isCreditNoteCbte,
  isDebitNoteCbte,
  letterForCbte,
  type QrData,
  qrJson,
  qrUrl,
} from './vouchers'
import type { CaeAssociated, CaeRequest } from './wsfe'

// ─── El pedido guardado ──────────────────────────────────────────────────────

type Rec = Record<string, unknown>

function asRec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function int(value: unknown): number | null {
  const text = str(value)
  return text !== null && /^\d{1,15}$/.test(text) ? Number(text) : null
}

function cents(value: unknown): number {
  return parseAmountToCents(str(value)) ?? 0
}

/** `'20261008'` → `'2026-10-08'`. */
function day(value: unknown): IsoDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(str(value) ?? '')
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  return isRealIsoDay(iso) ? iso : null
}

function list(value: unknown): Rec[] {
  if (Array.isArray(value)) return value.map(asRec).filter((r): r is Rec => r !== null)
  const single = asRec(value)
  return single ? [single] : []
}

const RATE_BY_ALIQUOT_ID: ReadonlyMap<number, VatRateBp> = new Map(
  VAT_RATE_VALUES.map((rate) => [AFIP_ALIQUOT_ID[rate], rate] as const),
)

/**
 * `acc_arca_vouchers.request` (el `FeCAEReq` que se mandó, sin `Auth`: la forma de
 * `caeRequestRecord`) → el pedido en centavos y fechas ISO. `null` si no tiene
 * la forma esperada.
 */
export function readCaeRecord(raw: unknown): CaeRequest | null {
  const rec = asRec(raw)
  const cab = asRec(rec?.FeCabReq)
  const det = list(asRec(rec?.FeDetReq)?.FECAEDetRequest)[0]
  if (!cab || !det) return null
  const ptoVta = int(cab.PtoVta)
  const cbteTipo = int(cab.CbteTipo)
  const number = int(det.CbteDesde)
  const concepto = int(det.Concepto)
  const docTipo = int(det.DocTipo)
  const cbteFch = day(det.CbteFch)
  const condicion = int(det.CondicionIVAReceptorId)
  if (
    ptoVta === null ||
    !isCbteTipo(cbteTipo) ||
    number === null ||
    (concepto !== 1 && concepto !== 2 && concepto !== 3) ||
    (docTipo !== 80 && docTipo !== 86 && docTipo !== 96 && docTipo !== 99) ||
    cbteFch === null ||
    condicion === null
  ) {
    return null
  }
  const iva: WsfeAliquot[] = []
  for (const a of list(asRec(det.Iva)?.AlicIva)) {
    const id = int(a.Id)
    const rate = id === null ? undefined : RATE_BY_ALIQUOT_ID.get(id)
    if (id === null || rate === undefined) continue
    iva.push({ id, rateBp: rate, baseCents: cents(a.BaseImp), vatCents: cents(a.Importe) })
  }
  const amounts: WsfeAmounts = {
    totalCents: cents(det.ImpTotal),
    nonTaxedCents: cents(det.ImpTotConc),
    netCents: cents(det.ImpNeto),
    exemptCents: cents(det.ImpOpEx),
    tributesCents: cents(det.ImpTrib),
    vatCents: cents(det.ImpIVA),
    unsupportedCents: 0,
    iva,
  }
  const associated: CaeAssociated[] = []
  for (const a of list(asRec(det.CbtesAsoc)?.CbteAsoc)) {
    const tipo = int(a.Tipo)
    const pv = int(a.PtoVta)
    const nro = int(a.Nro)
    if (tipo === null || pv === null || nro === null) continue
    associated.push({
      cbteTipo: tipo,
      ptoVta: pv,
      number: nro,
      cuit: str(a.Cuit),
      cbteFch: day(a.CbteFch),
    })
  }
  return {
    ptoVta,
    cbteTipo,
    number,
    concepto,
    docTipo: docTipo as AfipDocType,
    docNro: str(det.DocNro) ?? '0',
    cbteFch,
    amounts,
    condicionIvaReceptorId: condicion,
    serviceFrom: day(det.FchServDesde),
    serviceTo: day(det.FchServHasta),
    paymentDue: day(det.FchVtoPago),
    associated,
  }
}

// ─── QR ──────────────────────────────────────────────────────────────────────

/** Los datos del QR de un comprobante autorizado (el documento del receptor va «de corresponder»). */
export function invoiceQrData(o: {
  readonly issuerCuit: string
  readonly request: CaeRequest
  readonly cae: string
}): QrData {
  const { request } = o
  return {
    fecha: request.cbteFch,
    cuit: o.issuerCuit.replace(/\D/g, ''),
    ptoVta: request.ptoVta,
    tipoCmp: request.cbteTipo,
    nroCmp: request.number,
    importeCents: request.amounts.totalCents,
    moneda: 'PES',
    ctz: '1',
    docTipo: request.docTipo === 99 ? null : request.docTipo,
    docNro: request.docTipo === 99 ? null : request.docNro,
    codAut: o.cae,
    tipoCodAut: 'E',
  }
}

/** El texto del QR (`https://www.arca.gob.ar/fe/qr/?p=…`) y el JSON que lleva adentro. */
export function invoiceQr(
  data: QrData,
  base: string = ARCA_QR_BASE_URL,
): { readonly url: string; readonly json: string } {
  return { url: qrUrl(data, base), json: qrJson(data) }
}

// ─── Leyendas ────────────────────────────────────────────────────────────────

export const TRANSPARENCY_TITLE = 'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)'

export const MONOTRIBUTO_A_LEGEND =
  'El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618'

export const ARCA_DISCLAIMER =
  'Comprobante autorizado por ARCA. Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación.'

/** Condiciones de monotributo (RG 5616): la A a ellas lleva la leyenda de la Ley 27.618. */
const MONOTRIBUTO_CONDITIONS = new Set([6, 13, 16])
/** Consumidor final (RG 5616). */
const FINAL_CONSUMER_CONDITION = 5

export type InvoiceLegends = {
  /** RG 5614/2024: a consumidores finales, el IVA contenido y los otros impuestos indirectos. */
  readonly transparency: {
    readonly title: string
    readonly vatText: string
    readonly otherTaxesText: string
  } | null
  /** Otras leyendas obligatorias, en el orden en que se imprimen. */
  readonly lines: readonly string[]
}

/**
 * Las leyendas de un comprobante según su letra y la condición del receptor.
 * `otherIndirectTaxesCents`: impuestos nacionales indirectos que no son IVA (hoy
 * 0: la plataforma no emite tributos; a confirmar con la contadora, P-C9).
 */
export function invoiceLegends(o: {
  readonly cbteTipo: CbteTipo
  readonly condicionIvaReceptorId: number
  readonly vatCents: number
  readonly otherIndirectTaxesCents?: number
}): InvoiceLegends {
  const letter = letterForCbte(o.cbteTipo)
  const lines: string[] = []
  if (letter === 'A' && MONOTRIBUTO_CONDITIONS.has(o.condicionIvaReceptorId)) {
    lines.push(MONOTRIBUTO_A_LEGEND)
  }
  const transparency =
    o.condicionIvaReceptorId === FINAL_CONSUMER_CONDITION
      ? {
          title: TRANSPARENCY_TITLE,
          vatText: `IVA Contenido: ${formatCents(o.vatCents)}`,
          otherTaxesText: `Otros Impuestos Nacionales Indirectos: ${formatCents(o.otherIndirectTaxesCents ?? 0)}`,
        }
      : null
  return { transparency, lines }
}

// ─── La factura entera ───────────────────────────────────────────────────────

const ISSUER_IVA_TEXT: Readonly<Record<string, string>> = {
  responsable_inscripto: 'IVA Responsable Inscripto',
  monotributo: 'Responsable Monotributo',
  exento: 'IVA Sujeto Exento',
}

const DOC_LABEL: Readonly<Record<number, string>> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI' }

const CONCEPTO_TEXT: Readonly<Record<number, string>> = {
  1: 'Productos',
  2: 'Servicios',
  3: 'Productos y servicios',
}

export type InvoiceIssuer = {
  /** Razón social (`acc_settings.legal_name`). */
  readonly legalName: string
  /** El nombre del bar, si es distinto de la razón social. */
  readonly tradeName: string | null
  readonly cuit: string
  /** `acc_settings.iva_condition`. */
  readonly ivaCondition: string
  readonly iibbNumber: string | null
  readonly activityStartDate: IsoDate | null
  /** Domicilio comercial (`acc_settings.fiscal_address`). */
  readonly address: string | null
}

export type InvoicePrintInput = {
  readonly environment: ArcaEnvironment
  readonly issuer: InvoiceIssuer
  /** Lo que se mandó a ARCA (`readCaeRecord`). */
  readonly request: CaeRequest
  readonly cae: string
  readonly caeDue: IsoDate
  /** El receptor como está en la ficha (nombre y domicilio). */
  readonly receiver: { readonly name: string | null; readonly address: string | null }
  /** «Detalle para la factura». */
  readonly detail: string
}

export type InvoiceAmountRow = { readonly label: string; readonly amount: string }

export type InvoicePrintModel = {
  readonly testData: boolean
  readonly letter: 'A' | 'B'
  /** «Cód. 006». */
  readonly codeText: string
  /** «FACTURA», «NOTA DE CRÉDITO», «NOTA DE DÉBITO». */
  readonly title: string
  readonly copy: 'ORIGINAL'
  /** «00005». */
  readonly pointOfSaleText: string
  /** «00000104». */
  readonly numberText: string
  /** «08/10/2026». */
  readonly issueDateText: string
  readonly issuer: {
    readonly name: string
    readonly legalName: string | null
    readonly lines: readonly string[]
  }
  readonly receiver: {
    readonly name: string
    readonly docText: string
    readonly conditionText: string
    readonly addressText: string | null
  }
  readonly conceptText: string
  readonly serviceText: string | null
  readonly paymentDueText: string | null
  readonly associatedText: string | null
  /** El renglón del detalle con su importe (en la A, sin IVA; en la B, con IVA). */
  readonly item: { readonly description: string; readonly amount: string }
  readonly amountRows: readonly InvoiceAmountRow[]
  readonly totalText: string
  readonly legends: InvoiceLegends
  readonly caeText: string
  readonly caeDueText: string
  readonly qrUrl: string
  /** «Factura B 00005-00000104» (para el título de la pestaña). */
  readonly documentLabel: string
}

function titleOf(cbteTipo: CbteTipo): string {
  if (isCreditNoteCbte(cbteTipo)) return 'NOTA DE CRÉDITO'
  if (isDebitNoteCbte(cbteTipo)) return 'NOTA DE DÉBITO'
  return 'FACTURA'
}

function labelOf(cbteTipo: CbteTipo): string {
  const letter = letterForCbte(cbteTipo)
  if (isCreditNoteCbte(cbteTipo)) return `Nota de crédito ${letter}`
  if (isDebitNoteCbte(cbteTipo)) return `Nota de débito ${letter}`
  return `Factura ${letter}`
}

/** Todo lo que dibuja la factura impresa, ya en texto. */
export function invoicePrintModel(input: InvoicePrintInput): InvoicePrintModel {
  const { request, issuer } = input
  const letter = letterForCbte(request.cbteTipo)
  const a = request.amounts
  const condicion = condicionIvaReceptor(request.condicionIvaReceptorId)
  const pvText = padPv(request.ptoVta, 5)
  const numberText = padDocNumber(request.number)

  const issuerLines: string[] = []
  if (issuer.address) issuerLines.push(`Domicilio comercial: ${issuer.address}`)
  issuerLines.push(
    `Condición frente al IVA: ${ISSUER_IVA_TEXT[issuer.ivaCondition] ?? 'IVA Responsable Inscripto'}`,
  )
  issuerLines.push(`CUIT: ${formatCuit(issuer.cuit)}`)
  issuerLines.push(`Ingresos Brutos: ${issuer.iibbNumber?.trim() || '—'}`)
  if (issuer.activityStartDate) {
    issuerLines.push(`Inicio de actividades: ${formatIsoDay(issuer.activityStartDate)}`)
  }
  const tradeName = issuer.tradeName?.trim() || null
  const showTrade =
    tradeName !== null && tradeName.toLowerCase() !== issuer.legalName.trim().toLowerCase()

  const docLabel = DOC_LABEL[request.docTipo]
  const docText =
    request.docTipo === 99 || !docLabel
      ? 'Sin identificar'
      : `${docLabel} ${request.docTipo === 96 ? request.docNro : formatCuit(request.docNro)}`
  const receiverName =
    input.receiver.name?.trim() ||
    (request.condicionIvaReceptorId === FINAL_CONSUMER_CONDITION ? 'Consumidor final' : '—')

  // Importes: la A discrimina (neto e IVA por alícuota, no gravado, exento); la B, solo el total.
  const subtotal = a.netCents + a.nonTaxedCents + a.exemptCents
  const amountRows: InvoiceAmountRow[] = []
  if (letter === 'A') {
    for (const x of a.iva) {
      amountRows.push({
        label: `Neto gravado ${vatRateLabel(x.rateBp)}`,
        amount: formatCents(x.baseCents),
      })
    }
    for (const x of a.iva) {
      if (x.rateBp === 0) continue
      amountRows.push({ label: `IVA ${vatRateLabel(x.rateBp)}`, amount: formatCents(x.vatCents) })
    }
    if (a.nonTaxedCents > 0)
      amountRows.push({ label: 'No gravado', amount: formatCents(a.nonTaxedCents) })
    if (a.exemptCents > 0) amountRows.push({ label: 'Exento', amount: formatCents(a.exemptCents) })
  }

  const service =
    request.concepto !== 1 && request.serviceFrom && request.serviceTo
      ? `Período facturado: del ${formatIsoDay(request.serviceFrom)} al ${formatIsoDay(request.serviceTo)}`
      : null
  const associated = request.associated?.[0]
  const associatedText = associated
    ? `Corresponde a: ${isCbteTipo(associated.cbteTipo) ? labelOf(associated.cbteTipo) : `Comprobante ${associated.cbteTipo}`} ${padPv(associated.ptoVta, 5)}-${padDocNumber(associated.number)}${associated.cbteFch ? ` del ${formatIsoDay(associated.cbteFch)}` : ''}`
    : null

  const qr = invoiceQr(invoiceQrData({ issuerCuit: issuer.cuit, request, cae: input.cae }))
  return {
    testData: input.environment === 'homologacion',
    letter,
    codeText: `Cód. ${String(request.cbteTipo).padStart(3, '0')}`,
    title: titleOf(request.cbteTipo),
    copy: 'ORIGINAL',
    pointOfSaleText: pvText,
    numberText,
    issueDateText: formatIsoDay(request.cbteFch),
    issuer: {
      name: showTrade && tradeName ? tradeName : issuer.legalName,
      legalName: showTrade ? issuer.legalName : null,
      lines: issuerLines,
    },
    receiver: {
      name: receiverName,
      docText,
      conditionText: condicion?.label ?? '—',
      addressText: input.receiver.address?.trim() || null,
    },
    conceptText: CONCEPTO_TEXT[request.concepto] ?? 'Productos',
    serviceText: service,
    paymentDueText:
      request.concepto !== 1 && request.paymentDue
        ? `Vencimiento del pago: ${formatIsoDay(request.paymentDue)}`
        : null,
    associatedText,
    item: {
      description: input.detail.trim() || labelOf(request.cbteTipo),
      amount: formatCents(letter === 'A' ? subtotal : a.totalCents),
    },
    amountRows,
    totalText: formatCents(a.totalCents),
    legends: invoiceLegends({
      cbteTipo: request.cbteTipo,
      condicionIvaReceptorId: request.condicionIvaReceptorId,
      vatCents: a.vatCents,
    }),
    caeText: input.cae,
    caeDueText: formatIsoDay(input.caeDue),
    qrUrl: qr.url,
    documentLabel: `${labelOf(request.cbteTipo)} ${pvText}-${numberText}`,
  }
}
