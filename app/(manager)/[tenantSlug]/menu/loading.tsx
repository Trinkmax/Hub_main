import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Catálogo"
        title="Carta"
        description={<Skeleton className="h-4 w-72" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-9 w-36" />
          </div>
        }
      />
      <div className="space-y-4">
        {['c1', 'c2', 'c3'].map((k) => (
          <Skeleton key={k} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
