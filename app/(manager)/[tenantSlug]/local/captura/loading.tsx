import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Configuración"
        title="Captura de clientes"
        description={<Skeleton className="h-4 w-96" />}
      />
      <Skeleton className="h-40 w-full rounded-xl" />
      <section className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="space-y-2">
          {['l1', 'l2', 'l3'].map((k) => (
            <Skeleton key={k} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </section>
    </div>
  )
}
