import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club de beneficios"
        title="Punch cards"
        description={<Skeleton className="h-4 w-72" />}
      />
      <ListSkeleton rows={6} />
    </div>
  )
}
