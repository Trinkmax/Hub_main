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
        title="Señas"
        description={<Skeleton className="h-4 w-72" />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-64" />
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {['s1', 's2', 's3', 's4'].map((key) => (
          <Skeleton key={key} className="h-28 w-full rounded-xl" />
        ))}
      </section>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </PageShell>
  )
}
