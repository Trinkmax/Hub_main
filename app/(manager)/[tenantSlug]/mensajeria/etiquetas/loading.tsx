import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Mensajería"
        title="Etiquetas de conversación"
        description={<Skeleton className="h-4 w-96 max-w-full" />}
      />
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="space-y-2">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
