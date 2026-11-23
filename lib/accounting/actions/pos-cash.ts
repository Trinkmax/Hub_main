'use server'

/**
 * Las acciones de la bandeja «De la caja del salón» (`lib/accounting/pos-cash.ts`).
 *
 * - `linkPosCash`: ata un retiro al comprobante que se está por guardar (`acc_pos_cash_link`). Se llama
 *   ANTES de guardar, con el `clientRef` del formulario: si el comprobante no se guarda, el retiro sigue
 *   esperando; si se guarda, deja de esperar solo. No carga nada por su cuenta.
 * - `dismissPosCash`: «esto no va a los libros» (`acc_pos_cash_dismiss`, que audita adentro).
 * - `loadPosCash`: un retiro por su id, para abrir un formulario ya completo. `null` si ya no espera.
 *
 * Alcanza con cargar compras (`buy_write`): los retiros a proveedores los pasa también quien tiene «solo
 * compras y pagos». La base lo vuelve a decidir retiro por retiro: los del personal piden acceso
 * completo. Nunca se loguean nombres ni importes: solo la operación y el código.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { ACC_GENERIC_ERROR, mapAccError } from '@/lib/accounting/errors'
import {
  type PosCashIdValues,
  type PosCashLinkValues,
  type PosCashPending,
  posCashIdSchema,
  posCashLinkSchema,
} from '@/lib/accounting/pos-cash'
import { listPosCashPending } from '@/lib/accounting/queries/pos-cash'
import { AccQueryError } from '@/lib/accounting/queries/shared'
import {
  afterCommit,
  errorName,
  logFailure,
  revalidateAdministracion,
} from '@/lib/accounting/server/post-document'
import { createClient } from '@/lib/supabase/server'

const GENERIC: AccFailureState = { ok: false, code: 'error', message: ACC_GENERIC_ERROR }

/** Una RPC con la sesión de la persona; su error vuelve listo para mostrar. */
async function callFailure(
  op: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<AccFailureState | null> {
  const supabase = await createClient()
  const { error } = await supabase.rpc(fn, args)
  if (!error) return null
  const state = mapAccError(error)
  logFailure(op, state, error.code)
  return state
}

/** Atar un retiro al comprobante que se está por guardar. */
export async function linkPosCash(slug: string, input: PosCashLinkValues): Promise<AccSimpleState> {
  try {
    const auth = await authorizeAccounting(slug, 'buy_write')
    if (!auth.ok) return auth.state
    const parsed = posCashLinkSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const failure = await callFailure('pos_cash.link', 'acc_pos_cash_link', {
      p_tenant_id: auth.tenantId,
      p_movement_id: parsed.data.movementId,
      p_client_ref: parsed.data.clientRef,
    })
    if (failure) return failure
    return { ok: true, data: undefined, message: '' }
  } catch (error) {
    console.error('[accounting.pos_cash.link] inesperado', errorName(error))
    return GENERIC
  }
}

/** «Esto no va a los libros». */
export async function dismissPosCash(
  slug: string,
  input: PosCashIdValues,
): Promise<AccSimpleState> {
  try {
    const auth = await authorizeAccounting(slug, 'buy_write')
    if (!auth.ok) return auth.state
    const parsed = posCashIdSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const failure = await callFailure('pos_cash.dismiss', 'acc_pos_cash_dismiss', {
      p_tenant_id: auth.tenantId,
      p_movement_id: parsed.data.movementId,
    })
    if (failure) return failure
    afterCommit('pos_cash.dismiss', () => revalidateAdministracion(slug))
    return { ok: true, data: undefined, message: 'Listo, no va a los libros.' }
  } catch (error) {
    console.error('[accounting.pos_cash.dismiss] inesperado', errorName(error))
    return GENERIC
  }
}

/** Un retiro que espera, por su id. `null`: ya tiene comprobante, se descartó o no es de esta persona. */
export async function loadPosCash(
  slug: string,
  input: PosCashIdValues,
): Promise<AccSimpleState<PosCashPending | null>> {
  try {
    const auth = await authorizeAccounting(slug, 'buy_write')
    if (!auth.ok) return auth.state
    const parsed = posCashIdSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const pending = await listPosCashPending(auth.tenantId)
    const found = pending.find((item) => item.id === parsed.data.movementId) ?? null
    return { ok: true, data: found, message: '' }
  } catch (error) {
    if (error instanceof AccQueryError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('[accounting.pos_cash.load] inesperado', errorName(error))
    return GENERIC
  }
}
