import { Planilla, SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Asiento manual y «Sueldos del mes» mientras cargan: el título, los campos de arriba y la grilla.
 * El esqueleto no sabe todavía cuál de las dos caras toca: dibuja la de la grilla.
 */
export default function AsientoManualLoading() {
  return (
    <SimplePage width="narrow">
      <div className="grid gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-52" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {['a', 'b', 'c', 'd', 'e'].map((k) => (
          <div key={k} className="space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full md:h-9" />
          </div>
        ))}
      </div>
      <Planilla>
        <div className="divide-y divide-border/60">
          {['1', '2', '3'].map((k) => (
            <div key={k} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-9 w-36" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 bg-secondary/40 px-3 py-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 w-40 md:h-9" />
        </div>
      </Planilla>
    </SimplePage>
  )
}
