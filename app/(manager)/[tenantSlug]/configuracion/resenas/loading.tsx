import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'
import { FieldSkeleton, ToggleSkeleton } from '../_components/settings-skeletons'

/** Copia el formulario: enlace de Google, WhatsApp, el interruptor, los puntos y «Guardar». */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <SkeletonPageHeader context actions={1} />
      <div aria-hidden="true" className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <FieldSkeleton />
          <FieldSkeleton className="sm:max-w-72" />
          <div className="border-y border-border py-3">
            <ToggleSkeleton />
          </div>
          <FieldSkeleton className="sm:max-w-56" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-(--control-md) w-28 rounded-md max-sm:w-full" />
        </div>
      </div>
    </div>
  )
}
