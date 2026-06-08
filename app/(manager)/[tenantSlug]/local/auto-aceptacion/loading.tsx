import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow="Salón"
        title="Auto-aceptación de comandas"
        description={<Skeleton className="h-4 w-96" />}
      />
      {['auto', 'cocina', 'timeouts'].map((k) => (
        <Skeleton key={k} className="h-40 w-full rounded-xl" />
      ))}
    </PageShell>
  )
}
