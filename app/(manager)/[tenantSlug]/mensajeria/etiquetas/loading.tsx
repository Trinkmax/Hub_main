import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow="Mensajería"
        title="Etiquetas"
        description={<Skeleton className="h-4 w-96 max-w-full" />}
      />
      <Skeleton className="h-52 w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-28" />
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-13 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  )
}
