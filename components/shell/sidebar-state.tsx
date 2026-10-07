'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'
import { Button } from '@/components/ui/button'

export const SIDEBAR_COOKIE = 'hub_sidebar'

type SidebarState = {
  collapsed: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarState | null>(null)

/**
 * Estado de plegado de la sidebar principal (desktop). Se persiste en una
 * cookie no-httpOnly para que el server la lea en el primer render (sin flash).
 */
export function SidebarProvider({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      // biome-ignore lint/suspicious/noDocumentCookie: cookie no-httpOnly leída por el server en el primer render (mismo patrón que hub_theme); Cookie Store API aún no es universal
      document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }, [])

  return <SidebarContext.Provider value={{ collapsed, toggle }}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar debe usarse dentro de <SidebarProvider>')
  return ctx
}

/** Botón del topbar para plegar/desplegar la sidebar (solo desktop). */
export function SidebarToggle() {
  const { collapsed, toggle } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
      title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
      // Margen negativo: centra el icono sobre la columna del rail de
      // mensajería (64px de ancho → centro en 32px desde el borde del contenido)
      className="-ml-0.5 hidden h-9 w-9 text-muted-foreground hover:text-foreground sm:-ml-2.5 lg:inline-flex"
    >
      {collapsed ? (
        <PanelLeftOpen className="size-[18px]" aria-hidden />
      ) : (
        <PanelLeftClose className="size-[18px]" aria-hidden />
      )}
    </Button>
  )
}
