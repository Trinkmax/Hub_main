import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonText,
} from '@/components/ui/skeleton'

/**
 * Carga del asistente de configuración inicial. Antes heredaba el esqueleto
 * del Resumen (una fila de KPIs) y la pantalla saltaba al llegar: este copia
 * la bienvenida real (encabezado y una tarjeta con ícono, título, los cuatro
 * pasos y las acciones). Sin `<main>` propio: lo pone el shell.
 */
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader />
      <div
        aria-hidden="true"
        className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 sm:p-8"
      >
        <div className="flex items-start gap-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex h-7 items-center">
              <Skeleton className="h-5 w-48 max-w-full" />
            </div>
            <SkeletonText lines={2} />
          </div>
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={`step-${i.toString()}`} className="flex items-start gap-3">
              <Skeleton className="mt-0.5 size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex h-[1.125rem] items-center">
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex h-[1.125rem] items-center">
                  <Skeleton className="h-2.5 w-44 max-w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-(--control-md) w-36 rounded-md" />
          <Skeleton className="h-(--control-md) w-28 rounded-md" />
        </div>
      </div>
    </PageShell>
  )
}
