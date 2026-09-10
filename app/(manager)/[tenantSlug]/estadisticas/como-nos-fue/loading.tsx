import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

// Mismo `PageShell width="comfortable"` que la page: si el contenedor no
// coincide, el layout salta cuando entran los datos.
export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow={<Skeleton className="h-3 w-24" />}
        title="Cómo nos fue"
        description={<Skeleton className="h-4 w-80" />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </PageShell>
  )
}
