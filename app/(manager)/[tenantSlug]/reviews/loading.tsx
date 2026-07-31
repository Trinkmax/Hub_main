import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-8 py-6">
      <PageHeader
        eyebrow="Fidelización"
        title="Reseñas"
        description={<Skeleton className="h-4 w-[28rem] max-w-full" />}
      />
      {/* Mismo grid que ReviewsInsights: 3 tarjetas chicas + distribución. */}
      <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_1.4fr]">
        {['s1', 's2', 's3', 's4'].map((k) => (
          <Skeleton key={k} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  )
}
