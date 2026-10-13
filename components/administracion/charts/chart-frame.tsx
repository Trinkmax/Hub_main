'use client'

import { ChartLine, Table2 } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * El marco de un gráfico de Administración: el título que AFIRMA («Vas 8 %
 * arriba del objetivo», no «Ventas por día»), la oración que lo explica, la
 * leyenda y el dibujo, con «Ver como tabla» para leer los mismos números en
 * filas.
 *
 * - `chart` y `table` llegan ya renderizados del server; acá solo se elige cuál
 *   se ve. Los dos quedan en el HTML (el que no se ve va con `hidden`): cambiar
 *   de vista no pide nada al servidor ni pierde el foco del teclado.
 * - **No dibuja tarjeta**: va adentro de un `Panel` (o del héroe). Nada de
 *   tarjetas dentro de tarjetas.
 * - Sin `table` no hay botón: sirve para los dibujos cuya leyenda ya es la
 *   tabla (la barra partida, las barras ordenadas).
 */

export type ChartFrameProps = {
  /** La conclusión, en una frase corta. */
  title: ReactNode
  /** Una oración: qué se mira, de cuándo, contra qué. */
  sentence?: ReactNode
  /** Qué es cada color o trazo, con palabras. Solo acompaña al dibujo. */
  legend?: ReactNode
  chart: ReactNode
  /** Los mismos datos en filas. */
  table?: ReactNode
  /** Notas al pie: de dónde sale el dato, qué es estimado. */
  footer?: ReactNode
  /** `h3` adentro de un panel con título; `h2` si el marco ES la sección. */
  headingLevel?: 'h2' | 'h3'
  /** Con qué vista arranca. */
  defaultView?: 'chart' | 'table'
  className?: string
}

export function ChartFrame({
  title,
  sentence,
  legend,
  chart,
  table,
  footer,
  headingLevel = 'h3',
  defaultView = 'chart',
  className,
}: ChartFrameProps) {
  const id = useId()
  const hasTable = table !== undefined && table !== null && table !== false
  const [asTable, setAsTable] = useState(hasTable && defaultView === 'table')
  const showTable = hasTable && asTable
  const Heading = headingLevel

  return (
    <section aria-labelledby={`${id}-title`} className={cn('min-w-0 space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-56 space-y-1">
          <Heading
            id={`${id}-title`}
            className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance"
          >
            {title}
          </Heading>
          {sentence ? (
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{sentence}</p>
          ) : null}
        </div>
        {hasTable ? (
          <button
            type="button"
            aria-controls={`${id}-chart ${id}-table`}
            onClick={() => setAsTable((v) => !v)}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card px-3.5 text-xs font-medium text-foreground transition-[background-color] duration-(--duration-fast) hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:h-9"
          >
            {showTable ? (
              <ChartLine className="size-3.5" aria-hidden />
            ) : (
              <Table2 className="size-3.5" aria-hidden />
            )}
            {showTable ? 'Ver como gráfico' : 'Ver como tabla'}
          </button>
        ) : null}
      </div>

      <div id={`${id}-chart`} hidden={showTable} className="min-w-0 space-y-3">
        {legend ? <div className="min-w-0">{legend}</div> : null}
        {chart}
      </div>
      {hasTable ? (
        <div id={`${id}-table`} hidden={!showTable} className="min-w-0">
          {table}
        </div>
      ) : null}

      {footer ? (
        <div className="space-y-0.5 text-xs leading-snug text-muted-foreground">{footer}</div>
      ) : null}
    </section>
  )
}
