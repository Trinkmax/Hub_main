import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Marketing"
        title="Link de Instagram"
        description={<Skeleton className="h-4 w-[30rem] max-w-full" />}
      />
      <Skeleton className="h-11 w-full rounded-xl" />
      {/* Misma grilla que LinksManager: editor + previa sticky. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-6">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <Skeleton className="h-[34rem] w-full rounded-[2rem]" />
      </div>
    </PageShell>
  )
}
