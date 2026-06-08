import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

export default function Loading() {
  return (
    <main className="space-y-6 py-6">
      <PageHeader
        eyebrow="Catálogo"
        title="Punch cards"
        description={<Skeleton className="h-4 w-72" />}
      />
      <ListSkeleton rows={6} />
    </main>
  )
}
