'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import { SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import type { AccountingAction, ActionSheetProps } from './types'

/** Mientras baja el código de la hoja (la primera vez): la forma real, sin spinner. */
function SheetLoading() {
  return (
    <div className="space-y-5 px-4 py-6 sm:px-6" aria-busy="true">
      <SheetTitle className="sr-only">Cargando…</SheetTitle>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}

/**
 * Una hoja por acción, cargada recién cuando se abre (el motor contable no
 * entra en el bundle de cada pantalla). El cuerpo de cada una vive en
 * `acciones/<accion>-sheet.tsx`.
 */
export const ACTION_SHEETS: Readonly<Record<AccountingAction, ComponentType<ActionSheetProps>>> = {
  gasto: dynamic(() => import('./gasto-sheet').then((m) => m.GastoSheet), {
    loading: SheetLoading,
  }),
  pagar: dynamic(() => import('./pagar-sheet').then((m) => m.PagarSheet), {
    loading: SheetLoading,
  }),
  cobrar: dynamic(() => import('./cobrar-sheet').then((m) => m.CobrarSheet), {
    loading: SheetLoading,
  }),
  mover: dynamic(() => import('./mover-sheet').then((m) => m.MoverSheet), {
    loading: SheetLoading,
  }),
  ajustar: dynamic(() => import('./ajustar-sheet').then((m) => m.AjustarSheet), {
    loading: SheetLoading,
  }),
  movimiento: dynamic(() => import('./movimiento-sheet').then((m) => m.MovimientoSheet), {
    loading: SheetLoading,
  }),
}
