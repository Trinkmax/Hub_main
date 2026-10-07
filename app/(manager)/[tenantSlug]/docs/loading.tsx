import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonText,
} from '@/components/ui/skeleton'

/** Ancho de cada etiqueta del índice, fijo por posición (el HTML del server y el del cliente coinciden). */
const TOC_WIDTHS = [
  'w-20',
  'w-28',
  'w-24',
  'w-16',
  'w-32',
  'w-28',
  'w-28',
  'w-24',
  'w-24',
  'w-32',
  'w-28',
  'w-32',
  'w-36',
  'w-28',
] as const

/**
 * Carga de la guía: copia el layout final (encabezado con el link al catálogo,
 * índice como fila en el celular y como columna desde `lg`, y las primeras
 * secciones), con sus altos, para que nada salte al llegar. Sin `<main>`
 * propio: lo pone el shell.
 */
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={1} />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        {/* Índice: fila subrayada en el celular… */}
        <div
          aria-hidden="true"
          className="flex gap-4 overflow-hidden shadow-[inset_0_-1px_0_0_var(--border)] lg:hidden"
        >
          {TOC_WIDTHS.slice(0, 5).map((width, i) => (
            <div key={`row-${i.toString()}`} className="flex h-10 shrink-0 items-center px-1">
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
        {/* …y columna desde lg. */}
        <div aria-hidden="true" className="hidden lg:flex lg:flex-col lg:gap-0.5">
          {TOC_WIDTHS.map((width, i) => (
            <div key={`col-${i.toString()}`} className="flex h-8 items-center gap-2.5 px-2.5">
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>

        <div aria-hidden="true" className="flex min-w-0 flex-col gap-12 lg:max-w-2xl">
          {[0, 1].map((i) => (
            <div key={`section-${i.toString()}`} className="flex flex-col gap-4">
              <div className="flex h-7 items-center">
                <Skeleton className="h-5 w-56 max-w-full" />
              </div>
              <SkeletonText lines={4} />
              <div className="flex h-6 items-center">
                <Skeleton className="h-4 w-44" />
              </div>
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
