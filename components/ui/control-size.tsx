'use client'

import * as React from 'react'

/** Los tres altos del kit: 32/36/44 px con mouse y 36/44/48 con el dedo (§2.2). */
export type ControlSize = 'sm' | 'md' | 'lg'

/** Nombres viejos que todavía llegan por compatibilidad (`default` de Button, Select y Switch; `xl` de Button). */
type LegacyControlSize = 'default' | 'xl'

const ControlSizeContext = React.createContext<ControlSize | undefined>(undefined)

/**
 * Lo que necesita el Button para medir lo mismo que los campos de la fila. El
 * Button es server-safe (sin hooks: se usa en Server Components), así que no
 * puede leer el contexto de React: lee estas variables por CSS. Cuando el
 * botón no recibe `size`, sus clases usan `var(--control-h, var(--control-md))`
 * y compañía; con un `size` explícito usa sus clases fijas y la prop gana.
 */
const SIZE_VARS: Record<ControlSize, Record<string, string>> = {
  sm: {
    '--control-h': 'var(--control-sm)',
    '--control-px': '0.75rem',
    '--control-px-icon': '0.75rem',
    '--control-text': '0.8125rem',
    '--control-icon': '1rem',
  },
  md: {
    '--control-h': 'var(--control-md)',
    '--control-px': '1rem',
    '--control-px-icon': '0.75rem',
    '--control-text': '0.875rem',
    '--control-icon': '1rem',
  },
  lg: {
    '--control-h': 'var(--control-lg)',
    '--control-px': '1.25rem',
    '--control-px-icon': '1rem',
    '--control-text': '1rem',
    '--control-icon': '1.25rem',
  },
}

export type ControlSizeProviderProps = {
  size: ControlSize
  children: React.ReactNode
}

/**
 * «Una fila, un tamaño» (§3.0): fija el `size` por defecto de los controles de
 * adentro; la prop explícita de cada control gana. `DataTableToolbar` lo pone
 * en `sm` y así buscador, segmentado, chips, período y «Exportar» quedan
 * alineados sin repetir la prop.
 *
 * Los controles cliente (Input, Select, Switch…) lo leen por contexto con
 * `useControlSize`. El Button lo lee por CSS: el envoltorio es un
 * `<div class="contents">` (no arma caja, así que no rompe el flex ni el gap
 * de la fila) que declara las variables de arriba, y las variables heredan.
 * Lo que se portaliza (un menú, un diálogo) sale del envoltorio y vuelve al
 * tamaño normal, que es lo que corresponde.
 */
function ControlSizeProvider({ size, children }: ControlSizeProviderProps) {
  return (
    <ControlSizeContext.Provider value={size}>
      <div
        data-slot="control-size"
        data-size={size}
        className="contents"
        style={SIZE_VARS[size] as React.CSSProperties}
      >
        {children}
      </div>
    </ControlSizeContext.Provider>
  )
}

/** Lleva los nombres viejos a la escala nueva: `default` → `md`, `xl` → `lg`. */
function normalizeControlSize(size: ControlSize | LegacyControlSize | null | undefined) {
  if (size === 'default') return 'md'
  if (size === 'xl') return 'lg'
  return size ?? undefined
}

/**
 * El tamaño de un control: el propio si vino, si no el del `ControlSizeProvider`
 * más cercano, si no `md`.
 */
function useControlSize(own?: ControlSize | LegacyControlSize | null): ControlSize {
  const inherited = React.useContext(ControlSizeContext)
  return normalizeControlSize(own) ?? inherited ?? 'md'
}

export { ControlSizeProvider, normalizeControlSize, useControlSize }
