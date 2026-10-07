'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { DIALOG_MOTION, OVERLAY_MOTION, usePortalContainer } from '@/components/ui/portal-container'
import { keepOpenOnToastWith } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/**
 * Diálogo del kit HUB (§3.7): para decidir algo sin perder la pantalla. Para
 * ver o editar sin perder la lista va `Sheet`; para borrar, `ConfirmDialog`.
 *
 * Mismos exports que antes (33 importadores) más `DialogBody`. Las clases que
 * ya pasan los que llaman siguen ganando (`sm:max-w-*`, `max-h-*`, `p-0`,
 * `overflow-hidden`): `cn()` deja la última de cada grupo.
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * 400 · 520 · 720 · 960 px desde `sm`, sin pasarse de la pantalla menos 16 px
 * por lado (un `lg` en una tablet de 700 px no toca los bordes).
 */
const DIALOG_SIZE_CLASS: Readonly<Record<DialogSize, string>> = {
  sm: 'sm:max-w-[min(25rem,calc(100%-2rem))]',
  md: 'sm:max-w-[min(32.5rem,calc(100%-2rem))]',
  lg: 'sm:max-w-[min(45rem,calc(100%-2rem))]',
  xl: 'sm:max-w-[min(60rem,calc(100%-2rem))]',
}

/** ¿El que llama le fija un alto (`h-[92dvh]`, `sm:h-auto`)? Ver `dialogContentClassName`. */
const OWN_HEIGHT_RE = /(?:^|\s)(?:[\w-]+:)*h-/

/**
 * Las clases de la caja de un diálogo. Las comparten `AlertDialogContent` y
 * `ConfirmDialog`.
 *
 * - **Alto máximo `min(85dvh, 760px)` con scroll adentro** (BACKLOG «Mobile del
 *   calendario»): un diálogo más alto que la pantalla desbordaba arriba y abajo
 *   y se perdían el título y la X. Con `DialogBody` scrollea solo el cuerpo;
 *   los diálogos de antes, sin cuerpo, scrollean enteros.
 * - Un `h-*` del que llama manda: la vista previa de páginas pide `h-[92dvh]`
 *   y el alto máximo la recortaría. Por eso el máximo no va si hay un `h-*`.
 * - `flex-col` y no `grid`: con `grid` un encabezado `sticky` queda atado a su
 *   fila y el cuerpo no puede achicarse para scrollear.
 */
function dialogContentClassName(size: DialogSize, className?: string): string {
  return cn(
    'fixed top-1/2 left-1/2 z-50 flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
    !OWN_HEIGHT_RE.test(className ?? '') && 'max-h-[min(85dvh,760px)]',
    'overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-modal outline-none',
    DIALOG_MOTION,
    DIALOG_SIZE_CLASS[size],
    className,
  )
}

/** El velo: tinta al 40 % en claro, negro al 60 % en oscuro (`--overlay`). */
const DIALOG_OVERLAY_CLASS = cn('fixed inset-0 z-50 bg-overlay', OVERLAY_MOTION)

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

/** Lee `PortalContainerProvider`; un `container` explícito gana. */
function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const container = usePortalContainer()
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={container} {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(DIALOG_OVERLAY_CLASS, className)}
      {...props}
    />
  )
}

export type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** 400 · 520 · 720 · 960 px. Default `md` (antes 512). */
  size?: DialogSize
  /** Default `true`: la X arriba a la derecha («Cerrar»). */
  showCloseButton?: boolean
  /**
   * Default `false`: tocar un aviso (toast) no cierra el diálogo
   * (`keepOpenOnToast`). `true` lo deja cerrar como cualquier click afuera.
   */
  closeOnToastClick?: boolean
}

/**
 * La caja del diálogo: `rounded-2xl`, cartulina flotante con borde y sombra
 * modal, 24 px de padding. Entra en 220 ms y sale en 160 ms (opacidad + escala
 * 0,97); con «reducir movimiento», solo fundido.
 *
 * Foco: el de Radix (atrapado, Esc, `aria-modal`). Al abrir va al primer
 * control; la X va al final del DOM para no robarle ese foco a un campo. Para
 * elegir otro, `onOpenAutoFocus`.
 */
function DialogContent({
  className,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnToastClick = false,
  onInteractOutside,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        className={dialogContentClassName(size, className)}
        onInteractOutside={
          closeOnToastClick ? onInteractOutside : keepOpenOnToastWith(onInteractOutside)
        }
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar"
              data-slot="dialog-close-button"
              // Centrada contra la primera línea del título (24 px de padding +
              // 28 de interlínea) y con el ícono alineado al borde del contenido.
              className="absolute top-5.5 right-4"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/** Título y descripción. Deja lugar a la X (`pr-8`) para que un título largo no pase abajo. */
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 pr-8 text-left', className)}
      {...props}
    />
  )
}

/**
 * El cuerpo que scrollea (nuevo). Encabezado y pie quedan fijos: el cuerpo se
 * achica hasta caber en el alto máximo del diálogo. Llega hasta los bordes
 * (`-mx-6 px-6`) para que la barra de scroll quede pegada al canto, y deja 4 px
 * arriba y abajo para que el contorno de foco de un campo no se recorte.
 */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        '-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-1',
        className,
      )}
      {...props}
    />
  )
}

/** Acciones a la derecha con 8 px entre sí; en el celular, apiladas y del mismo ancho. */
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('type-section text-balance text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('type-body text-pretty text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  DIALOG_OVERLAY_CLASS,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogContentClassName,
}
