import { ChevronDown } from 'lucide-react'
import { CancelBatchButton, RebuildButton } from './batch-actions'

/**
 * «Más opciones», al final de la revisión y plegado: volver a armar el archivo
 * con los datos de hoy y descartarlo. Antes eran dos botones del mismo peso
 * arriba a la derecha del título: uno que nadie sabía cuándo hacía falta y otro
 * que no tiene vuelta atrás. Acá cada uno dice para qué sirve.
 *
 * Solo lo monta la página para quien puede cargar, con el archivo abierto y con
 * algo adentro (la misma condición de siempre).
 */
export function MoreOptions({
  slug,
  batchId,
  posted,
}: {
  slug: string
  batchId: string
  /** Cuántos ya se cargaron (para decirlo al descartar). */
  posted: number
}) {
  return (
    <details className="group/more rounded-2xl border border-dashed border-border [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        Más opciones
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-(--duration-fast) ease-(--ease-out) group-open/more:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <ul className="divide-y divide-border/60 border-t border-border/60 px-4">
        <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-muted-foreground text-pretty">
            Usalo si cambiaste un proveedor, una categoría o algo que me enseñaste en otra pestaña.
          </p>
          <RebuildButton slug={slug} batchId={batchId} className="shrink-0" />
        </li>
        <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-muted-foreground text-pretty">
            Si subiste el archivo equivocado. Lo que ya se cargó sigue registrado.
          </p>
          <div className="shrink-0">
            <CancelBatchButton slug={slug} batchId={batchId} posted={posted} />
          </div>
        </li>
      </ul>
    </details>
  )
}
