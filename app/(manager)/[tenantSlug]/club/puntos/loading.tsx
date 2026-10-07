import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club de beneficios"
        title="Puntos y recompensas"
        description={<Skeleton className="h-4 w-80" />}
      />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
