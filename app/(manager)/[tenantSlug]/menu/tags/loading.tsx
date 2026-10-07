import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

const CHIPS = ['c1', 'c2', 'c3', 'c4'] as const

// Espejo de la página de tags: «volver» a la carta, título, los tags
// disponibles en chips y la tabla de ítems con sus tags.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex h-7 items-center">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((chip) => (
            <Skeleton key={chip} className="h-6 w-20 rounded-sm" />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex h-7 items-center">
          <Skeleton className="h-5 w-48" />
        </div>
        <SkeletonTable rows={6} columns={2} />
      </div>
    </PageShell>
  )
}
