import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'
import { FieldSkeleton, SectionTitleSkeleton } from '../_components/settings-skeletons'

/** Copia la pantalla: logo, color del bar e idioma, en secciones separadas por un pelo. */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div className="flex max-w-3xl flex-col gap-8">
        <div className="flex flex-col gap-4">
          <SectionTitleSkeleton />
          <div
            aria-hidden="true"
            className="flex items-center gap-4 rounded-xl border border-dashed border-border-strong bg-card p-4"
          >
            <Skeleton className="size-20 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
          <Skeleton aria-hidden="true" className="h-(--control-md) w-32 rounded-md" />
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-6">
          <SectionTitleSkeleton />
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-12 w-full rounded-lg" />
            <div className="flex flex-wrap gap-2">
              {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((swatch) => (
                <Skeleton key={swatch} className="size-8 rounded-full" />
              ))}
            </div>
            <FieldSkeleton className="max-w-48" />
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-6">
          <SectionTitleSkeleton />
          <div aria-hidden="true" className="flex max-w-md flex-col gap-2">
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      </div>
    </div>
  )
}
