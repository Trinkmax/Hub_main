import 'server-only'
import { type PayrollReport, parsePayrollReport } from '@/lib/accounting/payroll'
import { AccQueryError, callRpc, QUERY_FAILED_MESSAGE } from './shared'

/**
 * La planilla de Sueldos de un mes (`acc_report_payroll`): los empleados con su sueldo, sus adelantos
 * y pagos con comprobante vigente, y el devengamiento del mes. La leen los dueños con acceso y la
 * contadora (`acc_assert_reader`).
 *
 * Se importa directo de este archivo (no del barrel). `month` es `yyyy-MM`.
 */
export async function getPayrollReport(tenantId: string, month: string): Promise<PayrollReport> {
  const raw = await callRpc('acc_report_payroll', {
    p_tenant_id: tenantId,
    p_month: `${month}-01`,
  })
  const report = parsePayrollReport(raw, month)
  if (!report) {
    console.error('[acc.query] acc_report_payroll', 'respuesta inesperada')
    throw new AccQueryError('acc_report_payroll', 'error', QUERY_FAILED_MESSAGE)
  }
  return report
}
