import { Planilla } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = ['a', 'b', 'c', 'd'] as const

/** La tabla de Caja mientras carga, con su forma: nada salta de lugar cuando llegan los saldos. */
export function AccountsSkeleton() {
  return (
    <Planilla>
      <div aria-hidden>
        <div className="flex items-center justify-between gap-4 border-b border-border bg-secondary/50 px-3 py-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        {ROWS.map((key) => (
          <div
            key={key}
            className="flex items-center gap-4 border-b border-border/60 px-3 py-2.5 last:border-b-0"
          >
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20 max-sm:hidden" />
            <Skeleton className="h-3 w-20 max-sm:hidden" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t-[1.5px] border-foreground/30 bg-secondary px-3 py-2.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    </Planilla>
  )
}
