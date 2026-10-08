import 'server-only'

import { ARCA_SERVICE, type ArcaEnvironment, type ArcaWsn } from './endpoints'
import { type ArcaErrorKey, classifyArcaError } from './errors'
import { type ArcaCheckKey, type ArcaTestCheck, arcaTestStatus } from './guide'
import { condicionFromPersona, type PadronLookup } from './padron'
import { isArcaSecretsKeyError } from './secrets'
import {
  type ArcaDeadline,
  type ArcaSession,
  arcaDeadline,
  deadlineTimeout,
  isArcaCooldownError,
  isDeadlineFault,
  isTicketRejection,
} from './session'
import { isArcaFault } from './soap'
import { isArcaStoreError } from './store'
import { decodeTokenRelations } from './wsaa'
import { type PtoVenta, pointOfSaleStatus } from './wsfe'

/**
 * «Probar conexión» (diseño §2.6): los chequeos en orden, con la forma que guarda
 * `acc_arca_record_test` (`{ key, ok, detail?, error? }`, `error` = clave de
 * `ARCA_ERRORS`).
 *
 * 1. `service` — `FEDummy` (sin ticket). Si falla, se corta.
 * 2. `wsfe_ticket` — el ticket de `wsfe` (de la base o login). Si falla, se corta.
 * 3. `relations` — la SAS está en `relations` del token. Si el token se puede leer y
 *    trae otras CUIT pero no la SAS, se corta. Si no se puede leer (o viene vacío:
 *    la forma real se confirma con el primer login de homologación), decide WSFE en
 *    el chequeo 4 (600/601 = la SAS no está en el permiso).
 * 4. `point_of_sale` — `FEParamGetPtosVenta`. En homologación ARCA suele contestar
 *    602 «Sin Resultados» (no hay puntos de venta de prueba): eso NO falla. Si falla,
 *    se corta.
 * 5. `numbering` — `FECompUltimoAutorizado` de la Factura B (y de la A si está
 *    habilitada). No corta.
 * 6. `padron` — `dummy` del padrón y la constancia de la SAS con el ticket de
 *    `ws_sr_constancia_inscripcion`. No corta.
 * 7. `certificate` — días hasta el vencimiento (aviso con menos de 30). No corta.
 *
 * Lo que es de la base o de la configuración (`ArcaStoreError`, falta la clave del
 * servidor) corta la prueba con ese error: no es un resultado de ARCA y no se
 * guarda.
 *
 * **Plazo duro** (`ArcaDeadline`, el mismo que usa la sesión): 50 s desde que empezó
 * la acción. Cada llamada a ARCA tiene de tope lo que queda menos 3 s, y un login al
 * WSAA solo se empieza con 20 s o más por delante. El chequeo al que no le llegó el
 * tiempo queda «no se llegó a probar» (`arca_unavailable` con
 * `detail: { timeout: true, not_started: true }`) y los siguientes no se corren (van
 * a `notRun` en la vista), salvo el 7, que es local.
 *
 * **Ticket rechazado:** si WSFE o el padrón rechazan el ticket (600/601, o la SAS no
 * está en `relations`), se descarta ese ticket (`session.dropTicket`) para que la
 * próxima prueba pida otro, y el chequeo lo anota con `detail.ticket_dropped`.
 *
 * Los `detail` no llevan datos personales: estados, números, la razón social de la
 * SAS y códigos técnicos (nunca las CUIT del token ni el ticket).
 */

export type ConnectionTestInput = {
  readonly session: ArcaSession
  readonly environment: ArcaEnvironment
  /** La SAS (11 dígitos). */
  readonly representedCuit: string
  readonly pointOfSale: number | null
  /** `allowed_classes` de la conexión. */
  readonly allowedClasses: readonly string[]
  readonly certNotAfter: Date | null
  /** `acc_settings.legal_name`, para avisar si ARCA dice otra cosa. */
  readonly sasLegalName: string | null
  readonly now?: () => Date
  /**
   * El plazo duro de toda la prueba: el MISMO que recibió la sesión (así la sesión
   * recorta cada llamada y los chequeos saben cuándo frenar). Por defecto, 50 s desde
   * que empieza la prueba.
   */
  readonly deadline?: ArcaDeadline
}

export type ConnectionTestRun = {
  readonly checks: ArcaTestCheck[]
  readonly status: 'connected' | 'error'
}

/** Plazo duro de «Probar conexión», desde que empieza la acción (la función tiene 60 s). */
export const CONNECTION_TEST_DEADLINE_MS = 50_000
/** @deprecated Era un presupuesto blando de 45 s; ahora es el plazo duro `CONNECTION_TEST_DEADLINE_MS`. */
export const CONNECTION_TEST_BUDGET_MS = CONNECTION_TEST_DEADLINE_MS
/** Con menos de 30 días para el vencimiento, aviso de renovar (§2.2 y §2.6). */
export const CERT_RENEW_DAYS = 30

const DAY_MS = 86_400_000

type Detail = Record<string, unknown>
type Check = { key: ArcaCheckKey; ok: boolean; detail?: Detail | null; error?: ArcaErrorKey | null }

/** Lo que no es de ARCA corta la prueba entera (lo traduce la acción). */
function rethrowLocal(e: unknown): void {
  if (isArcaStoreError(e) || isArcaSecretsKeyError(e)) throw e
}

/**
 * «No se llegó a probar»: se acababa el plazo y este chequeo no se empezó (o no se
 * empezó el login que necesitaba). `timeout` lo entiende la vista de hoy («ARCA tardó
 * demasiado»); `not_started` distingue que no se llegó a preguntar.
 */
function notStarted(key: ArcaCheckKey, extra: Detail = {}): Check {
  return {
    key,
    ok: false,
    error: 'arca_unavailable',
    detail: { ...extra, timeout: true, not_started: true },
  }
}

/** El código técnico de una falla de ARCA (para soporte), sin datos de nadie. */
function technicalCode(e: unknown): string | null {
  if (!isArcaFault(e)) return null
  const first = e.messages[0]
  const code = e.kind === 'service' && first ? String(first.code) : e.code
  return code.slice(0, 80)
}

function failed(key: ArcaCheckKey, e: unknown, extra: Detail = {}): Check {
  const detail: Detail = { ...extra }
  const code = technicalCode(e)
  if (code) detail.code = code
  if (isArcaCooldownError(e)) {
    detail.cooldown = true
    detail.manual = e.manual
    if (e.until) detail.until = e.until.toISOString()
  }
  return {
    key,
    ok: false,
    error: classifyArcaError(e),
    detail: Object.keys(detail).length > 0 ? detail : null,
  }
}

function clip(text: string | null | undefined, max: number): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** «HUB COFFEE & BAR S.A.S.» y «Hub Coffee & Bar SAS» son la misma razón social. */
export function sameLegalName(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\./g, '')
      .replace(/[^A-Z0-9&]+/g, ' ')
      .trim()
  return norm(a) === norm(b)
}

function pointOfSaleCheck(
  items: readonly PtoVenta[],
  pointOfSale: number | null,
  environment: ArcaEnvironment,
): Check {
  if (pointOfSale === null) {
    return {
      key: 'point_of_sale',
      ok: false,
      error: 'arca_pos_not_enabled',
      detail: { configured: false },
    }
  }
  const found = items.find((p) => p.nro === pointOfSale)
  switch (pointOfSaleStatus(items, pointOfSale)) {
    case 'ok':
      return {
        key: 'point_of_sale',
        ok: true,
        detail: { nro: pointOfSale, emision_tipo: found?.emisionTipo ?? null, bloqueado: 'N' },
      }
    case 'missing':
      // Homologación: ARCA no lista los puntos de venta de prueba (602), y cualquiera sirve.
      return environment === 'homologacion'
        ? { key: 'point_of_sale', ok: true, detail: { nro: pointOfSale, listed: false } }
        : {
            key: 'point_of_sale',
            ok: false,
            error: 'arca_pos_not_enabled',
            detail: { nro: pointOfSale, listed: false, total: items.length },
          }
    case 'blocked':
      return {
        key: 'point_of_sale',
        ok: false,
        error: 'arca_pos_blocked',
        detail: { nro: pointOfSale, bloqueado: 'S' },
      }
    case 'dropped':
      return {
        key: 'point_of_sale',
        ok: false,
        error: 'arca_pos_not_enabled',
        detail: { nro: pointOfSale, state: 'dropped', fch_baja: found?.fchBaja ?? null },
      }
    case 'caea':
      return {
        key: 'point_of_sale',
        ok: false,
        error: 'arca_pos_not_enabled',
        detail: { nro: pointOfSale, state: 'caea' },
      }
  }
}

function padronCheck(lookup: PadronLookup, input: ConnectionTestInput): Check {
  if (!lookup.found) {
    // En homologación el padrón de prueba no tiene a todas las SAS: la autorización igual anduvo.
    return input.environment === 'homologacion'
      ? { key: 'padron', ok: true, detail: { found: false } }
      : { key: 'padron', ok: false, error: 'arca_issuer_problem', detail: { found: false } }
  }
  const persona = lookup.persona
  const address = clip(
    [persona.address?.direccion, persona.address?.localidad, persona.address?.provincia]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(', '),
    160,
  )
  const detail: Detail = {
    found: true,
    name: clip(persona.name, 120),
    iva: condicionFromPersona(persona).ivaCondition,
    active: persona.active,
    address,
    name_matches: sameLegalName(persona.name, input.sasLegalName),
  }
  if (!persona.active && input.environment === 'produccion') {
    return { key: 'padron', ok: false, error: 'arca_issuer_problem', detail }
  }
  return { key: 'padron', ok: true, detail }
}

function certificateCheck(notAfter: Date, now: Date): Check {
  const daysLeft = Math.floor((notAfter.getTime() - now.getTime()) / DAY_MS)
  const detail: Detail = { days_left: daysLeft, not_after: notAfter.toISOString() }
  if (now.getTime() > notAfter.getTime()) {
    return { key: 'certificate', ok: false, error: 'arca_cert_expired', detail }
  }
  if (daysLeft < CERT_RENEW_DAYS) {
    // Aviso sin clave de error: no es un problema de la conexión todavía.
    return { key: 'certificate', ok: false, detail: { ...detail, renew_soon: true } }
  }
  return { key: 'certificate', ok: true, detail }
}

/** Corre la prueba. Tira solo lo que no es de ARCA (`ArcaStoreError`, clave del servidor). */
export async function runConnectionTest(input: ConnectionTestInput): Promise<ConnectionTestRun> {
  const now = input.now ?? (() => new Date())
  const deadline = input.deadline ?? arcaDeadline(CONNECTION_TEST_DEADLINE_MS, now)
  /** ¿Queda tiempo para empezar otra llamada a ARCA (con su margen)? */
  const canCall = () => deadlineTimeout(deadline, Number.POSITIVE_INFINITY) !== null
  const { session } = input
  const checks: Check[] = []
  const done = (): ConnectionTestRun => {
    const result = checks.map((c) => ({
      key: c.key,
      ok: c.ok,
      ...(c.detail ? { detail: c.detail } : {}),
      ...(c.error ? { error: c.error } : {}),
    }))
    return { checks: result, status: arcaTestStatus(result) }
  }
  /** Si ARCA rechazó el ticket de `service`, se descarta y queda anotado en el chequeo. */
  const dropIfRejected = async (service: ArcaWsn, e: unknown): Promise<Detail> =>
    isTicketRejection(e) && (await session.dropTicket(service)) === 'dropped'
      ? { ticket_dropped: true }
      : {}

  // 1. ARCA responde (FEDummy, sin ticket).
  if (!canCall()) {
    checks.push(notStarted('service'))
    return done()
  }
  try {
    const status = await session.wsfe.dummy()
    const detail = { app: status.appServer, db: status.dbServer, auth: status.authServer }
    if (!status.ok) {
      checks.push({ key: 'service', ok: false, error: 'arca_unavailable', detail })
      return done()
    }
    checks.push({ key: 'service', ok: true, detail })
  } catch (e) {
    rethrowLocal(e)
    checks.push(isDeadlineFault(e) ? notStarted('service') : failed('service', e))
    return done()
  }

  // 2. El ticket de Facturación Electrónica (de la base o con login; el login solo con 20 s
  //    o más por delante: si no, la sesión no lo empieza y tira `deadlineFault`).
  if (!canCall()) {
    checks.push(notStarted('wsfe_ticket'))
    return done()
  }
  let token: string
  try {
    const ticket = await session.ticket('wsfe')
    token = ticket.token
    checks.push({
      key: 'wsfe_ticket',
      ok: true,
      detail: { source: ticket.source, expires_at: ticket.expiresAt.toISOString() },
    })
  } catch (e) {
    rethrowLocal(e)
    checks.push(isDeadlineFault(e) ? notStarted('wsfe_ticket') : failed('wsfe_ticket', e))
    return done()
  }

  // 3. La SAS está en el permiso (`relations` del token).
  const relations = decodeTokenRelations(token)
  const listed =
    relations !== null && relations.length > 0 ? relations.includes(input.representedCuit) : null
  if (listed === false) {
    // Ese ticket nunca va a servir para la SAS: se descarta, así después de arreglar el paso 7
    // la próxima prueba pide otro en vez de reusar este hasta 12 h.
    const dropped = (await session.dropTicket(ARCA_SERVICE.wsfe)) === 'dropped'
    checks.push({
      key: 'relations',
      ok: false,
      error: 'arca_cuit_not_in_token',
      detail: { listed: false, ...(dropped ? { ticket_dropped: true } : {}) },
    })
    return done()
  }
  if (listed === true) checks.push({ key: 'relations', ok: true, detail: { listed: true } })

  // 4. El punto de venta (y, si el token no se pudo leer, la representación).
  const posKey: ArcaCheckKey = listed === null ? 'relations' : 'point_of_sale'
  if (!canCall()) {
    checks.push(notStarted(posKey))
    return done()
  }
  let items: PtoVenta[]
  try {
    items = await session.wsfe.ptosVenta()
  } catch (e) {
    rethrowLocal(e)
    if (isDeadlineFault(e)) {
      checks.push(notStarted(posKey))
      return done()
    }
    // Con el token ilegible, WSFE decide si la SAS está en el permiso (600/601).
    const dropped = await dropIfRejected(ARCA_SERVICE.wsfe, e)
    checks.push(
      listed === null
        ? failed('relations', e, { listed: null, ...dropped })
        : failed('point_of_sale', e, dropped),
    )
    return done()
  }
  if (listed === null) {
    checks.push({ key: 'relations', ok: true, detail: { listed: null, confirmed_by: 'wsfe' } })
  }
  const posCheck = pointOfSaleCheck(items, input.pointOfSale, input.environment)
  checks.push(posCheck)
  if (!posCheck.ok || input.pointOfSale === null) return done()
  const pointOfSale = input.pointOfSale

  // 5. Numeración: el último comprobante autorizado (Factura B; y A si está habilitada).
  if (!canCall()) {
    checks.push(notStarted('numbering'))
  } else {
    const tipos = input.allowedClasses.includes('A') ? [6, 1] : [6]
    const detail: Detail = {}
    let firstError: unknown = null
    let dropped: Detail = {}
    for (const tipo of tipos) {
      try {
        detail[String(tipo)] = await session.wsfe.ultimoAutorizado(pointOfSale, tipo)
      } catch (e) {
        rethrowLocal(e)
        firstError ??= e
        // Con el ticket rechazado o sin tiempo, la otra letra no tiene sentido.
        if (isDeadlineFault(e)) break
        dropped = await dropIfRejected(ARCA_SERVICE.wsfe, e)
        if (isTicketRejection(e)) break
      }
    }
    checks.push(
      firstError === null
        ? { key: 'numbering', ok: true, detail }
        : isDeadlineFault(firstError)
          ? notStarted('numbering', detail)
          : failed('numbering', firstError, { ...detail, ...dropped }),
    )
  }

  // 6. Padrón: servidores y la constancia de la SAS (con su propio ticket).
  if (!canCall()) {
    checks.push(notStarted('padron'))
  } else {
    try {
      const dummy = await session.padron.dummy()
      if (!dummy.ok) {
        checks.push({
          key: 'padron',
          ok: false,
          error: 'arca_unavailable',
          detail: { app: dummy.appServer, db: dummy.dbServer, auth: dummy.authServer },
        })
      } else {
        checks.push(padronCheck(await session.padron.getPersona(input.representedCuit), input))
      }
    } catch (e) {
      rethrowLocal(e)
      checks.push(
        isDeadlineFault(e)
          ? notStarted('padron')
          : failed('padron', e, await dropIfRejected(ARCA_SERVICE.padron, e)),
      )
    }
  }

  // 7. Certificado: cuánto le queda (local, sin ARCA).
  if (input.certNotAfter) checks.push(certificateCheck(input.certNotAfter, now()))

  return done()
}
