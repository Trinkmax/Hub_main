import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Negocio"
        title="Mis números"
        description={<Skeleton className="h-4 w-56" />}
      />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['k1', 'k2', 'k3', 'k4'].map((k) => (
          <Skeleton key={k} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="space-y-2">
        {['s1', 's2', 's3', 's4', 's5'].map((k) => (
          <Skeleton key={k} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
