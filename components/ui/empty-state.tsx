import { cva } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Estado vacío (kit HUB §3.4). Server-safe.
 *
 * Qué va a haber acá y cómo empezar: «Todavía no cargaste proveedores» /
 * «Cargá el primero para llevar su cuenta corriente.» El botón dice el verbo.
 * El título va en Fraunces: la marca vive en los estados vacíos.
 *
 * Misma API que antes (`icon`, `title`, `description`, `action`, `className`),
 * ahora sin caja por defecto (`variant="plain"`): los `className` viejos que
 * le sacaban el borde (`border-0 bg-transparent`) siguen andando.
 */

/** La caja y el aire. `ErrorState` usa el mismo esqueleto. */
export const emptyStateVariants = cva('flex flex-col items-center justify-center text-center', {
  variants: {
    size: {
      // Adentro de tablas o tarjetas: sin caja.
      sm: 'px-4 py-8',
      md: 'px-6 py-12',
      // Página.
      lg: 'px-6 py-16',
    },
    variant: {
      plain: '',
      // Para «arrastrá acá».
      dashed: 'rounded-xl border border-dashed border-border-strong',
    },
  },
  defaultVariants: { size: 'md', variant: 'plain' },
})

/** Las partes, para que `ErrorState` se vea igual. */
export const emptyStateParts = {
  disc: 'mb-4 flex size-10 shrink-0 items-center justify-center rounded-full',
  icon: 'size-5',
  title: 'font-display text-xl font-[520] text-balance text-foreground',
  description: 'mt-2 max-w-sm type-body text-pretty text-muted-foreground',
  actions: 'mt-6 flex flex-wrap items-center justify-center gap-2',
} as const

export type EmptyStateProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  /** La acción principal (va última, como en todo el kit). */
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  /** `sm` adentro de tablas o tarjetas (py-8) · `md` (default, py-12) · `lg` página (py-16). */
  size?: 'sm' | 'md' | 'lg'
  /** `plain` (default: menos cajas) · `dashed` para «arrastrá acá». */
  variant?: 'plain' | 'dashed'
  /**
   * El título como encabezado, cuando el vacío es lo único de la pantalla (el
   * 404 del panel no tiene `PageHeader`). Sin esto, un `div`: adentro de una
   * lista no tiene que cortar el índice de encabezados de la página.
   */
  headingLevel?: 1 | 2 | 3
}

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  variant = 'plain',
  headingLevel,
  className,
  ...props
}: EmptyStateProps) {
  const Title = headingLevel ? HEADING_TAG[headingLevel] : 'div'
  return (
    <div
      data-slot="empty-state"
      className={cn(emptyStateVariants({ size, variant }), className)}
      {...props}
    >
      {Icon ? (
        <div
          data-slot="empty-state-icon"
          className={cn(emptyStateParts.disc, 'bg-secondary text-primary')}
        >
          <Icon className={emptyStateParts.icon} strokeWidth={1.75} aria-hidden="true" />
        </div>
      ) : null}
      {/* div y no p: el título y la descripción aceptan cualquier nodo. */}
      <Title data-slot="empty-state-title" className={emptyStateParts.title}>
        {title}
      </Title>
      {description ? (
        <div data-slot="empty-state-description" className={emptyStateParts.description}>
          {description}
        </div>
      ) : null}
      {action || secondaryAction ? (
        <div data-slot="empty-state-actions" className={emptyStateParts.actions}>
          {secondaryAction}
          {action}
        </div>
      ) : null}
    </div>
  )
}

export { EmptyState }
