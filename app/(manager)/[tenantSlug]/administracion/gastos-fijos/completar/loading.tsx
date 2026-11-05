import { SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { TotalizerSkeleton } from '../_components/sheet-skeleton'

/** «Completar la planilla» mientras carga: el título, el total y ocho renglones de dos campos. */
export default function CompletarPlanillaLoading() {
  return (
    <SimplePage width="narrow">
      <span className="sr-only" aria-live="polite">
        Cargando tus gastos fijos…
      </span>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
      </div>
      <TotalizerSkeleton items={2} />
      <div className="flex gap-1.5">
        <Skeleton className="h-9 w-28 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <div className="rounded-xl border border-border/70 bg-card shadow-xs">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
            key={index}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/60 px-3 py-3.5 last:border-b-0 sm:px-5"
          >
            <div className="min-w-0 flex-1 basis-40 space-y-1.5">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
            <div className="flex items-end gap-4">
              <Skeleton className="h-11 w-40" />
              <Skeleton className="h-11 w-16" />
            </div>
          </div>
        ))}
      </div>
    </SimplePage>
  )
}
