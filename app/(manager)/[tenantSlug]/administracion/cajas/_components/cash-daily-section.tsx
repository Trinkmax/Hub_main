import type { ReactNode } from 'react'
import { BlockError } from '@/components/administracion/cajas-ventas/block-error'
import { DataTableShell } from '@/components/ui/data-table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buildCashDailyViews,
  CASH_CHART_RANGE_OPTIONS,
  type CashChartRange,
  type CashDailyReport,
} from '@/lib/accounting/cash-daily'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { cn } from '@/lib/utils'
import { CashDailyChart } from './cash-daily-chart'

/**
 * «Cómo se movió la plata» (reunión del 12/10/2026): la tarjeta con su título
 * se dibuja con el resto de la pantalla; el gráfico llega después, en su
 * propio `Suspense`, para no frenar los saldos.
 */
export function CashDailyCard({ children }: { children: ReactNode }) {
  return (
    <DataTableShell>
      <header className="border-b border-border/60 px-5 py-4">
        <h2 className="font-serif text-lg font-semibold tracking-tight">Cómo se movió la plata</h2>
        <p className="text-xs text-muted-foreground">
          El saldo al final de cada día, y lo que entró y salió.
        </p>
      </header>
      {children}
    </DataTableShell>
  )
}

/** Espera el reporte (ya pedido por la página) y arma lo que dibuja el gráfico. */
export async function CashDailyBody({
  report,
  range,
  today,
}: {
  report: Promise<QueryOutcome<CashDailyReport>>
  range: CashChartRange
  today: string
}) {
  const outcome = await report
  if (!outcome.ok) {
    return <BlockError message={outcome.message} className="m-5 border-0 bg-transparent py-8" />
  }
  return (
    <CashDailyChart
      views={buildCashDailyViews(outcome.data, { today })}
      ranges={CASH_CHART_RANGE_OPTIONS}
      rangeKey={range.key}
      rangeLabel={range.label}
    />
  )
}

const SKELETON_BARS = [
  { key: 'a', height: 'h-10' },
  { key: 'b', height: 'h-16' },
  { key: 'c', height: 'h-8' },
  { key: 'd', height: 'h-20' },
  { key: 'e', height: 'h-12' },
  { key: 'f', height: 'h-24' },
  { key: 'g', height: 'h-14' },
  { key: 'h', height: 'h-9' },
  { key: 'i', height: 'h-16' },
  { key: 'j', height: 'h-11' },
] as const

/** Con la forma del gráfico: los filtros, el resumen, el eje y las barras. */
export function CashDailySkeleton() {
  return (
    <div className="space-y-4 px-5 py-4" aria-hidden="true">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="w-full space-y-1.5 sm:w-64">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-11 w-full md:h-9" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 w-36 rounded-full md:h-9" />
          <Skeleton className="h-11 w-24 rounded-full md:h-9" />
          <Skeleton className="h-11 w-28 rounded-full md:h-9" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-3 w-72 max-w-full" />
      <div className="flex h-64 gap-3 sm:h-72">
        <div className="flex w-12 flex-col justify-between py-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-6" />
        </div>
        <div className="flex flex-1 items-end gap-2 border-b border-border/60 pb-2">
          {SKELETON_BARS.map((bar) => (
            <Skeleton
              key={bar.key}
              className={cn(bar.height, 'flex-1 rounded-t-sm rounded-b-none')}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
