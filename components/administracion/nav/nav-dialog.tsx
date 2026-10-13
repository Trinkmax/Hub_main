'use client'

import { X } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * El marco del lanzador y de «Más»: un diálogo centrado en la compu y una hoja que sube desde
 * abajo en el celular (donde el pulgar llega). Es UN solo `Dialog` de `components/ui` con clases
 * por ancho, no dos componentes elegidos con JavaScript: así no hay salto al hidratar ni se
 * desmonta si se gira el teléfono con el diálogo abierto.
 *
 * Las clases `max-sm:*` pisan las del `DialogContent` base (centrado con top/left 50 %) solo por
 * debajo de `sm`; el primitivo no se toca.
 */
const SHEET_ON_PHONE = [
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none',
  'max-sm:translate-x-0 max-sm:translate-y-0',
  'max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0',
  'max-sm:pb-[env(safe-area-inset-bottom)]',
  // Sube desde abajo en vez de hacer zoom (el zoom queda en 100 % para que no se sumen).
  'max-sm:duration-300 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
  'max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100',
].join(' ')

const WIDTH = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
} as const

export function NavDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Una línea al pie, fuera del scroll (siempre a la vista). */
  footer?: ReactNode
  size?: keyof typeof WIDTH
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // La X propia va al final del DOM (abajo) y el foco, al abrir, cae en la opción donde
        // estás o en la primera: con el teclado se elige de una. Radix solo, saltea los links y
        // lo dejaba en «Cerrar» (o en la segunda tarjeta del lanzador, que es un botón).
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          const body = bodyRef.current
          const target =
            body?.querySelector<HTMLElement>('[aria-current="page"]') ??
            body?.querySelector<HTMLElement>('a[href], button:not([disabled])')
          if (!target) return
          event.preventDefault()
          target.focus()
        }}
        className={cn(
          'flex max-h-[min(90dvh,46rem)] flex-col gap-0 overflow-hidden rounded-3xl p-0',
          'motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none',
          WIDTH[size],
          SHEET_ON_PHONE,
        )}
      >
        {/* El «agarre» de las hojas del celular: avisa que esto subió desde abajo. */}
        <div
          aria-hidden="true"
          className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-foreground/20 sm:hidden"
        />
        <div className="shrink-0 space-y-1 px-5 pt-4 pr-14 pb-3 sm:px-6 sm:pt-6 sm:pr-16">
          <DialogTitle className="text-balance font-serif text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </div>
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-4 sm:px-4"
        >
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-border/60 px-5 py-3 text-sm text-muted-foreground sm:px-6">
            {footer}
          </div>
        ) : null}
        <DialogClose className="absolute top-3 right-3 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:top-4 sm:right-4">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Cerrar</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
