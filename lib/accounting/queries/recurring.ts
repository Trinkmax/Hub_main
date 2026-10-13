import 'server-only'
import type { RecurringPaymentFacts } from '@/lib/accounting/recurring-status'
import { callRpcRows, cents, day, dayOrNull, str } from './shared'

/**
 * Qué se pagó del último comprobante de cada gasto fijo (`acc_report_recurring_status`,
 * un solo viaje para toda la lista). La base usa la regla de siempre: la
 * partida del comprobante menos sus imputaciones vigentes (`acc_open_amount`),
 * la misma de «Comprobantes» y de la cuenta corriente del proveedor. Qué
 * vencimiento es y cómo se dice lo decide `lib/accounting/recurring-status.ts`.
 *
 * Por id de gasto fijo. Se importa directo de este archivo (no del barrel).
 */
export async function listRecurringPayments(
  tenantId: string,
): Promise<Map<string, RecurringPaymentFacts>> {
  const rows = await callRpcRows('acc_report_recurring_status', { p_tenant_id: tenantId })
  const out = new Map<string, RecurringPaymentFacts>()
  for (const row of rows) {
    const id = str(row.recurring_expense_id)
    if (!id) continue
    const documentId = str(row.document_id)
    out.set(id, {
      document: documentId
        ? {
            id: documentId,
            kind: str(row.document_kind),
            accountingDate: day(row.accounting_date),
            dueDate: dayOrNull(row.due_date),
            totalCents: cents(row.total_cents),
            paidCents: cents(row.paid_cents),
            openCents: cents(row.open_cents),
          }
        : null,
      priorOpenCents: cents(row.prior_open_cents),
    })
  }
  return out
}
