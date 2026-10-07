import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonForm,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

const TAB_WIDTHS = [
  { key: 'programa', width: 'w-32' },
  { key: 'aliados', width: 'w-16' },
  { key: 'bienvenida', width: 'w-24' },
  { key: 'punch', width: 'w-24' },
] as const

// Espejo del ClubEditor: encabezado (título, descripción y tres acciones), la
// fila de pestañas y la primera sección del programa (el formulario de la
// regla, las reglas avanzadas y la lista). Así nada salta al hidratar.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <div className="flex flex-col gap-4">
        <SkeletonPageHeader actions={3} />
        <div aria-hidden="true" className="flex gap-4 shadow-[inset_0_-1px_0_0_var(--border)]">
          {TAB_WIDTHS.map((tab) => (
            <div key={tab.key} className="flex min-h-10 items-center px-1 pointer-coarse:min-h-11">
              <Skeleton className={`h-3 ${tab.width}`} />
            </div>
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex h-7 items-center">
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="flex h-[1.125rem] items-center">
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <SkeletonForm fields={3} actions={false} />
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <SkeletonTable rows={2} columns={4} />
      </div>
    </PageShell>
  )
}
