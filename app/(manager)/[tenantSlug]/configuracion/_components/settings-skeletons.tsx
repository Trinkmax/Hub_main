import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/*
 * Piezas de esqueleto que se repiten en los `loading.tsx` de Configuración,
 * armadas con el `Skeleton` del kit y con los altos finales (así nada salta
 * al cargar). Decorativas: el «Cargando…» lo anuncia `SkeletonStatus`.
 */

/** Título de `Section` (20/28) y, si hay, su línea de descripción (13/18). */
export function SectionTitleSkeleton({
  description = true,
  className,
}: {
  description?: boolean
  className?: string
}) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-1', className)}>
      <div className="flex h-7 items-center">
        <Skeleton className="h-4 w-36" />
      </div>
      {description ? (
        <div className="flex h-[1.125rem] items-center">
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      ) : null}
    </div>
  )
}

/** Un `Field` apilado: etiqueta de 13/18, 8 px y el control del alto de los campos. */
export function FieldSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      <div className="flex h-[1.125rem] items-center">
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-(--control-md) w-full rounded-md" />
    </div>
  )
}

/** Una fila `Field layout="toggle"`: etiqueta y ayuda a la izquierda, interruptor a la derecha. */
export function ToggleSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex min-h-11 items-center justify-between gap-4', className)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-40 max-w-full" />
        <Skeleton className="h-2.5 w-64 max-w-full" />
      </div>
      <Skeleton className="h-5 w-9 rounded-full pointer-coarse:h-6 pointer-coarse:w-11" />
    </div>
  )
}
