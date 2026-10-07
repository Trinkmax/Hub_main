'use client'

import { CircleHelp } from 'lucide-react'
import type * as React from 'react'
import { useSyncExternalStore } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * La «i» que explica un término (kit HUB §3.5): «Qué son los cubiertos».
 *
 * - Con mouse es un tooltip al pasar o enfocar; con el dedo, un popover al
 *   tocar (un tooltip no se ve con el dedo, y esto sí es información).
 * - Dibuja un ícono de 16 px con un área de 24 (44 con el dedo, `hit-area`).
 * - `label` es el nombre del botón para el lector de pantalla; `children`, la
 *   explicación.
 */

export type InfoTipProps = Omit<React.ComponentProps<'button'>, 'children'> & {
  /** El nombre del botón: «Qué son los cubiertos». */
  label: string
  /** La explicación. */
  children: React.ReactNode
  /** Default `top`. */
  side?: 'top' | 'right' | 'bottom' | 'left'
}

const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

function subscribePointer(onChange: () => void): () => void {
  const query = window.matchMedia(FINE_POINTER_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const readFinePointer = () => window.matchMedia(FINE_POINTER_QUERY).matches
/** En el server se dibuja como tooltip: el botón es el mismo, solo cambia qué abre. */
const readFinePointerOnServer = () => true

function InfoTip({ label, children, side = 'top', className, ...props }: InfoTipProps) {
  const finePointer = useSyncExternalStore(
    subscribePointer,
    readFinePointer,
    readFinePointerOnServer,
  )

  const trigger = (
    <button
      type="button"
      aria-label={label}
      data-slot="info-tip"
      className={cn(
        'relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground hit-area',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)',
        className,
      )}
      {...props}
    >
      <CircleHelp className="size-4" aria-hidden="true" />
    </button>
  )

  if (finePointer) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side={side} data-slot="info-tip-content">
          {children}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        size="sm"
        aria-label={label}
        data-slot="info-tip-content"
        className="type-small text-pretty text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export { InfoTip }
