import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** Copia «Cerrar mesa» en el paso 1: encabezado con «volver», los tres pasos y el buscador. */
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div aria-hidden="true" className="flex items-center gap-3">
        {['cliente', 'consumo', 'confirmar'].map((step) => (
          <div key={step} className="flex flex-1 items-center gap-3 last:flex-none">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="hidden h-3 w-24 sm:block" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex max-w-xl flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-(--control-lg) w-full" />
        </div>
        <Skeleton className="h-(--control-md) w-36" />
      </div>
    </PageShell>
  )
}
