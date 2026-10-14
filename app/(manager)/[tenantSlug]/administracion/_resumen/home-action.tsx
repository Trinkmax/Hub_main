'use client'

import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import type { HomeAction } from '@/lib/accounting/home'
import { cn } from '@/lib/utils'

/**
 * El botón de una acción del Resumen (`HomeAction`, de `lib/accounting/home`):
 * va a una pantalla o abre la hoja sobre el Resumen (`?accion=`), según lo que
 * diga la acción. Es la única isla cliente que necesitan las tarjetas, así el
 * resto del bloque se arma en el servidor.
 *
 * En modo lectura no se dibuja: la contadora no ve botones de carga (igual
 * `lib/accounting/home` ya no le manda acciones; esto es la segunda red).
 */
export function HomeActionButton({
  action,
  variant = 'outline',
  className,
  children,
}: {
  action: HomeAction
  variant?: ComponentProps<typeof Button>['variant']
  className?: string
  /** Por defecto, el texto de la acción. */
  children?: ReactNode
}) {
  const { readOnly, openAction } = useAccounting()
  if (readOnly) return null

  // Un texto largo («Cargar el cierre del lunes 12/10») baja a dos renglones
  // en una tarjeta angosta en vez de salirse o cortarse.
  const classes = cn('h-auto min-h-11 whitespace-normal py-2 text-center text-balance', className)

  if (action.kind === 'href') {
    return (
      <Button asChild variant={variant} className={classes}>
        <Link href={action.href}>{children ?? action.label}</Link>
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant={variant}
      className={classes}
      onClick={() => openAction(action.sheet, action.params)}
    >
      {children ?? action.label}
    </Button>
  )
}
