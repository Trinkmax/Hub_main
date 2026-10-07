import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={<Skeleton className="h-3 w-28" />}
        title="Comisiones"
        description={<Skeleton className="h-4 w-48" />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-28" />
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['s1', 's2', 's3', 's4'].map((k) => (
          <Skeleton key={k} className="h-24 w-full rounded-xl" />
        ))}
      </section>
      <div className="space-y-2">
        {['r1', 'r2', 'r3', 'r4', 'r5'].map((k) => (
          <Skeleton key={k} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
