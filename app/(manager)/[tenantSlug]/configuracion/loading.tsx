import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Ajustes"
        title="Configuración"
        description={<Skeleton className="h-4 w-80" />}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {['c1', 'c2', 'c3'].map((k) => (
          <Skeleton key={k} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
