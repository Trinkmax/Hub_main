import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { NumberTicker, type NumberFormatKind } from './number-ticker'

type Tone = 'default' | 'positive' | 'negative' | 'muted'

const toneClass: Record<Tone, string> = {
  default: 'text-foreground',
  positive: 'text-success',
  negative: 'text-destructive',
  muted: 'text-muted-foreground',
}

type StatCardProps = {
  label: string
  /** Valor pre-formateado (string/ReactNode). Mutuamente excluyente con `numberValue`. */
  value?: ReactNode
  /** Valor numérico que se anima de 0→n con NumberTicker. */
  numberValue?: number
  /** Decimales para el ticker (cuando no usás `numberFormatKind`). */
  numberDecimals?: number
  /**
   * Kind serializable de formato — preferí esto en Server Components ya que
   * pasar funciones a NumberTicker (Client) rompe la frontera RSC.
   */
  numberFormatKind?: NumberFormatKind
  hint?: ReactNode
  delta?: ReactNode
  deltaTone?: Tone
  icon?: LucideIcon
  sparkline?: ReactNode
  className?: string
}

export function StatCard({
  label,
  value,
  numberValue,
  numberDecimals = 0,
  numberFormatKind,
  hint,
  delta,
  deltaTone = 'muted',
  icon: Icon,
  sparkline,
  className,
}: StatCardProps) {
  const renderedValue =
    typeof numberValue === 'number' ? (
      <NumberTicker
        value={numberValue}
        decimalPlaces={numberDecimals}
        formatKind={numberFormatKind}
      />
    ) : (
      value
    )

  return (
    <div
      className={cn(
        'card-hairline group relative overflow-hidden rounded-xl border border-border/70 bg-card/85 p-5 shadow-xs',
        'transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)]',
        'hover:-translate-y-0.5 hover:shadow-md hover:bg-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {label}
          </div>
          <div className="font-serif text-3xl font-semibold tracking-tight tabular-nums leading-tight">
            {renderedValue}
          </div>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        {delta ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary/70 px-2 py-1 text-[11px] font-medium tabular-nums',
              toneClass[deltaTone],
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>
      {sparkline ? (
        <div className="pointer-events-none mt-4 h-12 w-full opacity-90">{sparkline}</div>
      ) : null}
    </div>
  )
}
