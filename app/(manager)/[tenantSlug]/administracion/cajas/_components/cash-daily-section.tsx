import { Panel, PanelError } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import type { CashChartRange, CashDailyReport } from '@/lib/accounting/cash-daily'
import type { TreasuryTone } from '@/lib/accounting/home'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { cn } from '@/lib/utils'
import { CashMovePanel } from './cash-move-panel'

/** El ancla del bloque: los links «ver cómo se movió» de otras pantallas caen acá. */
export const CASH_MOVE_ANCHOR = 'como-se-movio'

const TITLE = 'Cómo se movió la plata'

/**
 * «Cómo se movió la plata»: espera el reporte por día (ya pedido por la
 * página, sin frenar a la billetera) y arma el bloque. Si esa lectura falla, el
 * bloque conserva su lugar y ofrece reintentar; el resto de la pantalla sigue.
 */
export async function CashMoveBlock({
  report,
  range,
  today,
  base,
  booksStartDate,
  tones,
  className,
}: {
  report: Promise<QueryOutcome<CashDailyReport>>
  range: CashChartRange
  today: string
  base: string
  booksStartDate: string | null
  tones: Readonly<Record<string, TreasuryTone | null>>
  className?: string
}) {
  const outcome = await report
  if (!outcome.ok) {
    return <PanelError title={TITLE} message={outcome.message} className={className} />
  }
  return (
    <Panel id={CASH_MOVE_ANCHOR} className={className}>
      <CashMovePanel
        report={outcome.data}
        range={range}
        today={today}
        base={base}
        booksStartDate={booksStartDate}
        tones={tones}
      />
    </Panel>
  )
}

const BARS = [
  { key: 'a', up: 'h-6', down: 'h-2' },
  { key: 'b', up: 'h-10', down: 'h-3' },
  { key: 'c', up: 'h-4', down: 'h-5' },
  { key: 'd', up: 'h-12', down: 'h-2' },
  { key: 'e', up: 'h-7', down: 'h-4' },
  { key: 'f', up: 'h-14', down: 'h-3' },
  { key: 'g', up: 'h-9', down: 'h-6' },
  { key: 'h', up: 'h-5', down: 'h-2' },
  { key: 'i', up: 'h-11', down: 'h-4' },
  { key: 'j', up: 'h-8', down: 'h-3' },
] as const

const STEPS = ['h-10', 'h-14', 'h-12', 'h-20', 'h-16', 'h-24', 'h-20', 'h-28', 'h-24', 'h-32']

/** Con la forma real: las píldoras, el título, la escalera del saldo y las barras de entró y salió. */
export function CashMoveSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5',
        className,
      )}
    >
      <Skeleton className="h-3 w-40" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <Skeleton className="h-11 w-32 rounded-full md:h-9" />
          <Skeleton className="h-11 w-20 rounded-full md:h-9" />
          <Skeleton className="h-11 w-28 rounded-full md:h-9 max-sm:hidden" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-11 w-32 rounded-full md:h-9" />
          <Skeleton className="h-11 w-24 rounded-full md:h-9 max-sm:hidden" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-80 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-3 w-52" />
      <div className="flex h-40 items-end gap-1.5 border-b border-border/60 sm:h-48">
        {STEPS.map((height, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: escalones fijos de un esqueleto
          <Skeleton key={index} className={cn(height, 'flex-1 rounded-none rounded-t-sm')} />
        ))}
      </div>
      <Skeleton className="h-3 w-56" />
      <div className="flex h-28 gap-1.5">
        {BARS.map((bar) => (
          <div key={bar.key} className="flex flex-1 flex-col">
            <div className="flex flex-1 items-end">
              <Skeleton className={cn(bar.up, 'w-full rounded-none rounded-t-sm')} />
            </div>
            <div className="flex h-8 items-start pt-0.5">
              <Skeleton className={cn(bar.down, 'w-full rounded-none rounded-b-sm')} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
