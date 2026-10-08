/**
 * Padrón de ARCA: constancia de inscripción (`ws_sr_constancia_inscripcion`, ex A5,
 * manual v4.1) para «Completar con ARCA» (diseño §3.1; `arca-tecnico.md` §5).
 *
 * - `getPersona_v2` trae datos generales (razón social o apellido y nombre, estado
 *   de la clave, domicilio fiscal), el régimen general (impuestos y actividades) y
 *   el monotributo. `getPersonaList_v2` hace lo mismo con hasta 250 CUIT.
 * - Los problemas de la persona consultada vienen adentro de la respuesta
 *   (`errorConstancia`: «No existe persona con ese Id», CUIT limitada…); los de
 *   autenticación, como SOAP Fault (HTTP 500, p. ej. «Token malformado»).
 * - `condicionFromPersona` deduce la condición frente al IVA con la precedencia de
 *   pyafipws: IVA exento (32) → no inscripto, legado (33) → IVA no alcanzado (34) →
 *   IVA activo (30, responsable inscripto) → monotributo (20/21) → sin datos. El
 *   resultado es una sugerencia: la pantalla la muestra y deja editarla.
 *
 * Privacidad: el padrón de una persona humana trae su nombre. No se loguea ni la
 * CUIT ni el nombre; la caché es por bar (`acc_arca_padron_cache`).
 *
 * Puro + transporte: la red entra por el `ArcaTransport` y el ticket por `getAuth`.
 */

import type { IvaCondition } from '@/lib/accounting/types'
import { parseCuit } from '@/lib/fiscal'
import { child, childrenNamed, escapeXml, textAt, type XmlNode } from '@/lib/xml/mini'
import { ARCA_ENDPOINTS, ARCA_NAMESPACES, type ArcaEnvironment } from './endpoints'
import {
  type ArcaCallContext,
  ArcaRequestError,
  type ArcaTransport,
  asEnvelope,
  envelope11,
  isArcaFault,
  soapCall,
  soapResult,
} from './soap'

// ─── Pedidos ─────────────────────────────────────────────────────────────────

export type PadronMethod = 'dummy' | 'getPersona_v2' | 'getPersonaList_v2'

/** Un pedido al padrón: el SOAPAction es `""` (anda así; el WSDL de JAX-WS no lo exige). */
export type PadronCall = {
  readonly method: PadronMethod
  readonly soapAction: ''
  readonly body: string
}

/** El ticket del WSAA (servicio `ws_sr_constancia_inscripcion`) y la CUIT representada. */
export type PadronAuth = { readonly token: string; readonly sign: string; readonly cuit: string }

/** Tope de `getPersonaList_v2` (manual v4.1 §3.3). */
export const PADRON_LIST_MAX = 250

function padronCall(method: PadronMethod, inner: string): PadronCall {
  const element = inner === '' ? `<a5:${method}/>` : `<a5:${method}>${inner}</a5:${method}>`
  return { method, soapAction: '', body: envelope11('a5', ARCA_NAMESPACES.padronA5, element) }
}

function cuitField(value: string, field: string): string {
  const parsed = parseCuit(value)
  if (!parsed.ok) throw new ArcaRequestError(field, 'la CUIT no es válida')
  return parsed.cuit
}

function credentials(token: string, sign: string, cuitRepresentada: string): string {
  if (!token.trim() || !sign.trim()) throw new ArcaRequestError('token', 'falta el ticket del WSAA')
  return (
    `<token>${escapeXml(token.trim())}</token><sign>${escapeXml(sign.trim())}</sign>` +
    `<cuitRepresentada>${cuitField(cuitRepresentada, 'cuitRepresentada')}</cuitRepresentada>`
  )
}

/** Estado de los servidores del padrón (sin autenticación). */
export function padronDummyBody(): PadronCall {
  return padronCall('dummy', '')
}

/** La constancia de una CUIT. Los hijos van sin prefijo (como en el manual). */
export function getPersonaV2Body(
  token: string,
  sign: string,
  cuitRepresentada: string,
  idPersona: string,
): PadronCall {
  return padronCall(
    'getPersona_v2',
    `${credentials(token, sign, cuitRepresentada)}<idPersona>${cuitField(idPersona, 'idPersona')}</idPersona>`,
  )
}

/** Las constancias de hasta 250 CUIT (las repetidas van una sola vez). */
export function getPersonaListV2Body(
  token: string,
  sign: string,
  cuitRepresentada: string,
  ids: readonly string[],
): PadronCall {
  const unique = [...new Set(ids.map((id, i) => cuitField(id, `idPersona.${i}`)))]
  if (unique.length === 0 || unique.length > PADRON_LIST_MAX) {
    throw new ArcaRequestError('idPersona', `van de 1 a ${PADRON_LIST_MAX} CUIT`)
  }
  return padronCall(
    'getPersonaList_v2',
    `${credentials(token, sign, cuitRepresentada)}${unique.map((id) => `<idPersona>${id}</idPersona>`).join('')}`,
  )
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export type PadronAddress = {
  readonly direccion: string | null
  readonly localidad: string | null
  readonly codPostal: string | null
  /** `descripcionProvincia` («CORDOBA»). */
  readonly provincia: string | null
  readonly idProvincia: number | null
  readonly datoAdicional: string | null
}

export type PadronTax = {
  /** `idImpuesto`: 30 IVA, 32 IVA exento, 34 IVA no alcanzado, 20/21 monotributo… */
  readonly id: number
  readonly description: string | null
  /** `estadoImpuesto` (`AC` = activo). */
  readonly state: string | null
  readonly period: string | null
  readonly source: 'general' | 'monotributo'
}

export type PadronActivity = {
  readonly code: string
  readonly description: string | null
  /** 1 = principal. */
  readonly order: number | null
  readonly period: string | null
  /** 883 = CLAE (F. 883). */
  readonly nomenclador: string | null
  readonly source: 'general' | 'monotributo'
}

export type PadronPersona = {
  readonly cuit: string
  readonly personKind: 'fisica' | 'juridica' | null
  /** Razón social, o «APELLIDO NOMBRE». */
  readonly name: string
  readonly razonSocial: string | null
  readonly apellido: string | null
  readonly nombre: string | null
  readonly estadoClave: string | null
  /** `estadoClave = ACTIVO`. */
  readonly active: boolean
  readonly esSucesion: boolean
  readonly address: PadronAddress | null
  readonly taxes: readonly PadronTax[]
  readonly activities: readonly PadronActivity[]
  /** La principal del régimen general (orden más bajo, CLAE si hay). */
  readonly mainActivity: { readonly code: string; readonly description: string | null } | null
  readonly monotributo: {
    readonly categoryId: string | null
    /** «B LOCACIONES DE SERVICIO». */
    readonly category: string | null
    readonly taxId: number | null
  } | null
  /** Los avisos de ARCA (`errorConstancia`, `errorRegimenGeneral`, `errorMonotributo`). */
  readonly notices: readonly string[]
}

export type PadronLookup =
  | { readonly found: true; readonly persona: PadronPersona }
  | {
      readonly found: false
      readonly cuit: string | null
      /** `not_found`: la CUIT no existe · `no_constancia`: existe pero ARCA no da la constancia. */
      readonly reason: 'not_found' | 'no_constancia'
      readonly message: string
    }

const CTX: ArcaCallContext = { service: 'padron', wsn: 'ws_sr_constancia_inscripcion' }
const ctxFor = (method: PadronMethod): ArcaCallContext => ({ ...CTX, method })

function clean(text: string | null | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat
}

const textOrNull = (node: XmlNode | null, path: string) => clean(textAt(node, path))

function intOrNull(node: XmlNode | null, path: string): number | null {
  const text = textOrNull(node, path)
  return text !== null && /^-?\d{1,9}$/.test(text) ? Number(text) : null
}

function cuitOrNull(text: string | null): string | null {
  const parsed = parseCuit(text)
  return parsed.ok ? parsed.cuit : null
}

const NOT_FOUND_RE = /no existe persona/i

function readTaxes(container: XmlNode | null, source: PadronTax['source']): PadronTax[] {
  const out: PadronTax[] = []
  for (const node of childrenNamed(container, 'impuesto')) {
    const id = intOrNull(node, 'idImpuesto')
    if (id === null) continue
    out.push({
      id,
      description: textOrNull(node, 'descripcionImpuesto'),
      state: textOrNull(node, 'estadoImpuesto')?.toUpperCase() ?? null,
      period: textOrNull(node, 'periodo'),
      source,
    })
  }
  return out
}

function readActivities(
  nodes: readonly XmlNode[],
  source: PadronActivity['source'],
): PadronActivity[] {
  const out: PadronActivity[] = []
  for (const node of nodes) {
    const code = textOrNull(node, 'idActividad')
    if (code === null) continue
    out.push({
      code,
      description: textOrNull(node, 'descripcionActividad'),
      order: intOrNull(node, 'orden'),
      period: textOrNull(node, 'periodo'),
      nomenclador: textOrNull(node, 'nomenclador'),
      source,
    })
  }
  return out
}

function messagesOf(node: XmlNode | null): string[] {
  return [...childrenNamed(node, 'error'), ...childrenNamed(node, 'mensaje')]
    .map((n) => clean(n.text))
    .filter((m): m is string => m !== null)
}

/** Una persona (`personaReturn` de `getPersona_v2` o `persona` de la lista). */
export function readPersona(node: XmlNode): PadronLookup {
  const general = child(node, 'datosGenerales')
  const errorConstancia = child(node, 'errorConstancia')
  const constancia = messagesOf(errorConstancia)
  if (!general) {
    const notFound = constancia.length === 0 || constancia.some((m) => NOT_FOUND_RE.test(m))
    return {
      found: false,
      cuit: cuitOrNull(textOrNull(errorConstancia, 'idPersona')),
      reason: notFound ? 'not_found' : 'no_constancia',
      message: constancia[0] ?? 'ARCA no devolvió datos de esa CUIT.',
    }
  }

  const regimen = child(node, 'datosRegimenGeneral')
  const mono = child(node, 'datosMonotributo')
  const razonSocial = textOrNull(general, 'razonSocial')
  const apellido = textOrNull(general, 'apellido')
  const nombre = textOrNull(general, 'nombre')
  const tipoPersona = textOrNull(general, 'tipoPersona')?.toUpperCase() ?? null
  const estadoClave = textOrNull(general, 'estadoClave')?.toUpperCase() ?? null
  const domicilio = child(general, 'domicilioFiscal')

  const activities = [
    ...readActivities(childrenNamed(regimen, 'actividad'), 'general'),
    ...readActivities(
      [...childrenNamed(mono, 'actividad'), ...childrenNamed(mono, 'actividadMonotributista')],
      'monotributo',
    ),
  ]
  const generalActivities = activities.filter((a) => a.source === 'general')
  const byOrder = (a: PadronActivity, b: PadronActivity) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  const main = [...generalActivities].sort(byOrder)[0] ?? [...activities].sort(byOrder)[0] ?? null

  const categoria = child(mono, 'categoriaMonotributo')

  const persona: PadronPersona = {
    cuit:
      cuitOrNull(textOrNull(general, 'idPersona')) ??
      cuitOrNull(textOrNull(errorConstancia, 'idPersona')) ??
      '',
    personKind:
      tipoPersona === 'FISICA' ? 'fisica' : tipoPersona === 'JURIDICA' ? 'juridica' : null,
    name: razonSocial ?? [apellido, nombre].filter((x): x is string => x !== null).join(' '),
    razonSocial,
    apellido,
    nombre,
    estadoClave,
    active: estadoClave === 'ACTIVO',
    esSucesion: textOrNull(general, 'esSucesion')?.toUpperCase() === 'SI',
    address: domicilio
      ? {
          direccion: textOrNull(domicilio, 'direccion'),
          localidad: textOrNull(domicilio, 'localidad'),
          codPostal: textOrNull(domicilio, 'codPostal'),
          provincia: textOrNull(domicilio, 'descripcionProvincia'),
          idProvincia: intOrNull(domicilio, 'idProvincia'),
          datoAdicional: textOrNull(domicilio, 'datoAdicional'),
        }
      : null,
    taxes: [...readTaxes(regimen, 'general'), ...readTaxes(mono, 'monotributo')],
    activities,
    mainActivity: main ? { code: main.code, description: main.description } : null,
    monotributo: categoria
      ? {
          categoryId: textOrNull(categoria, 'idCategoria'),
          category: textOrNull(categoria, 'descripcionCategoria'),
          taxId: intOrNull(categoria, 'idImpuesto'),
        }
      : null,
    notices: [
      ...constancia,
      ...messagesOf(child(node, 'errorRegimenGeneral')),
      ...messagesOf(child(node, 'errorMonotributo')),
    ],
  }
  return { found: true, persona }
}

/** La respuesta de `getPersona_v2`. */
export function parsePersona(input: XmlNode | string): PadronLookup {
  const ctx = ctxFor('getPersona_v2')
  return readPersona(soapResult(asEnvelope(input, ctx), 'getPersona_v2Response/personaReturn', ctx))
}

/** La respuesta de `getPersonaList_v2`: una por `persona`, en el orden de ARCA. */
export function parsePersonaList(input: XmlNode | string): PadronLookup[] {
  const ctx = ctxFor('getPersonaList_v2')
  const list = soapResult(
    asEnvelope(input, ctx),
    'getPersonaList_v2Response/personaListReturn',
    ctx,
  )
  return childrenNamed(list, 'persona').map(readPersona)
}

export type PadronDummyStatus = {
  readonly appServer: string | null
  readonly authServer: string | null
  readonly dbServer: string | null
  readonly ok: boolean
}

export function parsePadronDummy(input: XmlNode | string): PadronDummyStatus {
  const ctx = ctxFor('dummy')
  // El hijo de `dummyResponse` se llama `return` (JAX-WS); se toma el primero sin mirar el nombre.
  const ret = soapResult(asEnvelope(input, ctx), 'dummyResponse', ctx).children[0] ?? null
  const appServer = textOrNull(ret, 'appserver')
  const authServer = textOrNull(ret, 'authserver')
  const dbServer = textOrNull(ret, 'dbserver')
  return {
    appServer,
    authServer,
    dbServer,
    ok: appServer === 'OK' && authServer === 'OK' && dbServer === 'OK',
  }
}

// ─── Condición frente al IVA ─────────────────────────────────────────────────

export type PadronIvaReason =
  | 'iva_exento'
  | 'no_inscripto'
  | 'iva_no_alcanzado'
  | 'responsable_inscripto'
  | 'monotributo'
  | 'monotributo_social'
  | 'monotributo_promovido'
  | 'sin_datos'

export type PadronIvaCondition = {
  /** Para `acc_parties.iva_condition`. */
  readonly ivaCondition: IvaCondition
  /** Para `CondicionIVAReceptorId` de WSFE (1, 4, 5, 6, 13, 15, 16), o `null` si hay que elegirla. */
  readonly condicionIvaReceptorId: number | null
  /** La deducción no es segura: la persona tiene que confirmarla. */
  readonly needsReview: boolean
  readonly reason: PadronIvaReason
}

const isActive = (t: PadronTax) => t.state === null || t.state === 'AC'

/**
 * La condición frente al IVA que surge de la constancia (precedencia de pyafipws,
 * `arca-tecnico.md` §5.3):
 *
 * | Padrón | `iva_condition` | `CondicionIVAReceptorId` |
 * |---|---|---|
 * | 32 IVA exento (o el 30 en estado `EX`) | `exento` | 4 |
 * | 33 no inscripto (legado) | `sin_datos` | — (a revisar) |
 * | 34 IVA no alcanzado (o el 30 en `NA`) | `no_alcanzado` | 15 |
 * | 30 IVA activo | `responsable_inscripto` | 1 |
 * | Monotributo (20/21 o categoría) | `monotributo` | 6 (13 si es social, 16 si es promovido: a revisar) |
 * | Nada de eso | persona humana: `consumidor_final` (5); si no, `sin_datos` | 5 / — (a revisar) |
 */
export function condicionFromPersona(p: PadronPersona): PadronIvaCondition {
  const active = p.taxes.filter(isActive)
  const has = (id: number) => active.some((t) => t.id === id)
  const iva = p.taxes.find((t) => t.id === 30)

  if (has(32) || iva?.state === 'EX') {
    return {
      ivaCondition: 'exento',
      condicionIvaReceptorId: 4,
      needsReview: false,
      reason: 'iva_exento',
    }
  }
  if (has(33)) {
    return {
      ivaCondition: 'sin_datos',
      condicionIvaReceptorId: null,
      needsReview: true,
      reason: 'no_inscripto',
    }
  }
  if (has(34) || iva?.state === 'NA') {
    return {
      ivaCondition: 'no_alcanzado',
      condicionIvaReceptorId: 15,
      needsReview: false,
      reason: 'iva_no_alcanzado',
    }
  }
  if (iva && isActive(iva)) {
    return {
      ivaCondition: 'responsable_inscripto',
      condicionIvaReceptorId: 1,
      needsReview: false,
      reason: 'responsable_inscripto',
    }
  }
  const monoTax = active.some((t) => t.id === 20 || t.id === 21)
  const monoCategory =
    p.monotributo !== null &&
    (p.monotributo.taxId === null || [20, 21].includes(p.monotributo.taxId))
  if (monoTax || monoCategory) {
    const category = p.monotributo?.category ?? ''
    if (/SOCIAL/i.test(category)) {
      return {
        ivaCondition: 'monotributo',
        condicionIvaReceptorId: 13,
        needsReview: true,
        reason: 'monotributo_social',
      }
    }
    if (/PROMOVID/i.test(category)) {
      return {
        ivaCondition: 'monotributo',
        condicionIvaReceptorId: 16,
        needsReview: true,
        reason: 'monotributo_promovido',
      }
    }
    return {
      ivaCondition: 'monotributo',
      condicionIvaReceptorId: 6,
      needsReview: false,
      reason: 'monotributo',
    }
  }
  return p.personKind === 'fisica'
    ? {
        ivaCondition: 'consumidor_final',
        condicionIvaReceptorId: 5,
        needsReview: true,
        reason: 'sin_datos',
      }
    : {
        ivaCondition: 'sin_datos',
        condicionIvaReceptorId: null,
        needsReview: true,
        reason: 'sin_datos',
      }
}

/**
 * Una fila para `acc_arca_padron_cache_put` (`{ cuit, found, data }`, `data` ≤ 4 KB):
 * lo justo para completar el alta, con los nombres de §6.2.
 */
export function padronCacheRow(
  lookup: PadronLookup,
  requestedCuit: string,
): {
  cuit: string
  found: boolean
  data: Record<string, string | number | boolean | null | Record<string, string | null>>
} {
  const cuit = cuitField(requestedCuit, 'cuit')
  if (!lookup.found) {
    return { cuit, found: false, data: { reason: lookup.reason, message: lookup.message } }
  }
  const p = lookup.persona
  const iva = condicionFromPersona(p)
  return {
    cuit,
    found: true,
    data: {
      name: p.name,
      person_kind: p.personKind,
      active: p.active,
      iva_condition: iva.ivaCondition,
      condicion_iva_receptor_id: iva.condicionIvaReceptorId,
      needs_review: iva.needsReview,
      monotributo_category: p.monotributo?.category ?? null,
      address: p.address?.direccion ?? null,
      locality: p.address?.localidad ?? null,
      province: p.address?.provincia ?? null,
      activity: p.mainActivity
        ? { code: p.mainActivity.code, description: p.mainActivity.description }
        : null,
    },
  }
}

// ─── Cliente ─────────────────────────────────────────────────────────────────

export type PadronClient = {
  readonly environment: ArcaEnvironment
  dummy(): Promise<PadronDummyStatus>
  getPersona(idPersona: string): Promise<PadronLookup>
  getPersonaList(ids: readonly string[]): Promise<PadronLookup[]>
}

export type PadronClientOptions = { readonly timeoutMs?: number }

/**
 * Cliente del padrón para un ambiente. `getAuth` da el ticket del servicio
 * `ws_sr_constancia_inscripcion` y la CUIT representada (la SAS). Se reintenta una
 * vez ante un error de red (las consultas no cambian nada).
 */
export function createPadron(
  transport: ArcaTransport,
  env: ArcaEnvironment,
  getAuth: () => Promise<PadronAuth>,
  options: PadronClientOptions = {},
): PadronClient {
  const url = ARCA_ENDPOINTS[env].padronA5

  const send = async (call: PadronCall): Promise<XmlNode> => {
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
      if (isArcaFault(e) && e.kind === 'network') return soapCall(transport, input)
      throw e
    }
  }

  return {
    environment: env,

    async dummy() {
      return parsePadronDummy(await send(padronDummyBody()))
    },

    async getPersona(idPersona) {
      const auth = await getAuth()
      const call = getPersonaV2Body(auth.token, auth.sign, auth.cuit, idPersona)
      try {
        return parsePersona(await send(call))
      } catch (e) {
        // Algunas versiones contestan «No existe persona con ese Id» como Fault.
        if (isArcaFault(e) && e.kind === 'fault' && NOT_FOUND_RE.test(e.detail)) {
          return {
            found: false,
            cuit: cuitOrNull(idPersona),
            reason: 'not_found',
            message: e.detail,
          }
        }
        throw e
      }
    },

    async getPersonaList(ids) {
      const auth = await getAuth()
      return parsePersonaList(
        await send(getPersonaListV2Body(auth.token, auth.sign, auth.cuit, ids)),
      )
    },
  }
}
