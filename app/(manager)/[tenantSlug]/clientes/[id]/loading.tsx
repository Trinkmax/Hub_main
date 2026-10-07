import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton'

/**
 * Copia la ficha del cliente: «volver», nombre y acciones, etiquetas, los tres
 * números, hábitos y QR lado a lado, las pestañas y la lista de visitas.
 */
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <div className="flex flex-col gap-4">
        <SkeletonPageHeader context actions={3} />
        <div aria-hidden="true" className="flex gap-1.5">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
      <SkeletonKPIGroup count={3} columns={3} />
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <Skeleton className="h-4 w-40" />
          <SkeletonText lines={4} />
        </div>
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <Skeleton className="h-4 w-28" />
          <div className="flex gap-4">
            <Skeleton className="size-40 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <div aria-hidden="true" className="flex h-10 items-center gap-6 border-b border-border">
          {['w-14', 'w-14', 'w-12', 'w-16', 'w-16', 'w-12'].map((width, i) => (
            <Skeleton key={`tab-${i.toString()}`} className={`h-3 ${width}`} />
          ))}
        </div>
        <SkeletonTable rows={5} columns={4} />
      </div>
    </PageShell>
  )
}
