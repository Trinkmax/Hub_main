'use client'

import { Tooltip as TooltipPrimitive } from 'radix-ui'
import * as React from 'react'
import { usePortalContainer } from '@/components/ui/portal-container'
import { cn } from '@/lib/utils'

/**
 * Tooltip del kit HUB (§3.5). **Solo nombra un ícono o completa un texto
 * truncado**: nunca lleva información esencial, porque con el dedo no se ve
 * (para explicar algo, `InfoTip`).
 *
 * **Un solo proveedor.** El shell monta `TooltipProvider` una vez (400 ms para
 * el primero, 300 ms de gracia: al pasar de un ícono al de al lado, el
 * siguiente aparece al toque). Un `Tooltip` sin proveedor arriba (el catálogo,
 * auth) se arma uno propio con los mismos tiempos, así nunca tira el error de
 * Radix «Tooltip must be used within TooltipProvider».
 */

const TOOLTIP_DELAY_MS = 400
const TOOLTIP_SKIP_DELAY_MS = 300

/** ¿Hay un `TooltipProvider` del kit más arriba? */
const HasProviderContext = React.createContext(false)

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  skipDelayDuration = TOOLTIP_SKIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <HasProviderContext.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </HasProviderContext.Provider>
  )
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasProvider = React.useContext(HasProviderContext)
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  return hasProvider ? root : <TooltipProvider>{root}</TooltipProvider>
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/**
 * Papel y tinta invertidos, 240 px de ancho como máximo, a 6 px del disparador
 * y sin flecha. El primero entra en 150 ms desde su origen;
 * los siguientes (`data-state="instant-open"`) aparecen sin animar. El borde
 * transparente es para el alto contraste de Windows, que pinta los bordes y no
 * los fondos.
 */
function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const container = usePortalContainer()
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit max-w-60 origin-(--radix-tooltip-content-transform-origin) rounded-sm border border-transparent bg-foreground px-2 py-1 type-small text-pretty text-background shadow-float',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'fade-in-0 zoom-in-97 fade-out-0 zoom-out-97 duration-(--duration-quick) ease-(--ease-ui)',
          'motion-reduce:zoom-in-100 motion-reduce:zoom-out-100',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
