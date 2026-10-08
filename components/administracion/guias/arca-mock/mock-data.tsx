'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { type ArcaMockData, DEFAULT_MOCK_DATA } from '../arca-guide-model'

const MockDataContext = createContext<ArcaMockData>(DEFAULT_MOCK_DATA)

/**
 * Los datos del bar para todas las maquetas de ARCA (diseño §5.1.2): la razón social en
 * mayúsculas, la CUIT con guiones, el alias, el punto de venta y el nombre del pedido. La CUIT
 * y el nombre de la persona nunca se inventan: dicen «TU CUIT» y «TU NOMBRE».
 */
export function MockDataProvider({
  value,
  children,
}: {
  value: ArcaMockData
  children: ReactNode
}) {
  return <MockDataContext.Provider value={value}>{children}</MockDataContext.Provider>
}

/** Fuera de un `MockDataProvider` (las mini guías) devuelve textos genéricos. */
export function useMockData(): ArcaMockData {
  return useContext(MockDataContext)
}
