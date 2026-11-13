'use client'

import { X } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Tocar un aviso (su «Deshacer», su X) no cuenta como tocar afuera de la hoja: los avisos
 * viven en el `body` y, sin esto, el toque cerraba la hoja antes de llegar al botón.
 */
function keepOpenOnToast(event: Event): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) event.preventDefault()
}

/**
 * Al cerrar la hoja, el foco vuelve a lo que la abrió (el botón «Aumentar precios», el reloj
 * de un producto). La hoja se abre desde afuera, sin `SheetTrigger`, y así el primitivo no
 * sabe a dónde volver: el foco caía en el `body` y con el teclado se perdía el lugar en la
 * lista de 233 productos.
 */
function useReturnFocus(open: boolean): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null)
  // Antes de que la hoja se monte y se lleve el foco.
  useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
  }, [open])

  return (event) => {
    const target = opener.current
    opener.current = null
    if (!target?.isConnected) return
    event.preventDefault()
    target.focus()
  }
}

/**
 * La hoja de «Precios» (el aumento, el historial): entra por la derecha en la compu y ocupa
 * la pantalla en el celular, con el mismo aspecto que las hojas de Administración. Título en
 * Fraunces y, adentro, `SideSheetBody` (lo que desliza) y, si hace falta, `SideSheetFooter`
 * (el pie fijo con EL botón).
 *
 * El contenido se monta recién al abrir y se desmonta al cerrar: cada vez arranca de cero.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  testId,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  testId?: string
  children: ReactNode
}) {
  const returnFocus = useReturnFocus(open)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // La X la dibuja la hoja: la del primitivo mide 32 px y en el celular no llega a 44.
        showClose={false}
        data-testid={testId}
        onPointerDownOutside={keepOpenOnToast}
        onInteractOutside={keepOpenOnToast}
        onCloseAutoFocus={returnFocus}
        className={cn(
          'w-full gap-0 overflow-hidden p-0 sm:max-w-[35rem] sm:rounded-l-3xl',
          'ease-(--ease-out) data-[state=closed]:duration-200 data-[state=open]:duration-300',
          'motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none',
        )}
      >
        <header className="shrink-0 space-y-1.5 border-b border-border/60 px-4 pt-5 pr-16 pb-4 sm:px-7 sm:pt-7 sm:pr-20">
          <SheetTitle className="text-balance font-serif text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </SheetTitle>
          <SheetDescription className="text-pretty">{description}</SheetDescription>
        </header>
        {children}
        <SheetClose className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:top-5 sm:right-5">
          <X className="size-5" aria-hidden />
          <span className="sr-only">Cerrar</span>
        </SheetClose>
      </SheetContent>
    </Sheet>
  )
}

/** El cuerpo: lo único que desliza. Al llegar al final no arrastra la pantalla de atrás. */
export function SideSheetBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** El pie fijo, con el área segura del iPhone. */
export function SideSheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-border/60 bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-7 sm:py-4">
      {children}
    </div>
  )
}

/** La voz de las preguntas de una hoja («¿A qué productos?»): Fraunces, un escalón bajo el título. */
export const SHEET_QUESTION = 'font-serif text-lg leading-snug font-semibold tracking-tight'
