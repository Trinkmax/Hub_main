/**
 * Errores de ARCA en palabras simples (diseño §2.7) y a qué paso de la guía
 * «Conectar ARCA» lleva cada uno.
 *
 * - `classifyArcaError(e)`: cualquier cosa que tiró una llamada a ARCA (`ArcaFault`
 *   del WSAA, de WSFE o del padrón, un `ArcaError` de la sesión, un error de la
 *   cripto) → una clave estable de `ARCA_ERRORS`. Los `Errors`/`Observaciones` de
 *   WSFE se clasifican por código (`classifyArcaMessages`), incluidos los
 *   submensajes del 10000.
 * - `describeArcaError(e, ctx)`: título, texto y paso, con los datos del bar
 *   (alias, punto de venta, SAS) completados. Si falta un dato se usa el texto de
 *   respaldo, sin huecos (como `lib/accounting/errors.ts`).
 * - `wsaaCooldown(key, env)`: cuánto esperar antes de pedir otro ticket después de
 *   un error del WSAA (política de la especificación 1.2.2, diseño §2.5).
 *
 * Las claves `bug` no son algo que la persona pueda arreglar: se loguean con
 * contexto (sin datos personales) y se muestra el texto genérico.
 *
 * Puro: sin `server-only`, lo usan también las pantallas.
 */

import { padPv } from '@/lib/fiscal'
import type { ArcaEnvironment } from './endpoints'
import type { ArcaGuideStepId } from './guide'
import { type ArcaCallService, type ArcaFault, type ArcaMsg, isArcaFault } from './soap'

// ─── Catálogo ────────────────────────────────────────────────────────────────

export const ARCA_ERROR_KEYS = [
  'arca_unavailable',
  'arca_not_authorized',
  'arca_wrong_environment',
  'arca_cert_expired',
  'arca_key_mismatch',
  'arca_clock',
  'arca_already_authenticated',
  'arca_cuit_not_in_token',
  'arca_token_rejected',
  'arca_pos_not_enabled',
  'arca_pos_blocked',
  'arca_issuer_problem',
  'arca_class_a_not_enabled',
  'arca_number_mismatch',
  'arca_receiver_condition',
  'arca_receiver_document',
  'arca_fce_required',
  'arca_amounts',
  'arca_in_flight',
  'arca_unknown_state',
  'arca_authorized_not_posted',
  'arca_busy',
  'arca_internal',
  'arca_unknown',
] as const
export type ArcaErrorKey = (typeof ARCA_ERROR_KEYS)[number]

/** `now`: se puede reintentar ya · `later`: en unos minutos · `after_fix`: primero hay que arreglar algo. */
export type ArcaRetry = 'now' | 'later' | 'after_fix'

export type ArcaErrorInfo = {
  readonly title: string
  /** Puede traer `{alias}`, `{pv}`, `{sas}`, `{motivo}`, `{comprobante}`, `{cae}`, `{codigo}`, `{minutos}`. */
  readonly body: string
  /** El mismo texto sin huecos. Obligatorio si `body` tiene alguno. */
  readonly fallback?: string
  /** El paso de la guía que lo arregla (`null`: no hay nada que tocar en ARCA). */
  readonly step: ArcaGuideStepId | null
  readonly retry: ArcaRetry
  /** Error nuestro, no de carga: se loguea. */
  readonly bug?: true
}

export const ARCA_ERRORS: Readonly<Record<ArcaErrorKey, ArcaErrorInfo>> = {
  arca_unavailable: {
    title: 'ARCA no responde',
    body: 'ARCA no contestó. Suele pasar un rato; probá de nuevo en unos minutos.',
    step: null,
    retry: 'later',
  },
  arca_not_authorized: {
    title: 'Falta autorizar el certificado',
    body: 'ARCA dice que este certificado no está autorizado para «Facturación Electrónica». Hacé el paso 7 eligiendo la SAS y el alias «{alias}».',
    fallback:
      'ARCA dice que este certificado no está autorizado para «Facturación Electrónica». Hacé el paso 7 eligiendo la SAS y el alias de la plataforma.',
    step: 's7_wsfe',
    retry: 'after_fix',
  },
  arca_wrong_environment: {
    title: 'Certificado del ambiente equivocado',
    body: 'Este certificado es de pruebas (homologación) y lo estás usando en producción, o al revés.',
    step: 's6_certificado',
    retry: 'after_fix',
  },
  arca_cert_expired: {
    title: 'El certificado venció',
    body: 'Los certificados de ARCA duran 2 años. Renovalo: es el paso 6 con «Agregar certificado» sobre el mismo alias.',
    step: 's6_certificado',
    retry: 'after_fix',
  },
  arca_key_mismatch: {
    title: 'La clave no es la del certificado',
    body: 'El certificado no corresponde a la clave de la plataforma. Generá un pedido nuevo (paso 5) y repetí el 6.',
    step: 's5_pedido',
    retry: 'after_fix',
  },
  arca_clock: {
    title: 'Problema de horario',
    body: 'El pedido salió con la hora corrida. Avisanos: es un problema nuestro.',
    step: null,
    retry: 'later',
    bug: true,
  },
  arca_already_authenticated: {
    title: 'ARCA ya le dio un permiso a este certificado',
    body: '¿Estás usando este mismo certificado en otro sistema, como el sistema de caja que usás hoy? La plataforma necesita su propio alias. Si recién lo probaste, esperá {minutos} minutos y volvé a probar.',
    fallback:
      '¿Estás usando este mismo certificado en otro sistema, como el sistema de caja que usás hoy? La plataforma necesita su propio alias. Si recién lo probaste, esperá entre 2 y 10 minutos y volvé a probar.',
    step: 's6_certificado',
    retry: 'later',
  },
  arca_cuit_not_in_token: {
    title: 'La SAS no está en el permiso',
    body: 'Autorizaste el certificado a tu nombre y no al de la SAS. En el paso 7, arriba tiene que decir «Actuando en representación de {sas}».',
    fallback:
      'Autorizaste el certificado a tu nombre y no al de la SAS. En el paso 7, arriba tiene que decir «Actuando en representación de» y el nombre de la SAS.',
    step: 's7_wsfe',
    retry: 'after_fix',
  },
  arca_token_rejected: {
    title: 'ARCA no aceptó el permiso de la plataforma',
    body: 'El permiso (ticket) que usó la plataforma no le sirvió a ARCA. Probá la conexión de nuevo: pedimos uno nuevo.',
    step: 's9_probar',
    retry: 'now',
  },
  arca_pos_not_enabled: {
    title: 'El punto de venta no es de web services',
    body: 'El punto de venta {pv} no está habilitado para la plataforma. Tiene que ser «RECE para aplicativo y web services». Si lo creaste hoy, puede tardar unas horas en aparecer.',
    fallback:
      'El punto de venta no está habilitado para la plataforma. Tiene que ser «RECE para aplicativo y web services». Si lo creaste hoy, puede tardar unas horas en aparecer.',
    step: 's2_punto_venta',
    retry: 'after_fix',
  },
  arca_pos_blocked: {
    title: 'ARCA bloqueó el punto de venta',
    body: 'Entrá a «Administración de puntos de venta y domicilios» y regularizalo.',
    step: 's2_punto_venta',
    retry: 'after_fix',
  },
  arca_issuer_problem: {
    title: 'La SAS no está habilitada para facturar',
    body: 'ARCA no deja facturar a la SAS: {motivo}. Lo resuelve quien maneja la clave fiscal de la SAS, con la contadora (paso 0).',
    fallback:
      'ARCA no deja facturar a la SAS. Lo resuelve quien maneja la clave fiscal de la SAS, con la contadora: revisá el paso 0.',
    step: 's0_prereq',
    retry: 'after_fix',
  },
  arca_class_a_not_enabled: {
    title: 'Todavía no tenés Factura A',
    body: 'Para hacer Factura A primero hay que hacer la habilitación (F. 856). Mientras tanto emití B.',
    step: 's3_factura_a',
    retry: 'after_fix',
  },
  arca_number_mismatch: {
    title: 'El número o la fecha no son los que espera ARCA',
    body: 'Otro comprobante tomó ese número, o la fecha es anterior a la del último. Volvé a intentar: tomamos el número que corresponde.',
    step: null,
    retry: 'now',
  },
  arca_receiver_condition: {
    title: 'La condición del cliente no va con la letra',
    body: 'Revisá la condición frente al IVA del cliente: a un responsable inscripto o a un monotributista le corresponde Factura A; a un consumidor final o a un exento, Factura B.',
    step: null,
    retry: 'after_fix',
  },
  arca_receiver_document: {
    title: 'Revisá el documento del cliente',
    body: 'ARCA no aceptó el documento del cliente. La Factura A necesita una CUIT activa, y una B de monto alto necesita identificar a quien compra.',
    step: null,
    retry: 'after_fix',
  },
  arca_fce_required: {
    title: 'ARCA pide Factura de Crédito Electrónica',
    body: 'Por el monto y el cliente, esta venta va con Factura de Crédito Electrónica MiPyME, que la plataforma todavía no emite. Hacela desde ARCA y cargala con «Ya la emití en otro sistema».',
    step: null,
    retry: 'after_fix',
  },
  arca_amounts: {
    title: 'Los importes no cuadran',
    body: 'ARCA no aceptó los importes. Es un problema nuestro: ya lo estamos viendo.',
    step: null,
    retry: 'later',
    bug: true,
  },
  arca_in_flight: {
    title: 'Hay otra factura emitiéndose',
    body: 'Esperá unos segundos y volvé a intentar.',
    step: null,
    retry: 'now',
  },
  arca_unknown_state: {
    title: 'No sabemos si se emitió',
    body: 'ARCA no contestó y no pudimos confirmar si la autorizó. No la vuelvas a emitir: la verificamos sola en unos minutos.',
    step: null,
    retry: 'later',
  },
  arca_authorized_not_posted: {
    title: 'Emitida, pero falta en los libros',
    body: 'ARCA autorizó la {comprobante} (CAE {cae}), pero no pudimos cargarla en los libros: {motivo}. Tocá «Cargarla ahora».',
    fallback:
      'ARCA autorizó la factura, pero no pudimos cargarla en los libros. Tocá «Cargarla ahora».',
    step: null,
    retry: 'now',
  },
  arca_busy: {
    title: 'ARCA está ocupado',
    body: 'Reintentá en unos segundos.',
    step: null,
    retry: 'now',
  },
  arca_internal: {
    title: 'No pudimos armar el pedido a ARCA',
    body: 'Es un problema nuestro: avisanos y lo arreglamos.',
    step: null,
    retry: 'later',
    bug: true,
  },
  arca_unknown: {
    title: 'ARCA devolvió un error',
    body: 'ARCA devolvió un error que no conocemos (código {codigo}). Probá de nuevo en unos minutos; si sigue, avisanos.',
    fallback:
      'ARCA devolvió un error que no conocemos. Probá de nuevo en unos minutos; si sigue, avisanos.',
    step: null,
    retry: 'later',
  },
}

/**
 * Lo que cambia cuando el error vino del padrón (`ws_sr_constancia_inscripcion`):
 * la autorización que falta es la del paso 8.
 */
const PADRON_OVERRIDES: Partial<Record<ArcaErrorKey, Partial<ArcaErrorInfo>>> = {
  arca_not_authorized: {
    title: 'Falta autorizar la consulta del padrón',
    body: 'ARCA dice que este certificado no está autorizado para «Consulta de constancia de inscripción». Hacé el paso 8 eligiendo la SAS y el alias «{alias}».',
    fallback:
      'ARCA dice que este certificado no está autorizado para «Consulta de constancia de inscripción». Hacé el paso 8 eligiendo la SAS y el alias de la plataforma.',
    step: 's8_padron',
  },
}

/**
 * Lo que cambia en homologación (las pruebas de quien programa): el certificado sale de
 * WSASS y se autoriza ahí («Crear autorización a servicio», con la SAS como representada),
 * no en el portal de la SAS. El caso real: un certificado que no dio WSASS vuelve con
 * `cms.cert.untrusted`, y el texto de producción («es de pruebas y lo estás usando en
 * producción, o al revés») decía lo contrario de lo que pasaba. El paso de la guía no cambia:
 * la pantalla lo lleva al paso de «Pruebas (homologación)» que corresponde.
 */
const HOMOLOGACION_OVERRIDES: Partial<Record<ArcaErrorKey, Partial<ArcaErrorInfo>>> = {
  arca_wrong_environment: {
    title: 'ARCA de pruebas no reconoce el certificado',
    body: 'El ARCA de pruebas solo acepta certificados de WSASS (el de producción no sirve acá). Creá el certificado en WSASS con este pedido y subilo.',
  },
  arca_not_authorized: {
    title: 'Falta autorizar el certificado en WSASS',
    body: 'WSASS todavía no autorizó este certificado para wsfe. En WSASS, «Crear autorización a servicio» para wsfe, con el alias «{alias}» y la CUIT de la SAS como representada.',
    fallback:
      'WSASS todavía no autorizó este certificado para wsfe. En WSASS, «Crear autorización a servicio» para wsfe, con el alias del pedido y la CUIT de la SAS como representada.',
  },
  arca_cuit_not_in_token: {
    body: 'La autorización de WSASS no tiene a la SAS como representada. En «Crear autorización a servicio», poné la CUIT de la SAS como representada.',
  },
  arca_cert_expired: {
    title: 'El certificado de pruebas venció',
    body: 'Generá otro pedido y creá un certificado nuevo en WSASS.',
  },
  arca_key_mismatch: {
    body: 'El certificado no corresponde a la clave de este pedido. Generá otro pedido y creá el certificado en WSASS con ese.',
  },
  arca_already_authenticated: {
    body: 'El ARCA de pruebas le dio un permiso a este certificado hace poco: esperá {minutos} minutos y volvé a probar.',
    fallback:
      'El ARCA de pruebas le dio un permiso a este certificado hace poco: esperá unos minutos y volvé a probar.',
  },
}

/** Homologación y padrón: la autorización que falta en WSASS es la de la constancia. */
const HOMOLOGACION_PADRON_OVERRIDES: Partial<Record<ArcaErrorKey, Partial<ArcaErrorInfo>>> = {
  arca_not_authorized: {
    title: 'Falta autorizar la consulta del padrón en WSASS',
    body: 'WSASS todavía no autorizó este certificado para ws_sr_constancia_inscripcion. En WSASS, «Crear autorización a servicio» para ese servicio, con el alias «{alias}» y la CUIT de la SAS como representada.',
    fallback:
      'WSASS todavía no autorizó este certificado para ws_sr_constancia_inscripcion. En WSASS, «Crear autorización a servicio» para ese servicio, con el alias del pedido y la CUIT de la SAS como representada.',
  },
}

/**
 * Submensajes del error 10000 (validaciones del emisor; `arca-pasos.md` §2.4). El
 * 04 y el 09 (Factura A) van a `arca_class_a_not_enabled`.
 */
export const ISSUER_SUBMESSAGES: Readonly<Record<string, string>> = {
  '01': 'no figura como responsable inscripta en IVA',
  '02': 'no está habilitada a emitir comprobantes electrónicos, o la fecha es anterior a su alta',
  '03': 'el domicilio fiscal tiene un problema',
  '05': 'la CUIT no está activa',
  '06': 'no tiene ninguna actividad activa',
  '11': 'no tiene activo el Domicilio Fiscal Electrónico',
}

/** Submensajes que significan «la Factura A no está habilitada». */
const CLASS_A_SUBMESSAGES = new Set(['04', '09'])

export function isArcaErrorKey(value: unknown): value is ArcaErrorKey {
  return typeof value === 'string' && (ARCA_ERROR_KEYS as readonly string[]).includes(value)
}

/**
 * Un error de ARCA que ya tiene clave: lo tira la sesión (ticket en espera,
 * `arca_busy`) o la emisión (`arca_in_flight`, `arca_unknown_state`…).
 */
export class ArcaError extends Error {
  readonly key: ArcaErrorKey

  constructor(key: ArcaErrorKey, options: { cause?: unknown } = {}) {
    super(`ARCA: ${key}`, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ArcaError'
    this.key = key
  }
}

// ─── Clasificación ───────────────────────────────────────────────────────────

/** Los `faultcode` del WSAA (especificación 1.2.2), en minúsculas. */
const WSAA_FAULTS: Readonly<Record<string, ArcaErrorKey>> = {
  'coe.notauthorized': 'arca_not_authorized',
  'coe.alreadyauthenticated': 'arca_already_authenticated',
  'cms.cert.untrusted': 'arca_wrong_environment',
  'cms.cert.expired': 'arca_cert_expired',
  'cms.sign.invalid': 'arca_key_mismatch',
  'cms.cert.invalid': 'arca_clock',
  'xml.generationtime.invalid': 'arca_clock',
  'xml.expirationtime.expired': 'arca_clock',
  'xml.expirationtime.invalid': 'arca_clock',
  'cms.bad': 'arca_internal',
  'cms.bad.base64': 'arca_internal',
  'cms.cert.notfound': 'arca_internal',
  'xml.bad': 'arca_internal',
  'xml.source.invalid': 'arca_internal',
  'xml.destination.invalid': 'arca_internal',
  'xml.version.notsupported': 'arca_internal',
  'wsn.notfound': 'arca_internal',
  'wsn.unavailable': 'arca_unavailable',
  'wsaa.unavailable': 'arca_unavailable',
  'wsaa.internalerror': 'arca_unavailable',
}

/** Códigos de WSFE por grupo, de más a menos importante (manual v4.7). */
const POS_CODES = new Set([10005, 11000, 11002])
const RECEIVER_CONDITION_CODES = new Set([10242, 10243, 10246, 10017, 10063, 10245])
const RECEIVER_DOCUMENT_CODES = new Set([10013, 10015, 10069, 10247, 10284])
const AMOUNT_CODES = new Set([
  10018, 10020, 10021, 10022, 10023, 10024, 10029, 10046, 10047, 10048, 10051, 10056, 10061, 10065,
  10070, 10071,
])
/** Pedido mal armado de nuestro lado (lo validamos antes: si llega, es un bug). */
const REQUEST_CODES = new Set([10002, 10039, 10040, 10041, 10049, 10197, 10198, 10241, 11001])

/**
 * La clave de un conjunto de `Errors`/`Observaciones` de WSFE (o de un rechazo de
 * `FECAESolicitar`). Los eventos (`Evt`) son informativos: no se pasan acá.
 */
export function classifyArcaMessages(messages: readonly ArcaMsg[]): ArcaErrorKey {
  const codes = new Set(messages.map((m) => m.code))
  const msgOf = (code: number) => messages.find((m) => m.code === code)?.msg ?? ''

  if (codes.has(600)) {
    const text = msgOf(600)
    if (/relaci/i.test(text)) return 'arca_cuit_not_in_token'
    if (/firma|hash/i.test(text)) return 'arca_wrong_environment'
    return 'arca_token_rejected'
  }
  if (codes.has(601)) return 'arca_cuit_not_in_token'
  if (codes.has(502)) return 'arca_in_flight'
  if (codes.has(500) || codes.has(501)) return 'arca_unavailable'
  if (codes.has(10000)) {
    const subs = issuerSubcodes(messages)
    return subs.some((s) => CLASS_A_SUBMESSAGES.has(s))
      ? 'arca_class_a_not_enabled'
      : 'arca_issuer_problem'
  }
  if (codes.has(10234)) return 'arca_class_a_not_enabled'
  if ([...codes].some((c) => POS_CODES.has(c))) return 'arca_pos_not_enabled'
  if (codes.has(10016)) return 'arca_number_mismatch'
  if (codes.has(10192)) return 'arca_fce_required'
  if ([...codes].some((c) => RECEIVER_DOCUMENT_CODES.has(c))) return 'arca_receiver_document'
  if ([...codes].some((c) => RECEIVER_CONDITION_CODES.has(c))) return 'arca_receiver_condition'
  if ([...codes].some((c) => AMOUNT_CODES.has(c))) return 'arca_amounts'
  if ([...codes].some((c) => REQUEST_CODES.has(c))) return 'arca_internal'
  return 'arca_unknown'
}

/** Los submensajes (`'01'`, `'11'`…) de los errores 10000: el texto empieza con el número. */
export function issuerSubcodes(messages: readonly ArcaMsg[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.code !== 10000) continue
    const sub = /^\s*(\d{2})(?!\d)/.exec(m.msg)?.[1]
    if (sub && !out.includes(sub)) out.push(sub)
  }
  return out
}

function classifyFault(f: ArcaFault): ArcaErrorKey {
  switch (f.kind) {
    case 'timeout':
    case 'protocol':
      return 'arca_unavailable'
    case 'http': {
      const status = f.httpStatus ?? Number(f.code.replace('http_', ''))
      return [400, 404, 405, 415].includes(status) ? 'arca_internal' : 'arca_unavailable'
    }
    case 'network':
      if (f.code === 'url_not_allowed') return 'arca_internal'
      // TLS: un problema de configuración nuestro (o un cambio de ARCA que hay que mirar).
      if (/^(ERR_SSL|ERR_TLS|CERT_|UNABLE_TO|SELF_SIGNED|DEPTH_ZERO)/.test(f.code)) {
        return 'arca_internal'
      }
      return 'arca_unavailable'
    case 'service':
      return classifyArcaMessages(f.messages)
    case 'fault': {
      const wsaa = WSAA_FAULTS[f.code.toLowerCase()]
      if (wsaa) return wsaa
      const text = f.detail
      if (/ya posee un TA/i.test(text)) return 'arca_already_authenticated'
      if (/relaci/i.test(text)) return 'arca_cuit_not_in_token'
      if (/no (?:est[aá] |se encuentra )?autorizad|not authori[sz]ed/i.test(text)) {
        return 'arca_not_authorized'
      }
      if (/token|firma|\bsign\b/i.test(text)) return 'arca_token_rejected'
      if (/^(Client|Sender)$/i.test(f.code)) return 'arca_internal'
      if (/^(Server|Receiver)$/i.test(f.code)) return 'arca_unavailable'
      return 'arca_unknown'
    }
  }
}

/** Un error con nombre y `code` (las clases de otros módulos, sin importarlas). */
function namedError(e: unknown, name: string): { code?: unknown } | null {
  return e instanceof Error && e.name === name ? (e as Error & { code?: unknown }) : null
}

/** La clave de cualquier error de una llamada a ARCA. Lo que no se reconoce es un bug nuestro. */
export function classifyArcaError(e: unknown): ArcaErrorKey {
  if (e instanceof ArcaError) return e.key
  const keyed = namedError(e, 'ArcaError') as { key?: unknown } | null
  if (keyed && isArcaErrorKey(keyed.key)) return keyed.key
  if (isArcaFault(e)) return classifyFault(e)
  const crypto = namedError(e, 'ArcaCryptoError')
  if (crypto) return crypto.code === 'key_mismatch' ? 'arca_key_mismatch' : 'arca_internal'
  if (namedError(e, 'XmlParseError')) return 'arca_unavailable'
  return 'arca_internal'
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/** Datos del bar para completar los textos (todos opcionales). */
export type ArcaErrorContext = {
  readonly alias?: string | null
  readonly pointOfSale?: number | null
  /** Razón social de la SAS, como la muestra ARCA. */
  readonly sasName?: string | null
  readonly environment?: ArcaEnvironment | null
  /** «Factura B 0005-00000105». */
  readonly voucherLabel?: string | null
  readonly cae?: string | null
  /** Por qué no se pudo contabilizar (texto ya traducido). */
  readonly reason?: string | null
  /** El servicio que falló; si el error es una `ArcaFault`, sale de ahí. */
  readonly service?: ArcaCallService | null
  readonly wsn?: string | null
}

export type ArcaErrorView = {
  readonly key: ArcaErrorKey
  readonly title: string
  readonly body: string
  readonly step: ArcaGuideStepId | null
  readonly retry: ArcaRetry
  readonly bug: boolean
  /** El código técnico para soporte (`cms.cert.untrusted`, `10016`, `http_503`), si hay. */
  readonly code: string | null
}

function isPadron(ctx: ArcaErrorContext): boolean {
  return ctx.service === 'padron' || ctx.wsn === 'ws_sr_constancia_inscripcion'
}

/**
 * Texto, título y paso de una clave, con los datos del contexto. En homologación, el texto de
 * las pruebas (WSASS) donde el de producción no aplica; el paso es el mismo.
 */
export function describeArcaErrorKey(
  key: ArcaErrorKey,
  ctx: ArcaErrorContext = {},
  extra: { code?: string | null; issuerReasons?: readonly string[] } = {},
): ArcaErrorView {
  const padron = isPadron(ctx)
  const homologacion = ctx.environment === 'homologacion'
  const info: ArcaErrorInfo = {
    ...ARCA_ERRORS[key],
    ...(padron ? PADRON_OVERRIDES[key] : undefined),
    ...(homologacion ? HOMOLOGACION_OVERRIDES[key] : undefined),
    ...(homologacion && padron ? HOMOLOGACION_PADRON_OVERRIDES[key] : undefined),
  }
  const values: Record<string, string | null> = {
    alias: ctx.alias?.trim() || null,
    pv:
      ctx.pointOfSale != null && Number.isInteger(ctx.pointOfSale) && ctx.pointOfSale > 0
        ? padPv(ctx.pointOfSale, 4)
        : null,
    sas: ctx.sasName?.trim() || null,
    minutos: ctx.environment ? (ctx.environment === 'produccion' ? '2' : '10') : null,
    comprobante: ctx.voucherLabel?.trim() || null,
    cae: ctx.cae?.trim() || null,
    motivo:
      key === 'arca_issuer_problem'
        ? extra.issuerReasons && extra.issuerReasons.length > 0
          ? extra.issuerReasons.join('; ')
          : null
        : ctx.reason?.trim() || null,
    codigo: extra.code ?? null,
  }
  return {
    key,
    title: info.title,
    body: fill(info.body, values) ?? info.fallback ?? info.body,
    step: info.step,
    retry: info.retry,
    bug: info.bug === true,
    code: extra.code ?? null,
  }
}

/** `classifyArcaError` + `describeArcaErrorKey`, con el código técnico y los motivos del 10000. */
export function describeArcaError(e: unknown, ctx: ArcaErrorContext = {}): ArcaErrorView {
  const key = classifyArcaError(e)
  if (!isArcaFault(e)) return describeArcaErrorKey(key, ctx)
  const code = e.kind === 'service' && e.messages[0] ? String(e.messages[0].code) : e.code
  const issuerReasons = issuerSubcodes(e.messages)
    .map((s) => ISSUER_SUBMESSAGES[s])
    .filter((s): s is string => s !== undefined)
  return describeArcaErrorKey(
    key,
    { ...ctx, service: ctx.service ?? e.service, wsn: ctx.wsn ?? e.wsn },
    { code, issuerReasons },
  )
}

/** Completa los `{x}`; `null` si falta alguno (y entonces va el respaldo). */
function fill(template: string, values: Readonly<Record<string, string | null>>): string | null {
  let missing = false
  const out = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value == null || value === '') {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : out
}

// ─── Política del WSAA ───────────────────────────────────────────────────────

/**
 * Cuánto esperar antes de pedir otro ticket al WSAA después de un error (diseño
 * §2.5; especificación 1.2.2): 60 s si ARCA no respondió (`wsaa.*`,
 * `wsn.unavailable`, red); 2 min en producción y 10 min en homologación si ya hay
 * un ticket vigente en otro lado; y `'manual'` (hasta que la persona arregle algo y
 * vuelva a probar) para todo lo demás, como pide ARCA.
 */
export function wsaaCooldown(key: ArcaErrorKey, env: ArcaEnvironment): number | 'manual' {
  switch (key) {
    case 'arca_unavailable':
      return 60
    case 'arca_already_authenticated':
      return env === 'produccion' ? 120 : 600
    default:
      return 'manual'
  }
}
