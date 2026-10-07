'use client'

import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import type * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import { useField, useFieldControl } from '@/components/ui/field'
import { fieldSurface } from '@/components/ui/input'
import { MENU_MOTION, usePortalContainer } from '@/components/ui/portal-container'
import { cn } from '@/lib/utils'

/**
 * Lista corta de opciones (§3.2): la API y los exports de siempre (Radix).
 * Con más de 8 opciones va `Combobox`.
 *
 * Adentro de un `Field`, el Select toma name, required y disabled (con `name`,
 * Radix arma el `<select>` nativo oculto para el FormData) y el disparador
 * toma id, aria-describedby y aria-invalid. Con `readOnly` del Field no abre:
 * se ve y se enfoca, pero no se cambia.
 */
function Select({
  name,
  required,
  disabled,
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const field = useField()
  const readOnly = field?.readOnly === true
  return (
    <SelectPrimitive.Root
      data-slot="select"
      name={name ?? field?.name}
      required={required ?? field?.required}
      disabled={disabled ?? field?.disabled}
      open={readOnly ? false : open}
      onOpenChange={readOnly ? undefined : onOpenChange}
      {...props}
    />
  )
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/** @deprecated default→md */
export type LegacySelectSize = 'default'

export type SelectTriggerProps = React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  /** Default `md` (o el del `ControlSizeProvider`). `default` está deprecado: es `md`. */
  size?: ControlSize | LegacySelectSize
  /** Atajo de `aria-invalid`. */
  invalid?: boolean
}

const TRIGGER_HEIGHT: Record<ControlSize, string> = {
  sm: 'h-(--control-sm)',
  md: 'h-(--control-md)',
  lg: 'h-(--control-lg)',
}

/**
 * El disparador ES un Input: mismo alto, borde, fondo y foco «sobre el borde»;
 * chevron de 16 px en texto de apoyo. `w-fit` suelto (compatibilidad) y
 * `w-full` adentro de un Field.
 */
function SelectTrigger({ className, size, invalid, children, ...props }: SelectTriggerProps) {
  const resolvedSize = useControlSize(size)
  const field = useField()
  // name/required/disabled los maneja el Root; acá solo lo que va en el botón.
  const control = useFieldControl({
    ...props,
    name: undefined,
    required: undefined,
    'aria-invalid': invalid ? true : props['aria-invalid'],
  })
  const { name: _name, required: _required, readOnly, ...triggerProps } = control
  const fullWidth = field !== null && field.layout !== 'toggle'

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={resolvedSize}
      aria-readonly={readOnly ? true : undefined}
      {...triggerProps}
      className={cn(
        fieldSurface,
        'flex items-center justify-between gap-2 px-3 text-start whitespace-nowrap',
        fullWidth ? 'w-full' : 'w-fit',
        TRIGGER_HEIGHT[resolvedSize],
        'data-[placeholder]:text-subtle-foreground',
        'aria-readonly:border-border aria-readonly:bg-muted',
        '*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 text-subtle-foreground" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export type SelectContentProps = React.ComponentProps<typeof SelectPrimitive.Content> & {
  /**
   * Dónde se portaliza. Sin valor, el del `PortalContainerProvider` más cercano
   * (§3.0, «Portales»), y sin proveedor a `<body>` como siempre. Un valor
   * explícito gana, igual que en Dialog, Sheet y DropdownMenu.
   */
  container?: React.ComponentProps<typeof SelectPrimitive.Portal>['container']
}

/**
 * La lista: cartulina flotante con borde, `rounded-xl` y `shadow-float`. Sale
 * del disparador en 180 ms y se va en 120 ms; con «reducir movimiento», solo
 * fundido. El movimiento es el `MENU_MOTION` compartido: con la escala atada a
 * `data-[state=open]:` la regla pesaba más que `motion-reduce:zoom-in-100` y
 * «reducir movimiento» no la sacaba.
 */
function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  container,
  ...props
}: SelectContentProps) {
  const providerContainer = usePortalContainer()
  return (
    <SelectPrimitive.Portal container={container ?? providerContainer}>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={position === 'popper' ? sideOffset : undefined}
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto',
          'rounded-xl border border-border bg-popover text-popover-foreground shadow-float',
          'origin-(--radix-select-content-transform-origin)',
          MENU_MOTION,
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('px-2 py-1.5 type-caption font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}

export type SelectItemProps = React.ComponentProps<typeof SelectPrimitive.Item> & {
  /** Una línea de apoyo debajo de la opción. No entra en el valor que se ve en el disparador. */
  description?: React.ReactNode
}

/**
 * Una opción: 32 px de alto como mínimo (44 con el dedo), check a la derecha en
 * verde y resaltado `bg-accent` sin transición (se mueve con las flechas: una
 * transición dejaría estela).
 */
function SelectItem({ className, children, description, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full min-h-8 cursor-default items-center gap-2 rounded-md py-1.5 ps-2 pe-8 type-body outline-hidden select-none pointer-coarse:min-h-11',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        // El texto de la opción puede traer un ícono: en línea y centrado.
        '*:data-[slot=select-item-text]:flex *:data-[slot=select-item-text]:items-center *:data-[slot=select-item-text]:gap-2',
        className,
      )}
      {...props}
    >
      <span className="absolute end-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-primary" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      {description ? (
        <span className="grid min-w-0 gap-0.5 *:data-[slot=select-item-text]:flex *:data-[slot=select-item-text]:items-center *:data-[slot=select-item-text]:gap-2">
          <SelectPrimitive.ItemText data-slot="select-item-text">
            {children}
          </SelectPrimitive.ItemText>
          {/* Afuera del ItemText: no se copia al disparador ni entra en el nombre de la opción. */}
          <span data-slot="select-item-description" className="type-caption text-subtle-foreground">
            {description}
          </span>
        </span>
      ) : (
        <SelectPrimitive.ItemText data-slot="select-item-text">{children}</SelectPrimitive.ItemText>
      )}
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        'flex cursor-default items-center justify-center py-1 text-subtle-foreground',
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" aria-hidden />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        'flex cursor-default items-center justify-center py-1 text-subtle-foreground',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" aria-hidden />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
