import 'server-only'

/**
 * El camino de toda acción que guarda un comprobante (G.3, E.7):
 *
 * 1. `authorizeAccounting(slug, 'write')`: dueño con acceso vigente.
 * 2. zod del formulario (centavos enteros, fechas reales, avisos conocidos).
 * 3. Contexto DESDE LA BASE (nunca el del navegador) con las partidas que el
 *    formulario referencia, con su abierto de hoy.
 * 4. El mismo `build*` que corrió el formulario. Si el hash no es el que vio la
 *    persona → `preview_stale` con la vista previa nueva y su hash.
 * 5. Avisos del motor sin aceptar → `needs_confirmation`, todos juntos.
 * 6. `acc_post_bundle` con SU bundle y `p_client_ref` (doble envío = lo ya
 *    guardado). La RPC vuelve a validar todo y audita adentro (G.5).
 * 7. Avisos que solo ve la base (`warning_requires_ack`) → `needs_confirmation`
 *    con los nombres completados; el formulario los acepta y reenvía igual.
 * 8. `revalidatePath` de toda la sección y el toast («Factura cargada · …»).
 *
 * **El primer día abierto.** Un gasto o una compra con fecha de un mes cerrado
 * se contabiliza el primer día abierto (`accountingDateFor`, H.5). Si el
 * formulario armó la vista previa sin ese dato, su propuesta caería en un mes
 * cerrado y la RPC la rechazaría: no se manda. Vuelve `period_closed` con el
 * asiento corregido (`preview`) y su `hash`, para ofrecer «Cargarlo el 01/10»
 * (H.2) reenviando con ese hash.
 *
 * Nunca se loguean datos personales: solo la operación, la clave y el código.
 */

import { revalidatePath } from 'next/cache'
import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccActionState,
  type AccFailureState,
  invalidState,
} from '@/lib/accounting/action-state'
import {
  ACC_ERRORS,
  ACC_GENERIC_ERROR,
  accErrorMessage,
  detailVars,
  engineErrorsState,
  isWarningKey,
  mapAccError,
  type PgLikeError,
  warningCopy,
} from '@/lib/accounting/errors'
import { toRpcPayload } from '@/lib/accounting/posting'
import type {
  EntryPreview,
  IsoDate,
  MessageDetail,
  PostingContext,
  PostingResult,
  PostingWarning,
} from '@/lib/accounting/types'
import { createClient } from '@/lib/supabase/server'
import { loadDocumentContext } from './document-context'
import {
  buildIgnoringClosedMonths,
  buildPrimary,
  isDocumentForm,
  type ParsedDocumentForm,
  parseDocumentForm,
  withPreviewMeta,
} from './document-forms'
import type { DocumentForm, PreviewBundleState } from './document-types'
import { parsePostBundleResult } from './rpc-results'
import { savedMessage } from './saved-message'

// ─── Piezas comunes ──────────────────────────────────────────────────────────

const GENERIC: AccFailureState = { ok: false, code: 'error', message: ACC_GENERIC_ERROR }

const CONFIRM_MESSAGE = ACC_ERRORS.warning_requires_ack.message

/** El toast si no se pudo armar el texto (nunca debería pasar). */
export const SAVED_FALLBACK = 'Listo, quedó guardado.'

/**
 * Lo que corre después de que la base confirmó: si falla, se loguea y se sigue
 * (la persona tiene que ver «guardado», no un error que la haga cargar dos veces).
 */
export function afterCommit<T>(op: string, run: () => T): T | null {
  try {
    return run()
  } catch (error) {
    console.error(`[accounting.documents.${op}] después de guardar`, errorName(error))
    return null
  }
}

/** Toda escritura revalida la sección entera (G.6): Resumen, listas, fichas y libros. */
export function revalidateAdministracion(slug: string): void {
  revalidatePath(`/${slug}/administracion`, 'layout')
}

/**
 * Log sin datos personales (CLAUDE.md §9): operación, clave y código. Solo lo
 * que no es un error de carga (bugs y errores desconocidos).
 */
export function logFailure(op: string, state: AccFailureState, pgCode?: string | null): void {
  const key = typeof state.detail?.key === 'string' ? state.detail.key : null
  if (state.detail?.bug === true || (state.code === 'error' && key !== 'offline')) {
    console.error(`[accounting.documents.${op}]`, key ?? 'sin_clave', state.code, pgCode ?? '')
  }
}

export function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function forbiddenState(): AccFailureState {
  return {
    ok: false,
    code: 'forbidden',
    message: accErrorMessage('forbidden'),
    detail: { key: 'forbidden' },
  }
}

/** Dos envíos iguales a la vez: el segundo choca con el `client_ref` del primero. */
function isClientRefRace(error: PgLikeError): boolean {
  if (error.code !== '23505') return false
  return `${error.message ?? ''} ${error.details ?? ''}`.includes('abd_client_ref_uq')
}

/**
 * Los avisos de `warning_requires_ack` (C.0: `detail = {"warnings":[…]}`), con
 * los nombres que la base no manda (la caja, el proveedor) sacados del
 * contexto, para que el texto diga «Caja quedaría en −$ 40.000» y no «la caja».
 */
export function dbWarnings(
  details: string | null | undefined,
  ctx: Pick<PostingContext, 'treasuries' | 'parties' | 'accounts'>,
): PostingWarning[] {
  if (!details) return []
  let raw: unknown
  try {
    raw = JSON.parse(details)
  } catch {
    return []
  }
  const list = isRecord(raw) ? raw.warnings : null
  if (!Array.isArray(list)) return []
  const out: PostingWarning[] = []
  for (const item of list) {
    if (isWarningKey(item)) {
      out.push({ key: item })
      continue
    }
    if (!isRecord(item)) continue
    const key = item.key ?? item.warning
    if (!isWarningKey(key)) continue
    const detail: Record<string, string | number | boolean | null> = {}
    for (const [k, v] of Object.entries(item)) {
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        detail[k] = v
      }
    }
    const treasuryId =
      typeof item.treasury_id === 'string'
        ? item.treasury_id
        : typeof item.treasury === 'string'
          ? item.treasury
          : null
    if (treasuryId && typeof detail.treasury_name !== 'string') {
      const name = ctx.treasuries.get(treasuryId)?.name
      if (name) detail.treasury_name = name
    }
    const partyId =
      typeof item.party_id === 'string'
        ? item.party_id
        : typeof item.party === 'string'
          ? item.party
          : null
    if (partyId && typeof detail.party_name !== 'string') {
      const party = ctx.parties.get(partyId)
      if (party) detail.party_name = party.tradeName ?? party.name
    }
    // «Posible duplicado» de un gasto sin proveedor: la cuenta hace de nombre.
    const accountId = typeof item.account_id === 'string' ? item.account_id : null
    if (accountId && typeof detail.account_name !== 'string') {
      const account = ctx.accounts.get(accountId)
      if (account) detail.account_name = account.name
    }
    if (detail.amount_cents === undefined && typeof detail.total_cents === 'number') {
      detail.amount_cents = detail.total_cents
    }
    out.push({ key, detail: detail as MessageDetail })
  }
  return out
}

/** Error de `acc_post_bundle` → estado del formulario (avisos de la base incluidos). */
function postFailure(op: string, error: PgLikeError, ctx: PostingContext): AccFailureState {
  const state = mapAccError(error)
  if (state.detail?.key === 'warning_requires_ack') {
    const warnings = dbWarnings(error.details, ctx)
    if (warnings.length > 0) {
      return {
        ok: false,
        code: 'needs_confirmation',
        message: CONFIRM_MESSAGE,
        warnings: warnings.map(warningCopy),
        detail: { key: 'warning_requires_ack' },
      }
    }
  }
  logFailure(op, state, error.code)
  return state
}

/**
 * La vista previa que vio la persona no es la que se guardaría. Si es la
 * misma propuesta armada sin el primer día abierto (fecha de un mes cerrado),
 * `period_closed` con el asiento corregido; si no, cambió algo en la base
 * mientras se cargaba (`preview_stale`). Las dos traen el asiento y el hash
 * nuevos: reenviando con ese hash se guarda lo que muestran.
 */
function staleState(
  input: ParsedDocumentForm,
  ctx: PostingContext,
  firstOpenDate: IsoDate | null,
  preview: EntryPreview[],
  hash: string,
): AccFailureState {
  if (firstOpenDate) {
    const plain = buildIgnoringClosedMonths(input, ctx)
    if (plain.ok && plain.hash === input.previewHash) {
      const closed =
        plain.bundle.documents.map((d) => d.accountingDate).find((d) => d < firstOpenDate) ??
        firstOpenDate
      const month = closed.slice(0, 7)
      return {
        ok: false,
        code: ACC_ERRORS.period_closed.code,
        message: accErrorMessage('period_closed', detailVars({ month })),
        preview,
        hash,
        detail: { key: 'period_closed', month, first_open_date: firstOpenDate },
      }
    }
  }
  return {
    ok: false,
    code: 'preview_stale',
    message: ACC_ERRORS.preview_stale.message,
    preview,
    hash,
    detail: { key: 'preview_stale' },
  }
}

// ─── Guardar ─────────────────────────────────────────────────────────────────

/** El camino completo de G.3 para un formulario de comprobante. */
export async function runPostDocument(
  slug: unknown,
  form: DocumentForm,
  raw: unknown,
): Promise<AccActionState> {
  const op = `post.${form}`
  try {
    if (typeof slug !== 'string' || slug === '') return forbiddenState()
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state

    const parsed = parseDocumentForm(form, raw)
    if (!parsed.ok) return invalidState(parsed.error)
    const input = parsed.value

    const loaded = await loadDocumentContext(auth.tenantId, input.refs)
    if (!loaded.ok) {
      logFailure(op, loaded.state)
      return loaded.state
    }
    const { ctx, firstOpenDate } = loaded

    const built = buildPrimary(input, ctx, firstOpenDate)
    if (!built.ok) {
      const state = engineErrorsState(built.errors)
      logFailure(op, state)
      return state
    }
    if (built.hash !== input.previewHash) {
      return staleState(input, ctx, firstOpenDate, built.preview, built.hash)
    }

    const pending = built.warnings.filter((w) => !input.warningsAck.includes(w.key))
    if (pending.length > 0) {
      return {
        ok: false,
        code: 'needs_confirmation',
        message: CONFIRM_MESSAGE,
        warnings: pending.map(warningCopy),
      }
    }

    return await postBuiltBundle(op, slug, auth.tenantId, input.clientRef, built, ctx, form)
  } catch (error) {
    console.error(`[accounting.documents.${op}] inesperado`, errorName(error))
    return GENERIC
  }
}

/**
 * Pasos 6 a 8 de G.3 con un bundle ya armado (y ya comparado con la vista previa
 * que vio la persona): `acc_post_bundle` con SU bundle y `clientRef` (un reintento
 * con la misma referencia devuelve lo ya guardado), los avisos que solo ve la base
 * → `needs_confirmation`, la revalidación de la sección y el texto del toast.
 *
 * Lo usa también la emisión con ARCA (`lib/arca/emit.ts`): contabiliza la factura
 * autorizada con el `client_ref` de su fila de `acc_arca_vouchers`, así «Cargarla
 * ahora» nunca la guarda dos veces. Puede tirar si falla la red hacia la base:
 * quien llama lo envuelve (como `runPostDocument`).
 */
export async function postBuiltBundle(
  op: string,
  slug: string,
  tenantId: string,
  clientRef: string,
  built: Extract<PostingResult, { ok: true }>,
  ctx: PostingContext,
  form?: DocumentForm,
): Promise<AccActionState> {
  const supabase = await createClient()
  const args = {
    p_tenant_id: tenantId,
    p_client_ref: clientRef,
    p_bundle: toRpcPayload(built.bundle, built.hash),
  }
  let result = await supabase.rpc('acc_post_bundle', args)
  // Dos envíos iguales al mismo tiempo: el reintento devuelve lo que guardó el primero.
  if (result.error && isClientRefRace(result.error)) {
    result = await supabase.rpc('acc_post_bundle', args)
  }
  if (result.error) return postFailure(op, result.error, ctx)

  // Ya está guardado (la base confirmó): nada de acá en adelante puede volverlo un error.
  afterCommit(op, () => revalidateAdministracion(slug))
  const message = form ? afterCommit(op, () => savedMessage(form, built.bundle, ctx)) : null
  return {
    ok: true,
    result: parsePostBundleResult(result.data),
    message: message ?? SAVED_FALLBACK,
  }
}

// ─── Vista previa en el servidor ─────────────────────────────────────────────

/**
 * «Ver asiento» armado en el servidor, sin guardar nada: el asiento, su hash
 * (lo que el formulario manda como `previewHash`) y los avisos que va a pedir
 * confirmar. Sirve para los formularios que no tienen todo el contexto en el
 * navegador (partidas abiertas que se eligen después, la factura de comisiones).
 */
export async function runPreviewDocument(
  slug: unknown,
  request: unknown,
): Promise<PreviewBundleState> {
  const form = isRecord(request) ? request.form : null
  const op = `preview.${isDocumentForm(form) ? form : 'desconocido'}`
  try {
    if (typeof slug !== 'string' || slug === '') return forbiddenState()
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    if (!isRecord(request) || !isDocumentForm(form)) {
      return { ok: false, code: 'invalid', message: 'Revisá los datos.' }
    }

    const parsed = parseDocumentForm(form, withPreviewMeta(request.values))
    if (!parsed.ok) return invalidState(parsed.error)
    const input = parsed.value

    const loaded = await loadDocumentContext(auth.tenantId, input.refs)
    if (!loaded.ok) {
      logFailure(op, loaded.state)
      return loaded.state
    }
    const built = buildPrimary(input, loaded.ctx, loaded.firstOpenDate)
    if (!built.ok) return engineErrorsState(built.errors)
    return {
      ok: true,
      preview: built.preview,
      hash: built.hash,
      warnings: built.warnings.map(warningCopy),
    }
  } catch (error) {
    console.error(`[accounting.documents.${op}] inesperado`, errorName(error))
    return GENERIC
  }
}
