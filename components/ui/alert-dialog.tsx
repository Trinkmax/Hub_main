'use client'

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type * as React from 'react'
import {
  type ButtonVariant,
  buttonVariants,
  type LegacyButtonVariant,
} from '@/components/ui/button'
import {
  DIALOG_OVERLAY_CLASS,
  type DialogSize,
  dialogContentClassName,
} from '@/components/ui/dialog'
import { usePortalContainer } from '@/components/ui/portal-container'
import { cn } from '@/lib/utils'

/**
 * Las piezas de Radix AlertDialog, reestiladas con el kit (§3.7). Mismos
 * exports que antes: hoy hay 55 confirmaciones armadas a mano con esto y cada
 * lote las pasa a `ConfirmDialog` (`@/components/ui/confirm-dialog`), que ya
 * resuelve el «Borrando…», el error adentro y el foco.
 *
 * `AlertDialogAction` sigue siendo el `Action` de Radix (cierra al click): los
 * `e.preventDefault()` de hoy siguen funcionando. Suma `variant`.
 */

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

/** Lee `PortalContainerProvider`; un `container` explícito gana. */
function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  const container = usePortalContainer()
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" container={container} {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(DIALOG_OVERLAY_CLASS, className)}
      {...props}
    />
  )
}

/**
 * La caja: la misma del `Dialog`, en `sm` (400 px) por defecto. Radix no la
 * cierra con un click afuera ni con un toast; Esc sí. Al abrir, el foco va a
 * «Cancelar», lo menos destructivo.
 */
function AlertDialogContent({
  className,
  size = 'sm',
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  /** 400 · 520 · 720 · 960 px. Default `sm`. */
  size?: DialogSize
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={dialogContentClassName(size, className)}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-1.5 text-left', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('type-section text-balance text-foreground', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('type-body text-pretty text-muted-foreground', className)}
      {...props}
    />
  )
}

/**
 * Confirmar. Cierra al click (el `Action` de Radix): para esperar una acción
 * asíncrona con el diálogo abierto, `ConfirmDialog`. Las clases destructivas
 * a mano (`bg-destructive …`) siguen ganando; lo nuevo es `variant="danger"`.
 */
function AlertDialogAction({
  className,
  variant = 'primary',
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & {
  /** Default `primary`. */
  variant?: ButtonVariant | LegacyButtonVariant
}) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: 'secondary' }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
