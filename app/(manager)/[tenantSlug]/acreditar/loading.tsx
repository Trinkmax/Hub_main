import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Cajero"
        title="Acreditar puntos"
        description={<Skeleton className="h-4 w-72" />}
      />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
