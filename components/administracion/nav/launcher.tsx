'use client'

import { Plus } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { ActionTile } from '@/components/administracion/kit/action-tile'
import { cn } from '@/lib/utils'
import {
  LAUNCHER_DESCRIPTION,
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
  launcherHref,
} from './launcher-items'
import { NavDialog } from './nav-dialog'

/**
 * El lanzador «¿Qué querés cargar?»: la única puerta de carga de la sección. Reemplaza a los dos
 * menús «Más» (el del encabezado y el de la barra del celular, que no decían lo mismo): ocho
 * tarjetas que se eligen por lo que pasó, y cada una abre la hoja (`?accion=`) o la pantalla que
 * ya existía.
 *
 * Controlado: quien lo abre guarda el estado (`LauncherButton`, el flotante del celular). Sin
 * permiso de escritura no se dibuja nada: la contadora no ve ninguna puerta de carga.
 */
export function Launcher({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { tenantSlug, readOnly, openAction } = useAccounting()
  const pathname = usePathname()
  const base = `/${tenantSlug}/administracion`

  // Elegir una pantalla navega: el lanzador se cierra con la navegación aunque la tarjeta no
  // avise el click (red de seguridad; `openedAt` evita cerrarlo en el mismo render que lo abre).
  const openedAt = useRef(pathname)
  useEffect(() => {
    if (!open) {
      openedAt.current = pathname
      return
    }
    if (openedAt.current !== pathname) onOpenChange(false)
  }, [open, pathname, onOpenChange])

  if (readOnly) return null

  const close = () => onOpenChange(false)

  return (
    <NavDialog
      open={open}
      onOpenChange={onOpenChange}
      title={LAUNCHER_TITLE}
      description={LAUNCHER_DESCRIPTION}
      size="lg"
      footer={
        <p>
          ¿No sabés dónde va?{' '}
          <Link
            href={`${base}/guias`}
            onClick={close}
            className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Mirá la guía
          </Link>
        </p>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {LAUNCHER_ITEMS.map((item) => {
          const href = launcherHref(base, item.target)
          const { target } = item
          return (
            <li key={item.key} className="flex">
              {target.kind === 'sheet' ? (
                <ActionTile
                  icon={item.icon}
                  title={item.title}
                  hint={item.hint}
                  className="w-full"
                  // Primero se cierra el lanzador y después se abre la hoja: nunca quedan dos
                  // diálogos apilados, y al cerrar la hoja el foco vuelve al botón «Cargar».
                  onClick={() => {
                    close()
                    openAction(target.action)
                  }}
                />
              ) : (
                <ActionTile
                  icon={item.icon}
                  title={item.title}
                  hint={item.hint}
                  className="w-full"
                  href={href ?? base}
                  onClick={close}
                />
              )}
            </li>
          )
        })}
      </ul>
    </NavDialog>
  )
}

/**
 * El botón «＋ Cargar» con su lanzador. Lo usa la barra de la sección en la compu y lo puede usar
 * cualquier pantalla que quiera ofrecer «cargar algo» sin elegir por el usuario qué. En modo
 * lectura no se muestra (ni deshabilitado).
 */
export function LauncherButton({
  children,
  className,
}: {
  /** Por defecto, «＋ Cargar». */
  children?: ReactNode
  className?: string
}) {
  const { readOnly } = useAccounting()
  const [open, setOpen] = useState(false)
  if (readOnly) return null
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
          className,
        )}
      >
        {children ?? (
          <>
            <Plus className="size-4" aria-hidden="true" />
            Cargar
          </>
        )}
      </button>
      <Launcher open={open} onOpenChange={setOpen} />
    </>
  )
}
