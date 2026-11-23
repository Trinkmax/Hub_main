import { posCashFor } from '@/lib/accounting/pos-cash'
import { settleQuery } from '@/lib/accounting/queries'
import { listPosCashPending } from '@/lib/accounting/queries/pos-cash'
import { CashTrayList } from './cash-tray-list'

/**
 * «De la caja del salón», en Compras: los retiros que alguien anotó en la caja como pago a un proveedor
 * y que todavía no tienen comprobante. Solo para quien carga, y solo si hay alguno.
 *
 * Es un atajo, no un dato de la pantalla: si no se puede leer (la base todavía no lo tiene, o no le
 * toca a esta persona), no se dibuja nada y Compras sigue igual.
 *
 * Con `highlightId` (se llegó desde la caja del salón con `?caja=<retiro>`) se muestran los de todas
 * las sucursales: ese retiro tiene que estar a la vista aunque se esté mirando otra.
 */
export async function ComprasCashTray({
  tenantId,
  tenantSlug,
  branchId,
  highlightId,
}: {
  tenantId: string
  tenantSlug: string
  /** La sucursal que se mira; `null` = todas. */
  branchId: string | null
  highlightId: string | null
}) {
  const outcome = await settleQuery(listPosCashPending(tenantId, highlightId ? null : branchId))
  if (!outcome.ok) return null
  const items = posCashFor(outcome.data, 'suppliers')
  if (items.length === 0) return null
  return <CashTrayList tenantSlug={tenantSlug} items={items} highlightId={highlightId} />
}
