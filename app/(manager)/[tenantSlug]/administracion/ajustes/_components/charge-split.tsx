import { SplitBar, type SplitBarSegment } from '@/components/administracion/charts/split-bar'
import { formatCentsShort } from '@/lib/money'
import { type ChargeBreakdown, SAMPLE_GROSS_CENTS } from '../_lib/cobros'

/**
 * «De cada $ 10.000», en vivo: cómo se reparte una venta con las tasas que se
 * están escribiendo en «Lo que te descuentan». Contesta la pregunta del
 * diálogo —si me cobran esto, ¿cuánto me llega?— mientras se tipea, con la
 * misma cuenta que precarga «Registrar un cobro».
 *
 * Cuatro tramos, con su leyenda en palabras (monto y porcentaje): te llega,
 * comisión, IVA de la comisión y retenciones. Va rotulado «estimado».
 *
 * `breakdown: null` = todavía no hay ninguna tasa escrita: se dibuja el riel
 * vacío y se dice qué va a aparecer. Nunca «$ 10.000»: sin dato no es sin
 * descuento.
 *
 * Cuándo NO: fuera de ese diálogo. En la lista de medios, «de cada $ 10.000»
 * es una barra fina por fila (`MethodRow`).
 */
export function ChargeSplit({ breakdown }: { breakdown: ChargeBreakdown | null }) {
  const whole = formatCentsShort(SAMPLE_GROSS_CENTS)
  if (!breakdown) {
    return (
      <div className="rounded-xl bg-secondary/50 p-3 sm:p-4">
        <p className="text-sm font-medium">De cada {whole}</p>
        <div
          aria-hidden
          className="mt-2.5 h-3 rounded-full border border-dashed border-muted-foreground/50"
        />
        <p className="mt-2.5 text-xs text-muted-foreground text-pretty">
          Escribí la comisión y acá ves cuánto te llega. Sin cargarla no sabemos cuánto te
          descuentan.
        </p>
      </div>
    )
  }
  const segments: SplitBarSegment[] = [
    { key: 'net', label: 'Te llega', cents: breakdown.netCents, swatch: 'bg-adm-in' },
    {
      key: 'commission',
      label: 'Comisión',
      cents: breakdown.commissionCents,
      swatch: 'bg-adm-out',
    },
    {
      key: 'vat',
      label: 'IVA de la comisión',
      cents: breakdown.commissionVatCents,
      swatch: 'bg-adm-s2',
    },
    {
      key: 'withholdings',
      label: 'Retenciones',
      cents: breakdown.withholdingsCents,
      swatch: 'bg-adm-neutral',
    },
  ]
  return (
    <div className="rounded-xl bg-secondary/50 p-3 sm:p-4">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">
          De cada {whole} te llegan{' '}
          <span className="font-serif text-lg font-semibold tracking-tight">
            {formatCentsShort(breakdown.netCents)}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">estimado</span>
      </p>
      <SplitBar
        segments={segments}
        className="mt-2.5"
        ariaLabel={`De cada ${whole} te llegan ${formatCentsShort(breakdown.netCents)} (estimado).`}
      />
    </div>
  )
}
