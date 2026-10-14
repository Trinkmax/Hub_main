import { ArrowLeftRight } from 'lucide-react'
import { ChartFrame } from '@/components/administracion/charts/chart-frame'
import { ChartSilhouette } from '@/components/administracion/charts/chart-parts'
import { InOutBars } from '@/components/administracion/charts/in-out-bars'
import { IN_SWATCH, OUT_SWATCH } from '@/components/administracion/charts/palette'
import { RankBars } from '@/components/administracion/charts/rank-bars'
import { EmptyTeach, Panel } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import type { CashFlowRow } from '@/lib/accounting/queries/treasury'
import { formatCentsShort } from '@/lib/money'
import { flowView } from '../_lib/flow-view'
import { CashFlow } from './cash-flow'

/**
 * Con pocos meses, las columnas a todo el ancho quedan separadas por un
 * desierto: el dibujo se angosta. Las clases van escritas enteras (Tailwind no
 * ve una clase armada al vuelo).
 */
function monthsWidth(count: number): string | undefined {
  if (count <= 4) return 'max-w-xl'
  if (count <= 8) return 'max-w-3xl'
  return undefined
}

/**
 * «Entró y salió»: lo que entró y lo que salió de las cajas, mes por mes, y en
 * qué se fue. Antes era una tabla por mes y categoría con una barrita por
 * fila; ahora el dibujo dice primero si entra más de lo que sale y después a
 * dónde va la plata («De cada $ 100 que salieron, $ 79 fueron a proveedores»).
 *
 * La tabla con sus totales sigue ahí, en «Ver como tabla» (la contadora la ve
 * de entrada, con `tableFirst`).
 */
export function FlowBlocks({
  rows,
  label,
  tableFirst,
  everMoved,
}: {
  rows: readonly CashFlowRow[]
  /** «Agosto – octubre 2026»: el período, para la tabla. */
  label: string
  /** La contadora arranca en la tabla. */
  tableFirst: boolean
  /** Alguna caja tuvo algún movimiento alguna vez (si no, el vacío enseña qué va a aparecer). */
  everMoved: boolean
}) {
  const view = flowView(rows)

  if (view.isEmpty) {
    return everMoved ? (
      <EmptyTeach
        icon={ArrowLeftRight}
        title="No entró ni salió plata en este período"
        illustration={<ChartSilhouette kind="inout" />}
      >
        Probá con otro período: con las flechas de arriba cambiás de mes.
      </EmptyTeach>
    ) : (
      <EmptyTeach
        icon={ArrowLeftRight}
        title={view.title}
        illustration={<ChartSilhouette kind="inout" />}
      >
        Cuando cargues cierres, gastos y pagos vas a ver acá en qué se va la plata, mes por mes.
      </EmptyTeach>
    )
  }

  // «De dónde vino» tiene su panel solo si hay algo que repartir. Con una sola fuente de
  // plata, o con una que se lleva todo menos monedas (lo normal en un bar: las ventas),
  // alcanza con decirlo al pie del panel de al lado.
  const twoSides = view.in.rows.length > 1 && !view.in.dominant
  return (
    <>
      <Panel>
        <ChartFrame
          headingLevel="h2"
          title={view.title}
          sentence={view.sentence}
          defaultView={tableFirst ? 'table' : 'chart'}
          chart={
            <div className={monthsWidth(view.months.length)}>
              <InOutBars buckets={view.months} />
            </div>
          }
          table={<CashFlow rows={rows} label={label} />}
          footer={<p>Mover plata entre cajas no cuenta.</p>}
        />
      </Panel>

      <div className={twoSides ? 'grid gap-6 lg:grid-cols-2' : undefined}>
        <Panel
          title={view.out.title ?? 'En este período no salió plata'}
          description={
            view.out.totalCents > 0
              ? `En qué se fue: salieron ${formatCentsShort(view.out.totalCents)} en total.`
              : undefined
          }
          footer={
            // Cuánto entró ya lo dice la oración del dibujo de arriba.
            !twoSides && view.in.title ? `${view.in.title}.` : undefined
          }
        >
          {view.out.rows.length > 0 ? (
            // Sola, a todo el ancho de la pantalla, las barras quedan muy largas: se angostan.
            <div className={twoSides ? undefined : 'max-w-3xl'}>
              <RankBars
                rows={view.out.rows.map((row) => ({ ...row, swatch: OUT_SWATCH }))}
                sort={false}
                ariaLabel={`${view.out.title}. Salieron ${formatCentsShort(view.out.totalCents)} en total.`}
              />
            </div>
          ) : null}
        </Panel>
        {twoSides ? (
          <Panel
            title={view.in.title}
            description={`De dónde vino: entraron ${formatCentsShort(view.in.totalCents)} en total.`}
          >
            <RankBars
              rows={view.in.rows.map((row) => ({ ...row, swatch: IN_SWATCH }))}
              sort={false}
              ariaLabel={`${view.in.title}. Entraron ${formatCentsShort(view.in.totalCents)} en total.`}
            />
          </Panel>
        ) : null}
      </div>
    </>
  )
}

/**
 * «Entró y salió» entera mientras carga: el período con su «Exportar», los dos
 * bloques del flujo y las próximas semanas. La usan `loading.tsx` (al entrar) y
 * la página (al cambiar de vista).
 */
export function FlowTabSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-11 w-64 max-w-full rounded-full md:h-9" />
        <Skeleton className="h-11 w-28 md:h-9" />
      </div>
      <FlowSkeleton />
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-96 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-36 w-full" />
      </div>
    </div>
  )
}

/** Con la forma real: el dibujo por mes y las barras por categoría. */
export function FlowSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <div className="flex h-44 items-center justify-around gap-6 border-b border-border/60 px-6">
          {['h-24', 'h-32', 'h-20'].map((height) => (
            <div key={height} className="flex h-full flex-1 flex-col items-center justify-center">
              <Skeleton className={`${height} w-6 rounded-none rounded-t-sm`} />
              <Skeleton className="mt-0.5 h-4 w-6 rounded-none rounded-b-sm" />
            </div>
          ))}
        </div>
      </div>
      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <Skeleton className="h-6 w-80 max-w-full" />
        {['w-full', 'w-2/3', 'w-1/3', 'w-1/5'].map((width) => (
          <div key={width} className="space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className={`h-2.5 ${width}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
