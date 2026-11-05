import { Planilla, PlanillaBar, SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'

/** El totalizador mientras carga: los números con su lugar. */
export function TotalizerSkeleton({ items }: { items: number }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
      {Array.from({ length: items }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
        <div key={index} className="space-y-1.5 px-4 py-2.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-28 max-w-full" />
        </div>
      ))}
    </div>
  )
}

/**
 * Una pantalla de la sección mientras carga, con la forma real: los meses, el totalizador y la
 * planilla con sus filas. Nunca dice «no hay nada» mientras carga.
 */
export function SheetSkeleton({
  label,
  totals = 4,
  rows = 7,
}: {
  /** «Cargando Gastos fijos…». */
  label: string
  totals?: number
  rows?: number
}) {
  return (
    <SimplePage>
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      <PlanillaBar>
        <Skeleton className="h-8 w-44 rounded-lg pointer-coarse:h-11" />
      </PlanillaBar>
      <TotalizerSkeleton items={totals} />
      <Planilla>
        <div className="border-b border-border bg-secondary/50 px-3 py-2.5">
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
            key={index}
            className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0"
          >
            <Skeleton className="size-6 shrink-0 rounded-md" />
            <Skeleton className="h-3.5 w-10 shrink-0" />
            <Skeleton className="h-3.5 w-44 max-w-full" />
            <Skeleton className="ml-auto h-3.5 w-20 shrink-0" />
            <Skeleton className="hidden h-5 w-20 shrink-0 rounded-[5px] sm:block" />
          </div>
        ))}
      </Planilla>
    </SimplePage>
  )
}
