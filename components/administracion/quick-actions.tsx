'use client'

import type { ComponentProps, ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACTION_TITLES, type AccountingAction, type ActionParams } from './acciones/types'
import { useAccounting } from './accounting-provider'
import { LauncherButton } from './nav/launcher'

/** Lo que dura el «Deshacer» de lo que se guarda sin preguntar (mismo tiempo que el operativo). */
export const UNDO_MS = 6000

/**
 * El aviso después de guardar algo frecuente: «Gasto cargado · $ 12.500,00»
 * [Deshacer] durante 6 s. Lo irreversible no va con esto: va con `AlertDialog`.
 */
export function toastUndo(
  message: string,
  opts: {
    onUndo: () => void | Promise<void>
    description?: string
    id?: string | number
    undoLabel?: string
  },
): string | number {
  return toast(message, {
    id: opts.id,
    description: opts.description,
    duration: UNDO_MS,
    action: {
      label: opts.undoLabel ?? 'Deshacer',
      onClick: () => {
        void opts.onUndo()
      },
    },
  })
}

/**
 * Un botón que abre una hoja de acción rápida sobre la pantalla actual. No se
 * muestra en modo lectura (la contadora no ve botones de carga deshabilitados:
 * no los ve).
 */
export function ActionButton({
  action,
  params,
  children,
  ...button
}: {
  action: AccountingAction
  params?: ActionParams
  children?: ReactNode
} & Omit<ComponentProps<typeof Button>, 'onClick' | 'asChild' | 'type'>) {
  const { readOnly, openAction } = useAccounting()
  if (readOnly) return null
  return (
    <Button type="button" {...button} onClick={() => openAction(action, params)}>
      {children ?? ACTION_TITLES[action]}
    </Button>
  )
}

/**
 * «＋ Cargar» flotante del celular: abre el lanzador «¿Qué querés cargar?». Reemplazó a la barra
 * fija de tres botones ([＋ Gasto] · [Cierre del día] · [Más]), que ocupaba todo el ancho y
 * obligaba a saber de antemano qué nombre tenía lo que querías cargar. Va en las pantallas de la
 * barra (Resumen, Compras y pagos, Gastos fijos, Ventas, Cajas); desde `lg` no se ve, porque
 * «Cargar» está en la barra de la sección. Conserva el nombre para no tocar a quienes ya lo usan.
 *
 * Abajo a la derecha, por encima del área segura del iPhone, y deja su propio espacio al final de
 * la página para que lo último siempre se pueda leer sin el botón encima. Las hojas (z-50, con su
 * fondo) lo tapan mientras están abiertas: no compite con sus botones de abajo.
 */
export function QuickActionsBar() {
  const { readOnly } = useAccounting()
  if (readOnly) return null
  return (
    <>
      <div aria-hidden="true" className="h-24 lg:hidden" />
      <LauncherButton className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-30 h-14 gap-2 px-5 text-base shadow-lg lg:hidden" />
    </>
  )
}
