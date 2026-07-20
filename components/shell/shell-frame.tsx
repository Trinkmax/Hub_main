'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-state'

/**
 * Marco del workspace manager con sidebar plegable: anima el corrimiento de la
 * sidebar y el padding del contenido según el estado (desktop only).
 */
export function ShellFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <>
      <aside
        aria-label="Navegación principal"
        aria-hidden={collapsed}
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-border/60 bg-surface/85 backdrop-blur-xl transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out)] supports-[backdrop-filter]:bg-surface/65 lg:flex',
          collapsed && '-translate-x-full',
        )}
      >
        {sidebar}
      </aside>

      <div
        className={cn(
          'flex min-h-dvh flex-col transition-[padding-left] duration-[var(--duration-slow)] ease-[var(--ease-out)]',
          collapsed ? 'lg:pl-0' : 'lg:pl-[260px]',
        )}
      >
        {children}
      </div>
    </>
  )
}
