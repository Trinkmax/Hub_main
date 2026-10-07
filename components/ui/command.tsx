'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command as CommandPrimitive, useCommandState } from 'cmdk'
import { SearchIcon, XIcon } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { KbdShortcut } from '@/components/ui/kbd-shortcut'
import { usePortalContainer } from '@/components/ui/portal-container'
import { cn } from '@/lib/utils'

/**
 * La paleta ⌘K del kit HUB (§3.7 y §4.4), sobre cmdk. Mismos exports que
 * antes más `CommandFooter`.
 *
 * **Abre al instante.** Se usa decenas de veces por día: sin animación de
 * entrada ni de salida, ni fundido del velo. Por eso `CommandDialog` arma su
 * propio diálogo (el «PaletteDialog») en vez de usar el `DialogContent`
 * genérico, que trae la animación puesta.
 */

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

export type CommandDialogProps = React.ComponentProps<typeof DialogPrimitive.Root> & {
  /** Para el lector de pantalla. Default «Buscar y navegar». */
  title?: string
  /** Para el lector de pantalla. Default «Escribí el nombre de una página o una acción.» */
  description?: string
  /** Default `false`: se cierra con Esc o tocando afuera. */
  showCloseButton?: boolean
  className?: string
}

/**
 * La caja: 640 px como máximo, a 12 vh del borde de arriba (no centrada: la
 * lista crece hacia abajo sin mover el campo). Velo a la mitad del de un
 * diálogo, porque la paleta es un paso rápido, no una decisión.
 */
function CommandDialog({
  title = 'Buscar y navegar',
  description = 'Escribí el nombre de una página o una acción.',
  children,
  className,
  showCloseButton = false,
  ...props
}: CommandDialogProps) {
  const container = usePortalContainer()
  return (
    <DialogPrimitive.Root data-slot="command-dialog" {...props}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay
          data-slot="command-dialog-overlay"
          className="fixed inset-0 z-50 bg-overlay/50"
        />
        <DialogPrimitive.Content
          data-slot="command-dialog-content"
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-modal outline-none',
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          <Command>{children}</Command>
          {showCloseButton ? (
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Cerrar"
                data-slot="command-dialog-close"
                className="absolute top-2.5 right-2.5"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** 52 px con texto de 16 px y lupa de 18. El campo es la caja: sin contorno propio. */
function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-13 shrink-0 items-center gap-3 border-b border-border px-4"
    >
      <SearchIcon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[min(60vh,440px)] scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain p-2',
        className,
      )}
      {...props}
    />
  )
}

/** Lo que se buscó, entre «»: dice qué no se encontró, no solo que no hay nada. */
function CommandEmptyMessage() {
  const search = useCommandState((state) => state.search).trim()
  return search ? <>No encontramos nada con «{search}».</> : <>No encontramos nada.</>
}

/** Sin `children`, «No encontramos nada con «xyz».» con lo que se tipeó. */
function CommandEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('px-3 py-8 text-center type-body text-pretty text-muted-foreground', className)}
      {...props}
    >
      {children ?? <CommandEmptyMessage />}
    </CommandPrimitive.Empty>
  )
}

/** Encabezado de grupo en 12 px y texto de apoyo, minúscula normal. */
function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:type-caption [&_[cmdk-group-heading]]:text-subtle-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-2 my-2 h-px bg-border', className)}
      {...props}
    />
  )
}

/**
 * 40 px con mouse y 44 con el dedo; ícono de 16. El resaltado (`bg-accent`) no
 * se anima: se mueve con las flechas.
 */
function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex min-h-10 cursor-default select-none items-center gap-3 rounded-md px-3 type-body outline-none pointer-coarse:min-h-11',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** La pista a la derecha: «Agenda › Reservas» (4,55:1 sobre el resaltado). */
function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto shrink-0 type-small text-subtle-foreground', className)}
      {...props}
    />
  )
}

/**
 * El pie con las teclas (nuevo): «↑↓ para moverte · ↵ para abrir · esc para
 * cerrar». No se muestra en pantallas táctiles, donde no hay teclado.
 */
function CommandFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 type-caption text-subtle-foreground pointer-coarse:hidden',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <KbdShortcut keys={['up', 'down']} /> para moverte
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <KbdShortcut keys={['enter']} /> para abrir
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <KbdShortcut keys={['esc']} /> para cerrar
          </span>
        </>
      )}
    </div>
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
