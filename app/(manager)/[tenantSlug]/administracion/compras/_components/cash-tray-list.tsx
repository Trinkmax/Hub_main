'use client'

import { useAccounting } from '@/components/administracion/accounting-provider'
import { PosCashTray } from '@/components/administracion/caja-salon/pos-cash-tray'
import { Button } from '@/components/ui/button'
import { type PosCashPending, posCashWho } from '@/lib/accounting/pos-cash'
import { formatCentsShort } from '@/lib/money'

/**
 * Qué se hace con cada retiro a un proveedor: las dos hojas de siempre, ya completas (`?retiro=`).
 *
 * - «Cargar la compra»: trajo mercadería y se pagó en el momento. Abre «Nuevo gasto» con el proveedor,
 *   el monto, la fecha y la caja de efectivo de esa sucursal: falta decir qué papel dieron.
 * - «Era un pago»: se pagó una compra que ya estaba cargada. Abre «Pagar» con lo mismo.
 *
 * Al guardar, el retiro queda atado a ese comprobante y sale de la lista.
 */
export function CashTrayList({
  tenantSlug,
  items,
  highlightId,
}: {
  tenantSlug: string
  items: readonly PosCashPending[]
  highlightId: string | null
}) {
  const { openAction } = useAccounting()
  const paramsOf = (item: PosCashPending) => ({
    retiro: item.id,
    ...(item.partyId ? { proveedor: item.partyId } : {}),
  })
  const whatOf = (item: PosCashPending) =>
    `${formatCentsShort(item.amountCents)} para ${posCashWho(item)}`
  return (
    <PosCashTray
      tenantSlug={tenantSlug}
      items={items}
      note="falta cargar su comprobante."
      highlightId={highlightId}
      actions={(item) => (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="bg-card pointer-coarse:h-11"
            title="Trajo mercadería y se pagó en el momento"
            aria-label={`Cargar la compra: ${whatOf(item)}`}
            onClick={() => openAction('gasto', paramsOf(item))}
          >
            Cargar la compra
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="bg-card pointer-coarse:h-11"
            title="Se pagó una compra que ya estaba cargada"
            aria-label={`Era un pago: ${whatOf(item)}`}
            onClick={() => openAction('pagar', paramsOf(item))}
          >
            Era un pago
          </Button>
        </>
      )}
    />
  )
}
