import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Configuración"
        title="Equipo"
        description={<Skeleton className="h-4 w-80" />}
      />
      <Skeleton className="h-44 w-full rounded-xl" />
      <section className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="space-y-2">
          {['m1', 'm2', 'm3', 'm4'].map((k) => (
            <Skeleton key={k} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </section>
    </div>
  )
}
