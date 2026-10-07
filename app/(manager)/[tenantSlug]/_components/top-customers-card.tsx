import { Trophy } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Section } from '@/components/ui/section'
import { formatNumber } from '@/lib/format/number-kind'
import type { TopCustomerRow } from '@/lib/stats/queries'

function fullName(customer: TopCustomerRow): string {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Sin nombre'
}

function visitsLine(customer: TopCustomerRow): string {
  const visits = `${formatNumber(customer.total_visits)} ${customer.total_visits === 1 ? 'visita' : 'visitas'}`
  return customer.favorite_item_name ? `${visits} · ${customer.favorite_item_name}` : visits
}

/**
 * Los clientes que más consumieron. `total_spent_cents` sale de
 * `v_customer_stats`, que suma TODAS las visitas: es el consumo histórico, no
 * el del mes (el título de antes decía «del mes»).
 */
export function TopCustomersCard({
  tenantSlug,
  customers,
  className,
}: {
  tenantSlug: string
  customers: TopCustomerRow[]
  className?: string
}) {
  return (
    <Section
      className={className}
      title="Mejores clientes"
      description="Por consumo total, desde su primera visita"
      actions={
        <Button asChild variant="link" size="sm">
          <Link href={`/${tenantSlug}/clientes`}>Ver todos</Link>
        </Button>
      }
    >
      <DataTable
        caption="Mejores clientes por consumo total"
        rows={customers}
        getRowId={(customer) => customer.customer_id}
        rowHref={(customer) => `/${tenantSlug}/clientes/${customer.customer_id}`}
        columns={[
          {
            id: 'cliente',
            header: 'Cliente',
            // Sin `rowLabel`: el link de la fila se nombra con todo el contenido
            // de la celda (puesto, nombre, visitas y lo que más pide).
            cell: (customer, index) => (
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="w-4 shrink-0 text-end type-caption tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-pretty">{fullName(customer)}</span>
                  <span className="type-caption font-normal text-pretty text-muted-foreground">
                    {visitsLine(customer)}
                  </span>
                </span>
              </span>
            ),
          },
          {
            id: 'consumo',
            header: 'Consumo $',
            numeric: true,
            cell: (customer) => (
              <Amount cents={customer.total_spent_cents} decimals={0} currency={false} />
            ),
          },
        ]}
        empty={
          <EmptyState
            size="sm"
            icon={Trophy}
            title="Todavía no hay ranking"
            description="Cuando registres consumos a nombre de tus clientes, los que más gastan van a aparecer acá."
          />
        }
      />
    </Section>
  )
}
