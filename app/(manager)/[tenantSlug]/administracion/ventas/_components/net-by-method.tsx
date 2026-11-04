import { PRow, PTable, PTd, PTh, PTotalRow } from '@/components/administracion/planilla'
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
  return cents > 0 ? formatCents(cents) : <span className="text-muted-foreground/60">—</span>
}

/**
 * «Lo que llegó» por medio de cobro (el pedido de Franco): lo vendido, lo que descontaron (comisión,
 * su IVA, retenciones, otros), lo que llegó y lo que sigue en camino, con el % de descuento. Con
 * centavos: es lo que se compara contra la liquidación.
 */
export function NetByMethod({
  rows,
  label,
}: {
  /** Los medios con movimiento (`netVisibleRows`). */
  rows: readonly NetByMethodRow[]
  /** «Octubre 2026». */
  label: string
}) {
  // Diez columnas no entran al lado del menú: las de descuentos vacías no se muestran.
  const deductions = DEDUCTIONS.filter((d) => rows.some((r) => r[d.key] !== 0))
  const sum = (pick: (row: NetByMethodRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)
  return (
    <PTable
      minWidth={480 + deductions.length * 110}
      label={`Lo que llegó por medio de cobro, ${label}`}
    >
      <thead>
        <tr>
          <PTh>Medio</PTh>
          <PTh align="right">Vendido</PTh>
          {deductions.map((d) => (
            <PTh key={d.key} align="right">
              {d.label}
            </PTh>
          ))}
          <PTh align="right">Te llegó</PTh>
          <PTh align="right">En camino</PTh>
          <PTh align="right">Descuento</PTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <PRow key={r.methodId}>
            <PTd>
              <span className="block font-medium">{r.methodName}</span>
              <small className="text-[11px] text-muted-foreground">
                {CHANNEL_LABELS[r.channel] ?? r.channel}
              </small>
            </PTd>
            <PTd align="right">
              <Cell cents={r.soldCents} />
            </PTd>
            {deductions.map((d) => (
              <PTd key={d.key} align="right">
                <Cell cents={r[d.key]} />
              </PTd>
            ))}
            <PTd align="right">
              <Cell cents={r.creditedCents} />
            </PTd>
            <PTd align="right">
              <Cell cents={r.pendingCents} />
            </PTd>
            <PTd align="right" className="font-medium">
              {r.discountBp === null ? (
                <span className="font-normal text-muted-foreground/60">—</span>
              ) : (
                vatRateLabel(r.discountBp)
              )}
            </PTd>
          </PRow>
        ))}
      </tbody>
      <tfoot>
        <PTotalRow>
          <PTd>Total</PTd>
          <PTd align="right">
            <Cell cents={sum((r) => r.soldCents)} />
          </PTd>
          {deductions.map((d) => (
            <PTd key={d.key} align="right">
              <Cell cents={sum((r) => r[d.key])} />
            </PTd>
          ))}
          <PTd align="right">
            <Cell cents={sum((r) => r.creditedCents)} />
          </PTd>
          <PTd align="right">
            <Cell cents={sum((r) => r.pendingCents)} />
          </PTd>
          <PTd />
        </PTotalRow>
      </tfoot>
    </PTable>
  )
}
