import 'server-only'

import { readerClient } from './shared'

/** Los que entran en una consulta (una página de movimientos trae hasta 500). */
const MAX_IDS = 500

/**
 * En cuántas cuotas se pagó con tarjeta un comprobante; `null` si fue un solo pago (o no fue con
 * tarjeta). Una lectura de adorno: si falla no rompe la ficha, se toma como «sin cuotas».
 */
export async function getCardInstallments(
  tenantId: string,
  documentIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(documentIds)].slice(0, MAX_IDS)
  if (ids.length === 0) return out
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_card_installments')
    .select('document_id, installments')
    .eq('tenant_id', tenantId)
    .in('document_id', ids)
  if (error) {
    // Si el código llegó antes que la tabla (PGRST205 / 42P01), es «sin cuotas» y no un error.
    if (error.code !== 'PGRST205' && error.code !== '42P01') {
      console.error('[accounting.card-installments]', error.code ?? 'sin_codigo')
    }
    return out
  }
  for (const row of (data ?? []) as { document_id: string; installments: number }[]) {
    if (typeof row.document_id === 'string' && Number.isInteger(row.installments)) {
      out.set(row.document_id, row.installments)
    }
  }
  return out
}
