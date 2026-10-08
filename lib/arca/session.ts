import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { ARCA_SERVICE, type ArcaEnvironment, type ArcaWsn } from './endpoints'
import {
  ArcaError,
  type ArcaErrorKey,
  classifyArcaError,
  isArcaErrorKey,
  wsaaCooldown,
} from './errors'
import { createPadron, type PadronClient } from './padron'
import { type ArcaCredentials, loadCredentials, secretsKey } from './secrets'
import {
  type ArcaCallContext,
  ArcaFault,
  type ArcaMsg,
  type ArcaTransport,
  isArcaFault,
  SOAP_TIMEOUT_MS,
} from './soap'
import {
  type ArcaRpc,
  ArcaStoreError,
  asRec,
  callArcaRpc,
  dateOf,
  intOf,
  isArcaStoreError,
  isUuidText,
  type Rec,
  rpcOf,
  textOf,
} from './store'
import { getTransport } from './transport'
import { type ArcaTicket, wsaaLogin } from './wsaa'
import { createWsfe, type WsfeClient } from './wsfe'

/**
 * La sesión con ARCA de un bar y un ambiente (diseño §2.4.1 y §2.5): el ticket de
 * acceso (TA) del WSAA de cada servicio y los clientes de WSFE y del padrón que lo
 * usan. Con un **plazo duro** opcional (`ArcaDeadline`, ver abajo) y el descarte de un
 * TA que ARCA rechazó (`dropTicket`).
 *
 * **El ticket vive en la base** (`acc_arca_tickets`, cifrado): en serverless cada
 * instancia arranca vacía, y el WSAA pide reusar el TA (12 h); si se pide otro con
 * uno vigente contesta «El CEE ya posee un TA válido» (`coe.alreadyAuthenticated`).
 * Por eso la renovación va bajo un **lease** persistido (`acc_arca_ticket_get` /
 * `acc_arca_ticket_put`): una sola instancia hace el login; las demás ven `busy` y
 * esperan. Nunca hay dos logins a la vez.
 *
 * `acc_arca_ticket_get` contesta:
 * - `valid` → se usa (vence en más de 10 minutos).
 * - `cooldown` → no se pide otro (política del WSAA): `ArcaCooldownError` con la
 *   clave del último error. «Probar conexión» borra el cooldown **manual**
 *   (`clearManualCooldown`), no el de tiempo.
 * - `busy` → otra instancia está logueando: se espera 1,5 s y se vuelve a preguntar
 *   (hasta 7 veces, unos 9 s; después `arca_busy`).
 * - `lease` → le toca a esta instancia: carga las credenciales, hace el login y lo
 *   informa con `acc_arca_ticket_put` (en snake_case, ver abajo).
 * - Puede tirar `secret_unreadable` (la clave del servidor no abre el TA guardado)
 *   sin haber dado el lease: entonces NO se llama a `ticket_put`.
 *
 * **Cooldown** (`wsaaCooldown`) solo para fallas que vinieron del WSAA (una
 * `ArcaFault` de `wsaaLogin`): 60 s si no respondió, 2 o 10 minutos si «ya posee un
 * TA válido», manual para el resto. Si falló ANTES de pedir (no se pudieron cargar
 * las credenciales: `secret_unreadable`, `arca_key_missing`, `arca_not_ready`, o la
 * clave no es la del certificado), el lease se libera con `cooldown: null`: si no,
 * un deploy mal configurado dejaría a todos bloqueados hasta «Probar conexión».
 *
 * **TA rechazado** (`acc_arca_ticket_drop`, migración 20261008120400): si WSFE o el
 * padrón rechazan un TA vigente (Err 600/601, «No apareció CUIT en lista de
 * relaciones», un Fault por el token), quien llamó lo descarta con
 * `session.dropTicket(servicio)`. Así la próxima acción pide otro en vez de reusar el
 * mismo hasta 12 h (el caso real: la persona autorizó el certificado a su nombre y no
 * al de la SAS, lo arregla en ARCA y vuelve a probar). En esa misma sesión ese
 * servicio ya no pide otro: un login enseguida chocaría con «ya posee un TA válido».
 * Si la RPC todavía no existe (`function_unavailable`) todo sigue como antes.
 *
 * Solo servidor. Nunca loguear el token, el sign, el PEM ni la clave del servidor:
 * los logs llevan solo la operación y la clave del error.
 */

// ─── Plazo duro ──────────────────────────────────────────────────────────────

/**
 * El plazo de reloj de una acción que habla con ARCA. Vercel corta la función a los
 * `maxDuration` segundos: si la corta en medio de un login al WSAA que ARCA sí
 * procesó, ese TA se pierde y el servicio queda con «ya posee un TA válido» un rato.
 * Con el plazo:
 *
 * - cada llamada a ARCA tiene de tope `min(su tope, lo que queda − 3 s)`
 *   (`DEADLINE_MARGIN_MS`); si le quedaría menos de 1 s (`MIN_CALL_MS`) no se empieza:
 *   `ArcaFault('network', 'deadline')`, que nunca llegó a ARCA (como `url_not_allowed`);
 * - un login al WSAA se empieza solo con 20 s o más por delante
 *   (`LOGIN_MIN_REMAINING_MS`); si no, se devuelve el lease sin cooldown y la acción
 *   dice «no se llegó a probar»;
 * - la espera de `busy` (otra instancia logueando) no sigue si después no quedaría
 *   tiempo para usar el ticket.
 *
 * Lo arma la acción al empezar (`arcaDeadline(50_000)` en «Probar conexión», 40 s en
 * «Completar con ARCA») y lo comparten la sesión (por el transporte) y quien arma los
 * chequeos. Las llamadas a la base no se recortan: son cortas y tienen su propio tope.
 */
export type ArcaDeadline = {
  /** El instante límite (ms desde 1970). */
  readonly at: number
  /** Cuánto falta, en ms (negativo si ya pasó). */
  remaining(): number
}

/** Lo que cada llamada a ARCA deja libre antes del plazo (guardar el resultado y contestar). */
export const DEADLINE_MARGIN_MS = 3_000
/** Una llamada a ARCA con menos tope que esto no vale la pena: no se empieza. */
export const MIN_CALL_MS = 1_000
/** Un login al WSAA solo se empieza con al menos esto por delante. */
export const LOGIN_MIN_REMAINING_MS = 20_000
/** El `code` de la `ArcaFault` de una llamada que no se empezó por falta de tiempo. */
export const DEADLINE_FAULT_CODE = 'deadline'

/** Un plazo de `totalMs` desde ahora (`now` es el reloj: el de los tests es falso). */
export function arcaDeadline(totalMs: number, now: () => Date = () => new Date()): ArcaDeadline {
  const at = now().getTime() + totalMs
  return { at, remaining: () => at - now().getTime() }
}

/**
 * El tope de una llamada con el plazo: `min(timeoutMs, lo que queda − 3 s)`, o `null` si
 * le quedaría menos de 1 s (no se empieza). Sin plazo, `timeoutMs` tal cual.
 */
export function deadlineTimeout(
  deadline: ArcaDeadline | null | undefined,
  timeoutMs: number,
): number | null {
  if (!deadline) return timeoutMs
  const left = deadline.remaining() - DEADLINE_MARGIN_MS
  return left < MIN_CALL_MS ? null : Math.min(timeoutMs, left)
}

/** ¿Hay tiempo para empezar un login al WSAA? */
export function canStartLogin(deadline: ArcaDeadline | null | undefined): boolean {
  return !deadline || deadline.remaining() >= LOGIN_MIN_REMAINING_MS
}

/** ¿Tiene sentido esperar `waitMs` (a que otra instancia termine) y después usar el ticket? */
function canWait(deadline: ArcaDeadline | null | undefined, waitMs: number): boolean {
  return !deadline || deadline.remaining() - waitMs >= DEADLINE_MARGIN_MS + MIN_CALL_MS
}

/** La falla de una llamada (o un login) que no se empezó por el plazo. Nunca llegó a ARCA. */
export function deadlineFault(ctx: ArcaCallContext = {}): ArcaFault {
  return new ArcaFault('network', DEADLINE_FAULT_CODE, ctx)
}

/** ¿Es una llamada que no se empezó porque se acababa el plazo? */
export function isDeadlineFault(e: unknown): boolean {
  return isArcaFault(e) && e.kind === 'network' && e.code === DEADLINE_FAULT_CODE
}

/**
 * El transporte con el plazo: recorta el tope de cada pedido y no manda los que no
 * entran. Los reintentos por red de WSFE y del padrón pasan por acá también, así que
 * tampoco se pasan del plazo.
 */
export function withDeadline(transport: ArcaTransport, deadline: ArcaDeadline): ArcaTransport {
  return async (request) => {
    const timeoutMs = deadlineTimeout(deadline, request.timeoutMs)
    if (timeoutMs === null) throw deadlineFault()
    return transport(timeoutMs === request.timeoutMs ? request : { ...request, timeoutMs })
  }
}

// ─── Ticket rechazado ────────────────────────────────────────────────────────

/** Los códigos de WSFE que dicen que el TA no sirve (600: token o firma · 601: la CUIT no está). */
const TICKET_REJECTION_CODES: ReadonlySet<number> = new Set([600, 601])

/** ¿Estos `Errors` de WSFE rechazan el TA? (el rechazo de `FECAESolicitar` vuelve sin tirar). */
export function ticketRejectedBy(messages: readonly ArcaMsg[]): boolean {
  return messages.some((m) => TICKET_REJECTION_CODES.has(m.code))
}

/**
 * ¿ARCA rechazó el TA que usamos? WSFE con 600/601 o un Fault del padrón por el token
 * o la relación (`arca_token_rejected` / `arca_cuit_not_in_token`). Lo que vino del
 * WSAA no cuenta: ahí no se usó ningún TA.
 */
export function isTicketRejection(e: unknown): boolean {
  if (!isArcaFault(e) || e.service === 'wsaa') return false
  if (e.kind === 'service') return ticketRejectedBy(e.messages)
  if (e.kind !== 'fault') return false
  const key = classifyArcaError(e)
  return key === 'arca_token_rejected' || key === 'arca_cuit_not_in_token'
}

/**
 * Qué pasó al descartar un TA: `dropped` (ya no está en la base: la próxima acción pide
 * otro), `unavailable` (la base todavía no tiene `acc_arca_ticket_drop`: queda como
 * estaba) o `failed` (no se pudo; queda en el log).
 */
export type ArcaTicketDrop = 'dropped' | 'unavailable' | 'failed'

const TICKET_DROP = 'acc_arca_ticket_drop'

/** Borra el TA guardado de `service` (`acc_arca_ticket_drop`). Nunca tira. */
export async function dropStoredTicket(
  deps: Pick<TicketDeps, 'rpc' | 'tenantId' | 'environment'>,
  service: ArcaWsn,
): Promise<ArcaTicketDrop> {
  try {
    await callArcaRpc(deps.rpc, TICKET_DROP, {
      p_tenant_id: deps.tenantId,
      p_environment: deps.environment,
      p_service: service,
    })
    // `false` (no había TA) también deja la base sin TA: lo mismo para quien llama.
    return 'dropped'
  } catch (e) {
    if (isArcaStoreError(e) && e.key === 'function_unavailable') return 'unavailable'
    logTicket('drop', e)
    return 'failed'
  }
}

// ─── El ticket del WSAA ──────────────────────────────────────────────────────

/** Cuánto dura el lease del login (la base lo acota a 15–120 s). */
export const TICKET_LEASE_SECONDS = 60
/** Intentos de `acc_arca_ticket_get` antes de rendirse con `arca_busy`. */
export const TICKET_MAX_ATTEMPTS = 7
/** Espera entre intentos si otra instancia tiene el lease. */
export const TICKET_BUSY_WAIT_MS = 1_500
/** El TA se reusa hasta 10 minutos antes de que venza (lo mismo que decide la base). */
export const TICKET_REUSE_MARGIN_MS = 10 * 60_000

export type ArcaTicketSource = 'cache' | 'login'

/** El TA listo para usar. **Secreto**: nunca se loguea ni sale del servidor. */
export type ArcaAuthTicket = {
  readonly token: string
  readonly sign: string
  readonly expiresAt: Date
  /** `cache`: lo tenía la base · `login`: se pidió al WSAA ahora. */
  readonly source: ArcaTicketSource
}

/**
 * El WSAA no deja pedir otro ticket todavía (cooldown de la política del WSAA). La
 * clave es la del error que lo causó (`arca_already_authenticated`,
 * `arca_not_authorized`…), así el texto explica qué arreglar.
 */
export class ArcaCooldownError extends ArcaError {
  /** Hasta cuándo (`null` si es manual: hasta que la persona vuelva a probar). */
  readonly until: Date | null
  readonly manual: boolean

  constructor(key: ArcaErrorKey, until: Date | null, manual: boolean) {
    super(key)
    this.until = until
    this.manual = manual
  }
}

export function isArcaCooldownError(e: unknown): e is ArcaCooldownError {
  return e instanceof ArcaCooldownError
}

export type WsaaLoginFn = typeof wsaaLogin

/** Lo que necesita el manejo del ticket (la RPC, la clave y el transporte se inyectan). */
export type TicketDeps = {
  readonly rpc: ArcaRpc
  readonly tenantId: string
  readonly environment: ArcaEnvironment
  /** La clave del servidor (`secretsKey()`): viaja como argumento de la RPC. */
  readonly secretKey: string
  readonly transport: ArcaTransport
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  /** Tope del login al WSAA (por defecto, el de `wsaaLogin`: 25 s). */
  readonly loginTimeoutMs?: number
  /** Plazo duro de la acción: un login se empieza solo con 20 s o más por delante. */
  readonly deadline?: ArcaDeadline
  /** Para los tests: el login de verdad es `wsaaLogin`. */
  readonly login?: WsaaLoginFn
}

const TICKET_GET = 'acc_arca_ticket_get'
const TICKET_PUT = 'acc_arca_ticket_put'

/**
 * Un ticket del WSAA para `service`: el de la base si sirve, o uno nuevo bajo el
 * lease. Tira `ArcaCooldownError`, `ArcaError('arca_busy')`, `ArcaStoreError` (la
 * base), lo que tiró el login (`ArcaFault`, `ArcaCryptoError`) o, con plazo,
 * `deadlineFault` si no había tiempo para esperar o para empezar el login.
 */
export async function acquireTicket(
  deps: TicketDeps,
  service: ArcaWsn,
  opts: { readonly clearManualCooldown?: boolean } = {},
): Promise<ArcaAuthTicket> {
  for (let attempt = 0; attempt < TICKET_MAX_ATTEMPTS; attempt++) {
    const data = asRec(
      await callArcaRpc(deps.rpc, TICKET_GET, {
        p_tenant_id: deps.tenantId,
        p_environment: deps.environment,
        p_service: service,
        p_secret_key: deps.secretKey,
        p_lease_seconds: TICKET_LEASE_SECONDS,
        // Solo en la primera vuelta: la base ya lo borró (y lo confirmó) aunque conteste `busy`.
        p_clear_manual_cooldown: attempt === 0 && opts.clearManualCooldown === true,
      }),
    )
    const status = textOf(data?.status)
    if (data && status === 'valid') return validTicket(deps, data)
    if (status === 'cooldown') throw cooldownError(data)
    if (status === 'busy') {
      if (attempt < TICKET_MAX_ATTEMPTS - 1) {
        const wait = busyWait(data)
        // Esperar a la otra instancia solo si después queda tiempo para usar su ticket.
        if (!canWait(deps.deadline, wait)) throw deadlineFault({ service: 'wsaa', wsn: service })
        await deps.sleep(wait)
      }
      continue
    }
    if (status === 'lease' && isUuidText(data?.lease_id)) {
      return loginUnderLease(deps, service, data.lease_id)
    }
    // Una respuesta que no tiene la forma del contrato: no se adivina.
    throw new ArcaStoreError(TICKET_GET, null)
  }
  throw new ArcaError('arca_busy')
}

function validTicket(deps: TicketDeps, data: Rec): ArcaAuthTicket {
  const token = textOf(data.token)
  const sign = textOf(data.sign)
  if (!token || !sign) throw new ArcaStoreError(TICKET_GET, null)
  // La base solo dice `valid` si vence en más de 10 minutos.
  const expiresAt =
    dateOf(data.expires_at) ?? new Date(deps.now().getTime() + TICKET_REUSE_MARGIN_MS + 60_000)
  return { token, sign, expiresAt, source: 'cache' }
}

function cooldownError(data: Rec | null): ArcaCooldownError {
  const raw = data?.last_error_key
  const until = dateOf(data?.until)
  return new ArcaCooldownError(
    isArcaErrorKey(raw) ? raw : 'arca_unavailable',
    until,
    data?.manual === true || until === null,
  )
}

function busyWait(data: Rec | null): number {
  const ms = intOf(data?.retry_after_ms) ?? TICKET_BUSY_WAIT_MS
  return Math.min(5_000, Math.max(250, ms))
}

/** ¿El error vino del WSAA (o del camino hacia él)? Solo eso tiene cooldown. */
function reachedWsaa(e: unknown): boolean {
  // `url_not_allowed` y `deadline` los tira nuestro transporte antes de mandar nada.
  return (
    isArcaFault(e) &&
    !(e.kind === 'network' && (e.code === 'url_not_allowed' || e.code === DEADLINE_FAULT_CODE))
  )
}

/** La clave de una falla anterior al WSAA (para `last_error_key`, sin cooldown). */
function localFailureKey(e: unknown): string {
  return isArcaStoreError(e) && e.key ? e.key : 'arca_internal'
}

/**
 * Sin tiempo para un login entero: se devuelve el turno sin cooldown (nada llegó a
 * ARCA) y la acción lo cuenta como «no se llegó a probar».
 */
async function refuseLogin(deps: TicketDeps, service: ArcaWsn, leaseId: string): Promise<never> {
  await releaseLease(deps, service, leaseId, 'arca_unavailable', null)
  throw deadlineFault({ service: 'wsaa', wsn: service, method: 'loginCms' })
}

async function loginUnderLease(
  deps: TicketDeps,
  service: ArcaWsn,
  leaseId: string,
): Promise<ArcaAuthTicket> {
  // Antes de abrir la clave privada (no tiene sentido descifrarla si no hay tiempo).
  if (!canStartLogin(deps.deadline)) return refuseLogin(deps, service, leaseId)
  let credentials: ArcaCredentials
  try {
    credentials = await loadCredentials(deps.rpc, deps.tenantId, deps.environment, deps.secretKey)
  } catch (e) {
    await releaseLease(deps, service, leaseId, localFailureKey(e), null)
    throw e
  }
  // Y justo antes de mandar el login: con menos de 20 s, un corte de la función a la mitad
  // podría perder un TA que ARCA sí dio.
  if (!canStartLogin(deps.deadline)) return refuseLogin(deps, service, leaseId)

  const login = deps.login ?? wsaaLogin
  let ticket: ArcaTicket
  try {
    ticket = await login(
      deps.transport,
      deps.environment,
      service,
      credentials.certificatePem,
      credentials.privateKeyPem,
      deps.now(),
      {
        // Con plazo: min(el tope del login, lo que queda − 3 s). Con 20 s o más por delante
        // nunca queda en `null`; el `??` es solo para el tipo.
        timeoutMs: deps.deadline
          ? (deadlineTimeout(deps.deadline, deps.loginTimeoutMs ?? SOAP_TIMEOUT_MS) ?? MIN_CALL_MS)
          : deps.loginTimeoutMs,
      },
    )
  } catch (e) {
    const key = classifyArcaError(e)
    const cooldown = reachedWsaa(e) ? wsaaCooldown(key, deps.environment) : null
    await releaseLease(deps, service, leaseId, key, cooldown)
    throw e
  }

  await storeTicket(deps, service, leaseId, ticket)
  return {
    token: ticket.token,
    sign: ticket.sign,
    expiresAt: ticket.expirationTime,
    source: 'login',
  }
}

/** Libera el lease con el error (y su cooldown). Si no se puede, el lease vence solo. */
async function releaseLease(
  deps: TicketDeps,
  service: ArcaWsn,
  leaseId: string,
  key: string,
  cooldown: number | 'manual' | null,
): Promise<void> {
  try {
    await callArcaRpc(deps.rpc, TICKET_PUT, {
      p_tenant_id: deps.tenantId,
      p_environment: deps.environment,
      p_service: service,
      p_lease_id: leaseId,
      p_result: { ok: false, key, cooldown },
      p_secret_key: deps.secretKey,
    })
  } catch (e) {
    logTicket('release', e)
  }
}

/**
 * Guarda el TA nuevo (cifrado en la base) y libera el lease. `p_result` va en
 * snake_case con instantes ISO: el `ArcaTicket` de `wsaaLogin` está en camelCase y
 * la base lo rechazaría (`invalid_payload`). Si no se puede guardar, el TA igual
 * sirve para este pedido: se loguea y se sigue (`arca_lease_lost` = otra instancia
 * tomó el turno porque este login tardó más que el lease).
 */
async function storeTicket(
  deps: TicketDeps,
  service: ArcaWsn,
  leaseId: string,
  ticket: ArcaTicket,
): Promise<void> {
  const args = {
    p_tenant_id: deps.tenantId,
    p_environment: deps.environment,
    p_service: service,
    p_lease_id: leaseId,
    p_result: {
      ok: true,
      token: ticket.token,
      sign: ticket.sign,
      generation_time: ticket.generationTime.toISOString(),
      expiration_time: ticket.expirationTime.toISOString(),
    },
    p_secret_key: deps.secretKey,
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await callArcaRpc(deps.rpc, TICKET_PUT, args)
      return
    } catch (e) {
      const transient =
        isArcaStoreError(e) && (e.key === 'offline' || e.key === 'retry' || e.key === 'timeout')
      if (transient && attempt === 0) continue
      logTicket('store', e)
      return
    }
  }
}

/** Solo la operación y la clave: nunca el mensaje crudo ni los argumentos. */
function logTicket(op: string, e: unknown): void {
  const key = isArcaStoreError(e)
    ? (e.key ?? e.pgCode ?? 'error')
    : e instanceof Error
      ? e.name
      : 'unknown'
  console.error('[arca.ticket]', op, key)
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

// ─── La sesión ───────────────────────────────────────────────────────────────

export type ArcaSessionOptions = {
  readonly rpc: ArcaRpc
  readonly tenantId: string
  readonly environment: ArcaEnvironment
  /** La SAS: `Auth.Cuit` de WSFE y `cuitRepresentada` del padrón. */
  readonly representedCuit: string
  readonly secretKey: string
  readonly transport: ArcaTransport
  readonly now?: () => Date
  readonly sleep?: (ms: number) => Promise<void>
  /** «Probar conexión»: borra el cooldown manual en el primer pedido de cada servicio. */
  readonly clearManualCooldown?: boolean
  /** Tope de cada llamada a WSFE y al padrón. */
  readonly timeoutMs?: number
  /** Tope del login al WSAA. */
  readonly loginTimeoutMs?: number
  /** Plazo duro de la acción (recorta cada llamada y no deja empezar un login sin tiempo). */
  readonly deadline?: ArcaDeadline
  readonly login?: WsaaLoginFn
}

export type ArcaAuth = { readonly token: string; readonly sign: string; readonly cuit: string }

export type ArcaSession = {
  readonly environment: ArcaEnvironment
  readonly representedCuit: string
  /** El TA del servicio (cacheado por la sesión mientras sirva). */
  ticket(service: ArcaWsn): Promise<ArcaAuthTicket>
  /** Lo que piden los clientes: el TA y la CUIT representada. */
  auth(service: ArcaWsn): Promise<ArcaAuth>
  /**
   * ARCA rechazó el TA de `service` (`isTicketRejection`, o `ticketRejectedBy` con los
   * `Errors` de un `FECAESolicitar` rechazado): lo borra de la base para que la próxima
   * acción pida otro. Si quedó borrado, en esta sesión ese servicio ya no se usa ni pide
   * otro (`ArcaCooldownError('arca_token_rejected')`): un login enseguida chocaría con
   * «ya posee un TA válido». Una vez por servicio; nunca tira.
   */
  dropTicket(service: ArcaWsn): Promise<ArcaTicketDrop>
  readonly wsfe: WsfeClient
  readonly padron: PadronClient
}

/**
 * La sesión con dependencias inyectadas (los tests pasan una RPC y un transporte
 * falsos). Dentro de una sesión, dos pedidos del mismo servicio a la vez comparten
 * el mismo `acc_arca_ticket_get` y el TA se reusa mientras sirva. Con `deadline`,
 * todo lo que va a ARCA (el login y los clientes) pasa por `withDeadline`.
 */
export function createArcaSession(options: ArcaSessionOptions): ArcaSession {
  const now = options.now ?? (() => new Date())
  const transport = options.deadline
    ? withDeadline(options.transport, options.deadline)
    : options.transport
  const deps: TicketDeps = {
    rpc: options.rpc,
    tenantId: options.tenantId,
    environment: options.environment,
    secretKey: options.secretKey,
    transport,
    now,
    sleep: options.sleep ?? defaultSleep,
    loginTimeoutMs: options.loginTimeoutMs,
    deadline: options.deadline,
    login: options.login,
  }
  const held = new Map<ArcaWsn, ArcaAuthTicket>()
  const inflight = new Map<ArcaWsn, Promise<ArcaAuthTicket>>()
  const cleared = new Set<ArcaWsn>()
  const drops = new Map<ArcaWsn, Promise<ArcaTicketDrop>>()
  /** Servicios cuyo TA ARCA rechazó y quedó borrado: en esta sesión no se pide otro. */
  const rejected = new Set<ArcaWsn>()

  const ticket = (service: ArcaWsn): Promise<ArcaAuthTicket> => {
    if (rejected.has(service)) {
      return Promise.reject(new ArcaCooldownError('arca_token_rejected', null, false))
    }
    const have = held.get(service)
    if (have && have.expiresAt.getTime() - TICKET_REUSE_MARGIN_MS > now().getTime()) {
      return Promise.resolve(have)
    }
    const running = inflight.get(service)
    if (running) return running
    const clearManualCooldown = options.clearManualCooldown === true && !cleared.has(service)
    cleared.add(service)
    const promise = acquireTicket(deps, service, { clearManualCooldown })
      .then((t) => {
        held.set(service, t)
        return t
      })
      .finally(() => {
        inflight.delete(service)
      })
    inflight.set(service, promise)
    return promise
  }

  const auth = async (service: ArcaWsn): Promise<ArcaAuth> => {
    const t = await ticket(service)
    return { token: t.token, sign: t.sign, cuit: options.representedCuit }
  }

  const dropTicket = (service: ArcaWsn): Promise<ArcaTicketDrop> => {
    const running = drops.get(service)
    if (running) return running
    const promise = dropStoredTicket(deps, service).then((outcome) => {
      if (outcome === 'dropped') {
        rejected.add(service)
        held.delete(service)
      }
      return outcome
    })
    drops.set(service, promise)
    return promise
  }

  return {
    environment: options.environment,
    representedCuit: options.representedCuit,
    ticket,
    auth,
    dropTicket,
    wsfe: createWsfe(transport, options.environment, () => auth(ARCA_SERVICE.wsfe), {
      timeoutMs: options.timeoutMs,
    }),
    padron: createPadron(transport, options.environment, () => auth(ARCA_SERVICE.padron), {
      timeoutMs: options.timeoutMs,
    }),
  }
}

export type OpenArcaSessionInput = {
  readonly tenantId: string
  readonly environment: ArcaEnvironment
  /** `acc_arca_connections.represented_cuit` (la SAS). */
  readonly representedCuit: string
  readonly clearManualCooldown?: boolean
  readonly timeoutMs?: number
  readonly loginTimeoutMs?: number
  /** Plazo duro de la acción (`arcaDeadline`). */
  readonly deadline?: ArcaDeadline
}

/**
 * La sesión de todos los días: el cliente de Supabase **de la persona** (nunca
 * `service_role`: las RPC exigen escritor), la clave del servidor y el transporte
 * real (`getTransport`). Tira `ArcaSecretsKeyError` si falta la clave.
 */
export async function openArcaSession(input: OpenArcaSessionInput): Promise<ArcaSession> {
  const secretKey = secretsKey()
  const supabase = await createClient()
  return createArcaSession({
    ...input,
    rpc: rpcOf(supabase),
    secretKey,
    transport: getTransport(),
  })
}
