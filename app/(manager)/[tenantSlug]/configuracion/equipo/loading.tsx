import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'
import { FieldSkeleton, SectionTitleSkeleton } from '../_components/settings-skeletons'

/** Copia la pantalla: encabezado con «volver», el alta en su tarjeta y la tabla de miembros. */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <SkeletonPageHeader context />

      <div className="flex flex-col gap-4">
        <SectionTitleSkeleton />
        <div
          aria-hidden="true"
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-(--control-md) w-36 rounded-md max-sm:w-full" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <SectionTitleSkeleton />
        {/* En el celular, filas con nombre, email y el rol abajo: como las tarjetas del preset. */}
        <SkeletonTable rows={4} columns={3} />
      </div>
    </div>
  )
}
