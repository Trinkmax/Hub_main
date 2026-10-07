import { Amount } from '@/components/administracion/amount'
import { ExportButton } from '@/components/administracion/cajas-ventas/export-button'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import type { NetByMethodRow } from '@/lib/accounting/queries/books'
import { CHANNEL_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'

function Cell({ cents }: { cents: number }) {
  return cents > 0 ? (
    <Amount cents={cents} />
  ) : (
    <span className="text-xs text-muted-foreground/60">—</span>
  )
}

/**
 * Neto real por medio de cobro (F.11, el pedido de Franco): lo vendido con
 * cada medio, lo que descontaron (comisión, IVA de la comisión, retenciones,
 * otros), lo que llegó y lo que falta acreditar, con el % de descuento.
 */
export function NetByMethod({
  rows,
  label,
  exportHref,
  exportFileName,
}: {
  rows: readonly NetByMethodRow[]
  label: string
  exportHref: string
  exportFileName: string
}) {
  const visible = rows.filter(
    (r) => r.soldCents !== 0 || r.creditedCents !== 0 || r.pendingCents !== 0,
  )
  return (
    <DataTableShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="max-w-2xl">
          <h2 className="font-serif text-lg font-semibold tracking-tight">
            Neto por medio de cobro
          </h2>
          <p className="text-xs text-muted-foreground text-pretty">
            {label} · El descuento es todo lo que te descontaron (comisión, IVA de la comisión,
            retenciones y otros cargos) sobre lo que ya se acreditó. Lo pendiente todavía no se
            liquidó.
          </p>
        </div>
        <ExportButton
          href={exportHref}
          fileName={exportFileName}
          size="sm"
          className="h-11 md:h-8"
        />
      </header>
      {visible.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          No hay ventas ni acreditaciones en este período.
        </p>
      ) : (
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Neto por medio de cobro, {label}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Medio</DataTableHeader>
                <DataTableHeader className="text-right">Vendido</DataTableHeader>
                <DataTableHeader className="text-right">Comisión</DataTableHeader>
                <DataTableHeader className="text-right">IVA comisión</DataTableHeader>
                <DataTableHeader className="text-right">Retenciones</DataTableHeader>
                <DataTableHeader className="text-right">Otros</DataTableHeader>
                <DataTableHeader className="text-right">Sin explicar</DataTableHeader>
                <DataTableHeader className="text-right">Acreditado</DataTableHeader>
                <DataTableHeader className="text-right">Pendiente</DataTableHeader>
                <DataTableHeader className="text-right">Descuento</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {visible.map((r) => (
                <tr
                  key={r.methodId}
                  className="transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-cream-tint"
                >
                  <DataTableCell>
                    <span className="block font-medium">{r.methodName}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {CHANNEL_LABELS[r.channel] ?? r.channel}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.soldCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.commissionCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.commissionVatCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.withholdingsCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.otherChargesCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.unexplainedCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.creditedCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Cell cents={r.pendingCents} />
                  </DataTableCell>
                  <DataTableCell className="text-right font-medium tabular-nums">
                    {r.discountBp === null ? (
                      <span className="text-xs font-normal text-muted-foreground/60">—</span>
                    ) : (
                      vatRateLabel(r.discountBp)
                    )}
                  </DataTableCell>
                </tr>
              ))}
            </DataTableBody>
          </DataTableRoot>
        </DataTableScroll>
      )}
    </DataTableShell>
  )
}
