import { User2 } from 'lucide-react'
import type { CustomerByQr } from '@/lib/customers/queries'
import { formatPhoneForDisplay } from '@/lib/phone'

/** Ficha del socio recién escaneado: quién es, en qué nivel está y cuánto tiene. */
export function CustomerHeader({ customer }: { customer: CustomerByQr }) {
  const tierColor = customer.tier?.color
  return (
    <div className="card-hairline rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
          <User2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold leading-tight">
            {customer.first_name} {customer.last_name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {customer.tier ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={
                  tierColor
                    ? { backgroundColor: `${tierColor}22`, color: tierColor }
                    : { backgroundColor: 'var(--secondary)' }
                }
              >
                {customer.tier.name}
              </span>
            ) : null}
            <span className="font-mono text-xs text-muted-foreground">
              {formatPhoneForDisplay(customer.phone)}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Puntos</p>
          <p className="font-display text-xl font-semibold tabular-nums leading-none">
            {customer.points_balance.toLocaleString('es-AR')}
          </p>
        </div>
      </div>
    </div>
  )
}
