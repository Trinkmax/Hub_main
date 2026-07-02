import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

export default function Loading() {
  return (
    <main className="space-y-6 py-6">
      <PageHeader title="Tags de carta" description={<Skeleton className="h-4 w-80" />} />
      <ListSkeleton rows={6} />
    </main>
  )
}
