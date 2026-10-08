/**
 * WSFEv1, factura electrónica (diseño §2.4.1 y §3.2; `arca-tecnico.md` §4; manual
 * del desarrollador v4.7 y el WSDL de homologación, que manda sobre el manual).
 *
 * - **Builders** (`*Body`): el sobre SOAP 1.1 de cada método con su SOAPAction
 *   exacto. `FECAESolicitar` sale con los elementos en el orden del WSDL,
 *   `CantReg = 1`, `MonId = PES`, `MonCotiz = 1` y `CondicionIVAReceptorId`
 *   siempre. Un dato que ARCA rechazaría no llega a la red: tira `ArcaRequestError`.
 * - **Parsers** (`parse*`): reciben el `Envelope` (o el texto) y devuelven datos
 *   limpios más los `errors` y `events` de ARCA tal cual, sin decidir nada.
 * - **Cliente** (`createWsfe`): decide. Los errores de negocio de WSFE (HTTP 200 con
 *   `<Errors>`) salen como `ArcaFault` `kind: 'service'`, salvo el 602 («no existen
 *   datos») donde significa «no hay» (`compConsultar` → `null`, `ptosVenta` → `[]`).
 *   Las llamadas que no cambian nada se reintentan **una** vez ante un error de red;
 *   `FECAESolicitar` **nunca** (si no hay respuesta, se consulta con
 *   `FECompConsultar` antes de volver a pedir: diseño §3.2.4).
 *
 * Puro + transporte: la red entra por el `ArcaTransport` y el ticket por `getAuth`.
 */

import type { AfipDocType, IsoDate } from '@/lib/accounting/types'
import { isRealIsoDay } from '@/lib/dates'
import { parseCuit } from '@/lib/fiscal'
import { child, childrenNamed, escapeXml, textAt, type XmlNode } from '@/lib/xml/mini'
import { ARCA_ENDPOINTS, ARCA_NAMESPACES, type ArcaEnvironment } from './endpoints'
import { checkWsfeAmounts, formatCents2, parseAmountToCents, type WsfeAmounts } from './importes'
import {
  type ArcaCallContext,
  ArcaFault,
  type ArcaMsg,
  ArcaRequestError,
  type ArcaTransport,
  asEnvelope,
  envelope11,
  isArcaFault,
  soapCall,
  soapResult,
} from './soap'
import {
  associableCbteTipos,
  type CbteTipo,
  CONDICION_IVA_RECEPTOR_IDS,
  isCbteTipo,
  isCondicionValidForLetter,
  isNoteCbte,
  letterForCbte,
} from './vouchers'

// ─── Métodos ─────────────────────────────────────────────────────────────────

export const WSFE_PARAM_METHODS = [
  'FEParamGetTiposCbte',
  'FEParamGetTiposIva',
  'FEParamGetTiposDoc',
  'FEParamGetTiposConcepto',
  'FEParamGetTiposMonedas',
  'FEParamGetTiposTributos',
  'FEParamGetTiposOpcional',
] as const
export type WsfeParamMethod = (typeof WSFE_PARAM_METHODS)[number]

export const WSFE_METHODS = [
  'FEDummy',
  'FECompUltimoAutorizado',
  'FECAESolicitar',
  'FECompConsultar',
  'FEParamGetPtosVenta',
  'FEParamGetCondicionIvaReceptor',
  'FECompTotXRequest',
  ...WSFE_PARAM_METHODS,
] as const
export type WsfeMethod = (typeof WSFE_METHODS)[number]

/** `"http://ar.gov.afip.dif.FEV1/<Metodo>"` sin las comillas (las pone `soapHeaders`). */
export function wsfeSoapAction(method: WsfeMethod): string {
  return `${ARCA_NAMESPACES.wsfe}${method}`
}

/** Un pedido listo para `soapCall`: método, SOAPAction y el sobre. */
export type WsfeCall = {
  readonly method: WsfeMethod
  readonly soapAction: string
  readonly body: string
}

/** El ticket del WSAA y la CUIT emisora (o representada: tiene que estar en el token). */
export type WsfeAuth = { readonly token: string; readonly sign: string; readonly cuit: string }

const CTX: ArcaCallContext = { service: 'wsfe', wsn: 'wsfe' }
const ctxFor = (method: WsfeMethod): ArcaCallContext => ({ ...CTX, method })

// ─── Builders ────────────────────────────────────────────────────────────────

function wsfeCall(method: WsfeMethod, inner: string): WsfeCall {
  const element = inner === '' ? `<ar:${method}/>` : `<ar:${method}>${inner}</ar:${method}>`
  return {
    method,
    soapAction: wsfeSoapAction(method),
    body: envelope11('ar', ARCA_NAMESPACES.wsfe, element),
  }
}

function authXml(auth: WsfeAuth): string {
  if (!auth.token.trim() || !auth.sign.trim()) {
    throw new ArcaRequestError('Auth', 'falta el ticket del WSAA')
  }
  const cuit = parseCuit(auth.cuit)
  if (!cuit.ok) throw new ArcaRequestError('Auth.Cuit', 'la CUIT no es válida')
  return (
    `<ar:Auth><ar:Token>${escapeXml(auth.token.trim())}</ar:Token>` +
    `<ar:Sign>${escapeXml(auth.sign.trim())}</ar:Sign><ar:Cuit>${cuit.cuit}</ar:Cuit></ar:Auth>`
  )
}

function intField(value: number, min: number, max: number, field: string): string {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ArcaRequestError(field, `tiene que ser un entero entre ${min} y ${max}`)
  }
  return String(value)
}

function dateField(value: IsoDate | null | undefined, field: string): string {
  if (!isRealIsoDay(value)) throw new ArcaRequestError(field, 'no es una fecha válida')
  return value.replaceAll('-', '')
}

export const PTO_VTA_MAX = 99_998
export const CBTE_NRO_MAX = 99_999_999

/** Estado de los servidores (sin autenticación). */
export function feDummyBody(): WsfeCall {
  return wsfeCall('FEDummy', '')
}

/** El último número autorizado para (punto de venta, tipo). */
export function ultimoAutorizadoBody(auth: WsfeAuth, ptoVta: number, cbteTipo: number): WsfeCall {
  return wsfeCall(
    'FECompUltimoAutorizado',
    `${authXml(auth)}<ar:PtoVta>${intField(ptoVta, 1, PTO_VTA_MAX, 'PtoVta')}</ar:PtoVta>` +
      `<ar:CbteTipo>${intField(cbteTipo, 1, 999, 'CbteTipo')}</ar:CbteTipo>`,
  )
}

/** Un comprobante ya emitido (orden del WSDL: `CbteTipo`, `CbteNro`, `PtoVta`). */
export function compConsultarBody(
  auth: WsfeAuth,
  cbteTipo: number,
  ptoVta: number,
  cbteNro: number,
): WsfeCall {
  return wsfeCall(
    'FECompConsultar',
    `${authXml(auth)}<ar:FeCompConsReq>` +
      `<ar:CbteTipo>${intField(cbteTipo, 1, 999, 'CbteTipo')}</ar:CbteTipo>` +
      `<ar:CbteNro>${intField(cbteNro, 1, CBTE_NRO_MAX, 'CbteNro')}</ar:CbteNro>` +
      `<ar:PtoVta>${intField(ptoVta, 1, PTO_VTA_MAX, 'PtoVta')}</ar:PtoVta>` +
      '</ar:FeCompConsReq>',
  )
}

/** Los puntos de venta de web services de la CUIT. */
export function ptosVentaBody(auth: WsfeAuth): WsfeCall {
  return wsfeCall('FEParamGetPtosVenta', authXml(auth))
}

/** Las condiciones frente al IVA del receptor (RG 5616), opcionalmente de una clase. */
export function condicionIvaReceptorBody(
  auth: WsfeAuth,
  claseCmp?: 'A' | 'ALEY' | 'B' | 'C' | '49',
): WsfeCall {
  const clase = claseCmp ? `<ar:ClaseCmp>${claseCmp}</ar:ClaseCmp>` : ''
  return wsfeCall('FEParamGetCondicionIvaReceptor', `${authXml(auth)}${clase}`)
}

/** Las tablas de parámetros (`FEParamGetTipos*`): solo llevan `Auth`. */
export function paramListBody(auth: WsfeAuth, method: WsfeParamMethod): WsfeCall {
  return wsfeCall(method, authXml(auth))
}

/** Cuántos registros acepta `FECAESolicitar` por pedido. */
export function compTotXRequestBody(auth: WsfeAuth): WsfeCall {
  return wsfeCall('FECompTotXRequest', authXml(auth))
}

// ─── FECAESolicitar ──────────────────────────────────────────────────────────

/** Comprobante asociado de una NC o ND (`CbtesAsoc/CbteAsoc`). */
export type CaeAssociated = {
  readonly cbteTipo: number
  readonly ptoVta: number
  readonly number: number
  /** CUIT del emisor del asociado (la nuestra). */
  readonly cuit?: string | null
  readonly cbteFch?: IsoDate | null
}

/** Un comprobante para pedir CAE (CantReg = 1). Fechas `'yyyy-MM-dd'` (día de Córdoba); plata en centavos. */
export type CaeRequest = {
  readonly ptoVta: number
  readonly cbteTipo: CbteTipo
  /** El número a autorizar (= último autorizado + 1). */
  readonly number: number
  /** 1 productos · 2 servicios · 3 productos y servicios. */
  readonly concepto: 1 | 2 | 3
  readonly docTipo: AfipDocType
  /** Solo dígitos; `'0'` con `docTipo` 99. */
  readonly docNro: string
  readonly cbteFch: IsoDate
  readonly amounts: WsfeAmounts
  /** RG 5616: se manda siempre (`CONDICION_IVA_RECEPTOR`). */
  readonly condicionIvaReceptorId: number
  /** Obligatorias con concepto 2 o 3 (10049); no van con concepto 1. */
  readonly serviceFrom?: IsoDate | null
  readonly serviceTo?: IsoDate | null
  readonly paymentDue?: IsoDate | null
  /** NC y ND: el comprobante que corrigen (10197). */
  readonly associated?: readonly CaeAssociated[]
  /** NC y ND sin comprobante asociado: el período (`PeriodoAsoc`). */
  readonly associatedPeriod?: { readonly from: IsoDate; readonly to: IsoDate } | null
}

/** Un pedazo de XML como datos: texto, otro registro o una lista que se repite. */
export type WsfeRecord = { readonly [key: string]: string | WsfeRecord | readonly WsfeRecord[] }

/** El `FeCAEReq` como registro, **sin** `Auth`: es lo que se guarda en `acc_arca_vouchers.request`. */
export type CaeRequestRecord = {
  readonly FeCabReq: WsfeRecord
  readonly FeDetReq: { readonly FECAEDetRequest: readonly WsfeRecord[] }
}

/**
 * `FeCAEReq` en el orden del WSDL. Valida lo que ARCA rechazaría (rangos, clase A
 * con CUIT, condición del receptor contra la letra, fechas de servicio, asociados
 * de NC y ND, importes con `checkWsfeAmounts`) y tira `ArcaRequestError` sin
 * llegar a la red.
 */
export function caeRequestRecord(req: CaeRequest): CaeRequestRecord {
  if (!isCbteTipo(req.cbteTipo)) {
    throw new ArcaRequestError('CbteTipo', 'la plataforma solo emite 1, 2, 3, 6, 7 y 8')
  }
  const letter = letterForCbte(req.cbteTipo)
  const ptoVta = intField(req.ptoVta, 1, PTO_VTA_MAX, 'PtoVta')
  const number = intField(req.number, 1, CBTE_NRO_MAX, 'CbteDesde')
  if (req.concepto !== 1 && req.concepto !== 2 && req.concepto !== 3) {
    throw new ArcaRequestError('Concepto', 'tiene que ser 1, 2 o 3')
  }

  // Documento del receptor.
  let docNro: string
  if (req.docTipo === 99) {
    if (req.docNro !== '0') throw new ArcaRequestError('DocNro', 'con DocTipo 99 va 0')
    docNro = '0'
  } else if (req.docTipo === 80 || req.docTipo === 86) {
    const parsed = parseCuit(req.docNro)
    if (!parsed.ok) throw new ArcaRequestError('DocNro', 'la CUIT del receptor no es válida')
    docNro = parsed.cuit
  } else if (req.docTipo === 96) {
    if (!/^\d{1,8}$/.test(req.docNro) || Number(req.docNro) === 0) {
      throw new ArcaRequestError('DocNro', 'el DNI no es válido')
    }
    docNro = String(Number(req.docNro))
  } else {
    throw new ArcaRequestError('DocTipo', 'tiene que ser 80, 86, 96 o 99')
  }
  if (letter === 'A' && req.docTipo !== 80) {
    throw new ArcaRequestError('DocTipo', 'la clase A va con CUIT (80)')
  }

  // Condición frente al IVA del receptor (RG 5616).
  if (!CONDICION_IVA_RECEPTOR_IDS.has(req.condicionIvaReceptorId)) {
    throw new ArcaRequestError('CondicionIVAReceptorId', 'no es una condición de la RG 5616')
  }
  if (!isCondicionValidForLetter(req.condicionIvaReceptorId, letter)) {
    throw new ArcaRequestError('CondicionIVAReceptorId', `no va con la clase ${letter}`)
  }

  // Importes.
  const amountIssues = checkWsfeAmounts(req.amounts, { cbteTipo: req.cbteTipo })
  if (amountIssues.length > 0) throw new ArcaRequestError('importes', amountIssues.join(', '))
  const a = req.amounts

  const det: Record<string, string | WsfeRecord | readonly WsfeRecord[]> = {
    Concepto: String(req.concepto),
    DocTipo: String(req.docTipo),
    DocNro: docNro,
    CbteDesde: number,
    CbteHasta: number,
    CbteFch: dateField(req.cbteFch, 'CbteFch'),
    ImpTotal: formatCents2(a.totalCents),
    ImpTotConc: formatCents2(a.nonTaxedCents),
    ImpNeto: formatCents2(a.netCents),
    ImpOpEx: formatCents2(a.exemptCents),
    ImpTrib: formatCents2(a.tributesCents),
    ImpIVA: formatCents2(a.vatCents),
  }

  // Fechas del servicio: obligatorias con concepto 2 o 3, prohibidas con 1.
  const hasServiceDates = req.serviceFrom != null || req.serviceTo != null || req.paymentDue != null
  if (req.concepto === 1) {
    if (hasServiceDates) {
      throw new ArcaRequestError('FchServDesde', 'con concepto 1 no van fechas de servicio')
    }
  } else {
    const from = dateField(req.serviceFrom, 'FchServDesde')
    const to = dateField(req.serviceTo, 'FchServHasta')
    if (from > to) throw new ArcaRequestError('FchServHasta', 'es anterior a FchServDesde')
    det.FchServDesde = from
    det.FchServHasta = to
    det.FchVtoPago = dateField(req.paymentDue, 'FchVtoPago')
  }

  det.MonId = 'PES'
  det.MonCotiz = '1'
  det.CondicionIVAReceptorId = String(req.condicionIvaReceptorId)

  // Asociados: NC y ND necesitan un comprobante o un período (10197); las facturas, nada.
  const associated = req.associated ?? []
  const period = req.associatedPeriod ?? null
  if (isNoteCbte(req.cbteTipo)) {
    if (associated.length === 0 && !period) {
      throw new ArcaRequestError('CbtesAsoc', 'una NC o ND asocia un comprobante o un período')
    }
    if (associated.length > 0 && period) {
      throw new ArcaRequestError(
        'CbtesAsoc',
        'van los comprobantes asociados o el período, no los dos',
      )
    }
  } else if (associated.length > 0 || period) {
    throw new ArcaRequestError('CbtesAsoc', 'una factura no lleva asociados')
  }
  if (associated.length > 0) {
    const allowed = associableCbteTipos(req.cbteTipo)
    const seen = new Set<string>()
    det.CbtesAsoc = {
      CbteAsoc: associated.map((x, i): WsfeRecord => {
        const field = `CbtesAsoc.${i}`
        if (!allowed.includes(x.cbteTipo)) {
          throw new ArcaRequestError(`${field}.Tipo`, 'no se puede asociar a este comprobante')
        }
        const key = `${x.cbteTipo}-${x.ptoVta}-${x.number}`
        if (seen.has(key)) throw new ArcaRequestError(field, 'está repetido')
        seen.add(key)
        const record: Record<string, string> = {
          Tipo: String(x.cbteTipo),
          PtoVta: intField(x.ptoVta, 1, PTO_VTA_MAX, `${field}.PtoVta`),
          Nro: intField(x.number, 1, CBTE_NRO_MAX, `${field}.Nro`),
        }
        if (x.cuit != null) {
          const cuit = parseCuit(x.cuit)
          if (!cuit.ok) throw new ArcaRequestError(`${field}.Cuit`, 'la CUIT no es válida')
          record.Cuit = cuit.cuit
        }
        if (x.cbteFch != null) record.CbteFch = dateField(x.cbteFch, `${field}.CbteFch`)
        return record
      }),
    }
  }
  if (a.iva.length > 0) {
    det.Iva = {
      AlicIva: a.iva.map(
        (x): WsfeRecord => ({
          Id: String(x.id),
          BaseImp: formatCents2(x.baseCents),
          Importe: formatCents2(x.vatCents),
        }),
      ),
    }
  }
  if (period) {
    const from = dateField(period.from, 'PeriodoAsoc.FchDesde')
    const to = dateField(period.to, 'PeriodoAsoc.FchHasta')
    if (from > to) throw new ArcaRequestError('PeriodoAsoc.FchHasta', 'es anterior a FchDesde')
    det.PeriodoAsoc = { FchDesde: from, FchHasta: to }
  }

  return {
    FeCabReq: { CantReg: '1', PtoVta: ptoVta, CbteTipo: String(req.cbteTipo) },
    FeDetReq: { FECAEDetRequest: [det] },
  }
}

function isRecordList(value: WsfeRecord | readonly WsfeRecord[]): value is readonly WsfeRecord[] {
  return Array.isArray(value)
}

/** Serializa un registro con el prefijo `ar:` y todo el texto escapado. */
export function wsfeRecordXml(record: WsfeRecord): string {
  let out = ''
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'string') out += `<ar:${name}>${escapeXml(value)}</ar:${name}>`
    else if (isRecordList(value)) {
      for (const item of value) out += `<ar:${name}>${wsfeRecordXml(item)}</ar:${name}>`
    } else out += `<ar:${name}>${wsfeRecordXml(value)}</ar:${name}>`
  }
  return out
}

/** Pedido de CAE para un comprobante (`CantReg = 1`). */
export function caeSolicitarBody(auth: WsfeAuth, req: CaeRequest): WsfeCall {
  const record = caeRequestRecord(req)
  return wsfeCall(
    'FECAESolicitar',
    `${authXml(auth)}<ar:FeCAEReq>${wsfeRecordXml(record)}</ar:FeCAEReq>`,
  )
}

// ─── Lectura de respuestas ───────────────────────────────────────────────────

function resultOf(input: XmlNode | string, method: WsfeMethod): XmlNode {
  const ctx = ctxFor(method)
  return soapResult(asEnvelope(input, ctx), `${method}Response/${method}Result`, ctx)
}

function clean(text: string | null): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > 500 ? `${flat.slice(0, 500)}…` : flat
}

function textOrNull(node: XmlNode | null, path: string): string | null {
  const text = textAt(node, path)
  if (text === null) return null
  const flat = clean(text)
  return flat === '' ? null : flat
}

function intOrNull(node: XmlNode | null, path: string): number | null {
  const text = textOrNull(node, path)
  if (text === null || !/^-?\d{1,15}$/.test(text)) return null
  return Number(text)
}

function centsOrNull(node: XmlNode | null, path: string): number | null {
  return parseAmountToCents(textOrNull(node, path))
}

/** `'20261018'` → `'2026-10-18'`; `null` si no es una fecha real. */
export function wsfeDate(text: string | null | undefined): IsoDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((text ?? '').trim())
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  return isRealIsoDay(iso) ? iso : null
}

/** `FchProceso` (`yyyymmddhhmiss`, hora de Argentina) → ISO con `-03:00`; `null` si no tiene hora. */
export function wsfeProcessedAt(text: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec((text ?? '').trim())
  if (!m) return null
  const day = `${m[1]}-${m[2]}-${m[3]}`
  if (!isRealIsoDay(day) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) {
    return null
  }
  return `${day}T${m[4]}:${m[5]}:${m[6]}-03:00`
}

/**
 * Los mensajes (`Code` + `Msg`) de un contenedor de WSFE: `Errors/Err`,
 * `Events/Evt`, `Observaciones/Obs`. Toma todo elemento de adentro que tenga
 * `Code`, así tolera el orden invertido de algunos ejemplos del manual.
 */
export function readMessages(container: XmlNode | null): ArcaMsg[] {
  if (!container) return []
  const out: ArcaMsg[] = []
  const stack: XmlNode[] = [...container.children].reverse()
  let node = stack.pop()
  while (node) {
    const code = textAt(node, 'Code')
    if (code !== null) {
      const n = Number.parseInt(code.trim(), 10)
      out.push({ code: Number.isFinite(n) ? n : 0, msg: clean(textAt(node, 'Msg')) })
    } else {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const kid = node.children[i]
        if (kid) stack.push(kid)
      }
    }
    node = stack.pop()
  }
  return out
}

const errorsOf = (result: XmlNode) => readMessages(child(result, 'Errors'))
const eventsOf = (result: XmlNode) => readMessages(child(result, 'Events'))

export type FeDummyStatus = {
  readonly appServer: string | null
  readonly dbServer: string | null
  readonly authServer: string | null
  /** Los tres en `OK`. */
  readonly ok: boolean
}

export function parseFeDummy(input: XmlNode | string): FeDummyStatus {
  const result = resultOf(input, 'FEDummy')
  const appServer = textOrNull(result, 'AppServer')
  const dbServer = textOrNull(result, 'DbServer')
  const authServer = textOrNull(result, 'AuthServer')
  return {
    appServer,
    dbServer,
    authServer,
    ok: appServer === 'OK' && dbServer === 'OK' && authServer === 'OK',
  }
}

export type UltimoAutorizado = {
  readonly ptoVta: number | null
  readonly cbteTipo: number | null
  /** 0 si todavía no hay ninguno. */
  readonly cbteNro: number | null
  readonly errors: readonly ArcaMsg[]
  readonly events: readonly ArcaMsg[]
}

export function parseUltimoAutorizado(input: XmlNode | string): UltimoAutorizado {
  const result = resultOf(input, 'FECompUltimoAutorizado')
  return {
    ptoVta: intOrNull(result, 'PtoVta'),
    cbteTipo: intOrNull(result, 'CbteTipo'),
    cbteNro: intOrNull(result, 'CbteNro'),
    errors: errorsOf(result),
    events: eventsOf(result),
  }
}

export type CaeResult = {
  /** `A` aprobado · `R` rechazado · `P` parcial (solo en lotes). */
  readonly resultado: 'A' | 'R' | 'P'
  readonly reproceso: string | null
  /** 14 dígitos; solo con `A`. */
  readonly cae: string | null
  /** Vencimiento del CAE. */
  readonly caeDue: IsoDate | null
  /** `FchProceso` tal cual vino. */
  readonly fchProceso: string | null
  /** `FchProceso` como ISO con `-03:00`, si trae hora. */
  readonly processedAt: string | null
  readonly cbteDesde: number | null
  readonly cbteHasta: number | null
  readonly cbteFch: IsoDate | null
  /** `Observaciones/Obs` del comprobante (con `A` son avisos; con `R`, el motivo). */
  readonly obs: readonly ArcaMsg[]
  /** `Errors/Err` del pedido (emisor, autenticación, infraestructura). */
  readonly errors: readonly ArcaMsg[]
  readonly events: readonly ArcaMsg[]
}

/**
 * La respuesta de `FECAESolicitar`. Si viene `A` sin un CAE de 14 dígitos o sin
 * vencimiento, o si no hay `Resultado` ni errores, tira `ArcaFault('protocol')`:
 * para la saga es «no sabemos qué pasó» y se consulta con `FECompConsultar`.
 */
export function parseCaeResponse(input: XmlNode | string): CaeResult {
  const ctx = ctxFor('FECAESolicitar')
  const result = resultOf(input, 'FECAESolicitar')
  const cab = child(result, 'FeCabResp')
  const detResp = child(result, 'FeDetResp')
  const det =
    childrenNamed(detResp, 'FECAEDetResponse')[0] ??
    childrenNamed(detResp, 'FEDetResponse')[0] ??
    null
  const errors = errorsOf(result)
  const events = eventsOf(result)
  const obs = readMessages(child(det, 'Observaciones') ?? child(det, 'Obs'))

  const raw = (textOrNull(det, 'Resultado') ?? textOrNull(cab, 'Resultado') ?? '').toUpperCase()
  let resultado: CaeResult['resultado']
  if (raw === 'A' || raw === 'R' || raw === 'P') resultado = raw
  else if (errors.length > 0) resultado = 'R'
  else throw new ArcaFault('protocol', 'missing:Resultado', ctx)

  let cae: string | null = null
  let caeDue: IsoDate | null = null
  if (resultado === 'A') {
    cae = textOrNull(det, 'CAE')
    if (cae === null || !/^\d{14}$/.test(cae)) throw new ArcaFault('protocol', 'bad:CAE', ctx)
    caeDue = wsfeDate(textOrNull(det, 'CAEFchVto'))
    if (caeDue === null) throw new ArcaFault('protocol', 'bad:CAEFchVto', ctx)
  }
  const fchProceso = textOrNull(cab, 'FchProceso')
  return {
    resultado,
    reproceso: textOrNull(cab, 'Reproceso'),
    cae,
    caeDue,
    fchProceso,
    processedAt: wsfeProcessedAt(fchProceso),
    cbteDesde: intOrNull(det, 'CbteDesde'),
    cbteHasta: intOrNull(det, 'CbteHasta'),
    cbteFch: wsfeDate(textOrNull(det, 'CbteFch')),
    obs,
    errors,
    events,
  }
}

export type ConsultedAliquot = {
  readonly id: number | null
  readonly baseCents: number | null
  readonly vatCents: number | null
}

/** Un comprobante como lo devuelve `FECompConsultar` (`ResultGet`). */
export type ConsultedVoucher = {
  readonly resultado: string | null
  /** `CodAutorizacion`: el CAE (o CAEA). */
  readonly cae: string | null
  /** `FchVto`. */
  readonly caeDue: IsoDate | null
  /** `EmisionTipo`: `CAE` o `CAEA`. */
  readonly emisionTipo: string | null
  readonly fchProceso: string | null
  readonly processedAt: string | null
  readonly ptoVta: number | null
  readonly cbteTipo: number | null
  readonly cbteDesde: number | null
  readonly cbteHasta: number | null
  readonly cbteFch: IsoDate | null
  readonly concepto: number | null
  readonly docTipo: number | null
  readonly docNro: string | null
  readonly totalCents: number | null
  readonly nonTaxedCents: number | null
  readonly netCents: number | null
  readonly exemptCents: number | null
  readonly tributesCents: number | null
  readonly vatCents: number | null
  readonly condicionIvaReceptorId: number | null
  readonly iva: readonly ConsultedAliquot[]
  readonly obs: readonly ArcaMsg[]
}

export type CompConsulta = {
  /** `null` si no vino `ResultGet` (mirá `errors`: el 602 es «no existe»). */
  readonly voucher: ConsultedVoucher | null
  readonly errors: readonly ArcaMsg[]
  readonly events: readonly ArcaMsg[]
}

export function parseCompConsultar(input: XmlNode | string): CompConsulta {
  const result = resultOf(input, 'FECompConsultar')
  const get = child(result, 'ResultGet')
  const errors = errorsOf(result)
  const events = eventsOf(result)
  if (!get) return { voucher: null, errors, events }
  const fchProceso = textOrNull(get, 'FchProceso')
  const docNro = textOrNull(get, 'DocNro')
  return {
    voucher: {
      resultado: textOrNull(get, 'Resultado'),
      cae: textOrNull(get, 'CodAutorizacion'),
      caeDue: wsfeDate(textOrNull(get, 'FchVto')),
      emisionTipo: textOrNull(get, 'EmisionTipo'),
      fchProceso,
      processedAt: wsfeProcessedAt(fchProceso),
      ptoVta: intOrNull(get, 'PtoVta'),
      cbteTipo: intOrNull(get, 'CbteTipo'),
      cbteDesde: intOrNull(get, 'CbteDesde'),
      cbteHasta: intOrNull(get, 'CbteHasta'),
      cbteFch: wsfeDate(textOrNull(get, 'CbteFch')),
      concepto: intOrNull(get, 'Concepto'),
      docTipo: intOrNull(get, 'DocTipo'),
      docNro: docNro && /^\d+$/.test(docNro) ? docNro.replace(/^0+(?=\d)/, '') : docNro,
      totalCents: centsOrNull(get, 'ImpTotal'),
      nonTaxedCents: centsOrNull(get, 'ImpTotConc'),
      netCents: centsOrNull(get, 'ImpNeto'),
      exemptCents: centsOrNull(get, 'ImpOpEx'),
      tributesCents: centsOrNull(get, 'ImpTrib'),
      vatCents: centsOrNull(get, 'ImpIVA'),
      condicionIvaReceptorId: intOrNull(get, 'CondicionIVAReceptorId'),
      iva: childrenNamed(child(get, 'Iva'), 'AlicIva').map((x) => ({
        id: intOrNull(x, 'Id'),
        baseCents: centsOrNull(x, 'BaseImp'),
        vatCents: centsOrNull(x, 'Importe'),
      })),
      obs: readMessages(child(get, 'Observaciones')),
    },
    errors,
    events,
  }
}

/**
 * Qué campos de un comprobante consultado no coinciden con el pedido (nombres de
 * WSFE). Vacío = es el mismo comprobante: sirve para reconciliar un timeout antes
 * de darlo por autorizado.
 */
export function compConsultaMismatches(found: ConsultedVoucher, req: CaeRequest): string[] {
  const out: string[] = []
  const docNro = req.docTipo === 99 ? '0' : req.docNro.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const checks: Array<[string, unknown, unknown]> = [
    ['PtoVta', found.ptoVta, req.ptoVta],
    ['CbteTipo', found.cbteTipo, req.cbteTipo],
    ['CbteDesde', found.cbteDesde, req.number],
    ['Concepto', found.concepto, req.concepto],
    ['DocTipo', found.docTipo, req.docTipo],
    ['DocNro', found.docNro, docNro],
    ['CbteFch', found.cbteFch, req.cbteFch],
    ['ImpTotal', found.totalCents, req.amounts.totalCents],
    ['ImpNeto', found.netCents, req.amounts.netCents],
    ['ImpIVA', found.vatCents, req.amounts.vatCents],
  ]
  for (const [name, got, want] of checks) if (got !== want) out.push(name)
  return out
}

export type PtoVenta = {
  readonly nro: number
  /** `CAE` o `CAEA` (como lo informa ARCA). */
  readonly emisionTipo: string | null
  readonly bloqueado: boolean
  readonly fchBaja: IsoDate | null
}

export type PtosVentaResult = {
  readonly items: readonly PtoVenta[]
  readonly errors: readonly ArcaMsg[]
  readonly events: readonly ArcaMsg[]
}

export function parsePtosVenta(input: XmlNode | string): PtosVentaResult {
  const result = resultOf(input, 'FEParamGetPtosVenta')
  const items: PtoVenta[] = []
  for (const node of childrenNamed(child(result, 'ResultGet'), 'PtoVenta')) {
    const nro = intOrNull(node, 'Nro')
    if (nro === null) continue
    items.push({
      nro,
      emisionTipo: textOrNull(node, 'EmisionTipo'),
      bloqueado: (textOrNull(node, 'Bloqueado') ?? '').toUpperCase() === 'S',
      fchBaja: wsfeDate(textOrNull(node, 'FchBaja')),
    })
  }
  return { items, errors: errorsOf(result), events: eventsOf(result) }
}

/**
 * Cómo está un punto de venta para emitir con CAE (chequeo 4 de «Probar
 * conexión»): `ok`, `missing` (no está o no es de web services), `blocked`,
 * `dropped` (dado de baja: no se puede volver a usar) o `caea` (solo CAEA).
 */
export function pointOfSaleStatus(
  items: readonly PtoVenta[],
  nro: number,
): 'ok' | 'missing' | 'blocked' | 'dropped' | 'caea' {
  const pv = items.find((p) => p.nro === nro)
  if (!pv) return 'missing'
  if (pv.fchBaja) return 'dropped'
  if (pv.bloqueado) return 'blocked'
  if (/CAEA/i.test(pv.emisionTipo ?? '')) return 'caea'
  return 'ok'
}

export type CondicionIvaReceptorItem = {
  readonly id: number
  readonly desc: string | null
  /** `Cmp_Clase` (`A/M/C`, `B/C`…). */
  readonly clase: string | null
}

export function parseCondicionIvaReceptor(input: XmlNode | string): {
  readonly items: readonly CondicionIvaReceptorItem[]
  readonly errors: readonly ArcaMsg[]
  readonly events: readonly ArcaMsg[]
} {
  const result = resultOf(input, 'FEParamGetCondicionIvaReceptor')
  const items: CondicionIvaReceptorItem[] = []
  for (const node of childrenNamed(child(result, 'ResultGet'), 'CondicionIvaReceptor')) {
    const id = intOrNull(node, 'Id')
    if (id === null) continue
    items.push({ id, desc: textOrNull(node, 'Desc'), clase: textOrNull(node, 'Cmp_Clase') })
  }
  return { items, errors: errorsOf(result), events: eventsOf(result) }
}

/**
 * Una tabla de parámetros (`FEParamGetTipos*`): cada fila con sus campos tal cual
 * (`{ Id: '5', Desc: '21%', FchDesde: '20090220', FchHasta: 'NULL' }`).
 */
export function parseParamList(
  input: XmlNode | string,
  method: WsfeParamMethod,
): {
  readonly items: readonly Readonly<Record<string, string>>[]
  readonly errors: readonly ArcaMsg[]
  readonly events: readonly ArcaMsg[]
} {
  const result = resultOf(input, method)
  const items = (child(result, 'ResultGet')?.children ?? []).map((row) => {
    const fields: Record<string, string> = {}
    for (const field of row.children) fields[field.name] = clean(field.text)
    return fields
  })
  return { items, errors: errorsOf(result), events: eventsOf(result) }
}

export function parseCompTotXRequest(input: XmlNode | string): {
  readonly regXReq: number | null
  readonly errors: readonly ArcaMsg[]
} {
  const result = resultOf(input, 'FECompTotXRequest')
  return { regXReq: intOrNull(result, 'RegXReq'), errors: errorsOf(result) }
}

// ─── Cliente ─────────────────────────────────────────────────────────────────

export type WsfeClient = {
  readonly environment: ArcaEnvironment
  /** Estado de los servidores (sin autenticación). */
  dummy(): Promise<FeDummyStatus>
  /** El último número autorizado (0 si no hay ninguno). */
  ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number>
  /** Pide el CAE. **Sin reintento**: ante red o timeout, reconciliar con `compConsultar`. */
  caeSolicitar(req: CaeRequest): Promise<CaeResult>
  /** El comprobante emitido, o `null` si ARCA dice que no existe (602). */
  compConsultar(cbteTipo: number, ptoVta: number, cbteNro: number): Promise<ConsultedVoucher | null>
  /** Los puntos de venta de web services (`[]` si no hay ninguno). */
  ptosVenta(): Promise<PtoVenta[]>
  condicionesIvaReceptor(
    claseCmp?: 'A' | 'ALEY' | 'B' | 'C' | '49',
  ): Promise<CondicionIvaReceptorItem[]>
  paramList(method: WsfeParamMethod): Promise<Readonly<Record<string, string>>[]>
}

export type WsfeClientOptions = {
  /** Tope por llamada (por defecto, 25 s). */
  readonly timeoutMs?: number
}

/** `ArcaFault('service')` con los errores de WSFE. */
function serviceFault(method: WsfeMethod, errors: readonly ArcaMsg[]): ArcaFault {
  const first = errors[0]
  return new ArcaFault('service', first ? String(first.code) : 'unknown', {
    ...ctxFor(method),
    messages: errors,
    detail: first?.msg ?? null,
  })
}

const onlyNoData = (errors: readonly ArcaMsg[]) =>
  errors.length > 0 && errors.every((e) => e.code === 602)

/**
 * Cliente de WSFEv1 para un ambiente. `getAuth` da el ticket y la CUIT
 * representada (lo cachea la sesión, `lib/arca/session.ts`).
 */
export function createWsfe(
  transport: ArcaTransport,
  env: ArcaEnvironment,
  getAuth: () => Promise<WsfeAuth>,
  options: WsfeClientOptions = {},
): WsfeClient {
  const url = ARCA_ENDPOINTS[env].wsfe

  const send = async (call: WsfeCall, idempotent: boolean): Promise<XmlNode> => {
    const input = {
      url,
      soapAction: call.soapAction,
      body: call.body,
      timeoutMs: options.timeoutMs,
      ...ctxFor(call.method),
    }
    try {
      return await soapCall(transport, input)
    } catch (e) {
      // Una sola vez y solo si no hubo respuesta (nunca en FECAESolicitar).
      if (idempotent && isArcaFault(e) && e.kind === 'network') return soapCall(transport, input)
      throw e
    }
  }

  return {
    environment: env,

    async dummy() {
      return parseFeDummy(await send(feDummyBody(), true))
    },

    async ultimoAutorizado(ptoVta, cbteTipo) {
      const call = ultimoAutorizadoBody(await getAuth(), ptoVta, cbteTipo)
      const r = parseUltimoAutorizado(await send(call, true))
      if (r.errors.length > 0) throw serviceFault(call.method, r.errors)
      if (r.cbteNro === null || r.cbteNro < 0) {
        throw new ArcaFault('protocol', 'missing:CbteNro', ctxFor(call.method))
      }
      return r.cbteNro
    },

    async caeSolicitar(req) {
      const call = caeSolicitarBody(await getAuth(), req)
      const result = parseCaeResponse(await send(call, false))
      if (
        result.resultado === 'A' &&
        result.cbteDesde !== null &&
        result.cbteDesde !== req.number
      ) {
        // ARCA autorizó otro número: no se da por bueno sin consultar.
        throw new ArcaFault('protocol', 'cae_number_mismatch', ctxFor(call.method))
      }
      return result
    },

    async compConsultar(cbteTipo, ptoVta, cbteNro) {
      const call = compConsultarBody(await getAuth(), cbteTipo, ptoVta, cbteNro)
      const r = parseCompConsultar(await send(call, true))
      if (r.voucher) return r.voucher
      if (onlyNoData(r.errors)) return null
      if (r.errors.length > 0) throw serviceFault(call.method, r.errors)
      throw new ArcaFault('protocol', 'missing:ResultGet', ctxFor(call.method))
    },

    async ptosVenta() {
      const call = ptosVentaBody(await getAuth())
      const r = parsePtosVenta(await send(call, true))
      if (r.errors.length > 0 && !onlyNoData(r.errors)) throw serviceFault(call.method, r.errors)
      return [...r.items]
    },

    async condicionesIvaReceptor(claseCmp) {
      const call = condicionIvaReceptorBody(await getAuth(), claseCmp)
      const r = parseCondicionIvaReceptor(await send(call, true))
      if (r.errors.length > 0) throw serviceFault(call.method, r.errors)
      return [...r.items]
    },

    async paramList(method) {
      const call = paramListBody(await getAuth(), method)
      const r = parseParamList(await send(call, true), method)
      if (r.errors.length > 0) throw serviceFault(call.method, r.errors)
      return [...r.items]
    },
  }
}
