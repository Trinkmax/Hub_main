import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * El estado vacío que ENSEÑA. En un bar que recién arranca casi todo está
 * vacío, así que esto es lo primero que ve el socio: tiene que decir qué va a
 * aparecer acá, para qué sirve y cuál es el paso siguiente, con su botón.
 *
 * - `title`: qué falta, sin culpa («Todavía no cerraste ningún día»).
 * - `children`: una o dos oraciones: qué vas a ver y por qué te sirve.
 * - `action`: EL botón del paso siguiente. `secondary`: un link más callado
 *   («Ver la guía»).
 * - `illustration`: la silueta tenue del gráfico o de la lista que va a
 *   aparecer. Si lleva números, pasá `example` para que quede rotulada
 *   «Ejemplo»: un número inventado nunca puede parecer un dato.
 *
 * Con `plain` no dibuja su propio marco: es para usarlo ADENTRO de un `Panel`.
 *
 * Cuándo NO: para un error (eso es «No pudimos cargar esto» + «Reintentar»),
 * para una búsqueda sin resultados (alcanza una línea) ni para la contadora en
 * solo lectura con un botón de carga (pasale `action` solo si puede cargar).
 */
export function EmptyTeach({
  icon: Icon,
  title,
  children,
  action,
  secondary,
  illustration,
  example = false,
  plain = false,
  className,
}: {
  icon?: LucideIcon
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  secondary?: ReactNode
  illustration?: ReactNode
  /** Rotula la ilustración como «Ejemplo» (obligatorio si muestra números). */
  example?: boolean
  /** Sin marco ni fondo, para ir adentro de un `Panel`. */
  plain?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8',
        !plain && 'rounded-2xl border border-dashed border-border bg-card/50 p-5 sm:p-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {Icon ? (
          <div
            aria-hidden
            className="mb-3.5 flex size-11 items-center justify-center rounded-full border border-primary/15 bg-accent text-accent-foreground shadow-2xs"
          >
            <Icon className="size-5" />
          </div>
        ) : null}
        <p className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance">
          {title}
        </p>
        {children ? (
          <div className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground text-pretty">
            {children}
          </div>
        ) : null}
        {action || secondary ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            {action}
            {secondary ? <div className="text-sm text-muted-foreground">{secondary}</div> : null}
          </div>
        ) : null}
      </div>
      {illustration ? (
        // Decorativa: lo que enseña ya está dicho en palabras al lado.
        <div aria-hidden className="relative w-full shrink-0 sm:w-[42%] sm:max-w-xs">
          <div className="pointer-events-none select-none rounded-xl bg-secondary/50 p-4 opacity-70">
            {illustration}
          </div>
          {example ? (
            <span className="absolute top-2 right-2 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground shadow-2xs">
              Ejemplo
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
