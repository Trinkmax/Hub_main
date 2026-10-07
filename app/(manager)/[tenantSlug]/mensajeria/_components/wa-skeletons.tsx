import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * El encabezado de una página de Mensajería mientras carga. Copia el
 * `PageHeader` tal como se ve adentro del clon de WhatsApp (`.wa` en
 * globals.css): sin la fila de contexto (el `.wa` la esconde), título de 19 px
 * en su línea de 25 y descripción de una línea. El preset del kit
 * (`SkeletonPageHeader`) dibuja el título de 28 px del resto del panel y la
 * página saltaba al cargar.
 */
export function WaSkeletonPageHeader({
  description = true,
  actions = 0,
  className,
}: {
  description?: boolean
  /** Cuántos botones de acción, a la derecha. */
  actions?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-page-header"
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex h-[1.5625rem] items-center">
          <Skeleton className="h-5 w-48 max-w-full" />
        </div>
        {description ? (
          <div className="flex h-5 items-center">
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
        ) : null}
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton
              key={`action-${i.toString()}`}
              className={cn('h-(--control-md) rounded-md', i === actions - 1 ? 'w-40' : 'w-32')}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
