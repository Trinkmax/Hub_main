import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'
import { FieldSkeleton } from '../_components/settings-skeletons'

/** Copia «Tarifas», la pestaña que abre por defecto: la fila de pestañas y una tarjeta por servicio. */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <div aria-hidden="true" className="flex flex-col gap-4">
        <SkeletonPageHeader context />
        <div className="flex min-h-10 items-stretch gap-4 shadow-[inset_0_-1px_0_0_var(--border)] pointer-coarse:min-h-11">
          {['w-14', 'w-24', 'w-16'].map((width) => (
            <div key={width} className="flex items-center px-1">
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex max-w-prose flex-col gap-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        {['desayuno', 'almuerzo', 'merienda'].map((meal) => (
          <div
            key={meal}
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
          >
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-(--control-sm) w-32 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[9rem_9rem_minmax(10rem,14rem)_minmax(0,1fr)]">
              <FieldSkeleton />
              <FieldSkeleton />
              <FieldSkeleton className="col-span-2 sm:col-span-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
