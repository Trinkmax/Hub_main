import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Mensajería"
        title="Plantillas de WhatsApp"
        description="Tus mensajes aprobados: WhatsApp los revisa una sola vez y después los usás en difusiones, automatizaciones o para escribirle primero a un cliente."
        actions={
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-9 w-36" />
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {['t1', 't2', 't3', 't4'].map((k) => (
          <div key={k} className="card-hairline space-y-4 rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <Skeleton className="h-20 w-[92%] rounded-lg" />
            <Skeleton className="h-4 w-56" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}
