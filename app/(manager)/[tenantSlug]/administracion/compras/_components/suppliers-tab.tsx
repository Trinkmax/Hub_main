import { CalendarClock, CircleAlert, HandCoins, Truck, Wallet } from 'lucide-react'
import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import { plural } from '@/components/administracion/format'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
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
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import {
  exportHref,
  listParties,
  PARTY_KIND_LABELS,
  type PartyListRow,
  settleQuery,
} from '@/lib/accounting/queries'
import { formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { firstParam, newPurchaseHref, supplierHref } from '../_lib/links'
import {
  isVisibleSupplier,
  SUPPLIER_FILTERS,
  supplierFilterOf,
  supplierTotals,
} from '../_lib/suppliers'
import { BlockError } from './block-error'
import { BulkSuppliersDialog } from './bulk-suppliers-dialog'
import { ExportButton } from './export-button'
import { SearchFilter, SegmentFilter } from './list-filters'
import { PartyStatus } from './party-status'

function Dash() {
  return (
    <span className="text-muted-foreground/60">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Nada</span>
    </span>
  )
}

/** «30-71876543-5» · o el tipo si no es un proveedor común («Organismo»). */
function subtitle(row: PartyListRow): string | null {
  const parts: string[] = []
  if (row.partyKind !== 'supplier') parts.push(PARTY_KIND_LABELS[row.partyKind] ?? 'Otro')
  if (row.taxId) parts.push(`CUIT ${formatCuit(row.taxId)}`)
  if (!row.active) parts.push('Inactivo')
  return parts.length > 0 ? parts.join(' · ') : null
}

function displayName(row: PartyListRow): string {
  return row.tradeName && row.tradeName !== row.partyName
    ? `${row.tradeName} (${row.partyName})`
    : row.partyName
}

/**
 * «Proveedores» (H.7): números del grupo, buscador, segmentado, la tabla con
 * saldo, vencido, semáforo y última compra (tarjetas en el celular) y los
 * totales al pie.
 */
export async function SuppliersTab({
  tenantId,
  tenantSlug,
  sp,
  today,
  canWrite,
}: {
  tenantId: string
  tenantSlug: string
  sp: Readonly<Record<string, string | string[] | undefined>>
  today: string
  canWrite: boolean
}) {
  const q = firstParam(sp.q).slice(0, 80)
  const { value: filterValue, filter } = supplierFilterOf(firstParam(sp.filtro))
  const outcome = await settleQuery(listParties(tenantId, { group: 'payables', q, filter }))

  if (!outcome.ok) return <BlockError message={outcome.message} />

  const { totals } = outcome.data
  const rows = outcome.data.rows.filter((row) => isVisibleSupplier(row, filter))
  const foot = supplierTotals(rows)
  const hasQuery = q !== '' || filterValue !== 'todos'
  const exportLink = exportHref(tenantSlug, 'saldos-proveedores', { hasta: today })
  const existingNames = outcome.data.rows.map((row) => row.partyName)

  return (
    <div className="space-y-6">
      <section
        aria-label="Lo que le debés a proveedores"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          icon={Wallet}
          iconClassName="text-primary"
          label="Le debés"
          value={formatCentsShort(totals.debtCents)}
          hint={totals.debtCents > 0 ? 'Facturas sin pagar, a hoy' : 'No tenés facturas pendientes'}
        />
        <StatCard
          icon={CircleAlert}
          iconClassName={totals.overdueCents > 0 ? 'text-destructive' : 'text-muted-foreground'}
          label="Vencido"
          value={formatCentsShort(totals.overdueCents)}
          hint={totals.overdueCents > 0 ? 'Ya pasó el vencimiento' : 'Nada vencido'}
        />
        <StatCard
          icon={CalendarClock}
          iconClassName="text-warning"
          label="Vence en 7 días"
          value={formatCentsShort(totals.dueSoonCents)}
          hint="De hoy a una semana"
        />
        <StatCard
          icon={HandCoins}
          iconClassName="text-success"
          label="A favor sin aplicar"
          value={formatCentsShort(totals.creditCents)}
          hint={totals.creditCents > 0 ? 'Notas de crédito y pagos a cuenta' : 'Sin saldos a favor'}
        />
      </section>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentFilter
            options={SUPPLIER_FILTERS}
            value={filterValue}
            param="filtro"
            defaultValue="todos"
            label="Qué proveedores ver"
          />
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
            {canWrite ? (
              <BulkSuppliersDialog tenantSlug={tenantSlug} existingNames={existingNames} />
            ) : null}
            <ExportButton
              href={exportLink}
              fileName={`saldos-proveedores-${today}.csv`}
              label="Exportar saldos"
              className="h-11 md:h-9"
            />
          </div>
        </div>
        <SearchFilter placeholder="Proveedor o CUIT" />
      </div>

      {rows.length === 0 ? (
        hasQuery ? (
          <EmptyState
            icon={Truck}
            title="Sin resultados"
            description={
              q
                ? `No hay proveedores con «${q}» en esta vista. Probá con otro nombre o quitá el filtro.`
                : 'No hay proveedores en esta vista. Probá con «Todos».'
            }
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="Todavía no hay proveedores"
            description="Se crean solos cuando cargás una factura o un gasto, o cargalos todos de una con «Cargar una lista»."
            action={
              canWrite ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild className="h-11 gap-2 md:h-9">
                    <Link href={newPurchaseHref(tenantSlug)}>Cargar factura</Link>
                  </Button>
                  <ActionButton action="gasto" variant="outline" className="h-11 md:h-9" />
                  <BulkSuppliersDialog tenantSlug={tenantSlug} existingNames={existingNames} />
                </div>
              ) : null
            }
          />
        )
      ) : (
        <>
          {/* Compu y tablet. Las columnas se muestran según el ancho de la tabla
              (@container), no de la ventana: con la barra lateral abierta en
              1280 px «Última compra» no entra y apretaba el estado. */}
          <DataTableShell className="@container hidden sm:block">
            <DataTableScroll>
              <DataTableRoot>
                <caption className="sr-only">Proveedores con su saldo</caption>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Proveedor</DataTableHeader>
                    <DataTableHeader>Estado</DataTableHeader>
                    <DataTableHeader className="text-right">Le debés</DataTableHeader>
                    <DataTableHeader className="text-right">Vencido</DataTableHeader>
                    <DataTableHeader className="hidden @[59rem]:table-cell">
                      Próximo vencimiento
                    </DataTableHeader>
                    <DataTableHeader className="text-right">A favor</DataTableHeader>
                    <DataTableHeader className="hidden @[68rem]:table-cell">
                      Última compra
                    </DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((row) => {
                    const sub = subtitle(row)
                    return (
                      <tr
                        key={row.partyId}
                        className="group transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                      >
                        <DataTableCell className="max-w-[17rem]">
                          <Link
                            href={supplierHref(tenantSlug, row.partyId)}
                            title={displayName(row)}
                            className="block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="block truncate font-medium group-hover:text-primary">
                              {displayName(row)}
                            </span>
                            {sub ? (
                              <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                                {sub}
                              </span>
                            ) : null}
                          </Link>
                        </DataTableCell>
                        <DataTableCell className="min-w-44">
                          <PartyStatus light={row.trafficLight} text={row.trafficText} />
                        </DataTableCell>
                        <DataTableCell className="text-right">
                          {row.debtCents > 0 ? (
                            <Amount cents={row.debtCents} className="font-medium" />
                          ) : (
                            <Dash />
                          )}
                        </DataTableCell>
                        <DataTableCell className="text-right">
                          {row.overdueCents > 0 ? (
                            <Amount cents={row.overdueCents} className="text-destructive" />
                          ) : (
                            <Dash />
                          )}
                        </DataTableCell>
                        <DataTableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground @[59rem]:table-cell">
                          {row.nextDueDate ? formatIsoDay(row.nextDueDate) : <Dash />}
                        </DataTableCell>
                        <DataTableCell className="text-right">
                          {row.creditCents > 0 ? (
                            <Amount cents={row.creditCents} className="text-success" />
                          ) : (
                            <Dash />
                          )}
                        </DataTableCell>
                        <DataTableCell className="hidden whitespace-nowrap tabular-nums text-muted-foreground @[68rem]:table-cell">
                          {row.lastIncreaseDate ? formatIsoDay(row.lastIncreaseDate) : <Dash />}
                        </DataTableCell>
                      </tr>
                    )
                  })}
                </DataTableBody>
                <tfoot className="border-t border-border bg-secondary/30 font-semibold">
                  <tr>
                    <DataTableCell colSpan={2} className="text-xs">
                      Total
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={foot.debtCents} />
                    </DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount
                        cents={foot.overdueCents}
                        className={cn(foot.overdueCents > 0 && 'text-destructive')}
                      />
                    </DataTableCell>
                    <DataTableCell className="hidden @[59rem]:table-cell">{null}</DataTableCell>
                    <DataTableCell className="text-right">
                      <Amount cents={foot.creditCents} />
                    </DataTableCell>
                    <DataTableCell className="hidden @[68rem]:table-cell">{null}</DataTableCell>
                  </tr>
                </tfoot>
              </DataTableRoot>
            </DataTableScroll>
            <DataTableFooter>
              <span>
                Mostrando{' '}
                <strong className="tabular-nums text-foreground">
                  {plural(rows.length, 'proveedor', 'proveedores')}
                </strong>
              </span>
            </DataTableFooter>
          </DataTableShell>

          {/* Celular: tarjetas, con los mismos números que la tabla y la franja de
              arriba: «Le debés» son las facturas sin pagar y lo «A favor» va
              aparte (no se resta). Sin deuda ni saldo a favor, lo dice el estado. */}
          <div className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card sm:hidden">
            <ul aria-label="Proveedores con su saldo" className="divide-y divide-border/60">
              {rows.map((row) => {
                const sub = subtitle(row)
                return (
                  <li key={row.partyId}>
                    <Link
                      href={supplierHref(tenantSlug, row.partyId)}
                      className="flex min-h-11 items-start justify-between gap-3 px-4 py-3 outline-none focus-visible:bg-cream-tint active:bg-cream-tint"
                    >
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-pretty">
                          {displayName(row)}
                        </span>
                        {sub ? (
                          <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                            {sub}
                          </span>
                        ) : null}
                        <PartyStatus light={row.trafficLight} text={row.trafficText} />
                      </span>
                      {row.debtCents > 0 ? (
                        <span className="shrink-0 text-right text-sm">
                          <Amount cents={row.debtCents} balance="payable" />
                          {row.overdueCents > 0 ? (
                            <span className="mt-0.5 block text-[11px] text-destructive">
                              Vencido <Amount cents={row.overdueCents} />
                            </span>
                          ) : null}
                          {row.creditCents > 0 ? (
                            <span className="mt-0.5 block text-[11px] text-success">
                              A favor <Amount cents={row.creditCents} />
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-start justify-between gap-3 border-t border-border/60 bg-secondary/30 px-4 py-3 text-sm font-semibold">
              <span>Total</span>
              <span className="text-right">
                <Amount cents={foot.debtCents} balance="payable" />
                {foot.creditCents > 0 ? (
                  <span className="mt-0.5 block text-[11px] font-normal text-success">
                    A favor <Amount cents={foot.creditCents} />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
