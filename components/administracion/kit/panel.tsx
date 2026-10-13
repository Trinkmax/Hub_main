import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * La superficie estándar de Administración: una tarjeta crema con filete,
 * `rounded-2xl` y sombra apenas. Lleva título en Fraunces, una descripción
 * corta, una acción arriba a la derecha y un pie opcional.
 *
 * Cuándo NO: adentro de otro `Panel` (nada de tarjetas dentro de tarjetas:
 * adentro se separa con aire, con `PanelSection` o con un fondo
 * `bg-secondary/50 rounded-xl`), ni para el número grande de la pantalla (eso
 * es `HeroPanel`), ni para un estado vacío (eso es `EmptyTeach`).
 */
export function Panel({
  title,
  description,
  action,
  footer,
  className,
  id,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  /** Va arriba a la derecha: un link «Ver todo», una píldora, un botón chico. */
  action?: ReactNode
  /** Va abajo, separado por una raya: el total, una nota, «Ver como tabla». */
  footer?: ReactNode
  className?: string
  /** Ancla (`#cajas`). Deja aire arriba para que la barra pegajosa no la tape. */
  id?: string
  children?: ReactNode
}) {
  const headingId = useId()
  const hasHeader = Boolean(title || description || action)

  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'card-hairline scroll-mt-28 rounded-2xl border bg-card p-4 shadow-xs sm:p-5',
        className,
      )}
    >
      {hasHeader ? (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title ? (
              <h2
                id={headingId}
                className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance"
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              <div className="text-sm text-muted-foreground text-pretty">{description}</div>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      {children !== undefined && children !== null ? (
        <div className={hasHeader ? 'mt-4' : undefined}>{children}</div>
      ) : null}
      {footer ? (
        <footer className="mt-4 border-t border-border/60 pt-3 text-sm text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  )
}

/**
 * Un bloque adentro de un `Panel`, separado del anterior por una raya suave.
 * El primero no dibuja raya (ya lo separa el encabezado del panel).
 *
 * Cuándo NO: para separar dos temas distintos (eso son dos `Panel`).
 */
export function PanelSection({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  const hasHeader = Boolean(title || description || action)
  return (
    <div
      className={cn(
        'mt-4 border-t border-border/60 pt-4 first:mt-0 first:border-t-0 first:pt-0',
        className,
      )}
    >
      {hasHeader ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-sm font-semibold leading-snug">{title}</h3> : null}
            {description ? (
              <div className="mt-0.5 text-sm text-muted-foreground text-pretty">{description}</div>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}
