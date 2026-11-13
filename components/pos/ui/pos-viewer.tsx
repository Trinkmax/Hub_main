'use client'

import { createContext, useContext, useMemo } from 'react'

/**
 * Quién está trabajando en este teléfono ahora. Lo arma la página (que ya validó la sesión) y lo usan
 * las piezas que guardan cosas en el teléfono: lo que queda sin enviar es de quien lo cargó, y el
 * teléfono pasa de mano en mano.
 */
type PosViewer = { userId: string }

const PosViewerContext = createContext<PosViewer | null>(null)

export function PosViewerProvider({
  userId,
  children,
}: {
  userId: string
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ userId }), [userId])
  return <PosViewerContext.Provider value={value}>{children}</PosViewerContext.Provider>
}

/** `null` si la pantalla no lo armó: quien lo use tiene que seguir andando sin saber quién mira. */
export function usePosViewer(): PosViewer | null {
  return useContext(PosViewerContext)
}
