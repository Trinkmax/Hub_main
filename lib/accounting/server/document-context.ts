import 'server-only'

/**
 * El contexto con que la acción (y la vista previa del servidor) arma un
 * comprobante: el de `lib/accounting/context.ts` (catálogo + partidas
 * referenciadas, DESDE LA BASE) más el primer día abierto, que mueve la fecha
 * contable de un gasto o una compra cargados con fecha de un mes cerrado
 * («Septiembre está cerrado: lo cargamos el 01/10», H.5).
 */

import { cache } from 'react'
import type { AccFailureState } from '@/lib/accounting/action-state'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingContextRefs,
  tryLoadPostingContext,
} from '@/lib/accounting/context'
import { ACC_GENERIC_ERROR } from '@/lib/accounting/errors'
import type { IsoDate, PostingContext } from '@/lib/accounting/types'
import { addDays, isRealIsoDay } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import type { DocumentRefs } from './document-refs'

export type DocumentContext =
  | { ok: true; ctx: PostingContext; firstOpenDate: IsoDate | null }
  | { ok: false; state: AccFailureState }

/**
 * El primer día del primer mes abierto: el día después del último mes
 * cerrado. Los meses se cierran en orden y solo se reabre el último
 * (C.5.1–C.5.2), así que los cerrados son siempre un prefijo. `null` si no hay
 * ninguno cerrado (o si no se pudo leer: la RPC igual vuelve a controlar el
 * período de cada comprobante).
 *
 * Una página que arma la vista previa en el navegador lo carga junto con
 * `loadPostingContext` y se lo pasa al formulario para `previewDocumentForm`
 * (`opts.firstOpenDate`): así la vista previa ya muestra la fecha corrida.
 * Cacheado por request.
 */
export const loadFirstOpenDate = cache(async (tenantId: string): Promise<IsoDate | null> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('acc_periods')
      .select('ends_on')
      .eq('tenant_id', tenantId)
      .eq('kind', 'month')
      .eq('status', 'closed')
      .order('month', { ascending: false })
      .limit(1)
    if (error) {
      console.error('[accounting.documents] primer día abierto', error.code, error.message)
      return null
    }
    const row = Array.isArray(data) ? (data[0] as { ends_on?: unknown } | undefined) : undefined
    const endsOn = row?.ends_on
    return typeof endsOn === 'string' && isRealIsoDay(endsOn) ? addDays(endsOn, 1) : null
  } catch (error) {
    console.error(
      '[accounting.documents] primer día abierto',
      error instanceof Error ? error.message : 'unknown',
    )
    return null
  }
})

/**
 * Las referencias del formulario → las de `loadPostingContext`. La factura de
 * comisiones trae solo las partidas abiertas de «IVA a documentar» del
 * partícipe (no toda su cuenta corriente: Mercado Pago puede tener miles).
 */
async function contextRefsFor(tenantId: string, refs: DocumentRefs): Promise<PostingContextRefs> {
  const out: PostingContextRefs = { lineIds: refs.lineIds }
  if (refs.commissionPartyId) {
    const catalog = await loadPostingCatalog(tenantId)
    const pending = catalog.accounts.find((a) => a.systemKey === 'vat_credit_pending')
    out.openItemsOf = [{ partyId: refs.commissionPartyId, accountId: pending?.id ?? null }]
  }
  return out
}

/** Contexto + primer día abierto, sin tirar: el error va directo a la acción. */
export async function loadDocumentContext(
  tenantId: string,
  refs: DocumentRefs,
): Promise<DocumentContext> {
  let contextRefs: PostingContextRefs
  try {
    contextRefs = await contextRefsFor(tenantId, refs)
  } catch (error) {
    if (error instanceof AccountingContextError) return { ok: false, state: error.state }
    console.error(
      '[accounting.documents] contexto',
      error instanceof Error ? error.message : 'unknown',
    )
    return { ok: false, state: { ok: false, code: 'error', message: ACC_GENERIC_ERROR } }
  }
  const [loaded, firstOpenDate] = await Promise.all([
    tryLoadPostingContext(tenantId, contextRefs),
    loadFirstOpenDate(tenantId),
  ])
  if (!loaded.ok) return loaded
  return { ok: true, ctx: loaded.ctx, firstOpenDate }
}
