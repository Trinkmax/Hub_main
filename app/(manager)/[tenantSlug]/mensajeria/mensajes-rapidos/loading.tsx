import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow="Mensajería"
        title="Mensajes rápidos"
        description={<Skeleton className="h-4 w-80 max-w-full" />}
      />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="space-y-3">
        {['a', 'b', 'c'].map((k) => (
          <Skeleton key={k} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  )
}
