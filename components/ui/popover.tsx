'use client'

import { Popover as PopoverPrimitive } from 'radix-ui'
import type * as React from 'react'
import { MENU_MOTION, usePortalContainer } from '@/components/ui/portal-container'
import { keepOpenOnToastWith } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/**
 * Popover del kit HUB (§3.7): para un dato chico sin salir de la pantalla.
 * Mismos exports que antes.
 */

export type PopoverSize = 'sm' | 'md' | 'lg' | 'auto'

const POPOVER_SIZE: Readonly<Record<PopoverSize, string>> = {
  sm: 'w-64',
  md: 'w-72',
  lg: 'w-96',
  auto: 'w-auto',
}

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

export type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /** `w-64` · `w-72` · `w-96` · a lo que mida. Default `md`. Un `w-*` en `className` sigue ganando. */
  size?: PopoverSize
  /** Default `false`: tocar un aviso (toast) no lo cierra (`keepOpenOnToast`). */
  closeOnToastClick?: boolean
}

/**
 * Cartulina flotante con borde y sombra, a 6 px del disparador; `p-4` (para
 * listas, `p-0` en `className`). Sale de su disparador en 180 ms y se va en
 * 120 ms; con «reducir movimiento», solo fundido.
 */
function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  size = 'md',
  closeOnToastClick = false,
  onInteractOutside,
  ...props
}: PopoverContentProps) {
  const container = usePortalContainer()
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-[calc(100vw-1rem)] origin-(--radix-popover-content-transform-origin) rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-float outline-none',
          MENU_MOTION,
          POPOVER_SIZE[size],
          className,
        )}
        onInteractOutside={
          closeOnToastClick ? onInteractOutside : keepOpenOnToastWith(onInteractOutside)
        }
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="popover-header" className={cn('flex flex-col gap-1', className)} {...props} />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-title"
      className={cn('type-body font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('type-small text-pretty text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
