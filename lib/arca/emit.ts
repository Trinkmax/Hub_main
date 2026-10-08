import 'server-only'

import { sha256Hex } from '@/lib/accounting/preview'
import type { IsoDate } from '@/lib/accounting/types'
import type { ArcaStoredForm } from './emit-form'
import type { ArcaEnvironment } from './endpoints'
import { type ArcaErrorKey, classifyArcaError, classifyArcaMessages } from './errors'
import { readCaeRecord } from './print'
import { ArcaFault, type ArcaMsg, ArcaRequestError, type ArcaTransport, isArcaFault } from './soap'
import {
  type ArcaRpc,
  ArcaStoreError,
  asRec,
  callArcaRpc,
  intOf,
  isArcaStoreError,
  isUuidText,
  textOf,
} from './store'
import type { CbteTipo } from './vouchers'
import {
  type CaeRequest,
  type CaeResult,
  caeRequestRecord,
  compConsultaMismatches,
  createWsfe,
  type WsfeAuth,
  type WsfeClient,
} from './wsfe'

/**
 * La emisión con CAE, «CAE primero, asiento después» (diseño §3.2.4 y §3.2.5, D5).
 *
 * El comprobante vive en `acc_arca_vouchers` y pasa por estados que se pueden
 * retomar siempre:
 *
 * ```
 * reserved ──▶ requesting ──▶ authorized ──▶ posted
 *    │              │  │            (asiento con el client_ref del comprobante)
 *    ▼              │  └──▶ rejected (ARCA lo rechazó: sin CAE, el número queda libre)
 * abandoned         ▼
 *            needs_reconcile ──▶ authorized | failed
 * ```
 *
 * Reglas que nunca se rompen:
 * 1. **`FECAESolicitar` una sola vez.** Ante un corte, un timeout o algo que no
 *    se entiende, primero se pregunta con `FECompConsultar` (manual WSFEv1,
 *    «Operatoria con errores de comunicación»). Nunca se reenvía a ciegas.
 * 2. **Un «no existe» recién cuenta pasado un rato** (`RECONCILE_SAFE_AFTER_MS`):
 *    ARCA puede estar terminando de procesar un pedido que nos llegó cortado. Antes
 *    de eso queda «en verificación» y la persona ve «No la vuelvas a emitir».
 *    Si el corte fue antes de mandar nada (conexión rechazada, DNS, TLS), sí se
 *    da por no emitida enseguida.
 * 3. **Tiempo.** Toda la corrida tiene un tope (`deadline`, ~50 s: la función de
 *    Vercel corta a los 60). No se manda el pedido de CAE con menos de
 *    `CAE_MIN_START_MS` por delante: se suelta la reserva (`abandoned`) y no pasó
 *    nada. Cada llamada a ARCA lleva el tope que le queda.
 * 4. **Exclusión entre instancias** sin locks durante el HTTP: el índice único
 *    parcial de vouchers vivos por (bar, ambiente, punto de venta, tipo) hace que
 *    la segunda reserva falle con `arca_voucher_in_flight` (evita el 10016 y el
 *    502 «Transacción activa» de ARCA).
 * 5. **El ticket se pide antes de reservar**: un login lento no tiene tomada la
 *    reserva.
 *
 * Este módulo no contabiliza: devuelve `authorized` con el `client_ref` y quien
 * llama (`emit-actions.ts`) arma el asiento con `postBuiltBundle` y lo vincula con
 * `linkVoucherDocument`. Homologación nunca contabiliza.
 *
 * La base y ARCA entran por `EmitDeps` (los tests pasan dobles). Nunca se loguea
 * el pedido, el ticket, datos del cliente ni el texto de ARCA: solo el paso, la
 * clave y el código.
 */

// ─── Tiempos ─────────────────────────────────────────────────────────────────

/** Tope de toda la emisión desde que arranca la acción (la función corta a los 60 s). */
export const EMIT_BUDGET_MS = 50_000
/** Lo mínimo que tiene que quedar para mandar `FECAESolicitar` (pedido + consulta + asiento). */
export const CAE_MIN_START_MS = 22_000
/** Lo que se guarda después del pedido de CAE para consultar si se cortó y contabilizar. */
export const AFTER_CAE_RESERVE_MS = 12_000
export const CAE_TIMEOUT_MAX_MS = 25_000
export const CONSULT_TIMEOUT_MAX_MS = 8_000
export const CONSULT_TIMEOUT_MIN_MS = 2_000
export const ULTIMO_TIMEOUT_MAX_MS = 10_000
export const ULTIMO_TIMEOUT_MIN_MS = 3_000
/** Un «no existe» de `FECompConsultar` recién cuenta si pasó esto desde el pedido. */
export const RECONCILE_SAFE_AFTER_MS = 90_000
/** Un `requesting` sin moverse hace 2 minutos: la función que lo pidió ya no está. */
export const STALE_REQUESTING_MS = 120_000

const MAX_MESSAGES = 10

// ─── Dependencias ────────────────────────────────────────────────────────────

export type EmitDeps = {
  /** RPC con la sesión de la persona (nunca `service_role`: las RPC exigen escritor). */
  readonly rpc: ArcaRpc
  readonly tenantId: string
  readonly environment: ArcaEnvironment
  readonly transport: ArcaTransport
  /** El ticket de WSFE y la CUIT representada (de la sesión). Tira si no hay ticket. */
  readonly auth: () => Promise<WsfeAuth>
  readonly now: () => number
  /** Instante (ms) en que la corrida tiene que estar terminada. */
  readonly deadline: number
  /** Un comprobante por id (la tabla, con la sesión de la persona; `null` si no está). */
  readonly loadVoucher: (voucherId: string) => Promise<ArcaVoucherRow | null>
}

function remaining(deps: EmitDeps): number {
  return deps.deadline - deps.now()
}

function wsfe(deps: EmitDeps, timeoutMs: number): WsfeClient {
  return createWsfe(deps.transport, deps.environment, deps.auth, { timeoutMs })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ─── La fila de acc_arca_vouchers ────────────────────────────────────────────

export type ArcaVoucherStatusValue =
  | 'reserved'
  | 'requesting'
  | 'needs_reconcile'
  | 'authorized'
  | 'posted'
  | 'rejected'
  | 'failed'
  | 'abandoned'

const STATUSES: readonly ArcaVoucherStatusValue[] = [
  'reserved',
  'requesting',
  'needs_reconcile',
  'authorized',
  'posted',
  'rejected',
  'failed',
  'abandoned',
]

/** `acc_arca_vouchers` como la usa el servidor (sin nada secreto: la tabla no tiene). */
export type ArcaVoucherRow = {
  readonly id: string
  readonly environment: ArcaEnvironment
  readonly status: ArcaVoucherStatusValue
  readonly pointOfSale: number
  readonly cbteTipo: number
  readonly number: number | null
  readonly clientRef: string
  readonly form: unknown
  readonly request: unknown
  readonly cae: string | null
  readonly caeDue: IsoDate | null
  readonly fchProceso: string | null
  readonly observations: readonly ArcaMsg[]
  readonly errors: readonly ArcaMsg[]
  readonly documentId: string | null
  readonly relatedVoucherId: string | null
  readonly totalCents: number
  readonly issueDate: IsoDate | null
  readonly reason: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Las columnas que lee `parseVoucherRow`. */
export const VOUCHER_COLUMNS = [
  'id',
  'environment',
  'status',
  'point_of_sale',
  'cbte_tipo',
  'number',
  'client_ref',
  'form',
  'request',
  'cae',
  'cae_due',
  'fch_proceso',
  'observations',
  'errors',
  'document_id',
  'related_voucher_id',
  'total_cents',
  'issue_date',
  'reason',
  'created_at',
  'updated_at',
].join(', ')

function messages(value: unknown): ArcaMsg[] {
  if (!Array.isArray(value)) return []
  const out: ArcaMsg[] = []
  for (const item of value) {
    const rec = asRec(item)
    const code = intOf(rec?.code)
    if (rec && code !== null) out.push({ code, msg: textOf(rec.msg) ?? '' })
  }
  return out
}

function isoDay(value: unknown): IsoDate | null {
  const text = textOf(value)
  return text && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

/** Una fila (de un `select` o del `to_jsonb` que devuelve la RPC) → el comprobante; `null` si no tiene la forma. */
export function parseVoucherRow(raw: unknown): ArcaVoucherRow | null {
  const row = asRec(raw)
  if (!row || !isUuidText(row.id) || !isUuidText(row.client_ref)) return null
  const environment = row.environment
  const status = row.status
  const pointOfSale = intOf(row.point_of_sale)
  const cbteTipo = intOf(row.cbte_tipo)
  if (
    (environment !== 'produccion' && environment !== 'homologacion') ||
    !(STATUSES as readonly unknown[]).includes(status) ||
    pointOfSale === null ||
    cbteTipo === null
  ) {
    return null
  }
  const documentId = row.document_id
  const relatedId = row.related_voucher_id
  return {
    id: row.id,
    environment,
    status: status as ArcaVoucherStatusValue,
    pointOfSale,
    cbteTipo,
    number: intOf(row.number),
    clientRef: row.client_ref,
    form: row.form ?? null,
    request: row.request ?? null,
    cae: textOf(row.cae),
    caeDue: isoDay(row.cae_due),
    fchProceso: textOf(row.fch_proceso),
    observations: messages(row.observations),
    errors: messages(row.errors),
    documentId: isUuidText(documentId) ? documentId : null,
    relatedVoucherId: isUuidText(relatedId) ? relatedId : null,
    totalCents: intOf(row.total_cents) ?? 0,
    issueDate: isoDay(row.issue_date),
    reason: textOf(row.reason),
    createdAt: textOf(row.created_at) ?? '',
    updatedAt: textOf(row.updated_at) ?? '',
  }
}

// ─── RPC de la saga ──────────────────────────────────────────────────────────

const RESERVE = 'acc_arca_voucher_reserve'
const UPDATE = 'acc_arca_voucher_update'

/** Lo que se guarda al reservar (lista blanca de `acc_arca_voucher_reserve`). */
export type ReservePayload = {
  readonly form: ArcaStoredForm
  readonly total_cents: number
  readonly issue_date: IsoDate
  readonly related_voucher_id: string | null
}

export type ReserveResult =
  | { readonly kind: 'reserved'; readonly voucherId: string; readonly clientRef: string }
  | { readonly kind: 'needs_reconcile'; readonly voucherId: string }

/** `acc_arca_voucher_reserve`: el lease de emisión de (punto de venta, tipo). Tira `ArcaStoreError`. */
export async function reserveVoucher(
  deps: Pick<EmitDeps, 'rpc' | 'tenantId' | 'environment'>,
  o: {
    readonly pointOfSale: number
    readonly cbteTipo: CbteTipo
    readonly payload: ReservePayload
  },
): Promise<ReserveResult> {
  const data = asRec(
    await callArcaRpc(deps.rpc, RESERVE, {
      p_tenant_id: deps.tenantId,
      p_environment: deps.environment,
      p_point_of_sale: o.pointOfSale,
      p_cbte_tipo: o.cbteTipo,
      p_payload: o.payload,
    }),
  )
  if (isUuidText(data?.needs_reconcile)) {
    return { kind: 'needs_reconcile', voucherId: data.needs_reconcile }
  }
  if (isUuidText(data?.voucher_id) && isUuidText(data?.client_ref)) {
    return { kind: 'reserved', voucherId: data.voucher_id, clientRef: data.client_ref }
  }
  throw new ArcaStoreError(RESERVE, null)
}

type TransitionPatch = Readonly<Record<string, unknown>>

/** `acc_arca_voucher_update`: avanza el comprobante. Tira `ArcaStoreError`. */
export async function transitionVoucher(
  deps: Pick<EmitDeps, 'rpc' | 'tenantId'>,
  voucherId: string,
  to: ArcaVoucherStatusValue,
  patch: TransitionPatch = {},
): Promise<ArcaVoucherRow | null> {
  return parseVoucherRow(
    await callArcaRpc(deps.rpc, UPDATE, {
      p_tenant_id: deps.tenantId,
      p_voucher_id: voucherId,
      p_to: to,
      p_patch: patch,
    }),
  )
}

/**
 * Lo mismo, reintentando una vez si fue la red hacia la base. Devuelve `false` si
 * no se pudo (se loguea): la saga sigue, y la próxima verificación lo acomoda.
 */
async function transitionSafe(
  deps: EmitDeps,
  step: string,
  voucherId: string,
  to: ArcaVoucherStatusValue,
  patch: TransitionPatch = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await transitionVoucher(deps, voucherId, to, patch)
      return true
    } catch (e) {
      const transient =
        isArcaStoreError(e) && (e.key === 'offline' || e.key === 'retry' || e.key === 'timeout')
      if (transient && attempt === 0) continue
      logStep(step, e)
      return false
    }
  }
  return false
}

/** Soltar una reserva que no llegó a pedir el CAE (nada salió a ARCA). */
async function abandon(deps: EmitDeps, voucherId: string, reason: string): Promise<void> {
  await transitionSafe(deps, 'abandon', voucherId, 'abandoned', { reason })
}

/** Vincular el comprobante autorizado con su asiento (`posted`). */
export async function linkVoucherDocument(
  deps: Pick<EmitDeps, 'rpc' | 'tenantId'>,
  voucherId: string,
  documentId: string,
): Promise<ArcaVoucherRow | null> {
  return transitionVoucher(deps, voucherId, 'posted', { document_id: documentId })
}

function messagesJson(list: readonly ArcaMsg[]): Array<{ code: number; msg: string }> {
  return list.slice(0, MAX_MESSAGES).map((m) => ({ code: m.code, msg: m.msg.slice(0, 500) }))
}

/** `sha256` del pedido como se guarda (mismo JSON, mismo orden de claves). */
export function requestSha256(record: unknown): string {
  return sha256Hex(JSON.stringify(record))
}

function logStep(step: string, e: unknown): void {
  const key = isArcaStoreError(e)
    ? (e.key ?? e.pgCode ?? 'store')
    : isArcaFault(e)
      ? `${e.kind}:${e.code}`
      : e instanceof Error
        ? e.name
        : 'unknown'
  console.error('[arca.emit]', step, key)
}

// ─── Fallas antes de pedir el CAE ────────────────────────────────────────────

/**
 * Lo que impidió llegar al pedido de CAE (nada se emitió): un error de ARCA (sin
 * ticket, el número no se pudo consultar…), de la base (`ArcaStoreError`) o se
 * acabó el tiempo.
 */
export type NotStartedCause =
  | { readonly kind: 'arca'; readonly error: unknown }
  | { readonly kind: 'store'; readonly error: ArcaStoreError }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'request'; readonly error: ArcaRequestError }
  | { readonly kind: 'stuck'; readonly voucherId: string }

/** `ArcaFault('network', 'deadline')`: la sesión no empezó una llamada por el plazo (`withDeadline`). */
function isOutOfTime(e: unknown): boolean {
  return isArcaFault(e) && e.kind === 'network' && e.code === 'deadline'
}

function causeOf(e: unknown): NotStartedCause {
  if (isOutOfTime(e)) return { kind: 'timeout' }
  if (isArcaStoreError(e)) return { kind: 'store', error: e }
  if (e instanceof ArcaRequestError) return { kind: 'request', error: e }
  return { kind: 'arca', error: e }
}

// ─── La corrida ──────────────────────────────────────────────────────────────

export type EmissionPlan = {
  readonly pointOfSale: number
  readonly cbteTipo: CbteTipo
  /** El número que vio la persona; `null` = el que dé ARCA (prueba de homologación). */
  readonly predictedNumber: number | null
  /** El pedido para ese número. Puede tirar `ArcaRequestError` (nada sale a ARCA). */
  readonly request: (number: number) => CaeRequest
  readonly payload: ReservePayload
}

export type EmissionOutcome =
  | { readonly kind: 'not_started'; readonly cause: NotStartedCause }
  | { readonly kind: 'number_changed'; readonly nextNumber: number }
  | {
      readonly kind: 'rejected'
      readonly voucherId: string
      readonly number: number
      readonly errorKey: ArcaErrorKey
      /** Errores y observaciones de ARCA (el código del primero sirve para soporte). */
      readonly messages: readonly ArcaMsg[]
    }
  /** No se sabe si ARCA la autorizó: queda «en verificación». No se reemite. */
  | { readonly kind: 'unknown'; readonly voucherId: string; readonly number: number }
  /** Confirmado: no se emitió (el número quedó libre). */
  | { readonly kind: 'not_emitted'; readonly voucherId: string; readonly number: number }
  | {
      readonly kind: 'authorized'
      readonly voucherId: string
      readonly clientRef: string
      readonly number: number
      readonly cae: string
      readonly caeDue: IsoDate
      readonly observations: readonly ArcaMsg[]
      /** Salió de una verificación (`FECompConsultar`), no de la respuesta directa. */
      readonly reconciled: boolean
      /** El estado `authorized` quedó guardado (si no, lo acomoda la próxima verificación). */
      readonly persisted: boolean
    }

/**
 * La saga de §3.2.4, pasos 5 a 9: ticket → reserva (con una verificación si había
 * una colgada) → último número → pedido de CAE una sola vez → estado final.
 */
export async function runEmission(deps: EmitDeps, plan: EmissionPlan): Promise<EmissionOutcome> {
  // 1. El ticket, antes de reservar.
  try {
    await deps.auth()
  } catch (e) {
    return { kind: 'not_started', cause: causeOf(e) }
  }
  if (remaining(deps) < CAE_MIN_START_MS + ULTIMO_TIMEOUT_MIN_MS) {
    return { kind: 'not_started', cause: { kind: 'timeout' } }
  }

  // 2. La reserva (una sola emisión viva por punto de venta y tipo).
  let reserved: ReserveResult
  try {
    reserved = await reserveVoucher(deps, plan)
    if (reserved.kind === 'needs_reconcile') {
      // Quedó una colgada hace más de 3 minutos: se verifica con ARCA y se reintenta una vez.
      await reconcileById(deps, reserved.voucherId)
      reserved = await reserveVoucher(deps, plan)
      if (reserved.kind === 'needs_reconcile') {
        return { kind: 'not_started', cause: { kind: 'stuck', voucherId: reserved.voucherId } }
      }
    }
  } catch (e) {
    return { kind: 'not_started', cause: causeOf(e) }
  }
  const { voucherId, clientRef } = reserved

  // 3. El número que sigue.
  let next: number
  try {
    if (remaining(deps) < CAE_MIN_START_MS + ULTIMO_TIMEOUT_MIN_MS) throw new TimeUp()
    const timeout = clamp(
      remaining(deps) - CAE_MIN_START_MS,
      ULTIMO_TIMEOUT_MIN_MS,
      ULTIMO_TIMEOUT_MAX_MS,
    )
    next = (await wsfe(deps, timeout).ultimoAutorizado(plan.pointOfSale, plan.cbteTipo)) + 1
  } catch (e) {
    await abandon(deps, voucherId, e instanceof TimeUp ? 'no_time' : 'last_number_failed')
    return { kind: 'not_started', cause: e instanceof TimeUp ? { kind: 'timeout' } : causeOf(e) }
  }
  if (plan.predictedNumber !== null && next !== plan.predictedNumber) {
    await abandon(deps, voucherId, 'number_changed')
    return { kind: 'number_changed', nextNumber: next }
  }

  // 4. El pedido (si ARCA lo rechazaría por cómo está armado, no sale).
  let req: CaeRequest
  let record: unknown
  try {
    req = plan.request(next)
    record = caeRequestRecord(req)
  } catch (e) {
    await abandon(deps, voucherId, 'request_invalid')
    return { kind: 'not_started', cause: causeOf(e) }
  }
  if (remaining(deps) < CAE_MIN_START_MS) {
    await abandon(deps, voucherId, 'no_time')
    return { kind: 'not_started', cause: { kind: 'timeout' } }
  }

  // 5. `requesting`: desde acá, si algo se corta, se verifica con ARCA antes de nada.
  try {
    await transitionVoucher(deps, voucherId, 'requesting', {
      number: next,
      request: record,
      request_sha256: requestSha256(record),
      issue_date: req.cbteFch,
    })
  } catch (e) {
    // No se mandó nada a ARCA: se suelta la reserva.
    await abandon(deps, voucherId, 'store_failed')
    return { kind: 'not_started', cause: causeOf(e) }
  }

  // 6. FECAESolicitar, una sola vez.
  const sentAt = deps.now()
  let result: CaeResult
  try {
    const timeout = Math.min(CAE_TIMEOUT_MAX_MS, remaining(deps) - AFTER_CAE_RESERVE_MS)
    result = await wsfe(deps, Math.max(timeout, 5_000)).caeSolicitar(req)
  } catch (e) {
    logStep('cae_lost', e)
    return settleLost(deps, { voucherId, clientRef, req, sentAt, error: e })
  }

  // 7. Lo que contestó ARCA.
  if (result.resultado === 'A' && result.cae && result.caeDue) {
    const patch: Record<string, unknown> = {
      cae: result.cae,
      cae_due: result.caeDue,
      observations: messagesJson(result.obs),
      events: messagesJson(result.events),
    }
    if (result.processedAt) patch.fch_proceso = result.processedAt
    const persisted = await transitionSafe(deps, 'authorized', voucherId, 'authorized', patch)
    return {
      kind: 'authorized',
      voucherId,
      clientRef,
      number: next,
      cae: result.cae,
      caeDue: result.caeDue,
      observations: result.obs,
      reconciled: false,
      persisted,
    }
  }
  const all = [...result.errors, ...result.obs]
  const patch: Record<string, unknown> = {
    errors: messagesJson(result.errors),
    observations: messagesJson(result.obs),
    events: messagesJson(result.events),
    reason: `result_${result.resultado}`,
  }
  if (result.processedAt) patch.fch_proceso = result.processedAt
  await transitionSafe(deps, 'rejected', voucherId, 'rejected', patch)
  return {
    kind: 'rejected',
    voucherId,
    number: next,
    errorKey: classifyArcaMessages(all),
    messages: all,
  }
}

class TimeUp extends Error {
  constructor() {
    super('ARCA emit: no time left')
    this.name = 'TimeUp'
  }
}

/**
 * Cortes que pasan antes de mandar el pedido (no hubo conexión): ARCA no recibió
 * nada y se puede dar por no emitida enseguida. Un corte en el medio
 * (`ECONNRESET`, timeout) no entra acá: ARCA pudo haberla procesado.
 */
const PRE_SEND_CODE =
  /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|url_not_allowed|deadline|ERR_SSL_[A-Z0-9_]+|ERR_TLS_[A-Z0-9_]+|CERT_[A-Z0-9_]+|UNABLE_TO_[A-Z0-9_]+|SELF_SIGNED_[A-Z0-9_]+|DEPTH_ZERO_[A-Z0-9_]+)$/

export function failedBeforeSending(e: unknown): boolean {
  if (e instanceof ArcaRequestError) return true
  return isArcaFault(e) && e.kind === 'network' && PRE_SEND_CODE.test(e.code)
}

async function settleLost(
  deps: EmitDeps,
  o: {
    readonly voucherId: string
    readonly clientRef: string
    readonly req: CaeRequest
    readonly sentAt: number
    readonly error: unknown
  },
): Promise<EmissionOutcome> {
  const preSend = failedBeforeSending(o.error)
  const reason = preSend
    ? 'not_sent'
    : isArcaFault(o.error)
      ? `lost_${o.error.kind}`.slice(0, 60)
      : 'lost_unknown'
  const marked = await transitionSafe(deps, 'needs_reconcile', o.voucherId, 'needs_reconcile', {
    reason,
  })
  if (!marked) return { kind: 'unknown', voucherId: o.voucherId, number: o.req.number }
  if (preSend) {
    const failed = await transitionSafe(deps, 'failed', o.voucherId, 'failed', {
      reason: 'not_sent',
    })
    return failed
      ? { kind: 'not_emitted', voucherId: o.voucherId, number: o.req.number }
      : { kind: 'unknown', voucherId: o.voucherId, number: o.req.number }
  }
  const settled = await consultAndSettle(deps, {
    voucherId: o.voucherId,
    req: o.req,
    elapsedMs: deps.now() - o.sentAt,
  })
  if (settled.kind === 'authorized') {
    return {
      kind: 'authorized',
      voucherId: o.voucherId,
      clientRef: o.clientRef,
      number: o.req.number,
      cae: settled.cae,
      caeDue: settled.caeDue,
      observations: settled.observations,
      reconciled: true,
      persisted: settled.persisted,
    }
  }
  if (settled.kind === 'not_emitted') {
    return { kind: 'not_emitted', voucherId: o.voucherId, number: o.req.number }
  }
  return { kind: 'unknown', voucherId: o.voucherId, number: o.req.number }
}

// ─── Verificar con ARCA ──────────────────────────────────────────────────────

export type SettleOutcome =
  | {
      readonly kind: 'authorized'
      readonly cae: string
      readonly caeDue: IsoDate
      readonly observations: readonly ArcaMsg[]
      readonly persisted: boolean
    }
  | { readonly kind: 'not_emitted' }
  /** ARCA todavía no la tiene y es muy pronto para darla por no emitida. */
  | { readonly kind: 'too_soon' }
  /** ARCA no contestó la consulta. */
  | { readonly kind: 'unreachable'; readonly error: unknown }
  /** Hay un comprobante con ese número que no es el nuestro: no se adivina. */
  | { readonly kind: 'mismatch'; readonly fields: readonly string[] }
  | { readonly kind: 'store_failed' }

/**
 * `FECompConsultar` del número pedido y el estado que corresponde: autorizada
 * (con el CAE de ARCA, si coincide con lo que se pidió) o, si ARCA no la tiene y
 * ya pasó `RECONCILE_SAFE_AFTER_MS` desde el pedido, no emitida.
 */
export async function consultAndSettle(
  deps: EmitDeps,
  o: { readonly voucherId: string; readonly req: CaeRequest; readonly elapsedMs: number },
): Promise<SettleOutcome> {
  const timeout = Math.min(CONSULT_TIMEOUT_MAX_MS, remaining(deps) - 2_000)
  if (timeout < CONSULT_TIMEOUT_MIN_MS) {
    return { kind: 'unreachable', error: new ArcaFault('timeout', 'no_time_left') }
  }
  let found: Awaited<ReturnType<WsfeClient['compConsultar']>>
  try {
    found = await wsfe(deps, timeout).compConsultar(o.req.cbteTipo, o.req.ptoVta, o.req.number)
  } catch (e) {
    logStep('consult', e)
    return { kind: 'unreachable', error: e }
  }
  if (found) {
    const mismatches = compConsultaMismatches(found, o.req)
    const authorized =
      (found.resultado ?? 'A').toUpperCase() === 'A' &&
      found.cae !== null &&
      /^\d{14}$/.test(found.cae) &&
      found.caeDue !== null
    if (authorized && mismatches.length === 0 && found.cae && found.caeDue) {
      const patch: Record<string, unknown> = {
        cae: found.cae,
        cae_due: found.caeDue,
        observations: messagesJson(found.obs),
      }
      if (found.processedAt) patch.fch_proceso = found.processedAt
      const persisted = await transitionSafe(deps, 'reconciled', o.voucherId, 'authorized', patch)
      return {
        kind: 'authorized',
        cae: found.cae,
        caeDue: found.caeDue,
        observations: found.obs,
        persisted,
      }
    }
    // Solo los nombres de los campos (nunca los valores: pueden traer la CUIT del cliente).
    console.error('[arca.emit] consult mismatch', mismatches.join(',') || 'not_authorized')
    return { kind: 'mismatch', fields: mismatches }
  }
  if (o.elapsedMs < RECONCILE_SAFE_AFTER_MS) return { kind: 'too_soon' }
  const ok = await transitionSafe(deps, 'not_emitted', o.voucherId, 'failed', {
    reason: 'not_in_arca',
  })
  return ok ? { kind: 'not_emitted' } : { kind: 'store_failed' }
}

export type ReconcileOutcome =
  | SettleOutcome
  /** Se está pidiendo el CAE ahora mismo (hace menos de 2 minutos): no se toca. */
  | { readonly kind: 'in_progress' }
  /** Ya no estaba en verificación: el estado que tiene. */
  | { readonly kind: 'unchanged'; readonly status: ArcaVoucherStatusValue }
  /** El pedido guardado no se pudo leer (no debería pasar). */
  | { readonly kind: 'unreadable' }

/**
 * Verificar con ARCA un comprobante `requesting` (colgado hace más de 2 minutos)
 * o `needs_reconcile`. El tiempo desde el pedido sale de `updated_at`: la última
 * vez que cambió de estado fue al pedirlo o al marcarlo en verificación, así que
 * nunca se lo da por no emitido antes de tiempo.
 */
export async function reconcileVoucher(
  deps: EmitDeps,
  row: ArcaVoucherRow,
): Promise<ReconcileOutcome> {
  if (row.status !== 'requesting' && row.status !== 'needs_reconcile') {
    return { kind: 'unchanged', status: row.status }
  }
  const req = readCaeRecord(row.request)
  if (!req || req.number !== row.number) {
    console.error('[arca.emit] reconcile unreadable request')
    return { kind: 'unreadable' }
  }
  const since = Date.parse(row.updatedAt)
  const elapsed = Number.isFinite(since) ? deps.now() - since : 0
  if (row.status === 'requesting') {
    if (elapsed < STALE_REQUESTING_MS) return { kind: 'in_progress' }
    const marked = await transitionSafe(deps, 'stale_request', row.id, 'needs_reconcile', {
      reason: 'stale_request',
    })
    if (!marked) return { kind: 'store_failed' }
  }
  return consultAndSettle(deps, { voucherId: row.id, req, elapsedMs: elapsed })
}

/** Para la reserva: la colgada que devolvió `acc_arca_voucher_reserve`, leída por id. */
async function reconcileById(deps: EmitDeps, voucherId: string): Promise<void> {
  let row: ArcaVoucherRow | null = null
  try {
    row = await deps.loadVoucher(voucherId)
  } catch (e) {
    logStep('load_stuck', e)
    return
  }
  if (row) await reconcileVoucher(deps, row)
}

// ─── Errores en palabras simples ─────────────────────────────────────────────

/** La clave de ARCA de una falla antes del pedido (para el texto de `lib/arca/errors.ts`). */
export function notStartedKey(cause: NotStartedCause): ArcaErrorKey | null {
  switch (cause.kind) {
    case 'arca':
      return classifyArcaError(cause.error)
    case 'request':
      return 'arca_internal'
    case 'timeout':
      return 'arca_unavailable'
    case 'stuck':
      return 'arca_in_flight'
    case 'store':
      return null
  }
}
