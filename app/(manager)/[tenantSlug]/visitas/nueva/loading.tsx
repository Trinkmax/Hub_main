import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-32" />
      <PageHeader
        eyebrow="Operación"
        title="Cerrar mesa"
        description={<Skeleton className="h-4 w-80" />}
      />
      <Skeleton className="h-[480px] w-full rounded-xl" />
    </div>
  )
}
