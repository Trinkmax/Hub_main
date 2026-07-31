import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Salón" title="Validar" description={<Skeleton className="h-4 w-64" />} />
      <Skeleton className="h-56 w-full rounded-2xl" />
    </div>
  )
}
