'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SIDEBAR_COOKIE, SIDEBAR_ID } from './shell-ids'

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

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle])
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar debe usarse dentro de <SidebarProvider>')
  return ctx
}

/**
 * Botón del topbar para plegar/desplegar la sidebar (solo desktop). El nombre
 * dice lo que va a hacer y `aria-expanded` cómo está el menú ahora; el tooltip
 * repite el nombre para el mouse (el `title` nativo no se ve con el teclado).
 */
export function SidebarToggle() {
  const { collapsed, toggle } = useSidebar()
  const label = collapsed ? 'Mostrar menú' : 'Ocultar menú'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={label}
          aria-expanded={!collapsed}
          aria-controls={SIDEBAR_ID}
          // Margen negativo: centra el icono sobre la columna del rail de
          // mensajería (64px de ancho → centro en 32px desde el borde del contenido)
          className="-ml-0.5 hidden sm:-ml-2.5 lg:inline-flex"
        >
          {collapsed ? (
            <PanelLeftOpen strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <PanelLeftClose strokeWidth={1.75} aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
