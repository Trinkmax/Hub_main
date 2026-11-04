import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { invoicedSplit } from '@/lib/accounting/home'
import { getMonthSpending, settleQuery } from '@/lib/accounting/queries'
import { daysBetween } from '@/lib/dates'
import { NBSP } from '@/lib/money'

/** Hasta cuántos días se pide el total: más que eso cuesta demasiados viajes a la base. */
const SPLIT_MAX_DAYS = 92

/**
 * Cuánto se compró en el período, con factura y sin factura (reunión del 12/10/2026): el mismo número
 * que sale de `invoicedSplit`. Un solo libro: ninguno de los dos es alarma, y lo sin factura queda
 * registrado igual; lo único que cambia es que no entra al Libro IVA.
 *
 * Es un agregado de la lista: si el período es largo, no hay nada o falló la lectura, no se dibuja y
 * la lista sigue andando (`settleQuery` ya dejó el error en el log).
 */
export async function InvoicedTotals({
  tenantId,
  from,
  to,
}: {
  tenantId: string
  from: string
  to: string
}) {
  if (daysBetween(from, to) + 1 > SPLIT_MAX_DAYS) return null
  const outcome = await settleQuery(getMonthSpending(tenantId, { from, to }))
  if (!outcome.ok || outcome.data.truncated) return null
  const split = invoicedSplit(outcome.data.vouchers)
  if (split.isEmpty) return null
  const share = Math.round(split.invoicedPercent)
  return (
    <Totalizer
      items={[
        { label: 'Compraste y gastaste', cents: split.totalCents },
        { label: 'Con factura', cents: split.invoicedCents, hint: `${share}${NBSP}%` },
        { label: 'Sin factura', cents: split.notInvoicedCents, hint: `${100 - share}${NBSP}%` },
      ]}
    />
  )
}
