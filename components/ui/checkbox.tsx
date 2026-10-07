'use client'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon, MinusIcon } from 'lucide-react'
import type * as React from 'react'
import { useFieldControl } from '@/components/ui/field'
import { cn } from '@/lib/utils'

export type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** Atajo de `aria-invalid`. */
  invalid?: boolean
  /** Solo lectura: se ve y se enfoca, pero no cambia (rol Contabilidad). */
  readOnly?: boolean
}

/** Un click que no tiene que cambiar nada: Radix no alterna si el evento viene cancelado. */
function preventToggle(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

/**
 * Casilla (§3.2): la de Radix + `invalid`. Con `name` y `value` Radix crea el
 * input del formulario.
 *
 * - Caja de 16 px (20 con el dedo), `rounded-[4px]` (excepción documentada: con
 *   6 px una caja de 16 se ve redonda), borde de campo de 3,56:1.
 * - Marcada: relleno verde y check de 12 px con trazo 3. Indeterminada: un
 *   guion (para «elegir todo»).
 * - El área clickeable llega a 24 px con mouse y a 44 con el dedo (hit-area).
 * - Foco «afuera».
 */
function Checkbox({ className, invalid, readOnly, onClick, ...props }: CheckboxProps) {
  const control = useFieldControl({
    ...props,
    readOnly,
    'aria-invalid': invalid ? true : props['aria-invalid'],
  })
  const { readOnly: isReadOnly, ...rootProps } = control

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      aria-readonly={isReadOnly ? true : undefined}
      {...rootProps}
      onClick={isReadOnly ? preventToggle : onClick}
      className={cn(
        'peer group/checkbox relative hit-area inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card text-primary-foreground pointer-coarse:size-5',
        'transition-colors duration-(--duration-quick)',
        'outline-offset-2 outline-(--ring) focus-visible:outline-2',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'aria-invalid:border-destructive',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon
          className="size-3 group-data-[state=indeterminate]/checkbox:hidden pointer-coarse:size-3.5"
          strokeWidth={3}
          aria-hidden
        />
        <MinusIcon
          className="hidden size-3 group-data-[state=indeterminate]/checkbox:block pointer-coarse:size-3.5"
          strokeWidth={3}
          aria-hidden
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
