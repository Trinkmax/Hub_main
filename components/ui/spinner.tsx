import type * as React from 'react'
import { cn } from '@/lib/utils'

export type SpinnerSize = 14 | 16 | 20 | 24

export type SpinnerProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  /** Lado en px. Default 16 (el de un ícono de botón). */
  size?: SpinnerSize
  /** Texto para el lector de pantalla cuando va suelto. */
  label?: string
}

const SIZE_CLASS: Record<SpinnerSize, string> = {
  14: 'size-3.5',
  16: 'size-4',
  20: 'size-5',
  24: 'size-6',
}

const SPIN =
  'animate-[spin_700ms_linear_infinite] motion-reduce:animate-[spin_1200ms_linear_infinite]'

/**
 * Arco de 2 px que gira (§3.1 del kit).
 *
 * - Suelto lleva `role="status"` y el texto oculto: el lector anuncia «Cargando…».
 * - Adentro de un botón va con `aria-hidden` (el botón ya dice `aria-busy`):
 *   entonces la raíz es el `<svg>` pelado, sin rol ni texto, para que ocupe
 *   exactamente el lugar del ícono que reemplaza (un envoltorio rompería el
 *   `has-[>svg]` del padding del botón y el ancho saltaría).
 * - Gira en 700 ms lineal (rápido se siente más rápido); con «reducir
 *   movimiento», en 1,2 s. No se frena del todo: un spinner quieto no dice que
 *   algo está pasando.
 *
 * Server-safe: sin hooks, se puede usar desde un Server Component.
 */
function Spinner({ size = 16, label = 'Cargando…', className, ...props }: SpinnerProps) {
  // El trazo se calcula para que mida 2 px dibujado al tamaño pedido (viewBox
  // de 24). Si un className lo achica (la perilla del Switch), el trazo se
  // achica con él, que es lo que se quiere en un spinner de 10 px.
  const strokeWidth = (2 * 24) / size
  const path = (
    // Tres cuartos de vuelta: arranca arriba y termina a la izquierda.
    <path
      d="M12 3a9 9 0 1 1-9 9"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  )

  if (props['aria-hidden'] === true || props['aria-hidden'] === 'true') {
    // Los atributos que llegan (data-*, aria-*, id, style) valen igual en un
    // <svg>; los handlers reciben el evento del svg. Tipar el spinner con dos
    // raíces posibles complicaría a todos los que lo usan por un caso interno.
    const svgProps = props as unknown as React.ComponentProps<'svg'>
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        focusable="false"
        data-slot="spinner"
        {...svgProps}
        // Es la rama oculta: lo explícito además deja claro al lint que no lleva título.
        aria-hidden="true"
        className={cn('shrink-0', SPIN, SIZE_CLASS[size], className)}
      >
        {path}
      </svg>
    )
  }

  return (
    <span
      role="status"
      data-slot="spinner"
      {...props}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className={cn('shrink-0', SPIN, SIZE_CLASS[size])}
      >
        {path}
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export { Spinner }
