import { Skeleton } from '@/components/ui/skeleton'

/** La Puesta en marcha mientras carga: la barra de avance y la planilla de pasos. */
export default function ComoArrancarLoading() {
  return (
    <div
      className="mx-auto grid w-full max-w-5xl content-start gap-3.5 px-4 pt-3.5 pb-24 sm:px-6 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando la puesta en marcha…</span>
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
        <Skeleton className="m-3 h-4 w-48" />
        <div className="divide-y divide-border/60 border-t border-border/70">
          {Array.from({ length: 8 }, (_, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filas de relleno
            <div key={row} className="flex items-center gap-4 px-3 py-2.5">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-8 w-12 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
