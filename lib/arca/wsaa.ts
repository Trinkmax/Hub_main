import 'server-only'
import { Buffer } from 'node:buffer'
import {
  attr,
  child,
  decodeEntities,
  findAll,
  findFirst,
  parseXml,
  textAt,
  textOf,
  type XmlNode,
} from '@/lib/xml/mini'
import { buildTra, signTra } from './cms'
import { ARCA_ENDPOINTS, ARCA_NAMESPACES, type ArcaEnvironment, type ArcaWsn } from './endpoints'
import {
  type ArcaCallContext,
  ArcaFault,
  ArcaRequestError,
  type ArcaTransport,
  asEnvelope,
  envelope11,
  isArcaFault,
  soapCall,
  soapResult,
} from './soap'

/**
 * WSAA: el ticket de acceso (TA) de cada servicio (diseño §2.4.1 y §2.5;
 * `arca-tecnico.md` §2; especificación técnica 1.2.2).
 *
 * 1. `buildTra(service, now)` (en `cms.ts`): `uniqueId` = segundos unix y ventana de
 *    ±10 minutos en UTC.
 * 2. `signTra(...)` (en `cms.ts`): CMS SignedData en base64, con el certificado.
 * 3. `loginCms`: SOAP 1.1, `SOAPAction: ""`. La respuesta trae el
 *    `loginTicketResponse` como **texto** (`xsd:string`): viene con entidades
 *    escapadas o en un CDATA, y `parseLoginCmsResponse` acepta los dos (y el doble
 *    escapado, por las dudas).
 * 4. El TA (`token` + `sign`) vale 12 h y hay que reusarlo: pedir otro teniendo uno
 *    vigente da `coe.alreadyAuthenticated` («ya posee un TA válido»). El caché y el
 *    lease viven en la base (`lib/arca/session.ts`).
 *
 * El `token` es un XML SSO en base64 con las CUIT que el certificado puede
 * representar (`relations`): `decodeTokenRelations` sirve para el chequeo «La SAS
 * está dentro del certificado» (equivale al error 601 de WSFE).
 *
 * Solo servidor: maneja la clave y el ticket. Nunca loguear el CMS, el token, el
 * sign ni el PEM.
 */

/** El WSDL del WSAA (Axis 1.4) declara `soapAction=""`. */
export const WSAA_SOAP_ACTION = ''

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** El sobre de `loginCms` con el CMS firmado (base64 de una línea) en `in0`. */
export function loginCmsBody(cmsBase64: string): string {
  const cms = cmsBase64.trim()
  if (!BASE64_RE.test(cms) || cms.length % 4 !== 0) {
    throw new ArcaRequestError('in0', 'el CMS no está en base64')
  }
  return envelope11(
    'wsaa',
    ARCA_NAMESPACES.wsaa,
    `<wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>`,
  )
}

/** El ticket de acceso. */
export type ArcaTicket = {
  readonly token: string
  readonly sign: string
  readonly generationTime: Date
  readonly expirationTime: Date
  /** DN del WSAA que lo emitió. */
  readonly source: string | null
  /** DN del certificado autenticado (`SERIALNUMBER=CUIT …, CN=<alias>`). */
  readonly destination: string | null
  readonly uniqueId: string | null
}

const XSD_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/

/**
 * Un `xsd:dateTime` (`2026-10-08T08:50:00.467-03:00`). Sin zona se toma la de
 * Argentina (−03:00), que es la que usa ARCA. `null` si no es una fecha válida.
 */
export function parseXsdDateTime(text: string | null | undefined): Date | null {
  const m = XSD_DATETIME_RE.exec((text ?? '').trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, frac = '', zone = '-03:00'] = m
  const ms = frac === '' ? '' : `.${frac.padEnd(3, '0').slice(0, 3)}`
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${ms}${zone}`)
  return Number.isNaN(date.getTime()) ? null : date
}

const LOGIN_CTX: ArcaCallContext = { service: 'wsaa', method: 'loginCms' }

/**
 * Lee la respuesta de `loginCms` (el sobre o el texto) y devuelve el TA. Un
 * `Fault` sale como `ArcaFault('fault', <código sin prefijo>)`, p. ej.
 * `coe.alreadyAuthenticated`; un ticket que no se puede leer, como `protocol`.
 */
export function parseLoginCmsResponse(input: XmlNode | string): ArcaTicket {
  const env = asEnvelope(input, LOGIN_CTX)
  const ret = soapResult(env, 'loginCmsResponse/loginCmsReturn', LOGIN_CTX)
  let inner = textOf(ret).trim()
  // `xsd:string` escapado dos veces (no lo hace hoy; por las dudas).
  if (inner.startsWith('&lt;')) inner = decodeEntities(inner).trim()
  let ticket: XmlNode
  try {
    ticket = parseXml(inner)
  } catch (e) {
    throw new ArcaFault('protocol', 'bad:loginTicketResponse', { ...LOGIN_CTX, cause: e })
  }
  if (ticket.name !== 'loginTicketResponse') {
    throw new ArcaFault('protocol', 'bad:loginTicketResponse', LOGIN_CTX)
  }
  const token = (textAt(ticket, 'credentials/token') ?? '').trim()
  const sign = (textAt(ticket, 'credentials/sign') ?? '').trim()
  if (token === '' || sign === '') throw new ArcaFault('protocol', 'missing:credentials', LOGIN_CTX)
  const generationTime = parseXsdDateTime(textAt(ticket, 'header/generationTime'))
  const expirationTime = parseXsdDateTime(textAt(ticket, 'header/expirationTime'))
  if (!generationTime || !expirationTime || expirationTime <= generationTime) {
    throw new ArcaFault('protocol', 'bad:ticketTimes', LOGIN_CTX)
  }
  const opt = (path: string) => {
    const text = textAt(ticket, path)?.trim()
    return text ? text : null
  }
  return {
    token,
    sign,
    generationTime,
    expirationTime,
    source: opt('header/source'),
    destination: opt('header/destination'),
    uniqueId: opt('header/uniqueId'),
  }
}

/** Lo que trae el token (XML SSO en base64), sin la firma. */
export type ArcaTokenInfo = {
  /** `service` del login (`wsfe`, `ws_sr_constancia_inscripcion`). */
  readonly service: string | null
  /** `uid`: el DN del certificado. */
  readonly uid: string | null
  readonly generatedAt: Date | null
  readonly expiresAt: Date | null
  /** CUIT que el certificado puede representar (sin repetir, en el orden del token). */
  readonly relations: readonly string[]
}

function epoch(text: string | null): Date | null {
  if (!text || !/^\d{9,11}$/.test(text.trim())) return null
  return new Date(Number(text.trim()) * 1000)
}

/** Lee el token del TA; `null` si no es el XML SSO esperado. */
export function decodeTokenInfo(token: string): ArcaTokenInfo | null {
  const clean = token.replace(/\s+/g, '')
  if (clean === '' || !BASE64_RE.test(clean)) return null
  let root: XmlNode
  try {
    root = parseXml(Buffer.from(clean, 'base64').toString('utf8'))
  } catch {
    return null
  }
  if (root.name !== 'sso') return null
  const id = child(root, 'id')
  const login = findFirst(root, 'login')
  const relations: string[] = []
  for (const rel of findAll(root, 'relation')) {
    // `<relation key="30…" reltype="4"/>` (manual del WSAA, cap. 6.3). Por las dudas se
    // acepta la CUIT en otro atributo o como texto: el formato real se confirma con el
    // primer login de homologación.
    const candidates = [attr(rel, 'key'), ...Object.values(rel.attrs), rel.text]
    const cuit = candidates.map((c) => (c ?? '').trim()).find((c) => /^\d{11}$/.test(c))
    if (cuit && !relations.includes(cuit)) relations.push(cuit)
  }
  return {
    service: attr(login, 'service'),
    uid: attr(login, 'uid'),
    generatedAt: epoch(attr(id, 'gen_time')),
    expiresAt: epoch(attr(id, 'exp_time')),
    relations,
  }
}

/**
 * Las CUIT de `relations` del token. `null` si el token no se puede leer (entonces
 * el chequeo «la SAS está en el certificado» no se puede hacer: no es lo mismo que
 * una lista vacía).
 */
export function decodeTokenRelations(token: string): string[] | null {
  const info = decodeTokenInfo(token)
  return info ? [...info.relations] : null
}

/** ¿El WSAA contestó «El CEE ya posee un TA válido para el acceso al WSN solicitado»? */
export function isAlreadyAuthenticated(e: unknown): boolean {
  return (
    isArcaFault(e) &&
    e.kind === 'fault' &&
    (e.code.toLowerCase() === 'coe.alreadyauthenticated' || /ya posee un TA/i.test(e.detail))
  )
}

export type WsaaLoginOptions = {
  /** Tope de la llamada (por defecto, 25 s). */
  readonly timeoutMs?: number
}

/**
 * Pide un TA nuevo para `service`. **Ojo:** el WSAA pide reusar el TA vigente y
 * esperar después de ciertos errores; quien llama tiene que pasar por el caché y el
 * lease de la sesión (`wsaaCooldown` en `errors.ts`). Las fallas salen como
 * `ArcaFault` con `service: 'wsaa'` y `wsn` = el servicio pedido.
 */
export async function wsaaLogin(
  transport: ArcaTransport,
  env: ArcaEnvironment,
  service: ArcaWsn,
  certificatePem: string,
  privateKeyPem: string,
  now: Date = new Date(),
  options: WsaaLoginOptions = {},
): Promise<ArcaTicket> {
  const ctx: ArcaCallContext = { ...LOGIN_CTX, wsn: service }
  const tra = buildTra(service, now)
  const cms = signTra(tra, certificatePem, privateKeyPem, now)
  try {
    const envelope = await soapCall(transport, {
      url: ARCA_ENDPOINTS[env].wsaa,
      soapAction: WSAA_SOAP_ACTION,
      body: loginCmsBody(cms),
      timeoutMs: options.timeoutMs,
      ...ctx,
    })
    const ticket = parseLoginCmsResponse(envelope)
    if (ticket.expirationTime.getTime() <= now.getTime()) {
      throw new ArcaFault('protocol', 'ticket_expired', ctx)
    }
    return ticket
  } catch (e) {
    throw isArcaFault(e) ? e.withContext(ctx) : e
  }
}
