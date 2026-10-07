import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Marketing"
        title="Páginas"
        description={<Skeleton className="h-4 w-[32rem] max-w-full" />}
        actions={<Skeleton className="h-9 w-36 rounded-md" />}
      />
      {/* Mismas tarjetas que PagesList. */}
      <div className="grid gap-3">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-[5.5rem] w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  )
}
