import { ArrowRight } from 'lucide-react'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { OTHERS_SWATCH } from '@/components/administracion/charts/palette'
import { RankBars } from '@/components/administracion/charts/rank-bars'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Panel, PanelSection } from '@/components/administracion/kit/panel'
import { invoicedSplit, spendingView } from '@/lib/accounting/home'
import { INVOICE_FILTER_PARAM } from '@/lib/accounting/invoiced'
import { monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { PanelError, PanelLink } from './block-states'
import type { HomeData } from './home-data'

/**
 * «En qué se va la plata»: las compras y los gastos del mes por categoría (el
 * grupo del plan de cuentas, con impuestos: lo que de verdad salió por cada
 * una) y, abajo, los mismos egresos mirados por el papel que tienen.
 *
 * «Con factura / sin factura» es una forma de mirar: los dos quedan
 * registrados igual, en el mismo libro. Por eso el «sin factura» va en azul,
 * no en un color de alarma, y cada tramo lleva a su lista en Comprobantes.
 */
export async function SpendingBlock({ data, className }: { data: HomeData; className?: string }) {
  const result = await data.spending
  if (!result.ok) {
    return (
      <PanelError title="En qué se va la plata" message={result.message} className={className} />
    )
  }

  const spending = result.data
  const view = spendingView(spending.categories)
  const split = invoicedSplit(spending.vouchers)
  const month = monthName(Number(data.today.slice(5, 7))) || 'este mes'
  const documentsHref = `${data.base}/compras?tab=comprobantes`

  if (view.isEmpty) {
    return (
      <Panel
        title="En qué se va la plata"
        description={`Las compras y los gastos de ${month}, por categoría.`}
        className={className}
      >
        <EmptyTeach
          plain
          title="Todavía no cargaste compras ni gastos este mes"
          illustration={<ChartSilhouette kind="rank" />}
        >
          Cada compra y cada gasto cae en su categoría: vas a ver en qué se va la plata y cuánto fue
          con factura y cuánto sin factura.
        </EmptyTeach>
      </Panel>
    )
  }

  return (
    <Panel
      title={view.title ?? 'En qué se va la plata'}
      description={`Compras y gastos de ${month}: ${formatCentsShort(view.totalCents)}, con impuestos.`}
      className={className}
    >
      <PanelSection>
        <RankBars
          sort={false}
          rows={view.bars.map((bar) => ({
            key: bar.key,
            label: bar.label,
            cents: bar.cents,
            sub: bar.isOther ? `${bar.count} categorías más` : undefined,
            swatch: bar.isOther ? OTHERS_SWATCH : undefined,
          }))}
        />
        {view.creditCents > 0 || spending.truncated ? (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {view.creditCents > 0 ? (
              <li>
                Aparte hay {formatCentsShort(view.creditCents)} a favor por notas de crédito: ya
                están restados del total.
              </li>
            ) : null}
            {spending.truncated ? (
              <li>Son muchos comprobantes: estos números son de una parte del mes.</li>
            ) : null}
          </ul>
        ) : null}
      </PanelSection>

      <PanelSection
        title="Con factura y sin factura"
        description={split.sentence}
        action={
          <PanelLink href={documentsHref}>
            Ver comprobantes
            <ArrowRight className="size-3.5" aria-hidden />
          </PanelLink>
        }
      >
        {split.isEmpty ? null : (
          <SplitBar
            segments={[
              {
                key: 'con',
                label: 'Con factura',
                cents: split.invoicedCents,
                swatch: 'bg-adm-s1',
                href: `${documentsHref}&${INVOICE_FILTER_PARAM}=con`,
              },
              {
                key: 'sin',
                label: 'Sin factura (remito o nada)',
                cents: split.notInvoicedCents,
                swatch: 'bg-adm-s4',
                href: `${documentsHref}&${INVOICE_FILTER_PARAM}=sin`,
              },
            ]}
          />
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
          Las dos quedan registradas igual en tus libros.
          {split.otherNote ? ` ${split.otherNote}` : ''}
        </p>
      </PanelSection>
    </Panel>
  )
}
