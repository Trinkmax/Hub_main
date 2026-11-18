import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { formatCentsShort } from '@/lib/money/format'
import type { SalesDay } from '@/lib/pos/today/types'

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/**
 * Lo vendido hoy en el salón, para un bar con punto de venta. Es la puerta a «Hoy en vivo» (el
 * detalle del día: por sucursal, por medio de pago, las cajas), que ya no tiene entrada propia en el
 * menú: se llega desde acá.
 */
export function PosTodayCard({
  tenantSlug,
  sales,
}: {
  tenantSlug: string
  sales: SalesDay | null
}) {
  const sold = sales?.salesCents ?? 0
  return (
    <Link
      href={`/${tenantSlug}/local/hoy`}
      aria-label="Ver cómo va el día en el salón"
      className="card-hairline group flex flex-wrap items-end justify-between gap-x-6 gap-y-2 rounded-2xl border bg-card px-5 py-4 transition-colors hover:bg-card/70 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Vendido hoy en el salón
        </p>
        <p className="mt-1 font-serif text-4xl font-semibold leading-none tracking-tight tabular-nums">
          {formatCentsShort(sold)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {sales && sales.payments > 0
            ? `En ${count(sales.payments, 'cobro', 'cobros')} de ${count(sales.tables, 'mesa', 'mesas')}${sales.people > 0 ? `, ${count(sales.people, 'persona', 'personas')}` : ''}.`
            : 'Todavía no se cobró nada.'}
        </p>
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground group-hover:text-foreground">
        Ver el día
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
