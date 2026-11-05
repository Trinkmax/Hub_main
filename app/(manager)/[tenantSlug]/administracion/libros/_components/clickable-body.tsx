'use client'

import type { MouseEvent, ReactNode } from 'react'

/**
 * El `<tbody>` de una planilla donde tocar la fila hace lo mismo que su link o su botón (el que lleva
 * `data-row-action`). Con el teclado se usa ese link o ese botón; esto es para el mouse y el dedo, y
 * deja las filas como componentes de servidor. Si la fila no tiene acción, se busca en todo el `tbody`
 * (en el Diario, un asiento son varias filas y la acción va en la primera).
 */
export function ClickableBody({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  function onClick(event: MouseEvent<HTMLTableSectionElement>) {
    const target = event.target as HTMLElement
    if (target.closest('a, button, input, select, textarea, label')) return
    // Seleccionando un número para copiarlo no se navega.
    if (window.getSelection()?.toString()) return
    const action =
      target.closest('tr')?.querySelector<HTMLElement>('[data-row-action]') ??
      event.currentTarget.querySelector<HTMLElement>('[data-row-action]')
    action?.focus({ preventScroll: true })
    action?.click()
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: con el teclado se usa el link o el botón de la fila.
    <tbody className={className} onClick={onClick}>
      {children}
    </tbody>
  )
}
