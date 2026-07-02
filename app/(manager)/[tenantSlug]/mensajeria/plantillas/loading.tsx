import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Configuración"
        title="Plantillas de WhatsApp"
        description={<Skeleton className="h-4 w-96" />}
        actions={<Skeleton className="h-9 w-32" />}
      />
      <div className="space-y-2">
        {['t1', 't2', 't3', 't4', 't5', 't6'].map((k) => (
          <Skeleton key={k} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
