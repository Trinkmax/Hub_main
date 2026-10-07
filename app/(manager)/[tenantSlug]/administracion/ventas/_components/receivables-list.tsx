import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { TrafficStatus } from '@/components/administracion/cajas-ventas/traffic-status'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { PARTY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import type { PartyListRow } from '@/lib/accounting/queries/parties'
import { formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'

function displayName(row: Pick<PartyListRow, 'partyName' | 'tradeName'>): string {
  return row.tradeName && row.tradeName !== row.partyName ? row.tradeName : row.partyName
}

/** Lo que tiene a favor: el cliente (anticipos, NC) o la plataforma («le debemos»). */
function creditText(row: PartyListRow): string | null {
  if (row.creditCents <= 0) return null
  const amount = formatCents(row.creditCents)
  return row.partyKind === 'customer' ? `A favor ${amount}` : `Le debemos ${amount}`
}

/**
 * «Clientes y plataformas» (H.9): Posnet, billeteras, plataformas y empresas
 * con su estado («PedidosYa está atrasada 5 días»), lo que te deben, lo
 * vencido, la próxima acreditación y lo que tienen a favor. Tabla en la compu,
 * tarjetas en el celular. Server-safe.
 */
export function ReceivablesList({
  rows,
  total,
  base,
}: {
  rows: readonly PartyListRow[]
  total: number
  base: string
}) {
  return (
    <>
      <DataTableShell className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Lo que te deben tus clientes y plataformas</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Cliente o plataforma</DataTableHeader>
                <DataTableHeader>Estado</DataTableHeader>
                <DataTableHeader className="text-right">Te debe</DataTableHeader>
                <DataTableHeader className="text-right">Vencido</DataTableHeader>
                <DataTableHeader>Próxima acreditación</DataTableHeader>
                <DataTableHeader className="text-right">A favor</DataTableHeader>
                <DataTableHeader className="w-8" />
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <tr
                  key={row.partyId}
                  className="group transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                >
                  <DataTableCell>
                    <Link
                      href={`${base}/ventas/clientes/${row.partyId}`}
                      className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block truncate font-medium group-hover:text-primary">
                        {displayName(row)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {PARTY_KIND_LABELS[row.partyKind] ?? 'Cliente'}
                        {row.active ? '' : ' · desactivado'}
                      </span>
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <TrafficStatus light={row.trafficLight} text={row.trafficText} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    {row.debtCents > 0 ? (
                      <Amount cents={row.debtCents} />
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin deuda</span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    {row.overdueCents > 0 ? (
                      <Amount cents={row.overdueCents} className="text-destructive" />
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {row.nextDueDate ? formatIsoDay(row.nextDueDate) : '—'}
                  </DataTableCell>
                  <DataTableCell className="text-right text-xs text-muted-foreground">
                    {creditText(row) ?? <span className="text-muted-foreground/60">—</span>}
                  </DataTableCell>
                  <DataTableCell className="w-8 text-muted-foreground/30 transition-opacity group-hover:text-muted-foreground">
                    <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </DataTableCell>
                </tr>
              ))}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
        <DataTableFooter>
          <span>
            Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
            <strong className="tabular-nums text-foreground">{total}</strong>
          </span>
        </DataTableFooter>
      </DataTableShell>

      <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
        <ul
          aria-label="Lo que te deben tus clientes y plataformas"
          className="divide-y divide-border/60"
        >
          {rows.map((row) => {
            const credit = creditText(row)
            return (
              <li key={row.partyId}>
                <Link
                  href={`${base}/ventas/clientes/${row.partyId}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-cream-tint focus-visible:bg-cream-tint"
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block truncate text-sm font-medium">{displayName(row)}</span>
                    <TrafficStatus light={row.trafficLight} text={row.trafficText} />
                    {row.nextDueDate || credit ? (
                      <span className="block text-xs text-muted-foreground">
                        {[
                          row.nextDueDate
                            ? `Próxima acreditación ${formatIsoDay(row.nextDueDate)}`
                            : null,
                          credit,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    {row.debtCents > 0 ? (
                      <Amount cents={row.debtCents} className="text-sm font-medium" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin deuda</span>
                    )}
                    {row.overdueCents > 0 ? (
                      <span className="block text-[11px] tabular-nums text-destructive">
                        {formatCents(row.overdueCents)} vencido
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="border-t border-border/60 bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground">
          Mostrando <strong className="tabular-nums text-foreground">{rows.length}</strong> de{' '}
          <strong className="tabular-nums text-foreground">{total}</strong>
        </div>
      </div>
    </>
  )
}
