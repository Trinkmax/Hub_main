import { Skeleton } from '@/components/ui/skeleton'

/**
 * El esqueleto del tablero con su forma real: la barra (título, resumen, filtros)
 * y dos grupos con sus filas. Sirve igual para `?vista=rutina` porque la barra es
 * la misma y lo de abajo son renglones.
 */
export default function Loading() {
  return (
    <div className="@container mx-auto w-full max-w-7xl px-4 pb-12 pt-3 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 pb-4 pt-1 lg:flex-row lg:items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2 lg:ml-auto">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-40 rounded-full" />
          <Skeleton className="hidden h-9 w-32 rounded-md lg:block" />
        </div>
      </div>
      {['a', 'b'].map((group) => (
        <div key={group} className="mb-6 overflow-hidden rounded-lg border border-border/70">
          <div className="flex h-11 items-center gap-3 border-b border-border/70 px-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-2 w-28 rounded-full" />
          </div>
          {['1', '2', '3', '4'].map((row) => (
            <div
              key={row}
              className="flex h-10 items-center gap-3 border-b border-border/60 bg-card px-4 last:border-b-0"
            >
              <Skeleton className="h-3.5 w-[45%]" />
              <Skeleton className="ml-auto h-6 w-6 rounded-full" />
              <Skeleton className="hidden h-6 w-28 rounded @3xl:block" />
              <Skeleton className="h-6 w-24 rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
