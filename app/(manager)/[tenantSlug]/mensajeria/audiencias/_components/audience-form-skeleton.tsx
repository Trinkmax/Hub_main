import { Skeleton } from '@/components/ui/skeleton'

/**
 * El formulario de audiencia mientras carga: nombre, grupos listos, armado a
 * medida, conteo y acciones, con los altos del formulario real.
 */
export function AudienceFormSkeleton({ conditions = 0 }: { conditions?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-(--control-md) w-full rounded-md sm:max-w-md" />
        <Skeleton className="h-2.5 w-64" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
        {Array.from({ length: conditions }, (_, i) => (
          <Skeleton key={`condition-${i.toString()}`} className="h-14 w-full rounded-lg" />
        ))}
        {conditions === 0 ? <Skeleton className="h-16 w-full rounded-lg" /> : null}
        <Skeleton className="h-(--control-sm) w-44 rounded-md" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="flex justify-end gap-2">
        <Skeleton className="h-(--control-md) w-24 rounded-md" />
        <Skeleton className="h-(--control-md) w-36 rounded-md" />
      </div>
    </div>
  )
}
