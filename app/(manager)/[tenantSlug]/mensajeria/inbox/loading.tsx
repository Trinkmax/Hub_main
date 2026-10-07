import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'

// Copia la bandeja real: lista de chats (encabezado, buscador, chips y filas
// con avatar) y el panel vacío de la derecha en escritorio.
export default function Loading() {
  return (
    <div className="flex h-full min-h-0" aria-busy="true">
      <SkeletonStatus label="Cargando los chats…" />
      <aside
        aria-hidden="true"
        className="w-full min-w-0 border-r border-(--wa-border) bg-(--wa-panel) md:w-[340px] md:shrink-0 lg:w-[380px] xl:w-[420px]"
      >
        <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        <div className="px-3 pt-1 pb-2">
          <Skeleton className="h-9 w-full rounded-full" />
        </div>
        <div className="flex gap-1.5 px-3 pb-2">
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <div className="space-y-1 px-3">
          {Array.from({ length: 8 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton estático
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <section aria-hidden="true" className="hidden min-w-0 flex-1 bg-(--wa-panel-soft) md:block" />
    </div>
  )
}
