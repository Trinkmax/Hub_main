import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonText,
} from '@/components/ui/skeleton'
import { SectionTitleSkeleton } from './_components/settings-skeletons'

/** Copia la portada: encabezado y tres secciones de dos tarjetas (ícono, título, dos líneas). */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <SkeletonStatus />
      <SkeletonPageHeader />
      {['equipo', 'salon', 'marca'].map((group) => (
        <div key={group} className="flex flex-col gap-4">
          <SectionTitleSkeleton description={false} />
          <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
            {['a', 'b'].map((card) => (
              <div
                key={card}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 sm:p-6"
              >
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex h-6 items-center">
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                  <SkeletonText lines={2} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
