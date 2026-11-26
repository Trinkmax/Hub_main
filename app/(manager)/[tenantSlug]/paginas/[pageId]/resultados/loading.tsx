import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function ResultadosLoading() {
  return (
    <PageShell width="comfortable">
      <div className="grid gap-3 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-14 w-20" />
        <Skeleton className="h-5 w-[28rem] max-w-full" />
      </div>
      <div className="grid gap-3">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <Skeleton key={key} className="h-16 w-full" />
        ))}
      </div>
    </PageShell>
  )
}
