'use client'

import { usePathname } from 'next/navigation'
import type { ComponentProps, ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ACTION_TITLES, type AccountingAction, type ActionParams } from './acciones/types'
import { useAccounting } from './accounting-provider'
import { admFabFromFrame } from './nav/adm-nav-model'
import { LauncherFab } from './nav/launcher-fab'

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
 * «＋ Cargar» flotante del celular (`LauncherFab`): abre el lanzador «¿Qué querés cargar?».
 * Reemplazó a la barra fija de tres botones ([＋ Gasto] · [Cierre del día] · [Más]), que ocupaba
 * todo el ancho y obligaba a saber de antemano qué nombre tenía lo que querías cargar.
 *
 * En las pantallas de primer nivel (Resumen, Ventas, Compras y pagos, Gastos fijos, Cajas,
 * Importar, Libros, Plan de cuentas) el flotante ya lo pone el marco de la sección (`AdmFab`,
 * en el layout): ahí esto no dibuja nada, para que no haya dos. Sirve en las sub-rutas que
 * quieran el flotante (una ficha) y no tengan pie fijo propio. Conserva el nombre para no tocar
 * a las páginas que ya lo usan.
 */
export function QuickActionsBar() {
  const { tenantSlug, readOnly } = useAccounting()
  const pathname = usePathname()
  if (readOnly) return null
  if (admFabFromFrame(`/${tenantSlug}/administracion`, pathname)) return null
  return <LauncherFab />
}
