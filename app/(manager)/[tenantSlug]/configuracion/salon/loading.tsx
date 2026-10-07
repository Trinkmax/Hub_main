import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'
import { FieldSkeleton, SectionTitleSkeleton } from '../_components/settings-skeletons'

/**
 * Mismo orden que la página: grilla de cupos por servicio, cupos especiales
 * por fecha, capacidad total del bar y cupo general por planta.
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <SkeletonPageHeader context />

      {/* Cupos por servicio: la tabla 3 × 7 en escritorio, las pestañas en el celular. */}
      <div className="flex flex-col gap-4">
        <SectionTitleSkeleton />
        <div aria-hidden="true" className="overflow-clip rounded-xl border border-border bg-card">
          <div className="hidden md:block">
            <div className="flex h-8 items-center gap-2 border-b border-border-strong bg-muted px-3">
              <Skeleton className="h-2.5 w-full" />
            </div>
            {['almuerzo', 'merienda', 'cena'].map((segment) => (
              <div
                key={segment}
                className="grid grid-cols-[7rem_repeat(7,minmax(0,1fr))] gap-2 border-t border-border p-3 first-of-type:border-t-0"
              >
                <Skeleton className="h-3 w-20" />
                {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                  <div key={dow} className="flex flex-col gap-1">
                    <Skeleton className="h-(--control-sm) w-full rounded-md" />
                    <Skeleton className="h-(--control-sm) w-full rounded-md" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 p-4 md:hidden">
            {[1, 2, 3, 4, 5].map((day) => (
              <div
                key={day}
                className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2"
              >
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-(--control-md) w-full rounded-md" />
                <Skeleton className="h-(--control-md) w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cupos especiales por fecha: el alta en su tarjeta. */}
      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <SectionTitleSkeleton />
        <div
          aria-hidden="true"
          className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-4"
        >
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
      </div>

      {/* Capacidad total y cupo por planta. */}
      {['total', 'plantas'].map((section) => (
        <div key={section} className="flex flex-col gap-4 border-t border-border pt-6">
          <SectionTitleSkeleton />
          <div aria-hidden="true" className="flex max-w-sm flex-col gap-4">
            <FieldSkeleton />
            <div className="flex justify-end">
              <Skeleton className="h-(--control-md) w-48 rounded-md max-sm:w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
