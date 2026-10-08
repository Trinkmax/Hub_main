/**
 * SOAP mínimo para los web services de ARCA (diseño §2.4.1 y §2.9;
 * `arca-tecnico.md` §4.1 y §6.2).
 *
 * - **Sobres:** `envelope11` / `envelope12` arman el `Envelope` con el prefijo y el
 *   namespace del servicio. El cuerpo lo arma cada módulo (`wsaa`, `wsfe`, `padron`)
 *   escapando todo lo que no es fijo.
 * - **SOAPAction:** en SOAP 1.1 va en su header, entre comillas. En WSFE tiene que
 *   ser **exacto** (`"http://ar.gov.afip.dif.FEV1/<Metodo>"`; vacío da HTTP 500); en
 *   el WSAA y el padrón es `""`. En SOAP 1.2 viaja como `action` del Content-Type.
 * - **`soapCall`** manda el pedido por un `ArcaTransport` y devuelve el `Envelope`
 *   ya leído. Todo lo que no es una respuesta SOAP sana sale como `ArcaFault`: un
 *   `Fault` (`kind: 'fault'`, con el `faultcode` sin prefijo: `cms.cert.untrusted`),
 *   un HTTP de error sin `Fault` (`'http'`), una página que no es SOAP o un XML roto
 *   (`'protocol'`), y lo que tira el transporte (`'network'`, `'timeout'`). Los
 *   errores de negocio de WSFE vuelven con HTTP 200 dentro de `<Errors>`: esos los
 *   lee cada servicio y, si corresponde, los tira como `kind: 'service'`.
 * - Una página XHTML se lee sin error como XML, así que además se exige que la raíz
 *   sea un `Envelope`.
 *
 * Puro (sin Node ni red): el transporte se recibe por parámetro. El de verdad, con
 * `node:https`, está en `transport.ts`; los tests usan uno falso.
 */

import { child, escapeXml, nodeAt, parseXml, textAt, type XmlNode } from '@/lib/xml/mini'
import type { ArcaWsn } from './endpoints'

// ─── El contrato del transporte ──────────────────────────────────────────────

export type ArcaHttpRequest = {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  /** Tope de toda la llamada (conexión, envío y respuesta). */
  readonly timeoutMs: number
}

export type ArcaHttpResponse = { readonly status: number; readonly body: string }

/**
 * Manda un POST y devuelve el status y el cuerpo, sea cual sea el status. Si no
 * hay respuesta tira `ArcaFault` (`network` o `timeout`).
 */
export type ArcaTransport = (request: ArcaHttpRequest) => Promise<ArcaHttpResponse>

// ─── Errores ─────────────────────────────────────────────────────────────────

export const ARCA_FAULT_KINDS = [
  /** `soap:Fault` (WSAA, padrón o un pedido mal armado). `code` = `faultcode` sin prefijo. */
  'fault',
  /** HTTP de error sin `Fault` adentro. `code` = `http_<status>`. */
  'http',
  /** No hubo respuesta: conexión rechazada, DNS, TLS, corte. `code` = el de Node (`ECONNREFUSED`). */
  'network',
  /** Se pasó el tope de tiempo de la llamada. */
  'timeout',
  /** Vino algo que no es la respuesta esperada (HTML, XML roto, falta un elemento). */
  'protocol',
  /** Errores de negocio de WSFE (`Errors/Err`, HTTP 200). `code` = el del primero; todos en `messages`. */
  'service',
] as const
export type ArcaFaultKind = (typeof ARCA_FAULT_KINDS)[number]

/** Un mensaje de ARCA con código: `Err`, `Obs` o `Evt` de WSFE. */
export type ArcaMsg = { readonly code: number; readonly msg: string }

/** A qué web service se le estaba hablando. */
export type ArcaCallService = 'wsaa' | 'wsfe' | 'padron'

export type ArcaCallContext = {
  readonly service?: ArcaCallService | null
  /** El servicio de negocio en juego (en el WSAA, el que se pidió en el TRA). */
  readonly wsn?: ArcaWsn | null
  /** `loginCms`, `FECAESolicitar`, `getPersona_v2`… (para el log). */
  readonly method?: string | null
}

export type ArcaFaultInit = ArcaCallContext & {
  readonly detail?: string | null
  readonly httpStatus?: number | null
  readonly messages?: readonly ArcaMsg[]
  readonly cause?: unknown
}

const DETAIL_MAX = 500

/**
 * Falla de una llamada a ARCA. `message` es solo `ARCA <kind>: <code> (<método>)`,
 * sin el texto de ARCA, así se puede loguear tal cual. `detail` (el `faultstring` o
 * el `Msg`) y `messages` pueden traer una CUIT: no van a los logs.
 */
export class ArcaFault extends Error {
  readonly kind: ArcaFaultKind
  readonly code: string
  readonly detail: string
  readonly httpStatus: number | null
  readonly messages: readonly ArcaMsg[]
  readonly service: ArcaCallService | null
  readonly wsn: ArcaWsn | null
  readonly method: string | null

  constructor(kind: ArcaFaultKind, code: string, init: ArcaFaultInit = {}) {
    super(
      `ARCA ${kind}: ${code}${init.method ? ` (${init.method})` : ''}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    )
    this.name = 'ArcaFault'
    this.kind = kind
    this.code = code
    this.detail = clip(init.detail ?? '', DETAIL_MAX)
    this.httpStatus = init.httpStatus ?? null
    this.messages = init.messages ?? []
    this.service = init.service ?? null
    this.wsn = init.wsn ?? null
    this.method = init.method ?? null
  }

  /** La misma falla con el contexto de la llamada, sin pisar lo que ya traía. */
  withContext(ctx: ArcaCallContext): ArcaFault {
    const service = this.service ?? ctx.service ?? null
    const wsn = this.wsn ?? ctx.wsn ?? null
    const method = this.method ?? ctx.method ?? null
    if (service === this.service && wsn === this.wsn && method === this.method) return this
    return new ArcaFault(this.kind, this.code, {
      detail: this.detail,
      httpStatus: this.httpStatus,
      messages: this.messages,
      service,
      wsn,
      method,
      cause: this.cause,
    })
  }
}

/** ¿Es una `ArcaFault`? (también si vino de otra copia del módulo). */
export function isArcaFault(e: unknown): e is ArcaFault {
  if (e instanceof ArcaFault) return true
  if (!(e instanceof Error) || e.name !== 'ArcaFault') return false
  const f = e as Partial<Record<'kind' | 'code', unknown>>
  return typeof f.code === 'string' && (ARCA_FAULT_KINDS as readonly unknown[]).includes(f.kind)
}

/**
 * Un pedido que no se puede armar (un dato fuera de rango, una combinación que ARCA
 * rechazaría). Es un error de programación: la acción tendría que haberlo validado
 * antes. El mensaje nombra el campo, nunca su valor.
 */
export class ArcaRequestError extends Error {
  readonly code = 'arca_request_invalid'
  readonly field: string

  constructor(field: string, reason: string) {
    super(`Pedido a ARCA inválido (${field}): ${reason}`)
    this.name = 'ArcaRequestError'
    this.field = field
  }
}

// ─── Sobres y headers ────────────────────────────────────────────────────────

export const SOAP11_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
export const SOAP12_NS = 'http://www.w3.org/2003/05/soap-envelope'
export type SoapVersion = '1.1' | '1.2'

const PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,30}$/

function envelope(
  envPrefix: string,
  envNs: string,
  prefix: string,
  nsUri: string,
  bodyXml: string,
): string {
  if (!PREFIX_RE.test(prefix) || prefix === envPrefix || /^xml/i.test(prefix)) {
    throw new ArcaRequestError('prefix', 'el prefijo del namespace no es válido')
  }
  return (
    `<${envPrefix}:Envelope xmlns:${envPrefix}="${envNs}" xmlns:${prefix}="${escapeXml(nsUri)}">` +
    `<${envPrefix}:Header/><${envPrefix}:Body>${bodyXml}</${envPrefix}:Body></${envPrefix}:Envelope>`
  )
}

/**
 * Sobre SOAP 1.1 (`soapenv`) con el `Header` vacío, como los ejemplos de ARCA.
 * `bodyXml` va tal cual: quien lo arma escapa los datos.
 */
export function envelope11(prefix: string, nsUri: string, bodyXml: string): string {
  return envelope('soapenv', SOAP11_NS, prefix, nsUri, bodyXml)
}

/** Sobre SOAP 1.2 (`soap12`). WSFE lo acepta; la plataforma usa 1.1. */
export function envelope12(prefix: string, nsUri: string, bodyXml: string): string {
  return envelope('soap12', SOAP12_NS, prefix, nsUri, bodyXml)
}

/**
 * Headers HTTP de un pedido SOAP. 1.1: `Content-Type: text/xml` y `SOAPAction`
 * entre comillas (`""` si va vacío). 1.2: `application/soap+xml` con el `action`.
 */
export function soapHeaders(version: SoapVersion, soapAction: string): Record<string, string> {
  if (/["\\\r\n]/.test(soapAction)) {
    throw new ArcaRequestError('soapAction', 'tiene caracteres que no van en un header')
  }
  if (version === '1.2') {
    return {
      'Content-Type': soapAction
        ? `application/soap+xml; charset=utf-8; action="${soapAction}"`
        : 'application/soap+xml; charset=utf-8',
    }
  }
  return { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${soapAction}"` }
}

// ─── La llamada ──────────────────────────────────────────────────────────────

/** Tope por llamada (diseño §2.9). */
export const SOAP_TIMEOUT_MS = 25_000

export type SoapCallInput = ArcaCallContext & {
  readonly url: string
  readonly soapAction: string
  /** El sobre completo (`envelope11(…)`). */
  readonly body: string
  readonly timeoutMs?: number
  readonly version?: SoapVersion
}

/**
 * Manda el sobre y devuelve el `Envelope` de la respuesta. Tira `ArcaFault` si no
 * hubo respuesta, si vino un `Fault` o si lo que vino no es SOAP. Los `Errors` de
 * WSFE (HTTP 200) no son falla acá: los lee quien llama.
 */
export async function soapCall(transport: ArcaTransport, input: SoapCallInput): Promise<XmlNode> {
  const ctx: ArcaCallContext = {
    service: input.service ?? null,
    wsn: input.wsn ?? null,
    method: input.method ?? null,
  }
  let response: ArcaHttpResponse
  try {
    response = await transport({
      url: input.url,
      headers: soapHeaders(input.version ?? '1.1', input.soapAction),
      body: input.body,
      timeoutMs: input.timeoutMs ?? SOAP_TIMEOUT_MS,
    })
  } catch (e) {
    throw transportFault(e, ctx)
  }
  return readSoapResponse(response, ctx)
}

/** Lo que tiró un transporte, como `ArcaFault` (las que ya lo son pasan con el contexto). */
function transportFault(e: unknown, ctx: ArcaCallContext): Error {
  if (e instanceof ArcaRequestError) return e
  if (isArcaFault(e)) return e.withContext(ctx)
  const code = (e as { code?: unknown } | null)?.code
  return new ArcaFault(
    'network',
    typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : 'network_error',
    { ...ctx, cause: e },
  )
}

/**
 * Lee una respuesta HTTP: si es un `Envelope` sin `Fault` y el status es 2xx,
 * devuelve el `Envelope`; si no, tira la `ArcaFault` que corresponde.
 */
export function readSoapResponse(response: ArcaHttpResponse, ctx: ArcaCallContext = {}): XmlNode {
  let root: XmlNode
  try {
    root = parseXml(response.body)
  } catch (e) {
    throw nonSoap(response.status, 'bad_xml', ctx, e)
  }
  return checkEnvelope(root, response.status, ctx)
}

/**
 * El `Envelope` de una respuesta, desde el texto (lo lee y chequea) o desde un nodo
 * ya leído (lo chequea igual). Es la entrada de todos los `parse*`.
 */
export function asEnvelope(input: XmlNode | string, ctx: ArcaCallContext = {}): XmlNode {
  return typeof input === 'string'
    ? readSoapResponse({ status: 200, body: input }, ctx)
    : checkEnvelope(input, 200, ctx)
}

function checkEnvelope(root: XmlNode, status: number, ctx: ArcaCallContext): XmlNode {
  if (root.name !== 'Envelope') throw nonSoap(status, 'not_soap', ctx)
  const body = child(root, 'Body')
  if (!body) throw nonSoap(status, 'missing:Body', ctx)
  const fault = child(body, 'Fault')
  if (fault) {
    const { code, detail } = readFault(fault)
    throw new ArcaFault('fault', code, {
      ...ctx,
      detail,
      httpStatus: status === 200 ? null : status,
    })
  }
  if (status < 200 || status > 299) {
    throw new ArcaFault('http', `http_${status}`, { ...ctx, httpStatus: status })
  }
  return root
}

/** Lo que no es SOAP: con status de error es `http`, con 2xx es `protocol`. */
function nonSoap(status: number, code: string, ctx: ArcaCallContext, cause?: unknown): ArcaFault {
  if (status < 200 || status > 299) {
    return new ArcaFault('http', `http_${status}`, { ...ctx, httpStatus: status, cause })
  }
  return new ArcaFault('protocol', code, { ...ctx, cause })
}

/**
 * Código y texto de un `Fault`. SOAP 1.1: `faultcode` y `faultstring`; SOAP 1.2:
 * `Code/Subcode/Value` (o `Code/Value`) y `Reason/Text`. El código va sin prefijo:
 * `ns1:cms.cert.untrusted` → `cms.cert.untrusted`, `soap:Server` → `Server`.
 */
export function readFault(fault: XmlNode): { code: string; detail: string } {
  const faultcode = textAt(fault, 'faultcode')
  if (faultcode !== null) {
    return { code: localCode(faultcode), detail: (textAt(fault, 'faultstring') ?? '').trim() }
  }
  const code = textAt(fault, 'Code/Subcode/Value') ?? textAt(fault, 'Code/Value') ?? ''
  return { code: localCode(code), detail: (textAt(fault, 'Reason/Text') ?? '').trim() }
}

function localCode(qname: string): string {
  const text = qname.trim()
  const local = text.slice(text.lastIndexOf(':') + 1)
  // Solo lo que sirve como clave estable (y no ensucia un log).
  const safe = local.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  return safe === '' ? 'unknown' : safe
}

/**
 * El nodo en `path`, relativo a `Body` (`'FEDummyResponse/FEDummyResult'`), o
 * `ArcaFault('protocol', 'missing:<último>')` si la respuesta no lo trae.
 */
export function soapResult(envelope: XmlNode, path: string, ctx: ArcaCallContext = {}): XmlNode {
  const node = nodeAt(child(envelope, 'Body'), path)
  if (!node) {
    const last = path.split('/').filter(Boolean).pop() ?? path
    throw new ArcaFault('protocol', `missing:${last}`, ctx)
  }
  return node
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
