'use client'

import * as React from 'react'

/** Qué temas se ven: los dos lado a lado, o uno solo a todo el ancho. */
export type CatalogView = 'both' | 'light' | 'dark'

/** Cómoda: controles de 36 px y filas de 44 · compacta: controles de 32 px y filas de 36. */
export type CatalogDensity = 'comfortable' | 'compact'

export type CatalogContextValue = {
  view: CatalogView
  setView: (view: CatalogView) => void
  density: CatalogDensity
  setDensity: (density: CatalogDensity) => void
  tenantSlug: string
  /** `/[slug]/docs/componentes`: los links de los ejemplos son anclas de esta misma página. */
  basePath: string
  /** Hoy en Córdoba (`yyyy-MM-dd`), calculado una vez en el server: el server y el cliente dibujan lo mismo. */
  today: string
  /**
   * Monta los ejemplos de todos los bloques de una (el test de render). En la
   * página van montándose a medida que se acercan a la pantalla: son unos
   * 30.000 elementos entre los dos temas.
   */
  eager: boolean
}

const CatalogContext = React.createContext<CatalogContextValue | null>(null)

/** La vista se recuerda en este navegador (§6.2). */
const VIEW_STORAGE_KEY = 'hub:catalogo:vista'

const VIEWS: readonly CatalogView[] = ['both', 'light', 'dark']

function isCatalogView(value: unknown): value is CatalogView {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
}

function readStoredView(): CatalogView | null {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return isCatalogView(stored) ? stored : null
  } catch {
    // Ventana privada o almacenamiento bloqueado: se arranca con los dos lados.
    return null
  }
}

function writeStoredView(view: CatalogView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Sin almacenamiento la vista igual cambia; solo no se recuerda.
  }
}

export function CatalogProvider({
  tenantSlug,
  today,
  eager = false,
  children,
}: {
  tenantSlug: string
  today: string
  eager?: boolean
  children: React.ReactNode
}) {
  // El server no sabe lo que guardó el navegador: arranca en «lado a lado» y
  // la vista guardada se aplica al montar (así no hay error de hidratación).
  const [view, setViewState] = React.useState<CatalogView>('both')
  const [density, setDensity] = React.useState<CatalogDensity>('comfortable')

  React.useEffect(() => {
    const stored = readStoredView()
    if (stored) setViewState(stored)
  }, [])

  const setView = React.useCallback((next: CatalogView) => {
    setViewState(next)
    writeStoredView(next)
  }, [])

  const value = React.useMemo<CatalogContextValue>(
    () => ({
      view,
      setView,
      density,
      setDensity,
      tenantSlug,
      basePath: `/${tenantSlug}/docs/componentes`,
      today,
      eager,
    }),
    [view, setView, density, tenantSlug, today, eager],
  )

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog(): CatalogContextValue {
  const context = React.useContext(CatalogContext)
  if (!context) throw new Error('useCatalog va adentro de <CatalogProvider>.')
  return context
}

/** El tema del panel donde se dibuja un ejemplo (lo pone `ThemePanels`). */
export type PanelTheme = 'light' | 'dark'

const PanelThemeContext = React.createContext<PanelTheme>('light')

export function PanelThemeProvider({
  theme,
  children,
}: {
  theme: PanelTheme
  children: React.ReactNode
}) {
  return <PanelThemeContext.Provider value={theme}>{children}</PanelThemeContext.Provider>
}

export function usePanelTheme(): PanelTheme {
  return React.useContext(PanelThemeContext)
}
