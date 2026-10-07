'use client'

import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { DIALOG_OVERLAY_CLASS } from '@/components/ui/dialog'
import { usePortalContainer } from '@/components/ui/portal-container'
import { keepOpenOnToastWith } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/**
 * Hoja del kit HUB (§3.7): para ver o editar sin perder la lista. Lateral por
 * defecto; abajo para el celular.
 *
 * Mismos exports que antes (`SheetGrabber` incluido) más `SheetBody`. Las
 * hojas armadas a mano siguen igual: `SheetContent` mantiene sus 16 px entre
 * hijos y sin padding propio; con `SheetBody` (encabezado fijo, cuerpo con
 * scroll, pie fijo) las partes van pegadas y cada una trae su padding y su pelo.
 */

export type SheetSide = 'right' | 'left' | 'bottom' | 'top'
export type SheetSize = 'sm' | 'md' | 'lg' | 'full'

/** Laterales: 384 · 480 · 640 px · todo el ancho; en el celular, nunca más que la pantalla. */
const SHEET_WIDTH: Readonly<Record<SheetSize, string>> = {
  sm: '[--sheet-w:24rem]',
  md: '[--sheet-w:30rem]',
  lg: '[--sheet-w:40rem]',
  full: '[--sheet-w:100vw]',
}

const SHEET_SIDE: Readonly<Record<SheetSide, string>> = {
  right:
    'inset-y-0 right-0 h-full w-[min(100vw,var(--sheet-w))] border-l slide-in-from-right slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-[min(100vw,var(--sheet-w))] border-r slide-in-from-left slide-out-to-left',
  top: 'inset-x-0 top-0 h-auto max-h-[90dvh] border-b slide-in-from-top slide-out-to-top',
  // rounded + safe-area: en el celular el último botón quedaba debajo del home
  // indicator del iPhone. Con `SheetFooter` el pie ya suma el safe-area.
  bottom:
    'inset-x-0 bottom-0 h-auto max-h-[90dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] has-[>[data-slot=sheet-footer]]:pb-0 slide-in-from-bottom slide-out-to-bottom',
}

/**
 * Entra en 220 ms desde su borde con `ease-drawer` y sale en 160 ms (antes 500
 * y 300). Con «reducir movimiento», solo fundido: el desplazamiento queda en 0.
 */
const SHEET_MOTION = [
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'duration-(--duration-overlay) data-[state=closed]:duration-(--duration-overlay-exit) ease-(--ease-drawer)',
  'motion-reduce:[--tw-enter-translate-x:0] motion-reduce:[--tw-exit-translate-x:0]',
  'motion-reduce:[--tw-enter-translate-y:0] motion-reduce:[--tw-exit-translate-y:0]',
  'motion-reduce:fade-in-0 motion-reduce:fade-out-0',
].join(' ')

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

/** Lee `PortalContainerProvider`; un `container` explícito gana. */
function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  const container = usePortalContainer()
  return <SheetPrimitive.Portal data-slot="sheet-portal" container={container} {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(DIALOG_OVERLAY_CLASS, className)}
      {...props}
    />
  )
}

export type SheetContentProps = React.ComponentProps<typeof SheetPrimitive.Content> & {
  /** Default `right`. */
  side?: SheetSide
  /** Laterales: 384 · 480 · 640 px · 100 %. Default `sm` (el `sm:max-w-sm` de antes). */
  size?: SheetSize
  /** Default `true`: la X arriba a la derecha («Cerrar»). El mismo nombre que en `Dialog`. */
  showCloseButton?: boolean
  /** @deprecated usar `showCloseButton` */
  showClose?: boolean
  /** Default `false`: tocar un aviso (toast) no cierra la hoja (`keepOpenOnToast`). */
  closeOnToastClick?: boolean
}

function SheetContent({
  className,
  children,
  side = 'right',
  size = 'sm',
  showCloseButton,
  showClose,
  closeOnToastClick = false,
  onInteractOutside,
  ...props
}: SheetContentProps) {
  const withClose = showCloseButton ?? showClose ?? true
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-popover text-popover-foreground shadow-modal outline-none has-[>[data-slot=sheet-body]]:gap-0',
          SHEET_MOTION,
          SHEET_WIDTH[size],
          SHEET_SIDE[side],
          className,
        )}
        onInteractOutside={
          closeOnToastClick ? onInteractOutside : keepOpenOnToastWith(onInteractOutside)
        }
        {...props}
      >
        {children}
        {withClose ? (
          <SheetPrimitive.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar"
              data-slot="sheet-close-button"
              className="absolute top-3.5 right-3.5"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/**
 * La manija de una hoja de abajo. Es decorativa (`aria-hidden`): arrastrar
 * para cerrar nunca es la única forma, siempre están «Cerrar» y Esc (WCAG 2.5.7).
 */
function SheetGrabber({
  tone = 'default',
  className,
  ...props
}: React.ComponentProps<'div'> & {
  /** `light` sobre una foto oscura. */
  tone?: 'default' | 'light'
}) {
  return (
    <div
      aria-hidden="true"
      data-slot="sheet-grabber"
      className={cn(
        'absolute top-2 left-1/2 z-20 h-1.5 w-10 -translate-x-1/2 rounded-full',
        tone === 'light' ? 'bg-white/70' : 'bg-foreground/20',
        className,
      )}
      {...props}
    />
  )
}

/** Encabezado fijo con un pelo abajo; deja lugar a la X (`pr-12`). */
function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex shrink-0 flex-col gap-1 border-b border-border p-4 pr-12', className)}
      {...props}
    />
  )
}

/** El cuerpo que scrollea (nuevo): encabezado y pie quedan fijos. */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-4', className)}
      {...props}
    />
  )
}

/** Pie fijo con un pelo arriba; suma el safe-area del iPhone. */
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex shrink-0 flex-col gap-2 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('type-section text-balance text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('type-body text-pretty text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetGrabber,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
