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
import { formatCents } from '@/lib/money'

/** Los descuentos: una columna solo si algún medio del período la tiene (como el Libro IVA). */
const DEDUCTIONS = [
  { key: 'commissionCents', label: 'Comisión' },
  { key: 'commissionVatCents', label: 'IVA comisión' },
  { key: 'withholdingsCents', label: 'Retenciones' },
  { key: 'otherChargesCents', label: 'Otros' },
  { key: 'unexplainedCents', label: 'Sin explicar' },
] as const satisfies ReadonlyArray<{ key: keyof NetByMethodRow; label: string }>

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
  // Diez columnas no entran al lado del menú: las de descuentos vacías no se muestran
  // (y las celdas van más juntas que en una lista).
  const deductions = DEDUCTIONS.filter((d) => visible.some((r) => r[d.key] !== 0))
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
        <>
          {/* Compu y tablet: la tabla completa. */}
          <div className="hidden sm:block">
            <DataTableScroll>
              <DataTableRoot>
                <caption className="sr-only">Neto por medio de cobro, {label}</caption>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Medio</DataTableHeader>
                    <DataTableHeader className="px-2.5 text-right">Vendido</DataTableHeader>
                    {deductions.map((d) => (
                      <DataTableHeader key={d.key} className="px-2.5 text-right">
                        {d.label}
                      </DataTableHeader>
                    ))}
                    <DataTableHeader className="px-2.5 text-right">Acreditado</DataTableHeader>
                    <DataTableHeader className="px-2.5 text-right">Pendiente</DataTableHeader>
                    <DataTableHeader className="px-2.5 text-right">Descuento</DataTableHeader>
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
                      <DataTableCell className="px-2.5 text-right">
                        <Cell cents={r.soldCents} />
                      </DataTableCell>
                      {deductions.map((d) => (
                        <DataTableCell key={d.key} className="px-2.5 text-right">
                          <Cell cents={r[d.key]} />
                        </DataTableCell>
                      ))}
                      <DataTableCell className="px-2.5 text-right">
                        <Cell cents={r.creditedCents} />
                      </DataTableCell>
                      <DataTableCell className="px-2.5 text-right">
                        <Cell cents={r.pendingCents} />
                      </DataTableCell>
                      <DataTableCell className="px-2.5 text-right font-medium tabular-nums">
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
          </div>

          {/* Celular: cada medio con lo vendido; lo descontado, acreditado y pendiente, debajo. */}
          <ul
            aria-label={`Neto por medio de cobro, ${label}`}
            className="divide-y divide-border/60 sm:hidden"
          >
            {visible.map((r) => {
              const discounted = DEDUCTIONS.reduce((acc, d) => acc + r[d.key], 0)
              const detail = [
                discounted > 0 ? `Descontado ${formatCents(discounted)}` : null,
                r.creditedCents > 0 ? `Acreditado ${formatCents(r.creditedCents)}` : null,
                r.pendingCents > 0 ? `Pendiente ${formatCents(r.pendingCents)}` : null,
              ].filter(Boolean)
              return (
                <li key={r.methodId} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">{r.methodName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {CHANNEL_LABELS[r.channel] ?? r.channel}
                      {r.discountBp === null ? '' : ` · Descuento ${vatRateLabel(r.discountBp)}`}
                    </span>
                    {detail.length > 0 ? (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {detail.join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <Amount cents={r.soldCents} className="block text-sm font-medium" />
                    <span className="block text-[11px] text-muted-foreground">Vendido</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </DataTableShell>
  )
}
