import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club de beneficios"
        title="Niveles del club"
        description={<Skeleton className="h-4 w-96 max-w-full" />}
      />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  )
}
