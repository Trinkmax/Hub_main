import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="space-y-6 py-6">
      <PageHeader title="Documentación" description={<Skeleton className="h-4 w-80" />} />
      <div className="space-y-3">
        {['d1', 'd2', 'd3', 'd4', 'd5'].map((k) => (
          <Skeleton key={k} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </main>
  )
}
