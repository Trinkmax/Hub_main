import { Slot } from '@radix-ui/react-slot'
import type * as React from 'react'
import { cn } from '@/lib/utils'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

/**
 * El relleno va en una variable y se aplica con UNA sola clase `p-*`: así un
 * `className="p-0"` o `"p-6"` de quien llama gana en todos los anchos (con
 * `p-4 sm:p-6` sueltas, tailwind-merge sacaba el `p-4` y el `sm:p-6` quedaba
 * pisando desde `sm`).
 */
const PADDING: Readonly<Record<CardPadding, string>> = {
  none: '',
  sm: 'p-3',
  md: 'p-(--card-pad) [--card-pad:1rem] sm:[--card-pad:1.5rem]',
  lg: 'p-(--card-pad) [--card-pad:1.5rem] sm:[--card-pad:2rem]',
}

/**
 * Una tarjeta interactiva (con `asChild` y un `<Link>` adentro): el borde se
 * marca al pasar, el foco va afuera y presionar pinta `--active`. Sin «float»
 * ni escala: es ancha (§2.10).
 */
const INTERACTIVE =
  'transition-colors duration-(--duration-quick) ease-(--ease-ui) hover:border-border-strong active:bg-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none'

type CardProps = React.ComponentProps<'div'> & {
  /** `sm` p-3 · `md` p-4 → p-6 desde `sm` (default) · `lg` p-6 → p-8 · `none` sin relleno. */
  padding?: CardPadding
  /** Para tarjetas que son un link (con `asChild`): hover, foco y presionado del kit. */
  interactive?: boolean
  /** Dibuja el hijo (un `<Link>`, un `<article>`) con el estilo de la tarjeta. */
  asChild?: boolean
}

/**
 * Agrupa lo que va junto: cartulina, pelo y radio de 12 px, sin sombra.
 *
 * Reglas (§3.5): nunca una tarjeta adentro de otra; una lista es una
 * `DataTable`, no un `<ul>` en tarjeta; los KPIs van en `KPIGroup`; el resto
 * de la jerarquía de la página es `Section`.
 *
 * El relleno es de la tarjeta, no de sus partes: `CardHeader`, `CardContent`
 * y `CardFooter` no suman relleno propio.
 */
function Card({
  padding = 'md',
  interactive = false,
  asChild = false,
  className,
  ...props
}: CardProps) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      data-slot="card"
      data-interactive={interactive ? '' : undefined}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-card text-card-foreground',
        PADDING[padding],
        interactive && INTERACTIVE,
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-4',
        className,
      )}
      {...props}
    />
  )
}

/**
 * `type-subtitle` (16/24). El `font-semibold` va aparte a propósito: si quien
 * llama pasa un `text-base`, cn() saca el `type-subtitle` entero (tamaño y
 * peso) y el título quedaría en peso normal.
 */
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('type-subtitle font-semibold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('type-small text-pretty text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn(className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2 [.border-t]:pt-4', className)}
      {...props}
    />
  )
}

export type { CardProps }
export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
