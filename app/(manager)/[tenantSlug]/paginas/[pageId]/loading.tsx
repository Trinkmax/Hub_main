import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** Pestañas del editor: Código · Imágenes · Historial. */
const TABS = [
  { id: 'codigo', width: 'w-16' },
  { id: 'imagenes', width: 'w-20' },
  { id: 'historial', width: 'w-20' },
] as const

/**
 * Espeja el editor: la barra de arriba (volver, título, link y acciones), la
 * previa (arriba en el celular, a la derecha en escritorio) y el código.
 */
export default function Loading() {
  return (
    <PageShell width="wide" className="gap-4" aria-busy="true">
      <SkeletonStatus />
      <div className="-mx-4 border-b border-border px-4 pb-4 sm:-mx-6 sm:px-6 sm:pt-3 lg:-mx-8 lg:px-8">
        <SkeletonPageHeader context actions={4} />
      </div>
      <div
        aria-hidden="true"
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start"
      >
        <div className="order-1 flex flex-col gap-3 lg:order-2">
          <div className="overflow-clip rounded-xl border border-border bg-card">
            <div className="flex h-12 items-center justify-between border-b border-border px-3">
              <Skeleton className="h-(--control-sm) w-20" />
              <Skeleton className="h-(--control-sm) w-16" />
            </div>
            <Skeleton className="h-[42dvh] w-full rounded-none lg:h-[calc(100dvh-var(--topbar-h)-20rem)] lg:min-h-[26rem]" />
          </div>
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
        <div className="order-2 flex flex-col gap-2 lg:order-1">
          <div className="flex min-h-10 items-center gap-4 shadow-[inset_0_-1px_0_0_var(--border)]">
            {TABS.map((tab) => (
              <Skeleton key={tab.id} className={`h-3 ${tab.width}`} />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-(--control-sm) w-28" />
          </div>
          <Skeleton className="h-[52dvh] w-full rounded-xl lg:h-[calc(100dvh-var(--topbar-h)-17.5rem)]" />
        </div>
      </div>
    </PageShell>
  )
}
