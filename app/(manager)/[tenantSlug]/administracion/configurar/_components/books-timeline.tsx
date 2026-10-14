import { fiscalYearEndOnOrAfter, formatIsoDay, isRealIsoDay } from '@/lib/dates'

/**
 * La línea de los libros: el día desde el que se va a cargar, marcado sobre
 * una línea que llega hasta el cierre del primer ejercicio. A la izquierda de
 * la marca, lo de antes (no se carga acá: entra como saldos iniciales); a la
 * derecha, desde donde se carga todo.
 *
 * Va en el único lugar donde se elige esa fecha (el paso 1 de la puesta en
 * marcha), porque después del primer comprobante ya no se cambia: el dibujo
 * muestra que es un piso antes de que la persona siga. En Ajustes, con la
 * fecha ya fija, alcanza la oración.
 *
 * Decorativa para lectores: lo mismo está dicho en la oración de abajo.
 */
export function BooksTimeline({
  booksStartDate,
  fiscalYearEndMonth,
}: {
  booksStartDate: string | null
  fiscalYearEndMonth: number
}) {
  if (!booksStartDate || !isRealIsoDay(booksStartDate)) return null
  let end: string
  try {
    end = fiscalYearEndOnOrAfter(booksStartDate, fiscalYearEndMonth)
  } catch {
    return null
  }
  const start = formatIsoDay(booksStartDate)
  return (
    <div className="rounded-xl bg-secondary/50 p-3 sm:p-4">
      <div aria-hidden className="grid grid-cols-[minmax(0,3fr)_auto_minmax(0,7fr)] items-center">
        {/* Lo de antes: punteado, no se carga. */}
        <span className="border-t-2 border-dashed border-adm-neutral" />
        <span className="flex size-4 items-center justify-center rounded-full bg-primary ring-4 ring-primary/15">
          <span className="size-1.5 rounded-full bg-primary-foreground" />
        </span>
        {/* Desde acá: línea llena hasta el cierre del ejercicio. */}
        <span className="flex items-center">
          <span className="h-0.5 flex-1 rounded-full bg-adm-in" />
          <span className="h-3 w-0.5 rounded-full bg-adm-in" />
        </span>
      </div>
      <div
        aria-hidden
        className="mt-2 grid grid-cols-[minmax(0,3fr)_minmax(0,7fr)] gap-x-3 text-xs leading-snug"
      >
        <p className="text-muted-foreground text-pretty">
          Lo de antes<span className="max-sm:hidden">: entra como saldos iniciales</span>
        </p>
        <p className="flex justify-between gap-x-3">
          <span className="min-w-0 text-pretty">
            <b className="font-semibold tabular-nums">{start}</b>
            <span className="max-sm:hidden"> · desde acá cargás todo</span>
          </span>
          <span className="shrink-0 text-muted-foreground tabular-nums">{formatIsoDay(end)}</span>
        </p>
      </div>
      <p className="mt-2.5 border-t border-border/60 pt-2.5 text-sm text-pretty">
        Primer ejercicio: del <span className="tabular-nums">{start}</span> al{' '}
        <span className="tabular-nums">{formatIsoDay(end)}</span>.
      </p>
    </div>
  )
}
