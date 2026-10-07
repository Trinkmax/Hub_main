'use client'

import { Ellipsis, Plus } from 'lucide-react'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ACTION_TITLES, type AccountingAction, type ActionParams } from './acciones/types'
import { useAccounting } from './accounting-provider'

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
 * La barra fija de abajo en el celular (H.2), para Resumen, Compras, Ventas y
 * Cajas: [＋ Gasto] · [Cierre del día] · [Más]. Desde `lg` no se ve (las
 * acciones van en el encabezado). Deja su propio espacio al final de la
 * página para no tapar el contenido.
 */
export function QuickActionsBar() {
  const { readOnly, openAction, tenantSlug } = useAccounting()
  if (readOnly) return null
  const base = `/${tenantSlug}/administracion`
  const more: Array<{ action: AccountingAction; label: string }> = [
    { action: 'pagar', label: 'Pagar a un proveedor' },
    { action: 'cobrar', label: ACTION_TITLES.cobrar },
    { action: 'mover', label: ACTION_TITLES.mover },
    { action: 'ajustar', label: 'Ajustar saldo de una caja' },
    { action: 'movimiento', label: ACTION_TITLES.movimiento },
  ]
  return (
    <>
      <div aria-hidden="true" className="h-24 lg:hidden" />
      <nav
        aria-label="Acciones rápidas"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <Button type="button" className="h-11 flex-1 gap-1.5" onClick={() => openAction('gasto')}>
            <Plus className="size-4" aria-hidden />
            Gasto
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-11 gap-1.5">
                <Ellipsis className="size-4" aria-hidden />
                Más
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-60">
              {more.map((item) => (
                <DropdownMenuItem
                  key={item.action}
                  className="min-h-11"
                  onSelect={() => openAction(item.action)}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="min-h-11">
                <Link href={`${base}/compras/nueva`}>Factura de proveedor</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </>
  )
}
