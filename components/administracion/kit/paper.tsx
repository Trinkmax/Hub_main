import { type CSSProperties, type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una hoja de papel: un documento que NO es un tique. La constancia de
 * inscripción (Datos de la SAS), la cabecera de una factura (Puntos de venta),
 * la factura que se va llenando sola (Factura aparte).
 *
 * Es el mismo papel que `Ticket` (claro también en modo oscuro, misma tinta),
 * pero con los bordes rectos: una hoja, no una tira que se arranca. Lleva un
 * membrete arriba (`title`, en monoespaciada y mayúsculas) con una aclaración
 * a la derecha (`aside`: «como en la constancia», el número) y reglas finas.
 * Adentro valen las piezas del ticket: `TicketRow`, `TicketRule`,
 * `TicketTotal`, `TicketStamp`, `TicketLabel`. Los campos de un formulario se
 * apoyan sobre el papel tal cual son.
 *
 *   <PaperSheet title="Datos de la SAS" aside="como en la constancia">
 *     …
 *   </PaperSheet>
 *
 * `size="sm"` es la hoja chica: un recorte de documento que acompaña una
 * explicación (la cabecera de una factura con su número señalado).
 *
 * Cuándo NO: para lo que se cobra, se paga o se cierra en el momento (eso es
 * `Ticket`, también la carátula del mes); como tarjeta genérica (eso es
 * `Panel`); ni adentro de otro papel.
 */

// La tinta del papel, puesta en línea: le gana a `.dark` y a `.force-light`
// sin sumar una clase a `globals.css`. Es la misma receta de `.adm-ticket`.
const PAPER_INK = {
  '--foreground': 'var(--adm-paper-ink)',
  '--card-foreground': 'var(--adm-paper-ink)',
  '--muted-foreground': 'color-mix(in oklch, var(--adm-paper-ink) 68%, var(--adm-paper))',
  '--border': 'var(--adm-paper-rule)',
} as CSSProperties

const SIZE = {
  md: 'p-5 text-sm sm:p-6',
  sm: 'p-3.5 text-[13px]',
} as const

export function PaperSheet({
  title,
  aside,
  children,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: {
  /** El membrete: qué documento es. */
  title?: ReactNode
  /** A la derecha del membrete, en gris. */
  aside?: ReactNode
  children: ReactNode
  size?: 'md' | 'sm'
  className?: string
  /** Para lectores, si no hay `title` o no alcanza. */
  'aria-label'?: string
}) {
  const titleId = useId()
  const hasHeader = Boolean(title) || Boolean(aside)
  return (
    <article
      aria-label={ariaLabel}
      aria-labelledby={!ariaLabel && title ? titleId : undefined}
      style={PAPER_INK}
      className={cn(
        'force-light rounded-[3px] border border-adm-paper-rule bg-adm-paper text-adm-paper-ink',
        // Apoyada sobre la mesa: una sombra corta y una larga, de la tinta del papel.
        'shadow-[0_1px_1px_color-mix(in_oklch,var(--adm-paper-ink)_10%,transparent),0_10px_18px_-8px_color-mix(in_oklch,var(--adm-paper-ink)_18%,transparent)]',
        SIZE[size],
        className,
      )}
    >
      {hasHeader ? (
        <header
          className={cn(
            'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-adm-paper-rule',
            size === 'sm' ? 'mb-3 pb-2' : 'mb-4 pb-2.5',
          )}
        >
          {title ? (
            <p
              id={titleId}
              className="font-mono text-[11px] font-semibold uppercase leading-snug tracking-[0.16em]"
            >
              {title}
            </p>
          ) : null}
          {aside ? (
            <div className="ml-auto text-right text-xs text-muted-foreground">{aside}</div>
          ) : null}
        </header>
      ) : null}
      {children}
    </article>
  )
}
