'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SIDEBAR_ID } from './shell-ids'
import { useSidebar } from './sidebar-state'

/**
 * Marco del workspace manager con sidebar plegable (desktop): el menú lateral
 * fijo de `--sidebar-w` (256 px) y la columna del contenido, que corre su
 * padding según el estado.
 *
 * - Papel plano: el menú es `bg-surface` (el mismo papel que la página) con un
 *   pelo a la derecha, sin vidrio ni degradé.
 * - Plegado lleva `inert`: sale del orden de Tab y del árbol accesible. Antes
 *   tenía solo `aria-hidden` y sus links seguían enfocables, escondidos.
 * - Se mueve con la curva de las hojas (220 ms); con «reducir movimiento»,
 *   instantáneo.
 */
export function ShellFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <>
      <aside
        id={SIDEBAR_ID}
        aria-label="Menú lateral"
        inert={collapsed}
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden w-(--sidebar-w) flex-col border-r border-border bg-surface text-surface-foreground lg:flex',
          'transition-transform duration-(--duration-overlay) ease-(--ease-drawer) motion-reduce:transition-none',
          collapsed && '-translate-x-full',
        )}
      >
        {sidebar}
      </aside>

      <div
        className={cn(
          'flex min-h-dvh flex-col transition-[padding-left] duration-(--duration-overlay) ease-(--ease-drawer) motion-reduce:transition-none',
          collapsed ? 'lg:pl-0' : 'lg:pl-(--sidebar-w)',
        )}
      >
        {children}
      </div>
    </>
  )
}
