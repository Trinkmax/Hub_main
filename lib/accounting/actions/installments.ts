'use server'

/**
 * Las cuotas de un pago con tarjeta (pedido de los socios, 16/11/2026). Se anotan DESPUÉS de guardar el
 * pago, para el paquete recién guardado: si el pago no salió de una tarjeta de crédito, la base no hace
 * nada. No mueve saldos.
 */

import { z } from 'zod'
import { authorizeAccounting } from '@/lib/accounting/access'
import { type AccSimpleState, invalidState } from '@/lib/accounting/action-state'
import { MAX_INSTALLMENTS } from '@/lib/accounting/installments'
import { createClient } from '@/lib/supabase/server'
import { asRecord, revalidateAccounting, rpcFailure, unexpectedFailure } from './support'

const schema = z.object({
  bundleId: z.uuid(),
  installments: z.number().int().min(1).max(MAX_INSTALLMENTS),
})

export async function setCardInstallments(
  slug: string,
  raw: unknown,
): Promise<AccSimpleState<{ documents: number }>> {
  const op = 'installments.set'
  try {
    // Las cuotas de una compra pagada con tarjeta: también con «solo compras y pagos».
    const auth = await authorizeAccounting(slug, 'buy_write')
    if (!auth.ok) return auth.state
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return invalidState(parsed.error)
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('acc_set_card_installments', {
      p_tenant_id: auth.tenantId,
      p_bundle_id: parsed.data.bundleId,
      p_installments: parsed.data.installments,
    })
    if (error) return rpcFailure(op, error)
    const documents = Number(asRecord(data)?.documents ?? 0)
    revalidateAccounting(slug)
    return {
      ok: true,
      data: { documents: Number.isFinite(documents) ? documents : 0 },
      message: '',
    }
  } catch (error) {
    return unexpectedFailure(op, error)
  }
}
