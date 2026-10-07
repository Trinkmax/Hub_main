import * as React from 'react'
import { cn } from '@/lib/utils'

export type SectionProps = Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title?: React.ReactNode
  /** Apoyo del título, `type-small` apagado. */
  description?: React.ReactNode
  /** Botones de la sección, a la derecha del título. */
  actions?: React.ReactNode
  /** `2` → `type-section` (20 px) · `3` → `type-subtitle` (16 px), para una sección adentro de otra. */
  headingLevel?: 2 | 3
  /** Pelo arriba y 24 px de aire: separa bloques sin meterlos en cajas. */
  divider?: boolean
  /** `section` (default) es una región con nombre; `div` cuando no hace falta el punto de referencia. */
  as?: 'section' | 'div'
  children: React.ReactNode
}

/**
 * La unidad de jerarquía de la página (§3.5): título + aire + contenido, en
 * lugar de una tarjeta por bloque. Server-safe (`useId` funciona en Server
 * Components).
 *
 * - Título en Inter (antes Fraunces 16): Fraunces queda para el título de la
 *   página y los números.
 * - 16 px entre el encabezado y el contenido.
 * - Como `<section>`, `aria-labelledby` apunta al título y la sección queda
 *   como región con nombre para los lectores de pantalla.
 */
export function Section({
  title,
  description,
  actions,
  headingLevel = 2,
  divider = false,
  as: Comp = 'section',
  id,
  className,
  children,
  ...props
}: SectionProps) {
  const autoId = React.useId()
  const titleId = id ? `${id}-titulo` : `${autoId}titulo`
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const hasHeader = Boolean(title || description || actions)
  // aria-labelledby solo en <section>: en un div genérico no nombra nada.
  const labelledBy = title && Comp === 'section' ? titleId : undefined

  return (
    <Comp
      data-slot="section"
      id={id}
      aria-labelledby={labelledBy}
      className={cn('flex flex-col gap-4', divider && 'border-t border-border pt-6', className)}
      {...props}
    >
      {hasHeader ? (
        <div
          data-slot="section-header"
          className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2"
        >
          {title || description ? (
            <div className="flex min-w-0 flex-col gap-1">
              {title ? (
                <Heading
                  id={titleId}
                  data-slot="section-title"
                  className={cn(
                    'text-balance',
                    headingLevel === 3 ? 'type-subtitle' : 'type-section',
                  )}
                >
                  {title}
                </Heading>
              ) : null}
              {description ? (
                <div
                  data-slot="section-description"
                  className="max-w-prose text-pretty type-small text-muted-foreground"
                >
                  {description}
                </div>
              ) : null}
            </div>
          ) : null}
          {actions ? (
            <div
              data-slot="section-actions"
              className="flex flex-wrap items-center gap-2 sm:ml-auto"
            >
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </Comp>
  )
}
