import { Trophy } from 'lucide-react'
import Link from 'next/link'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import type { TopCustomerRow } from '@/lib/stats/queries'

function fmtCents(cents: number) {
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function TopCustomersCard({
  tenantSlug,
  customers,
}: {
  tenantSlug: string
  customers: TopCustomerRow[]
}) {
  return (
    <div className="card-hairline relative overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">
            Top clientes del mes
          </h2>
          <p className="text-xs text-muted-foreground">Por consumo total</p>
        </div>
        <Link
          href={`/${tenantSlug}/clientes`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver todos →
        </Link>
      </header>

      <div className="border-t border-border/60">
        {customers.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Todavía no hay top"
            description="Cuando cierres mesas, los mejores clientes van a aparecer acá."
            className="m-3 border-0 bg-transparent py-8"
          />
        ) : (
          <ol className="divide-y divide-border/60">
            {customers.map((customer, index) => {
              const initials =
                `${customer.first_name?.[0] ?? ''}${customer.last_name?.[0] ?? ''}`.toUpperCase() ||
                '?'
              return (
                <li key={customer.customer_id}>
                  <Link
                    href={`/${tenantSlug}/clientes/${customer.customer_id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/40"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums ${
                        index === 0
                          ? 'bg-warning text-warning-foreground'
                          : index === 1
                            ? 'bg-secondary text-foreground'
                            : index === 2
                              ? 'bg-accent text-accent-foreground'
                              : 'bg-secondary/60 text-muted-foreground'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-secondary text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {customer.first_name} {customer.last_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {customer.total_visits} visitas
                        {customer.favorite_item_name ? ` · ${customer.favorite_item_name}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-sm font-semibold tabular-nums">
                      {fmtCents(customer.total_spent_cents)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
