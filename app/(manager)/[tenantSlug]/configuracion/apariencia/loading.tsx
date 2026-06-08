import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración · Apariencia"
        title="Apariencia"
        description={<Skeleton className="h-4 w-64" />}
      />
      {['a1', 'a2', 'a3'].map((k) => (
        <Skeleton key={k} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  )
}
