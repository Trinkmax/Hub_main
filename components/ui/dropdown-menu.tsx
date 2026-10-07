'use client'

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import type * as React from 'react'
import { MENU_MOTION, usePortalContainer } from '@/components/ui/portal-container'
import { cn } from '@/lib/utils'

/**
 * Menú desplegable del kit HUB (§3.7). Mismos exports (`variant`, `inset`).
 *
 * - El resaltado de una opción es `bg-accent` **sin transición**: se mueve con
 *   las flechas y una transición de color deja una estela detrás del cursor.
 * - Búsqueda por tipeo de Radix (tipear «bo» va a «Borrar»).
 * - **No hay un `ConfirmDialog` adentro de un menú:** se desmonta con el menú
 *   antes de confirmar. En el `onSelect` va `useConfirm()`.
 */

/** Ítem, ítem con check y radio comparten caja: 32 px con mouse, 44 con el dedo. */
const ITEM_BASE = [
  'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 type-body outline-none pointer-coarse:min-h-11',
  // `focus:` y no `data-highlighted:` (es lo mismo: Radix enfoca el ítem
  // resaltado) para que los `focus:text-…` que ya pasan los que llaman sigan
  // pisando al de acá: cn() solo resuelve conflictos con la misma variante.
  'focus:bg-accent focus:text-accent-foreground',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(' ')

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

/** Lee `PortalContainerProvider`; un `container` explícito gana. */
function DropdownMenuPortal(props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  const container = usePortalContainer()
  return (
    <DropdownMenuPrimitive.Portal
      data-slot="dropdown-menu-portal"
      container={container}
      {...props}
    />
  )
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

const MENU_SURFACE =
  'z-50 min-w-48 overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float outline-none'

/** A 6 px del disparador; sale de su origen en 180 ms y se va en 120 ms. */
function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const container = usePortalContainer()
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          MENU_SURFACE,
          'max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)',
          MENU_MOTION,
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

/**
 * Ícono de 16 px en `text-muted-foreground` (si no trae color propio).
 * `destructive`: texto e ícono en `text-destructive-text` y, resaltado,
 * `bg-destructive-soft` (5,52:1).
 */
function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        ITEM_BASE,
        "data-inset:pl-8 [&_svg:not([class*='text-'])]:text-muted-foreground",
        'data-[variant=destructive]:text-destructive-text',
        'data-[variant=destructive]:focus:bg-destructive-soft data-[variant=destructive]:focus:text-destructive-text',
        "data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-destructive-text",
        className,
      )}
      {...props}
    />
  )
}

/** El indicador va a la izquierda, en el color de «elegido». */
function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(ITEM_BASE, 'pl-8', className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center text-primary">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(ITEM_BASE, 'pl-8', className)}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center text-primary">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

/** Etiqueta de grupo: 12 px en texto de apoyo, minúscula normal. */
function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-2 pt-2 pb-1 type-caption text-subtle-foreground data-inset:pl-8',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

/** El atajo, a la derecha: un `KbdShortcut` o texto. */
function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto flex items-center pl-4 type-caption text-subtle-foreground',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSub(props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        ITEM_BASE,
        'data-inset:pl-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        "[&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        MENU_SURFACE,
        'origin-(--radix-dropdown-menu-content-transform-origin)',
        MENU_MOTION,
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
