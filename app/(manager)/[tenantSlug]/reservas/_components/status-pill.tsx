import type { SalonReservationStatus } from '@/lib/salon/types'
import { STATUS_LABELS } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const STYLES: Record<SalonReservationStatus, string> = {
  pending:
    'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60',
  arrived:
    'bg-blue-50 text-blue-900 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/60',
  seated:
    'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/60',
  closed:
    'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800',
  no_show:
    'bg-rose-50 text-rose-900 ring-rose-200 line-through dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60',
  cancelled:
    'bg-zinc-100 text-zinc-500 ring-zinc-200 line-through dark:bg-zinc-900/60 dark:text-zinc-500 dark:ring-zinc-800',
}

export function StatusPill({
  status,
  className,
}: {
  status: SalonReservationStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  )
}
