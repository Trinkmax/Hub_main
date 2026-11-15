'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { SectionKey } from '../section-tabs-config'

/**
 * Qué secciones ya van con sus pestañas sueltas en la barra de abajo del celular (la de la anfitriona:
 * Reservas · Operativo · Calendario · Ventas). En esas, las píldoras de arriba de la página repetirían lo
 * mismo: en el celular se esconden (en la compu siguen, porque ahí no hay barra de abajo).
 */
const DockFlatContext = createContext<readonly SectionKey[]>([])

export function DockFlatProvider({
  sections,
  children,
}: {
  sections: readonly SectionKey[]
  children: ReactNode
}) {
  return <DockFlatContext.Provider value={sections}>{children}</DockFlatContext.Provider>
}

export function useDockFlat(): readonly SectionKey[] {
  return useContext(DockFlatContext)
}
