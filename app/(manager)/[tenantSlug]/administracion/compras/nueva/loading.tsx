import { Skeleton } from '@/components/ui/skeleton'

/** Una sección numerada: el círculo, el título, su ayuda y lo que se contesta. */
function StepSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}

/**
 * «Cargar una compra que debo» mientras carga, con su forma real: las cuatro
 * secciones numeradas a la izquierda y la silueta del ticket a la derecha.
 */
export default function NuevaCompraLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando la compra…</span>
      <div className="space-y-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="space-y-4 sm:space-y-5">
          <StepSkeleton>
            <div className="flex flex-wrap gap-2">
              {['w-28', 'w-36', 'w-24', 'w-32'].map((w) => (
                <Skeleton key={w} className={`h-11 rounded-full md:h-9 ${w}`} />
              ))}
            </div>
            <Skeleton className="h-11 w-full" />
          </StepSkeleton>
          <StepSkeleton>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {['a', 'b', 'c', 'd'].map((k) => (
                <Skeleton key={k} className="h-28 rounded-2xl" />
              ))}
            </div>
          </StepSkeleton>
          <StepSkeleton>
            <Skeleton className="h-16 w-full rounded-2xl" />
          </StepSkeleton>
          <StepSkeleton>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          </StepSkeleton>
        </div>
        {/* El ticket: papel angosto con su encabezado, tres renglones y el total. */}
        <div className="hidden xl:block">
          <div className="mx-auto w-full max-w-[22rem] space-y-4 rounded-md border border-border/60 bg-card p-5">
            <Skeleton className="mx-auto h-5 w-40" />
            <Skeleton className="mx-auto h-3 w-28" />
            <Skeleton className="h-px w-full" />
            {['a', 'b', 'c'].map((k) => (
              <div key={k} className="flex justify-between gap-4">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            ))}
            <Skeleton className="h-px w-full" />
            <div className="flex items-end justify-between gap-4">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-7 w-32" />
            </div>
            <Skeleton className="mx-auto h-3 w-48" />
          </div>
        </div>
      </div>
    </div>
  )
}
