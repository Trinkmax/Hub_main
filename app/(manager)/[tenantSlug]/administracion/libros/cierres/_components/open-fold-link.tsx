'use client'

import type { ReactNode } from 'react'

/**
 * Un link a un plegable de la misma pantalla. Un `<details>` cerrado no se abre solo porque el ancla
 * sea él: sin esto, el link no llevaba a nada que se pudiera ver.
 */
export function OpenFoldLink({
  target,
  className,
  children,
}: {
  /** El `id` del `<details>`. */
  target: string
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={`#${target}`}
      className={className}
      onClick={() => {
        const fold = document.getElementById(target)
        if (fold instanceof HTMLDetailsElement) fold.open = true
      }}
    >
      {children}
    </a>
  )
}
