import { CircleCheck } from 'lucide-react'
import Link from 'next/link'
import { AgingBar } from '@/components/administracion/aging-bar'
import { Amount } from '@/components/administracion/amount'
import { DueStatus } from '@/components/administracion/due-status'
import { plural } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { agingBuckets } from '@/lib/accounting/aging'
import type { OpenItemRow, PartyPosition } from '@/lib/accounting/queries'
import { formatIsoDay } from '@/lib/dates'
import { documentHref } from '../../../_lib/links'

function ItemLink({ tenantSlug, item }: { tenantSlug: string; item: OpenItemRow }) {
  return (
    <Link
      href={documentHref(tenantSlug, item.documentId)}
      className="rounded-sm font-medium underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {item.documentLabel}
    </Link>
  )
}

/**
 * «Pendientes» de un proveedor (H.7): la antigüedad de la deuda (barra con su
 * tabla) y cada factura sin pagar con su semáforo y [Pagar]; abajo, los saldos
 * a favor sin aplicar.
 */
export function PendingTab({
  tenantSlug,
  partyId,
  partyName,
  position,
  today,
}: {
  tenantSlug: string
  partyId: string
  partyName: string
  position: PartyPosition
  today: string
}) {
  const debts = position.debtItems
  const credits = position.creditItems

  if (debts.length === 0 && credits.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        title={`No le debés nada a ${partyName}`}
        description="Cuando le cargues una factura a cuenta corriente, va a aparecer acá hasta que la pagues."
        action={
          <ActionButton
            action="pagar"
            params={{ proveedor: partyId }}
            variant="outline"
            className="h-11 md:h-9"
          >
            Dejar un pago a cuenta
          </ActionButton>
        }
      />
    )
  }

  const buckets = agingBuckets(
    debts.map((i) => ({ dueDate: i.dueDate, openCents: i.openCents })),
    today,
  )

  return (
    <div className="space-y-6">
      {debts.length > 0 ? (
        <div className="card-hairline rounded-xl border bg-card">
          <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <h2 className="font-serif text-lg font-semibold tracking-tight">
                Antigüedad de la deuda
              </h2>
              <p className="text-xs text-muted-foreground">
                {plural(debts.length, 'factura pendiente', 'facturas pendientes')} a hoy
              </p>
            </div>
            <Amount cents={position.debtCents} className="font-medium" />
          </header>
          <div className="px-5 py-4">
            <AgingBar buckets={buckets} title="Deuda" />
          </div>
        </div>
      ) : null}

      {debts.length > 0 ? (
        <section aria-labelledby="pendientes-facturas" className="space-y-3">
          <h2
            id="pendientes-facturas"
            className="font-display text-base font-semibold tracking-tight"
          >
            Facturas sin pagar
          </h2>
          <DataTableShell className="hidden sm:block">
            <DataTableScroll>
              <DataTableRoot>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Comprobante</DataTableHeader>
                    <DataTableHeader className="w-28">Fecha</DataTableHeader>
                    <DataTableHeader>Vence</DataTableHeader>
                    <DataTableHeader className="text-right">Importe</DataTableHeader>
                    <DataTableHeader className="text-right">Pendiente</DataTableHeader>
                    <DataTableHeader className="text-right">
                      <span className="sr-only">Pagar</span>
                    </DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {debts.map((item) => (
                    <tr
                      key={item.lineId}
                      className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                    >
                      <DataTableCell>
                        <ItemLink tenantSlug={tenantSlug} item={item} />
                      </DataTableCell>
                      <DataTableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatIsoDay(item.entryDate)}
                      </DataTableCell>
                      <DataTableCell>
                        <DueStatus dueDate={item.dueDate} today={today} showDate />
                      </DataTableCell>
                      <DataTableCell className="text-right text-muted-foreground">
                        <Amount cents={item.amountCents} />
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <Amount cents={item.openCents} className="font-medium" />
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        <ActionButton
                          action="pagar"
                          params={{ proveedor: partyId, partida: item.lineId }}
                          variant="outline"
                          size="sm"
                          className="h-8"
                        >
                          Pagar
                        </ActionButton>
                      </DataTableCell>
                    </tr>
                  ))}
                </DataTableBody>
                <tfoot className="border-t border-border bg-secondary/30 font-semibold">
                  <tr>
                    <DataTableCell colSpan={4} className="text-xs">
                      Total pendiente
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={position.debtCents} />
                    </DataTableCell>
                    <DataTableCell>{null}</DataTableCell>
                  </tr>
                </tfoot>
              </DataTableRoot>
            </DataTableScroll>
          </DataTableShell>
          <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
            <ul aria-label="Facturas sin pagar" className="divide-y divide-border/60">
              {debts.map((item) => (
                <li key={item.lineId} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-sm">
                        <ItemLink tenantSlug={tenantSlug} item={item} />
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatIsoDay(item.entryDate)}
                      </p>
                      <DueStatus dueDate={item.dueDate} today={today} />
                    </div>
                    <div className="shrink-0 text-right">
                      <Amount cents={item.openCents} block className="text-sm font-medium" />
                      {item.openCents !== item.amountCents ? (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          de <Amount cents={item.amountCents} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ActionButton
                    action="pagar"
                    params={{ proveedor: partyId, partida: item.lineId }}
                    variant="outline"
                    className="h-11 w-full"
                  >
                    Pagar esta factura
                  </ActionButton>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {credits.length > 0 ? (
        <section aria-labelledby="pendientes-a-favor" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2
              id="pendientes-a-favor"
              className="font-display text-base font-semibold tracking-tight"
            >
              Saldos a favor sin aplicar
            </h2>
            <p className="text-xs text-muted-foreground">Se usan solos en el próximo pago</p>
          </div>
          <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card">
            <ul aria-label="Saldos a favor" className="divide-y divide-border/60">
              {credits.map((item) => (
                <li key={item.lineId} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm">
                      <ItemLink tenantSlug={tenantSlug} item={item} />
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatIsoDay(item.entryDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Amount
                      cents={item.openCents}
                      block
                      className="text-sm font-medium text-success"
                    />
                    {item.openCents !== item.amountCents ? (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        de <Amount cents={item.amountCents} />
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-secondary/30 px-4 py-3 text-sm font-semibold">
              <span>Total a favor</span>
              <Amount cents={position.creditCents} />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
