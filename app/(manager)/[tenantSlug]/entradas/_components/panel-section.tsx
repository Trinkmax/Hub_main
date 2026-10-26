import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una tarjeta de la pestaña Entradas: el mismo encabezado que las de Link de
 * Instagram (título en Fraunces, bajada chica y una raya abajo) para que la
 * pestaña se sienta parte de Marketing y no una pantalla de otro lado.
 */
export function PanelSection({
  id,
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  /** Arma el id del título (`${id}-title`) para el `aria-labelledby`. */
  id: string
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn('card-hairline overflow-hidden rounded-xl border bg-card', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight"
          >
            {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}
