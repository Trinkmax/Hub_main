import { DEFAULT_SOON_DAYS, dueBucket, dueLabel } from '@/lib/accounting/aging'
import { formatIsoDay } from '@/lib/dates'
import { cn } from '@/lib/utils'

export type DueStatusProps = {
  /** Vencimiento `yyyy-MM-dd`, o `null` si no tiene. */
  dueDate: string | null
  /** Hoy en Córdoba (`yyyy-MM-dd`): lo pasa la página (`acc_today` / `useAccounting().today`). */
  today: string
  /** Pagada (o cobrada, con `group="receivables"`). */
  settled?: boolean
  /** `due_soon_days` del bar. Default 7. */
  soonDays?: number
  /** Las cobrables dicen «Cobrada» en vez de «Pagada». */
  group?: 'payables' | 'receivables'
  /** Suma « · 22/10/2026» después del texto. */
  showDate?: boolean
  className?: string
}

const TONE = {
  overdue: { dot: 'bg-destructive', text: 'text-destructive' },
  today: { dot: 'bg-warning', text: 'text-warning-text' },
  soon: { dot: 'bg-warning', text: 'text-warning-text' },
  current: { dot: 'bg-success', text: 'text-muted-foreground' },
  settled: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  'no-due': { dot: 'bg-muted-foreground/30', text: 'text-muted-foreground' },
} as const

/**
 * Semáforo de una partida: siempre punto + palabras, nunca solo color.
 * «Vencida hace 3 días» · «Vence hoy» · «Vence en 5 días» · «Al día» ·
 * «Pagada» · «Sin vencimiento». Server-safe.
 */
export function DueStatus({
  dueDate,
  today,
  settled = false,
  soonDays = DEFAULT_SOON_DAYS,
  group = 'payables',
  showDate = false,
  className,
}: DueStatusProps) {
  const bucket = dueBucket(dueDate, today, soonDays, settled)
  const tone = TONE[bucket]
  const label = dueLabel(dueDate, today, { soonDays, settled, group })
  const date = showDate && dueDate ? formatIsoDay(dueDate) : ''
  return (
    <span
      data-slot="due-status"
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums',
        tone.text,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} />
      {label}
      {date ? <span className="text-muted-foreground">· {date}</span> : null}
    </span>
  )
}
