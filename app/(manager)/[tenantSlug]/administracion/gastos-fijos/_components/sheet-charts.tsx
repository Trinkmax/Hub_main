import { gastosFijosHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartTable } from '@/components/administracion/charts/chart-parts'
import { DueStrip, type DueStripDay } from '@/components/administracion/charts/due-strip'
import {
  INVOICED_SWATCH,
  NOT_INVOICED_SWATCH,
  UNDEFINED_SWATCH,
} from '@/components/administracion/charts/palette'
import { RankBars, type RankBarsRow } from '@/components/administracion/charts/rank-bars'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Panel, PanelSection } from '@/components/administracion/kit'
import { formatDayLabel } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import {
  categoryBars,
  chartScope,
  dueDays,
  dueStripDays,
  missingFromCharts,
  paperSplit,
} from '../_lib/planilla'
import {
  categoryTitle,
  DUE_OUTSIDE_LABELS,
  dueTitle,
  INVOICE_BUCKET_LABELS,
  monthWord,
  paperTitle,
  type Sheet,
  topCategoryBars,
} from '../_lib/planilla-words'

const gastos = (n: number) => (n === 1 ? '1 gasto' : `${n} gastos`)

/**
 * «Cómo es tu mes de gastos fijos»: tres dibujos que aparecen de a partes,
 * solo cuando dicen algo.
 *
 * - **Qué días se te va la plata**: si lo que falta cae en dos días o más (si
 *   todo vence el mismo día, ya lo dice el margen de la planilla). Lo que quedó
 *   de meses anteriores va junto, en una columna «Antes».
 * - **En qué se va lo fijo**: con dos categorías o más. Es la columna
 *   «Categoría» de la planilla de los socios; cada barra filtra la planilla. Con
 *   muchas, las más chicas van juntas («Otras 7 categorías»).
 * - **Con qué papel pagás lo fijo**: si alguno tiene papel de siempre. Es la
 *   columna «Facturación»: una proporción, no 31 celdas. Habla del papel de
 *   SIEMPRE, no del de cada pago, y lo aclara.
 *
 * Si ningún gasto tiene monto, el bloque no existe (nada de siluetas vacías:
 * la cabecera ya dice qué falta). Los que no tienen monto no entran y se dice
 * UNA vez, al pie. Mirando el mes que viene, lo que quedó de antes tampoco
 * entra: no es «lo fijo de noviembre».
 *
 * Los importes van en pesos, sin centavos, también en «Ver como tabla»: es un
 * tablero, no un libro.
 */
export function SheetCharts({ sheet, tenantSlug }: { sheet: Sheet; tenantSlug: string }) {
  const scope = chartScope(sheet)
  if (!scope.items.some((item) => item.line.remainingCents !== null)) return null
  const mes = monthWord(sheet.month)
  const href = (extra: Readonly<Record<string, string>>) =>
    gastosFijosHref(tenantSlug, { mes: sheet.month, ...extra })

  const due = dueStripDays(scope)
  const dueWithMoney = due.filter((d) => d.cents > 0)
  const bars = categoryBars(scope)
  const split = paperSplit(scope)
  const showDue = dueWithMoney.length >= 2
  const showCategories = bars.length >= 2
  const showPaper = split.defined
  if (!showDue && !showCategories && !showPaper) return null

  const missing = missingFromCharts(scope)
  const missingNote =
    missing > 0
      ? missing === 1
        ? '1 sin monto no está en estos dibujos.'
        : `${missing} sin monto no están en estos dibujos.`
      : null

  const stripDays: DueStripDay[] = due.map((d) => ({
    // La columna que junta lo de otros meses no es un día: sin una fecha real, el eje y el
    // globito usan su rótulo («Antes») en lugar de un «10» que parecería del mes.
    date: d.outside ?? d.date,
    label: d.outside ? DUE_OUTSIDE_LABELS[d.outside] : formatDayLabel(d.date),
    cents: d.cents,
    count: d.count,
    overdue: d.overdue,
    href: d.cents > 0 ? `#dia-${d.date}` : undefined,
  }))
  const todayIndex = stripDays.findIndex((d) => d.date === sheet.today)
  // La tabla lista cada día con su fecha entera, también los de otros meses.
  const tableDays = dueDays(scope)

  const { top, rest } = topCategoryBars(bars)
  const rankRows: RankBarsRow[] = top.map((bar) => ({
    key: bar.id,
    label: bar.name,
    cents: bar.cents,
    sub: gastos(bar.count),
    href: href({ categoria: bar.id }),
  }))
  if (rest) {
    rankRows.push({
      key: 'otras',
      label: `Otras ${rest.categories} categorías`,
      cents: rest.cents,
      sub: gastos(rest.count),
      swatch: 'bg-adm-neutral',
    })
  }
  const total = bars.reduce((sum, bar) => sum + bar.cents, 0)

  return (
    <Panel
      title="Cómo es tu mes de gastos fijos"
      footer={missingNote ? <p className="text-xs">{missingNote}</p> : undefined}
    >
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
              <ChartTable
                caption={`Lo que falta pagar de ${mes}, por día`}
                columns={[
                  { key: 'dia', label: 'Día' },
                  { key: 'cuantos', label: 'Cuántos', align: 'right' },
                  { key: 'importe', label: 'Importe', align: 'right' },
                ]}
                rows={tableDays.map((d) => ({
                  key: d.date,
                  cells: [
                    d.overdue ? `${formatDayLabel(d.date)} · vencido` : formatDayLabel(d.date),
                    gastos(d.count),
                    formatCentsShort(d.cents),
                  ],
                }))}
                foot={[
                  'Total',
                  gastos(tableDays.reduce((sum, d) => sum + d.count, 0)),
                  formatCentsShort(tableDays.reduce((sum, d) => sum + d.cents, 0)),
                ]}
              />
            }
          />
        </PanelSection>
      ) : null}

      {showCategories ? (
        <PanelSection>
          <ChartFrame
            title={categoryTitle(bars)}
            sentence={`Lo fijo de ${mes} por categoría: lo pagado más lo que falta. Tocá una para ver sus gastos.${
              rest ? ' Las más chicas van juntas: en la tabla están todas.' : ''
            }`}
            chart={<RankBars sort={false} rows={rankRows} />}
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
                  cells: [bar.name, String(bar.count), formatCentsShort(bar.cents)],
                }))}
                foot={[
                  'Total',
                  String(bars.reduce((sum, bar) => sum + bar.count, 0)),
                  formatCentsShort(total),
                ]}
              />
            }
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
                // La barra mide lo mismo que su leyenda: cada importe cae debajo de su extremo.
                className="max-w-[34rem]"
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
            footer={<p>Es el papel de siempre; el de cada pago está en su comprobante.</p>}
          />
        </PanelSection>
      ) : null}
    </Panel>
  )
}
