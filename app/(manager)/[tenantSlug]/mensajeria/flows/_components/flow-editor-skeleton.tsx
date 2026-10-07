import { Skeleton } from '@/components/ui/skeleton'

/**
 * El editor de automatizaciones mientras carga: barra de arriba, paleta de
 * pasos y lienzo, estirado al alto que le deja la página (flex-1).
 */
export function FlowEditorSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[28rem] flex-1 flex-col overflow-clip rounded-xl border border-border bg-card"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Skeleton className="h-(--control-sm) w-64 rounded-md" />
        <Skeleton className="h-5 w-24" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-(--control-sm) w-24 rounded-md" />
          <Skeleton className="h-(--control-sm) w-20 rounded-md" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col gap-1.5 border-r border-border p-3">
          <Skeleton className="mb-1 h-3 w-24" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex flex-1 items-start justify-center p-8">
          <div className="flex w-56 flex-col gap-6">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
