'use client'

import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * La fila de una `DataTable` que abre algo (un cajón) en vez de navegar: un
 * botón estirado sobre toda la fila, con el mismo `data-slot` que el link de
 * fila del kit. Así la fila toma el hover, el presionado, el foco «adentro» y
 * los 44 px táctiles de una fila-link, y es una sola parada de Tab (un
 * `onClick` en el `<tr>` no anda con teclado).
 *
 * Va como contenido de la celda principal. Hueco del kit: `DataTable` solo
 * tiene `rowHref` (links); falta un `onRowClick`/`rowAction` para cajones.
 */
export function RowButton({
  className,
  type = 'button',
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type={type}
      data-slot="data-table-row-link"
      className={cn(
        'cursor-pointer text-start outline-none after:absolute after:inset-0',
        'focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--ring)',
        className,
      )}
      {...props}
    />
  )
}
