'use client'

import { toast } from 'sonner'
import { setCardInstallments } from '@/lib/accounting/actions/installments'

/**
 * Anota las cuotas del pago recién guardado. Va después de guardar: si falla, el pago ya quedó y se
 * avisa que las cuotas no (no es un motivo para deshacer el pago).
 */
export async function saveCardInstallments(
  tenantSlug: string,
  bundleId: string | null | undefined,
  installments: number,
): Promise<void> {
  if (!bundleId || installments <= 1) return
  const missed = 'El pago quedó cargado, pero no se guardó en cuántas cuotas.'
  try {
    const result = await setCardInstallments(tenantSlug, { bundleId, installments })
    if (!result.ok) toast.error(missed)
  } catch {
    toast.error(missed)
  }
}
