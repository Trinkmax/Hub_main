import { Amount } from '@/components/administracion/amount'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
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
 * La tabla de «De cada $ 100» (lo que antes era «Neto por medio», el pedido de
 * Franco): por medio de cobro, lo vendido, lo que descontaron (comisión, su
 * IVA, retenciones, otros), lo que llegó y lo que sigue en camino, con el % de
 * descuento. Es la vista «Ver como tabla» del dibujo, y la que abre por
 * defecto quien solo mira: va sin encabezado ni tarjeta propios (los pone el
 * bloque que la contiene).
 */
export function NetByMethod({
  rows,
  label,
}: {
  rows: readonly NetByMethodRow[]
  /** «Octubre 2026». */
  label: string
}) {
  const visible = rows.filter(
    (r) => r.soldCents !== 0 || r.creditedCents !== 0 || r.pendingCents !== 0,
  )
  // Diez columnas no entran al lado del menú: las de descuentos vacías no se muestran
  // (y las celdas van más juntas que en una lista).
  const deductions = DEDUCTIONS.filter((d) => visible.some((r) => r[d.key] !== 0))
  if (visible.length === 0) return null
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {/* Compu y tablet: la tabla completa. */}
      <div className="hidden sm:block">
        <DataTableScroll>
          <DataTableRoot>
            <caption className="sr-only">Lo que llegó por medio de cobro, {label}</caption>
            <DataTableHead>
              <tr>
                <DataTableHeader>Medio</DataTableHeader>
                <DataTableHeader className="px-2.5 text-right">Vendido</DataTableHeader>
                {deductions.map((d) => (
                  <DataTableHeader key={d.key} className="px-2.5 text-right">
                    {d.label}
                  </DataTableHeader>
                ))}
                <DataTableHeader className="px-2.5 text-right">Te llegó</DataTableHeader>
                <DataTableHeader className="px-2.5 text-right">En camino</DataTableHeader>
                <DataTableHeader className="px-2.5 text-right">Descuento</DataTableHeader>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {visible.map((r) => (
                <tr
                  key={r.methodId}
                  className="transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-cream-tint"
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

      {/* Celular: cada medio con lo vendido; lo descontado, lo que llegó y lo que falta, debajo. */}
      <ul
        aria-label={`Lo que llegó por medio de cobro, ${label}`}
        className="divide-y divide-border/60 sm:hidden"
      >
        {visible.map((r) => {
          const discounted = DEDUCTIONS.reduce((acc, d) => acc + r[d.key], 0)
          const detail = [
            discounted > 0 ? `Descontado ${formatCents(discounted)}` : null,
            r.creditedCents > 0 ? `Te llegó ${formatCents(r.creditedCents)}` : null,
            r.pendingCents > 0 ? `En camino ${formatCents(r.pendingCents)}` : null,
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
    </div>
  )
}
