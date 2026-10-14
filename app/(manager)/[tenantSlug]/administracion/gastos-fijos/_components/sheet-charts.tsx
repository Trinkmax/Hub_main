import { gastosFijosHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartTable } from '@/components/administracion/charts/chart-parts'
import {
  DueStrip,
  type DueStripDay,
  DueStripTable,
} from '@/components/administracion/charts/due-strip'
import {
  INVOICED_SWATCH,
  NOT_INVOICED_SWATCH,
  UNDEFINED_SWATCH,
} from '@/components/administracion/charts/palette'
import { RankBars } from '@/components/administracion/charts/rank-bars'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Panel, PanelSection } from '@/components/administracion/kit'
import { formatDayLabel } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { categoryBars, dueStripDays, missingFromCharts, paperSplit } from '../_lib/planilla'
import {
  categoryTitle,
  dueTitle,
  INVOICE_BUCKET_LABELS,
  monthWord,
  paperTitle,
  type Sheet,
} from '../_lib/planilla-words'

/**
 * «Cómo es tu mes de gastos fijos»: tres dibujos que aparecen de a partes,
 * solo cuando dicen algo.
 *
 * - **Qué días se te va la plata**: si lo que falta cae en dos días o más (si
 *   todo vence el mismo día, ya lo dice el margen de la planilla).
 * - **En qué se va lo fijo**: con dos categorías o más. Es la columna
 *   «Categoría» de la planilla de los socios; cada barra filtra la planilla.
 * - **Con qué papel pagás lo fijo**: si alguno tiene papel de siempre. Es la
 *   columna «Facturación»: una proporción, no 31 celdas. Habla del papel de
 *   SIEMPRE, no del de cada pago, y lo aclara.
 *
 * Si ningún gasto tiene monto, el bloque no existe (nada de siluetas vacías:
 * la cabecera ya dice qué falta). Los que no tienen monto no entran y se dice.
 */
export function SheetCharts({ sheet, tenantSlug }: { sheet: Sheet; tenantSlug: string }) {
  if (sheet.progress.countedRows === 0) return null
  const mes = monthWord(sheet.month)
  const href = (extra: Readonly<Record<string, string>>) =>
    gastosFijosHref(tenantSlug, { mes: sheet.month, ...extra })

  const due = dueStripDays(sheet)
  const dueWithMoney = due.filter((d) => d.cents > 0)
  const bars = categoryBars(sheet)
  const split = paperSplit(sheet)
  const showDue = dueWithMoney.length >= 2
  const showCategories = bars.length >= 2
  const showPaper = split.defined
  if (!showDue && !showCategories && !showPaper) return null

  const missing = missingFromCharts(sheet)
  const missingNote =
    missing > 0
      ? missing === 1
        ? '1 sin monto no está en el dibujo.'
        : `${missing} sin monto no están en el dibujo.`
      : null

  const stripDays: DueStripDay[] = due.map((d) => ({
    date: d.date,
    label: formatDayLabel(d.date),
    cents: d.cents,
    count: d.count,
    overdue: d.overdue,
    href: d.cents > 0 ? `#dia-${d.date}` : undefined,
  }))
  const todayIndex = stripDays.findIndex((d) => d.date === sheet.today)
  const total = bars.reduce((sum, bar) => sum + bar.cents, 0)

  return (
    <Panel title="Cómo es tu mes de gastos fijos">
      {showDue ? (
        <PanelSection>
          <ChartFrame
            title={dueTitle(due)}
            sentence={`Lo que te falta pagar de ${mes}, día por día. Tocá un día para ir a sus renglones.`}
            chart={
              <DueStrip
                days={stripDays}
                todayIndex={todayIndex === -1 ? null : todayIndex}
                unit={['gasto', 'gastos']}
              />
            }
            table={
              <DueStripTable
                days={stripDays}
                unit={['gasto', 'gastos']}
                caption={`Lo que falta pagar de ${mes}, por día`}
              />
            }
            footer={missingNote}
          />
        </PanelSection>
      ) : null}

      {showCategories ? (
        <PanelSection>
          <ChartFrame
            title={categoryTitle(bars)}
            sentence={`Lo fijo de ${mes} por categoría: lo pagado más lo que falta. Tocá una para ver sus gastos.`}
            chart={
              <RankBars
                sort={false}
                rows={bars.map((bar) => ({
                  key: bar.id,
                  label: bar.name,
                  cents: bar.cents,
                  sub: bar.count === 1 ? '1 gasto' : `${bar.count} gastos`,
                  href: href({ categoria: bar.id }),
                }))}
              />
            }
            table={
              <ChartTable
                caption={`Lo fijo de ${mes}, por categoría`}
                columns={[
                  { key: 'categoria', label: 'Categoría' },
                  { key: 'cuantos', label: 'Gastos', align: 'right' },
                  { key: 'importe', label: 'Importe', align: 'right' },
                ]}
                rows={bars.map((bar) => ({
                  key: bar.id,
                  cells: [bar.name, String(bar.count), formatCents(bar.cents)],
                }))}
                foot={[
                  'Total',
                  String(bars.reduce((sum, bar) => sum + bar.count, 0)),
                  formatCents(total),
                ]}
              />
            }
            footer={missingNote}
          />
        </PanelSection>
      ) : null}

      {showPaper ? (
        <PanelSection>
          <ChartFrame
            title={paperTitle(split)}
            sentence="Con factura o sin factura, todo queda registrado en los libros. Tocá una parte para ver sus gastos."
            chart={
              <SplitBar
                totalLabel={`Lo fijo de ${mes}`}
                segments={[
                  {
                    key: 'con',
                    label: INVOICE_BUCKET_LABELS.con,
                    cents: split.conCents,
                    swatch: INVOICED_SWATCH,
                    href: href({ factura: 'con' }),
                  },
                  {
                    key: 'sin',
                    label: INVOICE_BUCKET_LABELS.sin,
                    cents: split.sinCents,
                    swatch: NOT_INVOICED_SWATCH,
                    href: href({ factura: 'sin' }),
                  },
                  {
                    key: 'nose',
                    label: INVOICE_BUCKET_LABELS.nose,
                    cents: split.noseCents,
                    swatch: UNDEFINED_SWATCH,
                    href: href({ factura: 'nose' }),
                  },
                ]}
              />
            }
            footer={
              <>
                <p>Es el papel de siempre; el de cada pago está en su comprobante.</p>
                {missingNote ? <p>{missingNote}</p> : null}
              </>
            }
          />
        </PanelSection>
      ) : null}
    </Panel>
  )
}
