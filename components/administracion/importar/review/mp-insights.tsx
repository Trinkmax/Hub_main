import { ChevronDown } from 'lucide-react'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { DayBars, type DayBarsDay, DayBarsTable } from '@/components/administracion/charts/day-bars'
import { SplitBar, type SplitBarSegment } from '@/components/administracion/charts/split-bar'
import { Explain, MathRow, PanelSection, PillLink } from '@/components/administracion/kit'
import { formatRange } from '@/lib/dates'
import {
  type MpCut,
  type MpCutPart,
  type MpDay,
  mpDaysSummary,
  mpDayTitle,
} from '@/lib/imports/ui/mp-insights'
import { formatCents } from '@/lib/money'

const PART_SWATCH: Readonly<Record<MpCutPart['key'], string>> = {
  net: 'bg-adm-s1',
  commission: 'bg-adm-s5',
  commission_vat: 'bg-adm-s2',
  retained: 'bg-adm-s3',
  bank_tax: 'bg-adm-s4',
  other: 'bg-adm-neutral',
}

/**
 * «Mercado Pago contra tus cierres»: dos dibujos con lo que trae el reporte.
 *
 * 1. Una columna por día con lo que cobró Mercado Pago y una marca fina con lo
 *    que dice el cierre de ese día. La diferencia de un día salta a la vista; en
 *    una tabla hay que restar. Un día sin cierre NO es cero: la marca no se
 *    dibuja y debajo queda «Falta el cierre: …» con el link para cargarlo. Es el
 *    paso a paso del bar sin punto de venta.
 * 2. De cada $ 100 cobrados, cuánto quedó: la barra partida en lo que te
 *    depositaron, la comisión, su IVA y los impuestos.
 *
 * Plegado mientras quedan preguntas (ahí la tarea es contestar), con su título
 * a la vista. Los datos llegan armados (`mpDays`, `mpCut`). Server-safe.
 */
export function MpInsights({
  days,
  cut,
  slug,
  periodFrom,
  periodTo,
  open,
}: {
  days: readonly MpDay[]
  cut: MpCut | null
  slug: string
  periodFrom: string | null
  periodTo: string | null
  /** Abierto si no quedan preguntas por contestar. */
  open: boolean
}) {
  if (days.length === 0 || !cut) return null
  const summary = mpDaysSummary(days)
  const base = `/${slug}/administracion`
  const bars: DayBarsDay[] = days.map((d) => ({
    date: d.date,
    label: d.label,
    cents: d.collectedCents,
    targetCents: d.closeCents,
    state: 'ok',
  }))
  const segments: SplitBarSegment[] = cut.parts.map((part) => ({
    key: part.key,
    label: part.label,
    cents: part.cents,
    swatch: PART_SWATCH[part.key],
  }))
  const period = periodFrom && periodTo ? formatRange(periodFrom, periodTo) : null

  return (
    <details
      open={open}
      className="card-hairline group/mp rounded-2xl border bg-card shadow-xs [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-lg font-semibold leading-snug tracking-tight">
            Mercado Pago contra tus cierres
          </span>
          {/* Plegado, el título del dibujo va acá; abierto, ya lo dice el dibujo. */}
          <span className="block text-sm text-muted-foreground text-pretty group-open/mp:hidden">
            {summary.title}.
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/mp:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-border/60 px-4 py-4 sm:px-5">
        <PanelSection>
          <ChartFrame
            title={summary.title}
            sentence="Cada columna es lo que cobró Mercado Pago ese día; la marca, lo que anotaste en el cierre."
            chart={
              <DayBars
                days={bars}
                seriesLabel="Cobró Mercado Pago"
                targetLabel="Según tu cierre"
                missingPills={false}
              />
            }
            table={
              <DayBarsTable
                days={bars}
                seriesLabel="Cobró Mercado Pago"
                targetLabel="Según tu cierre"
                caption="Lo que cobró Mercado Pago y lo que dice el cierre, día por día"
              />
            }
          />
          {summary.missing.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-muted-foreground">Falta el cierre:</span>
              {summary.missing.map((d) => (
                <PillLink
                  key={d.date}
                  href={`${base}/ventas/cierre?fecha=${d.date}`}
                  className="h-11 border-dashed border-warning/70 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
                >
                  {mpDayTitle(d)}
                </PillLink>
              ))}
            </div>
          ) : null}
        </PanelSection>
        <PanelSection>
          <ChartFrame
            title={cut.title}
            sentence={cut.sentence}
            chart={<SplitBar segments={segments} totalLabel="Cobraste" />}
            footer={period ? `Según este reporte (${period}).` : undefined}
          />
          <Explain className="mt-3">
            <MathRow label="Cobraste" value={formatCents(cut.grossCents)} />
            {cut.parts
              .filter((part) => part.key !== 'net')
              .map((part) => (
                <MathRow key={part.key} op="−" label={part.label} value={formatCents(part.cents)} />
              ))}
            <MathRow op="=" label="Te depositaron" value={formatCents(cut.netCents)} />
          </Explain>
        </PanelSection>
      </div>
    </details>
  )
}
