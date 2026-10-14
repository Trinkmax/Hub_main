'use client'

import { createContext, type Dispatch, type SetStateAction, useContext } from 'react'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type { ChartIndex } from '../_lib/tree'

/**
 * Lo que comparten las piezas del plan de cuentas (el árbol, «Cuentas del sistema», el botón del
 * encabezado) con la hoja y los diálogos, que viven una sola vez en `ChartWorkspace`.
 */
export type ChartWorkspaceValue = {
  tenantSlug: string
  index: ChartIndex
  /** Contadora (o dueño sin carga): solo ver y exportar. */
  readOnly: boolean
  /** Importar y cambiar las cuentas del sistema: escritor y administrador de accesos. */
  canAdmin: boolean
  balancesAvailable: boolean
  expanded: ReadonlySet<string>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  /** La última cuenta creada o movida: el árbol la muestra y la resalta un momento. */
  focusId: string | null
  clearFocus: () => void
  /**
   * Abre la hoja de una cuenta. Con `simple` (desde «Tus categorías») la hoja muestra primero lo
   * que un socio sabe contestar (nombre y «para qué se usa») y pliega lo de la contadora; es el
   * mismo formulario y manda lo mismo.
   */
  openAccount: (id: string, opts?: { simple?: boolean }) => void
  /**
   * `undefined` = elegir dónde va; `null` = cuenta principal; un id = adentro de ese grupo.
   * Con `simple`, la hoja pide solo el nombre y «para qué se usa» (el alta corta de «Tus
   * categorías»); lo demás queda plegado con sus valores de siempre y se manda igual.
   */
  createAccount: (parentId?: string | null, opts?: { simple?: boolean }) => void
  moveAccount: (id: string) => void
  /** Desactivar pregunta antes (y explica si no se puede); reactivar guarda directo. */
  changeActive: (id: string, active: boolean) => void
  remapKey: (key: SystemAccountKey) => void
}

export const ChartWorkspaceContext = createContext<ChartWorkspaceValue | null>(null)

export function useChartWorkspace(): ChartWorkspaceValue {
  const value = useContext(ChartWorkspaceContext)
  if (!value) throw new Error('useChartWorkspace: falta <ChartWorkspace> (plan de cuentas).')
  return value
}
