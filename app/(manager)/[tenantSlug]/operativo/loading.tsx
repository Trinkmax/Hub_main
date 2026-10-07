import { Skeleton } from '@/components/ui/skeleton'

/**
 * Esqueleto fiel al tablero: cabecera del día, pulso, barra de trabajo y tres
 * tarjetas por servicio. Mismas alturas que lo real para que no salte nada al
 * llegar los datos.
 */
export default function OperativoLoading() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-28" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="size-11 rounded-full" />
          </div>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-11 w-32 rounded-full" />
          <Skeleton className="h-11 w-36 rounded-full" />
        </div>
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6">
        <div className="min-w-0">
          {/* Pulso */}
          <div className="card-hairline rounded-2xl border bg-card p-4 sm:p-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-end">
              <div>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-12 w-40" />
                <Skeleton className="mt-4 h-3 w-full rounded-full" />
                <div className="mt-3 flex gap-1.5">
                  <Skeleton className="h-9 w-28 rounded-full" />
                  <Skeleton className="h-9 w-32 rounded-full" />
                </div>
              </div>
              <div>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-2 h-4 w-48" />
                <Skeleton className="mt-3 h-14 w-full rounded-lg" />
              </div>
            </div>
          </div>

          {/* Barra de trabajo */}
          <div className="mt-4 space-y-2 py-2">
            <Skeleton className="h-11 w-full rounded-full" />
            <div className="flex gap-1.5">
              <Skeleton className="h-9 w-20 rounded-full" />
              <Skeleton className="h-9 w-24 rounded-full" />
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          </div>

          {/* Lista */}
          <div className="mt-4 space-y-6">
            {[0, 1].map((g) => (
              <div key={g}>
                <Skeleton className="mb-2 h-5 w-32" />
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="card-hairline grid h-[84px] grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-card px-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:px-4"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        <Skeleton className="h-4 w-10" />
                        <Skeleton className="h-3 w-6" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-11 w-24 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="card-hairline space-y-4 rounded-2xl border bg-card p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
