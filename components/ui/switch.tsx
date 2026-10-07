'use client'

import { Switch as SwitchPrimitive } from 'radix-ui'
import type * as React from 'react'
import { useFieldControl } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** @deprecated default→md */
export type LegacySwitchSize = 'default'

export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & {
  /** Default `md`. `default` está deprecado: es `md`. */
  size?: 'sm' | 'md' | LegacySwitchSize
  /** Optimistas: spinner de 10 px dentro de la perilla + `aria-busy`. */
  pending?: boolean
  /** Solo lectura: se ve y se enfoca, pero no cambia (rol Contabilidad). */
  readOnly?: boolean
}

/** Un click que no tiene que cambiar nada: Radix no alterna si el evento viene cancelado. */
function preventToggle(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

/**
 * Pista con borde transparente: en alto contraste el sistema le pinta el borde
 * y la pista se sigue viendo aunque desaparezca el fondo. El ancho cuenta ese
 * borde y 1 px de aire: md mide 36 × 20 (44 × 24 con el dedo) y la perilla, 16
 * (20); sm, 28 × 16 (36 × 20) con perilla de 12 (16).
 */
const TRACK = {
  md: 'h-5 w-9 pointer-coarse:h-6 pointer-coarse:w-11',
  sm: 'h-4 w-7 pointer-coarse:h-5 pointer-coarse:w-9',
}

const THUMB = {
  md: 'size-4 data-[state=checked]:translate-x-4 pointer-coarse:size-5 pointer-coarse:data-[state=checked]:translate-x-5',
  sm: 'size-3 data-[state=checked]:translate-x-3 pointer-coarse:size-4 pointer-coarse:data-[state=checked]:translate-x-4',
}

/**
 * Interruptor (§3.2). Para ajustes va con `Field layout="toggle"`: etiqueta y
 * descripción a la izquierda, switch a la derecha, toda la fila clickeable.
 *
 * - Apagado: pista con el borde de campo (3,56:1) y perilla cartulina.
 *   Prendido: pista verde y perilla clara; en oscuro, pista dorada y perilla
 *   oscura (los tokens ya lo resuelven).
 * - La perilla se desplaza en 150 ms; con «reducir movimiento», al instante.
 * - Con el dedo el área llega a 44 px (hit-area); foco «afuera».
 */
function Switch({ className, size, pending = false, readOnly, onClick, ...props }: SwitchProps) {
  const control = useFieldControl({ ...props, readOnly })
  const { readOnly: isReadOnly, ...rootProps } = control
  const key = size === 'sm' ? 'sm' : 'md'

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={key}
      aria-readonly={isReadOnly ? true : undefined}
      aria-busy={pending ? true : undefined}
      {...rootProps}
      onClick={isReadOnly ? preventToggle : onClick}
      className={cn(
        'peer group/switch relative hit-area inline-flex shrink-0 items-center rounded-full border border-transparent p-px',
        TRACK[key],
        'transition-colors duration-(--duration-quick)',
        'outline-offset-2 outline-(--ring) focus-visible:outline-2',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        'aria-invalid:border-destructive',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none flex items-center justify-center rounded-full',
          'bg-card text-muted-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary',
          'translate-x-0 transition-transform duration-(--duration-quick) ease-(--ease-ui) motion-reduce:transition-none',
          // Sin esto, en alto contraste el fondo pintado desaparece y no se ve
          // si está prendido.
          'forced-colors:border forced-colors:border-[CanvasText]',
          THUMB[key],
        )}
      >
        {pending ? <Spinner aria-hidden size={14} className="size-2.5" /> : null}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
