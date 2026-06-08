import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="space-y-8 py-6">
      <PageHeader
        eyebrow="Configuración"
        title="Regalo de bienvenida"
        description={<Skeleton className="h-4 w-96" />}
      />
      <Skeleton className="h-64 w-full rounded-xl" />
      <section className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </section>
    </main>
  )
}
