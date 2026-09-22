import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Operaciones"
        title="Reservas"
        description={<Skeleton className="h-4 w-72" />}
      />
      <div className="card-hairline rounded-xl border bg-card/40 p-2">
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="space-y-2">
        {['s1', 's2', 's3', 's4', 's5', 's6'].map((k) => (
          <Skeleton key={k} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
