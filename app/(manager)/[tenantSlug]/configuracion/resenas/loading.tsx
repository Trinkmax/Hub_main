import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración"
        title="Reseñas"
        description={<Skeleton className="h-4 w-80" />}
      />
      <div className="max-w-2xl space-y-6">
        <Skeleton className="h-[26rem] w-full rounded-xl" />
        <div className="flex justify-end">
          <Skeleton className="h-10 w-28 rounded-md" />
        </div>
      </div>
    </div>
  )
}
