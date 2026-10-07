import type * as React from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DataTable } from '@/components/ui/data-table'
import type { CustomerListRow } from '@/lib/customers/queries'
import { formatDate, todayInCordoba } from '@/lib/dates'
import { formatNumber } from '@/lib/format/number-kind'
import { formatPhoneForDisplay } from '@/lib/phone'
import { customerInitials, relativeDayLabel } from './customer-meta'
import { TagPill } from './tag-pill'

/**
 * La lista de clientes (kit HUB §3.6 y §5.2): `DataTable` declarativo, filas
 * que son links a la ficha (una sola parada de Tab por fila) y tarjetas en el
 * celular. Server Component: las celdas se arman en el server.
 */
export function CustomersTable({
  rows,
  tenantSlug,
  toolbar,
  empty,
  pagination,
}: {
  rows: CustomerListRow[]
  tenantSlug: string
  toolbar?: React.ReactNode
  empty?: React.ReactNode
  pagination?: React.ReactNode
}) {
  const today = todayInCordoba()

  return (
    <DataTable<CustomerListRow>
      caption="Clientes"
      rows={rows}
      getRowId={(c) => c.id}
      rowHref={(c) => `/${tenantSlug}/clientes/${c.id}`}
      rowLabel={(c) => `${c.first_name} ${c.last_name}`.trim() || 'Cliente sin nombre'}
      toolbar={toolbar}
      empty={empty}
      pagination={pagination}
      columns={[
        {
          id: 'cliente',
          header: 'Cliente',
          mobile: 'primary',
          cell: (c) => (
            <span className="flex min-w-0 items-center gap-3">
              <Avatar size="sm" className="shrink-0">
                <AvatarFallback className="bg-brand-soft font-semibold text-brand-text">
                  {customerInitials(c.first_name, c.last_name)}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">
                  {c.first_name} {c.last_name}
                </span>
                {c.total_visits > 0 ? (
                  <span className="type-caption font-normal type-amount text-muted-foreground">
                    {formatNumber(c.total_visits)} {c.total_visits === 1 ? 'visita' : 'visitas'}
                  </span>
                ) : null}
              </span>
            </span>
          ),
        },
        {
          id: 'telefono',
          header: 'Teléfono',
          mobile: 'secondary',
          cell: (c) => (
            <span className="type-amount text-muted-foreground">
              {formatPhoneForDisplay(c.phone)}
            </span>
          ),
        },
        {
          id: 'etiquetas',
          header: 'Etiquetas',
          mobile: 'meta',
          hideBelow: 'lg',
          cell: (c) =>
            c.tags.length === 0 ? (
              <span className="text-subtle-foreground">
                <span aria-hidden="true">—</span>
                <span className="sr-only">Sin etiquetas</span>
              </span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <TagPill key={t.id} tag={t} />
                ))}
              </span>
            ),
        },
        {
          id: 'ultima-visita',
          header: 'Última visita',
          mobile: 'meta',
          cell: (c) => {
            const label = relativeDayLabel(c.last_visit_at, today)
            return label ? (
              <span className="text-muted-foreground" title={formatDate(c.last_visit_at)}>
                {label}
              </span>
            ) : (
              <span className="text-subtle-foreground">Sin visitas todavía</span>
            )
          },
        },
        {
          id: 'puntos',
          header: 'Puntos',
          numeric: true,
          width: '6rem',
          cell: (c) => (
            <span className={c.points_balance > 0 ? 'font-medium' : 'text-subtle-foreground'}>
              {formatNumber(c.points_balance)}
              <span className="sr-only"> puntos</span>
            </span>
          ),
        },
      ]}
    />
  )
}
