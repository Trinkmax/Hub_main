import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'
import { FieldSkeleton } from '../_components/settings-skeletons'

/** Copia el editor: tarjetas de torta (número, bizcochuelo y nombre, rellenos y el pie). */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div aria-hidden="true" className="flex max-w-4xl flex-col gap-3">
        {['t1', 't2', 't3'].map((cake) => (
          <div
            key={cake}
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
          >
            <div className="flex items-start gap-3">
              <Skeleton className="mt-[1.625rem] size-8 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <FieldSkeleton />
                  <FieldSkeleton />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Skeleton className="h-(--control-md) w-full rounded-md" />
                  <Skeleton className="h-(--control-md) w-full rounded-md" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-(--control-sm) w-24 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
