import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell width="compact">
      <PageHeader
        eyebrow="Configuración"
        title="Canales"
        description={<Skeleton className="h-4 w-72 max-w-full" />}
      />
      {/* Dos cards de canal + guía de pasos, mismas proporciones que la página real */}
      <Skeleton className="h-52 w-full rounded-xl" />
      <Skeleton className="h-52 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </PageShell>
  )
}
