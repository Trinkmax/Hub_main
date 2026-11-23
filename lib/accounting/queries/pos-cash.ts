import 'server-only'
import { branchRpcParam } from '@/lib/accounting/branch'
import { type PosCashPending, parsePosCashPending } from '@/lib/accounting/pos-cash'
import { callRpc } from './shared'

/**
 * Lo que salió de la caja del salón y todavía no tiene comprobante (`acc_pos_cash_pending`): los
 * retiros que dicen para qué fueron (un proveedor, un adelanto, horas extra, un sueldo).
 *
 * La base decide qué ve cada uno (`acc_assert_buyer_writer`): quien tiene «solo compras y pagos», los
 * de proveedores; con acceso completo, también los del personal. La contadora no la puede llamar: es
 * plata del salón. Por eso se pide solo para quien carga (`canWrite`).
 *
 * Se importa directo de este archivo (no del barrel). Con `branchId`, solo los de esa sucursal.
 */
export async function listPosCashPending(
  tenantId: string,
  branchId: string | null = null,
): Promise<PosCashPending[]> {
  const raw = await callRpc('acc_pos_cash_pending', {
    p_tenant_id: tenantId,
    ...branchRpcParam(branchId),
  })
  return parsePosCashPending(raw)
}
