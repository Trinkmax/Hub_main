import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'

/**
 * Esqueleto fiel al tablero: encabezado del día (contexto, título, selector de
 * día y acciones), pulso, barra de búsqueda y filtros, y dos servicios con sus
 * reservas. Mismas alturas y radios que lo real (tokens del kit) para que no
 * salte nada al llegar los datos.
 */
export default function OperativoLoading() {
  return (
    <PageShell width="wide" aria-busy="true" className="pb-16 sm:pb-16">
      <SkeletonStatus label="Cargando el tablero…" />

      {/* Encabezado: contexto · título · [‹ día ›] [Escanear QR] [Nueva reserva] */}
      <div
        aria-hidden="true"
        className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex h-[1.125rem] items-center">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex h-[2.125rem] items-center lg:h-9">
            <Skeleton className="h-7 w-64 max-w-full" />
          </div>
        </div>
        <div className="flex items-center gap-2 max-sm:mt-1">
          <Skeleton className="size-(--control-md) rounded-md" />
          <Skeleton className="h-(--control-md) w-32 rounded-md" />
          <Skeleton className="size-(--control-md) rounded-md" />
          <Skeleton className="h-(--control-md) w-32 rounded-md max-sm:hidden" />
          <Skeleton className="h-(--control-md) w-36 rounded-md max-sm:hidden" />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6"
      >
        <div className="min-w-0">
          {/* Pulso */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-end">
              <div>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-12 w-40" />
                <Skeleton className="mt-4 h-3 w-full rounded-full" />
                <div className="mt-3 flex gap-2">
                  <Skeleton className="h-(--control-sm) w-28 rounded-full" />
                  <Skeleton className="h-(--control-sm) w-32 rounded-full" />
                </div>
              </div>
              <div>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-2 h-4 w-48" />
                <Skeleton className="mt-3 h-14 w-full rounded-lg" />
              </div>
            </div>
          </div>

          {/* Barra de búsqueda y filtros */}
          <div className="mt-4 flex flex-col gap-2 border-b border-border py-2">
            <Skeleton className="h-(--control-md) w-full rounded-md" />
            <Skeleton className="h-(--control-md) w-80 max-w-full rounded-md" />
          </div>

          {/* Lista por servicio */}
          <div className="mt-4 flex flex-col gap-6">
            {[0, 1].map((g) => (
              <div key={g} className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="grid min-h-[84px] grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-card px-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:px-4"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        <Skeleton className="h-4 w-10" />
                        <Skeleton className="h-3 w-6" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-40 max-w-full" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-(--control-md) w-20 rounded-md" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Aside de escritorio: el pulso extendido */}
        <div className="hidden lg:block">
          <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-48" />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
