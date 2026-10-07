import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="space-y-6 py-6">
      <PageHeader title="Plano de mesas" description={<Skeleton className="h-4 w-96" />} />
      <div className="flex gap-4">
        <Skeleton className="hidden h-[480px] w-56 shrink-0 rounded-xl lg:block" />
        <Skeleton className="h-[480px] flex-1 rounded-xl" />
      </div>
    </main>
  )
}
