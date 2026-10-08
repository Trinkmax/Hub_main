'use server'

/**
 * Acciones de la emisión con CAE (diseño §2.3, §3.2.2–§3.2.5 y §3.2.8):
 *
 * - `getArcaNextNumber`: el número que va a tener el comprobante (último + 1) y la
 *   fecha del último, para la ventana de fechas.
 * - `emitArcaSalesVoucher`: la saga de `lib/arca/emit.ts` desde «Ventas › Factura
 *   de venta» (solo producción y con la emisión prendida). El asiento es el mismo
 *   de siempre (`buildSalesInvoice`), guardado con el `client_ref` del comprobante
 *   de ARCA.
 * - `reconcileArcaVoucher`: «Verificar con ARCA» (`FECompConsultar`) un
 *   comprobante en verificación.
 * - `previewArcaVoucherPosting` + `postAuthorizedArcaVoucher`: «Cargarla ahora»
 *   (autorizada en ARCA pero sin asiento): el asiento armado en el servidor y
 *   guardado con el mismo `client_ref` (nunca dos veces).
 * - `emitArcaTestVoucher`: solo homologación (Factura B a consumidor final por
 *   $ 121, Factura A a una CUIT o nota de crédito B). Nunca va a los libros.
 * - `ensureArcaFinalConsumer`: el cliente de sistema «Consumidor final» para la
 *   Factura B sin identificar.
 *
 * Todas: `authorizeAccounting(slug, 'write')` → zod → la sesión de la persona
 * (nunca `service_role`) → `AccSimpleState`. Nunca tiran. Los logs llevan la
 * operación, la clave y el código: nunca datos del cliente, el pedido ni el ticket.
 * `ARCA_FAKE_TIMEOUT=1` (fuera de producción) simula que se pierde la respuesta del
 * CAE: lo resuelve `getTransport()`.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { accFailure, fieldFailure, formInput } from '@/lib/accounting/actions/support'
import { ACC_ERRORS, engineErrorsState, mapAccError, warningCopy } from '@/lib/accounting/errors'
import { buildSalesInvoice, finalize } from '@/lib/accounting/posting'
import { loadDocumentContext } from '@/lib/accounting/server/document-context'
import { postBuiltBundle, revalidateAdministracion } from '@/lib/accounting/server/post-document'
import type { IsoDate, PostingContext, PostingResult } from '@/lib/accounting/types'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatVoucherNumber } from '@/lib/fiscal'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import {
  type ArcaVoucherRow,
  CAE_MIN_START_MS,
  EMIT_BUDGET_MS,
  type EmissionOutcome,
  type EmissionPlan,
  type EmitDeps,
  linkVoucherDocument,
  type NotStartedCause,
  notStartedKey,
  reconcileVoucher,
  runEmission,
  ULTIMO_TIMEOUT_MIN_MS,
} from './emit'
import {
  type ArcaEmitInput,
  type ArcaEmitResult,
  type ArcaEmitValues,
  type ArcaNextNumber,
  type ArcaReconcileResult,
  type ArcaStoredForm,
  type ArcaTestKind,
  type ArcaTestVoucherResult,
  type ArcaVoucherPostingPreview,
  arcaDateWindow,
  arcaEmitSchema,
  arcaNextNumberSchema,
  arcaPaymentDue,
  arcaPostVoucherSchema,
  arcaReceiverIssue,
  arcaTestVoucherSchema,
  arcaVoucherRefSchema,
  arcaVoucherStatusLabel,
  letterOfVoucherType,
  readStoredForm,
} from './emit-form'
import {
  findBundleSalesDocument,
  findVoucherByEmissionKey,
  lastPlatformVoucher,
  lastTestInvoiceB,
  loadArcaVoucher,
} from './emit-queries'
import { ARCA_SERVICE, type ArcaEnvironment } from './endpoints'
import {
  ARCA_ERRORS,
  type ArcaErrorContext,
  type ArcaErrorKey,
  describeArcaError,
  describeArcaErrorKey,
  ISSUER_SUBMESSAGES,
  issuerSubcodes,
} from './errors'
import { ARCA_GUIDE_STEPS } from './guide'
import { checkWsfeAmounts, wsfeAmounts } from './importes'
import { type ArcaConnectionRow, loadArcaConnectionRow } from './queries'
import { isArcaSecretsKeyError, secretsKey } from './secrets'
import {
  type ArcaSession,
  arcaDeadline,
  createArcaSession,
  isTicketRejection,
  ticketRejectedBy,
  withDeadline,
} from './session'
import type { ArcaMsg } from './soap'
import { isArcaStoreError, rpcOf } from './store'
import { getTransport } from './transport'
import { arcaVoucherLabel } from './views'
import { CBTE_TIPO, type CbteTipo, isCbteTipo } from './vouchers'
import { type CaeRequest, createWsfe } from './wsfe'

// ─── Piezas comunes ──────────────────────────────────────────────────────────

const SECRETS_MISSING: AccFailureState = {
  ok: false,
  code: 'error',
  message:
    'Falta configurar la clave de la plataforma para hablar con ARCA. Avisanos y lo arreglamos.',
  detail: { key: 'secrets_key_missing', bug: true },
}

const UNEXPECTED: AccFailureState = {
  ok: false,
  code: 'error',
  message: 'No pudimos completar la operación con ARCA. Probá de nuevo; si sigue, avisanos.',
}

const RATE_LIMITED: AccFailureState = {
  ok: false,
  code: 'error',
  message: 'Probaste muchas veces seguidas. Esperá un minuto y volvé a probar.',
  detail: { key: 'rate_limited' },
}

const NO_STORED_FORM: AccFailureState = {
  ok: false,
  code: 'conflict',
  message:
    'No tenemos guardados los datos de esta factura para cargarla sola. Cargala a mano con «Ya la emití en otro sistema» usando el mismo número y avisanos.',
  detail: { key: 'arca_stored_form_missing' },
}

const ZERO_HASH = '0'.repeat(64)

/** Lo que no es de ARCA ni un error de carga → estado de la acción, con un log sin datos de nadie. */
function failureState(op: string, e: unknown): AccFailureState {
  if (isArcaSecretsKeyError(e)) {
    console.error(`[arca.emit.${op}] secrets_key_missing`)
    return SECRETS_MISSING
  }
  if (isArcaStoreError(e)) {
    if (e.state.detail?.bug === true || e.state.code === 'error') {
      console.error(`[arca.emit.${op}]`, e.op, e.key ?? e.pgCode ?? 'error')
    }
    return e.state
  }
  if (e instanceof Error && e.name === 'AccQueryError') {
    const q = e as Error & { code?: unknown }
    return {
      ok: false,
      code: q.code === 'forbidden' ? 'forbidden' : 'error',
      message: e.message,
    }
  }
  console.error(`[arca.emit.${op}] inesperado`, e instanceof Error ? e.name : 'unknown')
  return UNEXPECTED
}

function badSlug(slug: unknown): AccFailureState | null {
  return typeof slug === 'string' && slug !== '' ? null : accFailure('forbidden')
}

function limited(key: string, limit: number): AccFailureState | null {
  try {
    rateLimit({ key, limit, windowMs: 60_000 })
    return null
  } catch (e) {
    if (e instanceof RateLimitedError) return RATE_LIMITED
    throw e
  }
}

/** El número del paso de la guía «Conectar ARCA» (`#paso-N`). */
function stepNumber(step: string | null): number | null {
  if (!step) return null
  return ARCA_GUIDE_STEPS.find((s) => s.id === step)?.n ?? null
}

function errorContext(
  conn: ArcaConnectionRow | null,
  extra: ArcaErrorContext = {},
): ArcaErrorContext {
  return {
    alias: conn?.alias ?? null,
    pointOfSale: conn?.pointOfSale ?? null,
    environment: conn?.environment ?? null,
    ...extra,
  }
}

/**
 * Un problema de ARCA como estado de la acción: el texto del catálogo
 * (`lib/arca/errors.ts`) y, en `detail`, la clave, el paso de la guía que lo
 * arregla (`step_n` → `#paso-N`) y si se puede reintentar.
 */
function arcaState(
  view: {
    key: ArcaErrorKey
    title: string
    body: string
    step: string | null
    retry: string
    code: string | null
    bug?: boolean
  },
  opts: {
    readonly suffix?: string
    readonly fieldErrors?: Record<string, string>
    readonly detail?: Record<string, unknown>
  } = {},
): AccFailureState {
  if (view.bug) console.error('[arca.emit] bug', view.key, view.code ?? '')
  const message = `${view.body}${opts.suffix ?? ''}`
  return {
    ok: false,
    code: view.retry === 'after_fix' ? 'conflict' : 'error',
    message,
    ...(opts.fieldErrors ? { fieldErrors: opts.fieldErrors } : {}),
    detail: {
      key: view.key,
      title: view.title,
      step: view.step,
      step_n: stepNumber(view.step),
      retry: view.retry,
      code: view.code,
      ...(opts.detail ?? {}),
    },
  }
}

const NOTHING_EMITTED = ' No se emitió ninguna factura.'

/** Lo que frenó la emisión antes de pedir el CAE (nada salió a ARCA). */
function notStartedState(cause: NotStartedCause, ctx: ArcaErrorContext): AccFailureState {
  if (cause.kind === 'store') {
    const state = cause.error.state
    if (state.detail?.bug === true) {
      console.error(
        '[arca.emit] store',
        cause.error.op,
        cause.error.key ?? cause.error.pgCode ?? '',
      )
    }
    return state
  }
  if (cause.kind === 'arca' && isArcaSecretsKeyError(cause.error)) return SECRETS_MISSING
  if (cause.kind === 'stuck') {
    return {
      ok: false,
      code: 'conflict',
      message:
        'Hay una factura anterior de este tipo que todavía está en verificación con ARCA. Verificala primero (arriba, en «En verificación») y volvé a emitir.' +
        NOTHING_EMITTED,
      detail: { key: 'arca_in_flight', voucher_id: cause.voucherId, nothing_emitted: true },
    }
  }
  if (cause.kind === 'timeout') {
    return arcaState(describeArcaErrorKey('arca_unavailable', ctx), {
      suffix: NOTHING_EMITTED,
      detail: { nothing_emitted: true, timeout: true },
    })
  }
  const key = notStartedKey(cause) ?? 'arca_internal'
  const view =
    cause.kind === 'arca' ? describeArcaError(cause.error, ctx) : describeArcaErrorKey(key, ctx)
  return arcaState(view, { suffix: NOTHING_EMITTED, detail: { nothing_emitted: true } })
}

/** Qué campo marcar según lo que rechazó ARCA. */
function rejectionFields(key: ArcaErrorKey, body: string): Record<string, string> | undefined {
  if (key === 'arca_receiver_condition') return { 'arca.condicionIvaReceptorId': body }
  if (key === 'arca_receiver_document') return { partyId: body }
  return undefined
}

function firstCode(messages: readonly ArcaMsg[]): string | null {
  return messages[0] ? String(messages[0].code) : null
}

/** Los motivos del error 10000 (la SAS no está habilitada para facturar), en palabras. */
function issuerReasonsOf(messages: readonly ArcaMsg[]): string[] {
  return issuerSubcodes(messages)
    .map((s) => ISSUER_SUBMESSAGES[s])
    .filter((s): s is string => s !== undefined)
}

/** La sesión con ARCA de la persona para un ambiente, con el tope de tiempo de la corrida. */
type EmitSession = { readonly deps: EmitDeps; readonly session: ArcaSession }

/**
 * La sesión con ARCA de la persona para un ambiente, con el plazo de la acción
 * (`arcaDeadline`): el login y la espera del ticket lo respetan (la sesión), y las
 * llamadas de la saga también (`withDeadline` en su transporte).
 */
async function emitSession(
  tenantId: string,
  environment: ArcaEnvironment,
  representedCuit: string,
  deadlineAt: number,
): Promise<EmitSession> {
  const secretKey = secretsKey()
  const supabase = await createClient()
  const rpc = rpcOf(supabase)
  const raw = getTransport()
  const deadline = arcaDeadline(Math.max(0, deadlineAt - Date.now()))
  const loginTimeoutMs = Math.max(
    5_000,
    Math.min(15_000, deadline.remaining() - CAE_MIN_START_MS - ULTIMO_TIMEOUT_MIN_MS - 2_000),
  )
  const session = createArcaSession({
    rpc,
    tenantId,
    environment,
    representedCuit,
    secretKey,
    transport: raw,
    loginTimeoutMs,
    deadline,
  })
  return {
    session,
    deps: {
      rpc,
      tenantId,
      environment,
      transport: withDeadline(raw, deadline),
      auth: () => session.auth(ARCA_SERVICE.wsfe),
      now: Date.now,
      deadline: deadline.at,
      loadVoucher: (id) => loadArcaVoucher(tenantId, id),
    },
  }
}

/**
 * ARCA rechazó el ticket (600/601 en el pedido de CAE, o en el número): se descarta
 * para que el próximo intento pida otro. Nunca tira.
 */
async function dropRejectedTicket(session: ArcaSession, outcome: EmissionOutcome): Promise<void> {
  const rejected =
    (outcome.kind === 'rejected' && ticketRejectedBy(outcome.messages)) ||
    (outcome.kind === 'not_started' &&
      outcome.cause.kind === 'arca' &&
      isTicketRejection(outcome.cause.error))
  if (rejected) await session.dropTicket(ARCA_SERVICE.wsfe)
}

async function storeDeps(tenantId: string): Promise<Pick<EmitDeps, 'rpc' | 'tenantId'>> {
  return { rpc: rpcOf(await createClient()), tenantId }
}

function voucherLabelOf(row: Pick<ArcaVoucherRow, 'cbteTipo' | 'pointOfSale' | 'number'>): string {
  return arcaVoucherLabel(row.cbteTipo, row.pointOfSale, row.number)
}

// ─── El número que sigue ─────────────────────────────────────────────────────

/**
 * El próximo número de la plataforma para un tipo (`FECompUltimoAutorizado` + 1)
 * y la fecha del último (la de la base si es de la plataforma; si no, la de
 * ARCA), para que el formulario muestre «próximo 0005-00000104» y la ventana de
 * fechas. Solo producción, con la emisión prendida.
 *
 * Entrada (`arcaNextNumberSchema`): `{ cbteTipo: 1 | 2 | 3 | 6 | 7 | 8 }`.
 */
export async function getArcaNextNumber(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaNextNumber>> {
  const op = 'nextNumber'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaNextNumberSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const cbteTipo = parsed.data.cbteTipo as CbteTipo
    const tooMany = limited(`arca-next:${auth.tenantId}`, 30)
    if (tooMany) return tooMany

    const conn = await loadArcaConnectionRow(auth.tenantId, 'produccion')
    if (!conn || conn.status !== 'connected') return accFailure('arca_not_connected')
    if (!conn.emissionEnabled) return accFailure('arca_emission_disabled')
    const pv = conn.pointOfSale
    if (pv === null) return accFailure('arca_emission_requires_connection')

    const { deps, session } = await emitSession(
      auth.tenantId,
      'produccion',
      conn.representedCuit,
      Date.now() + 30_000,
    )
    const client = createWsfe(deps.transport, 'produccion', deps.auth, { timeoutMs: 10_000 })
    let last: number
    try {
      last = await client.ultimoAutorizado(pv, cbteTipo)
    } catch (e) {
      if (isArcaStoreError(e) || isArcaSecretsKeyError(e)) return failureState(op, e)
      if (isTicketRejection(e)) await session.dropTicket(ARCA_SERVICE.wsfe)
      return arcaState(describeArcaError(e, errorContext(conn)))
    }
    const mine = await lastPlatformVoucher(auth.tenantId, 'produccion', pv, cbteTipo)
    let lastIssueDate: IsoDate | null = mine && mine.number === last ? mine.issueDate : null
    if (last > 0 && lastIssueDate === null) {
      // El último no es de la plataforma (o no está en la base): su fecha, de ARCA.
      try {
        const found = await createWsfe(deps.transport, 'produccion', deps.auth, {
          timeoutMs: 8_000,
        }).compConsultar(cbteTipo, pv, last)
        lastIssueDate = found?.cbteFch ?? mine?.issueDate ?? null
      } catch {
        lastIssueDate = mine?.issueDate ?? null
      }
    }
    return {
      ok: true,
      data: { pointOfSale: pv, cbteTipo, lastNumber: last, nextNumber: last + 1, lastIssueDate },
      message: `El próximo es el ${formatVoucherNumber(pv, last + 1)}.`,
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Emitir ──────────────────────────────────────────────────────────────────

/** Los valores que se guardan en el comprobante de ARCA (sin la referencia ni el hash). */
function storedValues(input: ArcaEmitInput): Record<string, unknown> {
  const { clientRef: _ref, previewHash: _hash, warningsAck: _acks, ...values } = input
  return values
}

function okBuilt(built: PostingResult): built is Extract<PostingResult, { ok: true }> {
  return built.ok
}

/** El asiento de la factura, con su vista previa y su hash (el número va al hash). */
function buildFor(
  input: ArcaEmitInput,
  ctx: PostingContext,
  firstOpenDate: IsoDate | null,
  clientRef: string,
): PostingResult {
  return buildSalesInvoice(input, ctx, {
    clientRef,
    validate: firstOpenDate ? { firstOpenDate } : {},
  })
}

type PostOutcome =
  | { readonly ok: true; readonly documentId: string | null }
  | { readonly ok: false; readonly state: AccFailureState }

/**
 * Contabiliza la factura autorizada con el `client_ref` de su comprobante de ARCA
 * y la vincula. Si el asiento ya estaba (un envío anterior que se cortó), solo la
 * vincula. Nunca tira.
 */
async function postAndLink(o: {
  readonly op: string
  readonly slug: string
  readonly tenantId: string
  readonly voucherId: string
  readonly clientRef: string
  readonly built: Extract<PostingResult, { ok: true }>
  readonly ctx: PostingContext
  /** El estado `authorized` quedó guardado (si no, vincular falla: lo arregla la verificación). */
  readonly linkable: boolean
}): Promise<PostOutcome> {
  try {
    const existing = await findBundleSalesDocument(o.tenantId, o.clientRef)
    let documentId: string | null = existing?.documentId ?? null
    if (!documentId) {
      const state = await postBuiltBundle(
        `arca.${o.op}`,
        o.slug,
        o.tenantId,
        o.clientRef,
        o.built,
        o.ctx,
        'sales_invoice',
      )
      if (!state.ok) return { ok: false, state }
      documentId =
        state.result.documents.find((d) => d.ref === 'd1')?.id ??
        state.result.documents[0]?.id ??
        null
    }
    if (documentId && o.linkable) {
      try {
        await linkVoucherDocument(await storeDeps(o.tenantId), o.voucherId, documentId)
      } catch (e) {
        // El asiento está guardado: vincularlo lo reintenta «Cargarla ahora» o la verificación.
        console.error('[arca.emit] link', isArcaStoreError(e) ? (e.key ?? e.pgCode) : 'unknown')
      }
    }
    return { ok: true, documentId }
  } catch (e) {
    console.error('[arca.emit] post', e instanceof Error ? e.name : 'unknown')
    return { ok: false, state: { ok: false, code: 'error', message: ACC_ERRORS.offline.message } }
  }
}

function authorizedNotPosted(
  o: { voucherId: string; label: string; cae: string },
  reason: AccFailureState,
  ctx: ArcaErrorContext,
): AccFailureState {
  const view = describeArcaErrorKey('arca_authorized_not_posted', {
    ...ctx,
    voucherLabel: o.label,
    cae: o.cae,
    reason: reason.message.replace(/\.$/, ''),
  })
  return arcaState(view, {
    detail: {
      voucher_id: o.voucherId,
      cae: o.cae,
      label: o.label,
      emitted: true,
      needs_confirmation: reason.code === 'needs_confirmation',
    },
  })
}

/** Un reintento del mismo envío (`emissionKey`): lo que ya pasó, sin emitir de nuevo. */
async function replayState(
  op: string,
  slug: string,
  tenantId: string,
  row: ArcaVoucherRow,
  conn: ArcaConnectionRow | null,
): Promise<AccSimpleState<ArcaEmitResult>> {
  const label = voucherLabelOf(row)
  if (
    (row.status === 'posted' || row.status === 'authorized') &&
    row.cae &&
    row.caeDue &&
    row.number
  ) {
    let documentId = row.documentId
    if (row.status === 'authorized') {
      documentId = (await tryAutoPost(op, slug, tenantId, row.id))?.documentId ?? null
      if (!documentId) {
        return authorizedNotPosted(
          { voucherId: row.id, label, cae: row.cae },
          { ok: false, code: 'error', message: 'falta confirmarla' },
          errorContext(conn),
        )
      }
    }
    return {
      ok: true,
      data: {
        voucherId: row.id,
        documentId,
        label,
        cae: row.cae,
        caeDue: row.caeDue,
        number: row.number,
        observations: row.observations.map((m) => m.msg),
        replayed: true,
      },
      message: `${label} ya estaba emitida · CAE ${row.cae}`,
    }
  }
  if (row.status === 'needs_reconcile') {
    return {
      ok: false,
      code: 'error',
      message: ARCA_ERRORS.arca_unknown_state.body,
      detail: { key: 'arca_unknown_state', voucher_id: row.id, label },
    }
  }
  return {
    ok: false,
    code: 'conflict',
    message:
      'Esta factura se está emitiendo en este momento. Esperá unos segundos y fijate en Ventas › Facturas: no la vuelvas a emitir.',
    detail: { key: 'arca_in_flight', voucher_id: row.id, label },
  }
}

/**
 * Emite una factura, nota de crédito o nota de débito con CAE (diseño §3.2.4) y
 * la carga en los libros con el asiento de siempre.
 *
 * Entrada (`arcaEmitSchema`): los valores de la factura de venta (centavos, con
 * `clientRef`, `previewHash` y `warningsAck`) más `arca`. Devuelve:
 * - `ok: true` con `{ documentId, cae, label… }`: emitida y cargada.
 * - `preview_stale` (con la vista nueva): cambió algo, o ARCA da otro número
 *   (`detail.key = 'arca_number_changed'`, `detail.next_number`).
 * - `detail.nothing_emitted: true`: no se emitió nada (se puede reintentar).
 * - `detail.key = 'arca_unknown_state'`: no se sabe si se emitió; **no reemitir**.
 * - `detail.key = 'arca_authorized_not_posted'`: emitida pero sin asiento («Cargarla ahora»).
 */
export async function emitArcaSalesVoucher(
  slug: string,
  raw: ArcaEmitValues,
): Promise<AccSimpleState<ArcaEmitResult>> {
  const op = 'emit'
  const deadline = Date.now() + EMIT_BUDGET_MS
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaEmitSchema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)
    const input = parsed.data
    const tenantId = auth.tenantId

    const conn = await loadArcaConnectionRow(tenantId, 'produccion')
    // Un reintento del mismo envío (se cortó la respuesta): nunca emite dos veces. Una
    // reserva sin pedir el CAE no salió a ARCA: sigue el camino normal (la reserva la
    // frena si es de hace segundos, o la suelta si quedó colgada).
    const previous = await findVoucherByEmissionKey(tenantId, input.clientRef)
    if (previous && previous.status !== 'reserved') {
      return replayState(op, slug, tenantId, previous, conn)
    }

    const tooMany = limited(`arca-emit:${tenantId}`, 10)
    if (tooMany) return tooMany
    if (!conn || conn.status !== 'connected') return accFailure('arca_not_connected')
    if (!conn.emissionEnabled) return accFailure('arca_emission_disabled')
    const pv = conn.pointOfSale
    if (pv === null) return accFailure('arca_emission_requires_connection')
    if (input.pointOfSale !== pv) {
      return accFailure(
        'arca_point_of_sale_mismatch',
        {},
        {
          pointOfSale: ACC_ERRORS.arca_point_of_sale_mismatch.message,
        },
      )
    }
    const ctxErr = errorContext(conn)
    const letter = letterOfVoucherType(input.voucherType)
    if (letter === 'A' && !conn.allowedClasses.includes('A')) {
      const view = describeArcaErrorKey('arca_class_a_not_enabled', ctxErr)
      return arcaState(view, { fieldErrors: { 'arca.condicionIvaReceptorId': view.body } })
    }

    const loaded = await loadDocumentContext(tenantId, { lineIds: [], commissionPartyId: null })
    if (!loaded.ok) return loaded.state
    const { ctx, firstOpenDate } = loaded
    if (ctx.settings.ivaCondition !== 'responsable_inscripto') {
      return {
        ok: false,
        code: 'conflict',
        message:
          'Por ahora la plataforma emite con ARCA solo para responsables inscriptos (Factura A y B). Cargala con «Ya la emití en otro sistema».',
        detail: { key: 'arca_not_vat_registered' },
      }
    }
    const party = ctx.parties.get(input.partyId)
    if (!party) return fieldFailure('partyId', 'Ese cliente ya no está. Recargá la página.')

    // El asiento de siempre, con el número que vio la persona.
    const built = buildFor(input, ctx, firstOpenDate, input.clientRef)
    if (!okBuilt(built)) return engineErrorsState(built.errors)
    if (built.hash !== input.previewHash) {
      return {
        ok: false,
        code: 'preview_stale',
        message: ACC_ERRORS.preview_stale.message,
        preview: built.preview,
        hash: built.hash,
        detail: { key: 'preview_stale' },
      }
    }
    const pending = built.warnings.filter((w) => !input.warningsAck.includes(w.key))
    if (pending.length > 0) {
      return {
        ok: false,
        code: 'needs_confirmation',
        message: ACC_ERRORS.warning_requires_ack.message,
        warnings: pending.map(warningCopy),
      }
    }
    const doc = built.bundle.documents[0]
    const fv = doc?.fiscalVouchers[0]
    if (!doc || !fv || !letter) {
      console.error('[arca.emit] sin comprobante fiscal')
      return UNEXPECTED
    }

    // Lo que ARCA pide del cliente (Factura A con CUIT, tope de la B sin identificar).
    const receiver = arcaReceiverIssue({ letter, receiver: party, totalCents: doc.totalCents })
    if (receiver) return fieldFailure(receiver.field, receiver.message)

    // NC y ND: contra una factura emitida por la plataforma, del mismo cliente y letra.
    let related: ArcaVoucherRow | null = null
    if (input.arca.relatedVoucherId) {
      related = await loadArcaVoucher(tenantId, input.arca.relatedVoucherId)
      const relatedForm = related ? readStoredForm(related.form) : null
      const sameLetter = related !== null && related.cbteTipo <= 3 === (letter === 'A')
      if (
        !related ||
        related.environment !== 'produccion' ||
        (related.status !== 'authorized' && related.status !== 'posted') ||
        related.number === null ||
        ![1, 2, 6, 7].includes(related.cbteTipo) ||
        !sameLetter ||
        relatedForm?.partyId !== input.partyId ||
        (input.relatedDocumentId ?? null) !== related.documentId
      ) {
        return fieldFailure(
          'arca.relatedVoucherId',
          'Elegí una factura de este cliente emitida desde acá, de la misma letra.',
        )
      }
      if (related.issueDate && input.issueDate < related.issueDate) {
        return fieldFailure(
          'issueDate',
          `La nota no puede tener fecha anterior a la factura que corrige (${formatIsoDay(related.issueDate)}).`,
        )
      }
    }

    // La fecha: la ventana de ARCA y la del último comprobante de este tipo.
    const cbteTipo = CBTE_TIPO[input.voucherType as keyof typeof CBTE_TIPO]
    const lastMine = await lastPlatformVoucher(tenantId, 'produccion', pv, cbteTipo)
    const window = arcaDateWindow({
      today: ctx.today,
      concepto: input.arca.concepto,
      lastIssueDate: lastMine?.issueDate ?? null,
      firstOpenDate,
      booksStartDate: ctx.settings.booksStartDate,
    })
    if (input.issueDate < window.min || input.issueDate > window.max) {
      return fieldFailure(
        'issueDate',
        window.min === window.max
          ? 'Con ARCA, esta factura va con la fecha de hoy.'
          : `Con ARCA, la fecha tiene que estar entre el ${formatIsoDay(window.min)} y hoy.`,
      )
    }

    // Los importes como los pide WSFE (se controlan acá, antes de gastar una llamada).
    const amounts = wsfeAmounts(fv.amounts)
    const issues = checkWsfeAmounts(amounts, { cbteTipo })
    if (issues.length > 0) {
      if (issues.every((i) => i === '10051')) {
        return fieldFailure(
          'aliquots',
          'El IVA no coincide con la alícuota: ARCA acepta hasta un centavo de diferencia. Revisá los importes.',
        )
      }
      console.error('[arca.emit] amounts', issues.join(','))
      return arcaState(describeArcaErrorKey('arca_amounts', ctxErr))
    }

    const form: ArcaStoredForm = {
      v: 1,
      kind: 'sale',
      emissionKey: input.clientRef,
      values: storedValues(input),
      previewHash: built.hash,
      warningsAck: input.warningsAck,
      detail: input.arca.detail,
      partyId: input.partyId,
      testKind: null,
    }
    const docTipo = fv.counterparty.docType
    const docNro = docTipo === 99 ? '0' : fv.counterparty.docNumber.replace(/\D/g, '')
    const concepto = input.arca.concepto
    const plan: EmissionPlan = {
      pointOfSale: pv,
      cbteTipo,
      predictedNumber: input.arca.predictedNumber,
      request: (number): CaeRequest => ({
        ptoVta: pv,
        cbteTipo,
        number,
        concepto,
        docTipo,
        docNro,
        cbteFch: input.issueDate,
        amounts,
        condicionIvaReceptorId: input.arca.condicionIvaReceptorId,
        serviceFrom: concepto === 1 ? null : input.arca.serviceFrom,
        serviceTo: concepto === 1 ? null : input.arca.serviceTo,
        paymentDue: arcaPaymentDue(input),
        associated:
          related && related.number !== null
            ? [
                {
                  cbteTipo: related.cbteTipo,
                  ptoVta: related.pointOfSale,
                  number: related.number,
                  cuit: conn.representedCuit,
                  cbteFch: related.issueDate,
                },
              ]
            : [],
      }),
      payload: {
        form,
        total_cents: doc.totalCents,
        issue_date: input.issueDate,
        related_voucher_id: related?.id ?? null,
      },
    }

    const { deps, session } = await emitSession(
      tenantId,
      'produccion',
      conn.representedCuit,
      deadline,
    )
    const outcome = await runEmission(deps, plan)
    await dropRejectedTicket(session, outcome)
    return await emissionState({
      op,
      slug,
      tenantId,
      input,
      conn,
      ctx,
      firstOpenDate,
      built,
      outcome,
    })
  } catch (e) {
    return failureState(op, e)
  }
}

async function emissionState(o: {
  readonly op: string
  readonly slug: string
  readonly tenantId: string
  readonly input: ArcaEmitInput
  readonly conn: ArcaConnectionRow
  readonly ctx: PostingContext
  readonly firstOpenDate: IsoDate | null
  readonly built: Extract<PostingResult, { ok: true }>
  readonly outcome: EmissionOutcome
}): Promise<AccSimpleState<ArcaEmitResult>> {
  const { outcome, conn } = o
  const ctxErr = errorContext(conn)
  const cbteTipo = CBTE_TIPO[o.input.voucherType as keyof typeof CBTE_TIPO]
  const pv = conn.pointOfSale ?? o.input.pointOfSale
  if (outcome.kind !== 'not_started' && outcome.kind !== 'number_changed') {
    revalidateAdministracion(o.slug)
  }
  switch (outcome.kind) {
    case 'not_started':
      return notStartedState(outcome.cause, ctxErr)

    case 'number_changed': {
      // La vista previa con el número nuevo: reenviando con este hash se emite ese número.
      const next = outcome.nextNumber
      const rebuilt = buildFor(
        { ...o.input, number: next, arca: { ...o.input.arca, predictedNumber: next } },
        o.ctx,
        o.firstOpenDate,
        o.input.clientRef,
      )
      if (!okBuilt(rebuilt)) return engineErrorsState(rebuilt.errors)
      return {
        ok: false,
        code: 'preview_stale',
        message: `Ahora el número es ${formatVoucherNumber(pv, next)}: otra factura tomó el anterior. Revisá y emití de nuevo.`,
        preview: rebuilt.preview,
        hash: rebuilt.hash,
        detail: { key: 'arca_number_changed', next_number: next, cbte_tipo: cbteTipo },
      }
    }

    case 'rejected': {
      const view = describeArcaErrorKey(outcome.errorKey, ctxErr, {
        code: firstCode(outcome.messages),
        issuerReasons: issuerReasonsOf(outcome.messages),
      })
      return arcaState(view, {
        suffix: NOTHING_EMITTED,
        fieldErrors: rejectionFields(outcome.errorKey, view.body),
        detail: { voucher_id: outcome.voucherId, nothing_emitted: true, rejected: true },
      })
    }

    case 'unknown':
      return {
        ok: false,
        code: 'error',
        message: ARCA_ERRORS.arca_unknown_state.body,
        detail: {
          key: 'arca_unknown_state',
          voucher_id: outcome.voucherId,
          label: arcaVoucherLabel(cbteTipo, pv, outcome.number),
        },
      }

    case 'not_emitted':
      return {
        ok: false,
        code: 'error',
        message:
          'ARCA no contestó y la factura no se emitió. Podés volver a intentar en unos minutos.',
        detail: { key: 'arca_not_emitted', voucher_id: outcome.voucherId, nothing_emitted: true },
      }

    case 'authorized': {
      const label = arcaVoucherLabel(cbteTipo, pv, outcome.number)
      const posted = await postAndLink({
        op: o.op,
        slug: o.slug,
        tenantId: o.tenantId,
        voucherId: outcome.voucherId,
        clientRef: outcome.clientRef,
        built: o.built,
        ctx: o.ctx,
        linkable: outcome.persisted,
      })
      if (!posted.ok) {
        return authorizedNotPosted(
          { voucherId: outcome.voucherId, label, cae: outcome.cae },
          posted.state,
          ctxErr,
        )
      }
      return {
        ok: true,
        data: {
          voucherId: outcome.voucherId,
          documentId: posted.documentId,
          label,
          cae: outcome.cae,
          caeDue: outcome.caeDue,
          number: outcome.number,
          observations: outcome.observations.map((m) => m.msg),
          replayed: false,
        },
        message: `${label} emitida · CAE ${outcome.cae}`,
      }
    }
  }
}

// ─── «Cargarla ahora» ────────────────────────────────────────────────────────

type Rebuilt =
  | {
      readonly ok: true
      readonly built: Extract<PostingResult, { ok: true }>
      readonly ctx: PostingContext
      readonly movedTo: IsoDate | null
      readonly stored: ArcaStoredForm
    }
  | { readonly ok: false; readonly state: AccFailureState }

/**
 * El asiento de una factura autorizada, armado de nuevo desde lo que se guardó al
 * emitirla, con el contexto de hoy. Si su mes ya se cerró, va al primer día
 * abierto (H.5): la fecha de la factura no cambia, cambia la del asiento.
 */
async function rebuildVoucherPosting(tenantId: string, row: ArcaVoucherRow): Promise<Rebuilt> {
  const stored = readStoredForm(row.form)
  if (!stored || stored.kind !== 'sale' || !stored.values || row.number === null) {
    return { ok: false, state: NO_STORED_FORM }
  }
  const values = stored.values
  const arca =
    typeof values.arca === 'object' && values.arca !== null
      ? (values.arca as Record<string, unknown>)
      : {}
  const parsed = arcaEmitSchema.safeParse({
    ...values,
    number: row.number,
    arca: { ...arca, predictedNumber: row.number },
    clientRef: row.clientRef,
    previewHash: stored.previewHash ?? ZERO_HASH,
    warningsAck: stored.warningsAck,
  })
  if (!parsed.success) {
    console.error('[arca.emit] stored form unreadable')
    return { ok: false, state: NO_STORED_FORM }
  }
  const loaded = await loadDocumentContext(tenantId, { lineIds: [], commissionPartyId: null })
  if (!loaded.ok) return { ok: false, state: loaded.state }
  const { ctx, firstOpenDate } = loaded
  let built = buildFor(parsed.data, ctx, firstOpenDate, row.clientRef)
  let movedTo: IsoDate | null = null
  if (!built.ok && firstOpenDate && built.errors.every((e) => e.key === 'period_closed')) {
    const plain = buildFor(parsed.data, ctx, null, row.clientRef)
    if (okBuilt(plain)) {
      const bundle = {
        ...plain.bundle,
        documents: plain.bundle.documents.map((d) =>
          d.accountingDate < firstOpenDate ? { ...d, accountingDate: firstOpenDate } : d,
        ),
      }
      built = finalize(
        bundle,
        ctx,
        { clientRef: row.clientRef, validate: { firstOpenDate } },
        { warnings: plain.warnings },
      )
      movedTo = firstOpenDate
    }
  }
  if (!okBuilt(built)) return { ok: false, state: engineErrorsState(built.errors) }
  return { ok: true, built, ctx, movedTo, stored }
}

/**
 * Si lo que se armaría hoy es exactamente lo que aprobó la persona al emitir (mismo
 * hash, sin avisos nuevos y sin mover de mes), se carga solo. Si no, queda para
 * «Cargarla ahora». Nunca tira.
 */
async function tryAutoPost(
  op: string,
  slug: string,
  tenantId: string,
  voucherId: string,
): Promise<{ readonly documentId: string } | null> {
  try {
    const row = await loadArcaVoucher(tenantId, voucherId)
    if (!row || row.environment !== 'produccion' || row.status !== 'authorized') return null
    const existing = await findBundleSalesDocument(tenantId, row.clientRef)
    if (existing) {
      await linkVoucherDocument(await storeDeps(tenantId), row.id, existing.documentId)
      return { documentId: existing.documentId }
    }
    const rebuilt = await rebuildVoucherPosting(tenantId, row)
    if (!rebuilt.ok || rebuilt.movedTo !== null) return null
    if (rebuilt.built.hash !== rebuilt.stored.previewHash) return null
    if (rebuilt.built.warnings.some((w) => !rebuilt.stored.warningsAck.includes(w.key))) return null
    const posted = await postAndLink({
      op,
      slug,
      tenantId,
      voucherId: row.id,
      clientRef: row.clientRef,
      built: rebuilt.built,
      ctx: rebuilt.ctx,
      linkable: true,
    })
    return posted.ok && posted.documentId ? { documentId: posted.documentId } : null
  } catch (e) {
    console.error('[arca.emit] auto post', e instanceof Error ? e.name : 'unknown')
    return null
  }
}

/** La factura autorizada a cargar (o el motivo por el que no se puede). */
async function authorizedRow(
  tenantId: string,
  voucherId: string,
): Promise<{ ok: true; row: ArcaVoucherRow } | { ok: false; state: AccFailureState }> {
  const row = await loadArcaVoucher(tenantId, voucherId)
  if (!row) {
    return {
      ok: false,
      state: { ok: false, code: 'conflict', message: 'Esa factura ya no está. Recargá la página.' },
    }
  }
  if (row.environment !== 'produccion') {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'conflict',
        message: 'Es una factura de prueba (homologación): no va a los libros.',
      },
    }
  }
  if (row.status !== 'authorized' && row.status !== 'posted') {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'conflict',
        message: `Todavía no está autorizada (${arcaVoucherStatusLabel(row.status, row.environment).toLowerCase()}). Verificala con ARCA primero.`,
      },
    }
  }
  return { ok: true, row }
}

/**
 * El asiento de «Cargarla ahora», armado en el servidor (no guarda nada).
 * Entrada (`arcaVoucherRefSchema`): `{ voucherId }`.
 */
export async function previewArcaVoucherPosting(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaVoucherPostingPreview>> {
  const op = 'previewPosting'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaVoucherRefSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const found = await authorizedRow(auth.tenantId, parsed.data.voucherId)
    if (!found.ok) return found.state
    const { row } = found
    const rebuilt = await rebuildVoucherPosting(auth.tenantId, row)
    if (!rebuilt.ok) return rebuilt.state
    return {
      ok: true,
      data: {
        voucherId: row.id,
        label: voucherLabelOf(row),
        cae: row.cae,
        preview: rebuilt.built.preview,
        hash: rebuilt.built.hash,
        warnings: rebuilt.built.warnings
          .filter((w) => !rebuilt.stored.warningsAck.includes(w.key))
          .map(warningCopy),
        movedTo: rebuilt.movedTo,
      },
      message: 'Listo.',
    }
  } catch (e) {
    return failureState(op, e)
  }
}

/**
 * «Cargarla ahora»: guarda el asiento de una factura autorizada en ARCA con el
 * `client_ref` de su comprobante (un reintento devuelve lo ya guardado) y la
 * vincula. Si el asiento ya estaba, solo la vincula.
 *
 * Entrada (`arcaPostVoucherSchema`): `{ voucherId, previewHash, warningsAck? }`.
 */
export async function postAuthorizedArcaVoucher(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaReconcileResult>> {
  const op = 'postAuthorized'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaPostVoucherSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const found = await authorizedRow(auth.tenantId, parsed.data.voucherId)
    if (!found.ok) return found.state
    const { row } = found
    const label = voucherLabelOf(row)
    const done = (
      documentId: string | null,
      message: string,
    ): AccSimpleState<ArcaReconcileResult> => ({
      ok: true,
      data: { voucherId: row.id, status: 'posted', label, cae: row.cae, documentId },
      message,
    })
    if (row.status === 'posted') return done(row.documentId, `${label} ya estaba en los libros.`)

    const existing = await findBundleSalesDocument(auth.tenantId, row.clientRef)
    if (existing) {
      await linkVoucherDocument(await storeDeps(auth.tenantId), row.id, existing.documentId)
      revalidateAdministracion(slug)
      return done(existing.documentId, `Listo: ${label} quedó vinculada con su asiento.`)
    }

    const rebuilt = await rebuildVoucherPosting(auth.tenantId, row)
    if (!rebuilt.ok) return rebuilt.state
    if (rebuilt.built.hash !== parsed.data.previewHash) {
      return {
        ok: false,
        code: 'preview_stale',
        message: ACC_ERRORS.preview_stale.message,
        preview: rebuilt.built.preview,
        hash: rebuilt.built.hash,
        detail: { key: 'preview_stale' },
      }
    }
    const acks = new Set([...parsed.data.warningsAck, ...rebuilt.stored.warningsAck])
    const pending = rebuilt.built.warnings.filter((w) => !acks.has(w.key))
    if (pending.length > 0) {
      return {
        ok: false,
        code: 'needs_confirmation',
        message: ACC_ERRORS.warning_requires_ack.message,
        warnings: pending.map(warningCopy),
      }
    }
    const posted = await postAndLink({
      op,
      slug,
      tenantId: auth.tenantId,
      voucherId: row.id,
      clientRef: row.clientRef,
      built: rebuilt.built,
      ctx: rebuilt.ctx,
      linkable: true,
    })
    if (!posted.ok) return posted.state
    return done(
      posted.documentId,
      rebuilt.movedTo
        ? `Listo: ${label} quedó en los libros el ${formatIsoDay(rebuilt.movedTo)} (su mes ya estaba cerrado).`
        : `Listo: ${label} quedó en los libros.`,
    )
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Verificar con ARCA ──────────────────────────────────────────────────────

/**
 * «Verificar con ARCA» (`FECompConsultar`): un comprobante en verificación queda
 * autorizado (y, en producción, se carga solo si es exactamente lo que se aprobó)
 * o, si ARCA confirma que no existe, no emitido. También acomoda uno que quedó
 * pidiendo el CAE hace más de 2 minutos.
 *
 * Entrada (`arcaVoucherRefSchema`): `{ voucherId }`.
 */
export async function reconcileArcaVoucher(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<ArcaReconcileResult>> {
  const op = 'reconcile'
  const deadline = Date.now() + 40_000
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaVoucherRefSchema.safeParse(formInput(raw))
    if (!parsed.success) return invalidState(parsed.error)
    const tooMany = limited(`arca-reconcile:${auth.tenantId}`, 20)
    if (tooMany) return tooMany
    const tenantId = auth.tenantId
    const row = await loadArcaVoucher(tenantId, parsed.data.voucherId)
    if (!row) {
      return { ok: false, code: 'conflict', message: 'Esa factura ya no está. Recargá la página.' }
    }
    const label = voucherLabelOf(row)
    const result = (
      status: ArcaReconcileResult['status'],
      message: string,
      extra: Partial<ArcaReconcileResult> = {},
    ): AccSimpleState<ArcaReconcileResult> => ({
      ok: true,
      data: {
        voucherId: row.id,
        status,
        label,
        cae: row.cae,
        documentId: row.documentId,
        ...extra,
      },
      message,
    })

    if (row.status === 'authorized' && row.environment === 'produccion') {
      const auto = await tryAutoPost(op, slug, tenantId, row.id)
      revalidateAdministracion(slug)
      return auto
        ? result('posted', `${label} quedó cargada en los libros.`, { documentId: auto.documentId })
        : result(
            'authorized',
            `ARCA la autorizó (CAE ${row.cae}). Falta cargarla en los libros: tocá «Cargarla ahora».`,
          )
    }
    if (row.status !== 'requesting' && row.status !== 'needs_reconcile') {
      return result(
        row.status,
        `Ya estaba verificada: ${arcaVoucherStatusLabel(row.status, row.environment).toLowerCase()}.`,
      )
    }

    const conn = await loadArcaConnectionRow(tenantId, row.environment)
    if (!conn?.representedCuit) return accFailure('arca_not_connected')
    const { deps } = await emitSession(tenantId, row.environment, conn.representedCuit, deadline)
    const outcome = await reconcileVoucher(deps, row)
    revalidateAdministracion(slug)
    switch (outcome.kind) {
      case 'authorized': {
        if (row.environment === 'homologacion') {
          return result(
            'authorized',
            `ARCA la autorizó (CAE ${outcome.cae}). Es de prueba: no va a los libros.`,
            { cae: outcome.cae },
          )
        }
        const auto = outcome.persisted ? await tryAutoPost(op, slug, tenantId, row.id) : null
        return auto
          ? result(
              'posted',
              `ARCA la autorizó (CAE ${outcome.cae}) y quedó cargada en los libros.`,
              {
                cae: outcome.cae,
                documentId: auto.documentId,
              },
            )
          : result(
              'authorized',
              `ARCA la autorizó (CAE ${outcome.cae}). Falta cargarla en los libros: tocá «Cargarla ahora».`,
              { cae: outcome.cae },
            )
      }
      case 'not_emitted':
        return result('failed', 'ARCA confirmó que no se emitió. Si hace falta, emitila de nuevo.')
      case 'too_soon':
        return result(
          'needs_reconcile',
          'ARCA todavía no la muestra. Volvé a verificar en un par de minutos y no la emitas de nuevo.',
        )
      case 'in_progress':
        return result(
          'requesting',
          'Se está pidiendo el CAE en este momento. Esperá un minuto y volvé a verificar.',
        )
      case 'unchanged':
        return result(outcome.status, 'Ya estaba verificada.')
      case 'unreachable':
        if (isArcaStoreError(outcome.error) || isArcaSecretsKeyError(outcome.error)) {
          return failureState(op, outcome.error)
        }
        return arcaState(describeArcaError(outcome.error, errorContext(conn)))
      case 'mismatch':
        return {
          ok: false,
          code: 'conflict',
          message:
            'En ARCA hay un comprobante con ese número que no coincide con esta factura. Revisalo en ARCA («Mis Comprobantes») y avisanos antes de volver a emitir.',
          detail: { key: 'arca_reconcile_mismatch', voucher_id: row.id },
        }
      case 'unreadable':
      case 'store_failed':
        return UNEXPECTED
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Homologación ────────────────────────────────────────────────────────────

const TEST_NET_CENTS = 10_000
const TEST_VAT_CENTS = 2_100
const TEST_TOTAL_CENTS = TEST_NET_CENTS + TEST_VAT_CENTS
const TEST_DETAIL = 'Factura de prueba de la plataforma (homologación de ARCA). Sin validez fiscal.'

const TEST_PLAN: Readonly<Record<ArcaTestKind, { cbteTipo: CbteTipo; condicion: number }>> = {
  factura_b: { cbteTipo: 6, condicion: 5 },
  factura_a: { cbteTipo: 1, condicion: 1 },
  nota_credito_b: { cbteTipo: 8, condicion: 5 },
}

/**
 * «Emitir una factura de prueba» (diseño §3.2.8): solo en homologación, $ 121
 * (neto $ 100 + IVA 21 %), con fecha de hoy. Nunca va a los libros.
 *
 * Entrada (`arcaTestVoucherSchema`, opcional): `{ kind?: 'factura_b' | 'factura_a' |
 * 'nota_credito_b', receiverCuit? }`. La nota de crédito va asociada a la última
 * Factura B de prueba autorizada.
 */
export async function emitArcaTestVoucher(
  slug: string,
  raw?: unknown,
): Promise<AccSimpleState<ArcaTestVoucherResult>> {
  const op = 'testVoucher'
  const deadline = Date.now() + EMIT_BUDGET_MS
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = arcaTestVoucherSchema.safeParse(formInput(raw ?? {}))
    if (!parsed.success) return invalidState(parsed.error)
    const { kind, receiverCuit } = parsed.data
    const tooMany = limited(`arca-test-voucher:${auth.tenantId}`, 6)
    if (tooMany) return tooMany

    const conn = await loadArcaConnectionRow(auth.tenantId, 'homologacion')
    if (!conn || conn.status !== 'connected') {
      return {
        ok: false,
        code: 'conflict',
        message:
          'Primero conectá ARCA en pruebas (homologación) y tocá «Probar conexión»: la factura de prueba sale por ahí.',
        detail: { key: 'arca_not_connected' },
      }
    }
    const pv = conn.pointOfSale
    if (pv === null) {
      return {
        ok: false,
        code: 'conflict',
        message: 'Falta el punto de venta de pruebas (paso 2 en homologación).',
        detail: { key: 'arca_emission_requires_connection', step_n: 2 },
      }
    }
    const { cbteTipo, condicion } = TEST_PLAN[kind]
    let related: ArcaVoucherRow | null = null
    if (kind === 'nota_credito_b') {
      related = await lastTestInvoiceB(auth.tenantId)
      if (!related || related.number === null) {
        return fieldFailure(
          'kind',
          'Primero emití una Factura B de prueba: la nota de crédito va asociada a esa.',
        )
      }
    }
    const today = todayInCordoba()
    const form: ArcaStoredForm = {
      v: 1,
      kind: 'test',
      emissionKey: null,
      values: null,
      previewHash: null,
      warningsAck: [],
      detail: TEST_DETAIL,
      partyId: null,
      testKind: kind,
    }
    const relatedRef = related
    const plan: EmissionPlan = {
      pointOfSale: pv,
      cbteTipo,
      predictedNumber: null,
      request: (number): CaeRequest => ({
        ptoVta: pv,
        cbteTipo,
        number,
        concepto: 1,
        docTipo: kind === 'factura_a' ? 80 : 99,
        docNro: kind === 'factura_a' && receiverCuit ? receiverCuit : '0',
        cbteFch: today,
        amounts: {
          totalCents: TEST_TOTAL_CENTS,
          nonTaxedCents: 0,
          netCents: TEST_NET_CENTS,
          exemptCents: 0,
          tributesCents: 0,
          vatCents: TEST_VAT_CENTS,
          unsupportedCents: 0,
          iva: [{ id: 5, rateBp: 2100, baseCents: TEST_NET_CENTS, vatCents: TEST_VAT_CENTS }],
        },
        condicionIvaReceptorId: condicion,
        associated:
          relatedRef && relatedRef.number !== null && isCbteTipo(relatedRef.cbteTipo)
            ? [
                {
                  cbteTipo: relatedRef.cbteTipo,
                  ptoVta: relatedRef.pointOfSale,
                  number: relatedRef.number,
                  cuit: conn.representedCuit,
                  cbteFch: relatedRef.issueDate,
                },
              ]
            : [],
      }),
      payload: {
        form,
        total_cents: TEST_TOTAL_CENTS,
        issue_date: today,
        related_voucher_id: relatedRef?.id ?? null,
      },
    }
    const { deps, session } = await emitSession(
      auth.tenantId,
      'homologacion',
      conn.representedCuit,
      deadline,
    )
    const outcome = await runEmission(deps, plan)
    await dropRejectedTicket(session, outcome)
    const ctxErr = errorContext(conn)
    if (outcome.kind !== 'not_started') revalidateAdministracion(slug)
    switch (outcome.kind) {
      case 'not_started':
        return notStartedState(outcome.cause, ctxErr)
      case 'number_changed':
        return UNEXPECTED
      case 'rejected': {
        const view = describeArcaErrorKey(outcome.errorKey, ctxErr, {
          code: firstCode(outcome.messages),
          issuerReasons: issuerReasonsOf(outcome.messages),
        })
        const arcaSays = outcome.messages
          .slice(0, 3)
          .map((m) => `${m.code}: ${m.msg}`)
          .join(' · ')
        return arcaState(view, {
          suffix: arcaSays ? ` ARCA dice: ${arcaSays}` : '',
          detail: { voucher_id: outcome.voucherId, rejected: true },
        })
      }
      case 'unknown':
        return {
          ok: false,
          code: 'error',
          message: ARCA_ERRORS.arca_unknown_state.body,
          detail: { key: 'arca_unknown_state', voucher_id: outcome.voucherId },
        }
      case 'not_emitted':
        return {
          ok: false,
          code: 'error',
          message:
            'ARCA no contestó y la factura de prueba no se emitió. Probá de nuevo en unos minutos.',
          detail: { key: 'arca_not_emitted', voucher_id: outcome.voucherId },
        }
      case 'authorized': {
        const label = arcaVoucherLabel(cbteTipo, pv, outcome.number)
        return {
          ok: true,
          data: {
            voucherId: outcome.voucherId,
            kind,
            label,
            cae: outcome.cae,
            caeDue: outcome.caeDue,
            number: outcome.number,
            observations: outcome.observations.map((m) => m.msg),
          },
          message: `${label} de prueba autorizada · CAE ${outcome.cae}`,
        }
      }
    }
  } catch (e) {
    return failureState(op, e)
  }
}

// ─── Consumidor final ────────────────────────────────────────────────────────

/**
 * El cliente de sistema «Consumidor final (sin identificar)» para la Factura B
 * anónima: lo crea una sola vez (`acc_ensure_final_consumer`) y devuelve su id.
 */
export async function ensureArcaFinalConsumer(
  slug: string,
): Promise<AccSimpleState<{ readonly partyId: string }>> {
  const op = 'finalConsumer'
  try {
    const bad = badSlug(slug)
    if (bad) return bad
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_ensure_final_consumer', {
      p_tenant_id: auth.tenantId,
    })
    if (error) {
      const state = mapAccError(error)
      if (state.detail?.bug === true || state.code === 'error') {
        console.error(`[arca.emit.${op}]`, state.detail?.key ?? 'sin_clave', error.code ?? '')
      }
      return state
    }
    if (typeof data !== 'string') return UNEXPECTED
    revalidateAdministracion(slug)
    return { ok: true, data: { partyId: data }, message: 'Listo.' }
  } catch (e) {
    return failureState(op, e)
  }
}
