'use client'

import { X } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
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
  // En el celular puede crecer hasta dejar a la vista solo la barra de arriba del panel: las
  // ocho puertas del lanzador entran sin deslizar en un teléfono común.
  'max-sm:max-h-[calc(100dvh-3.5rem)]',
  // Sube desde abajo en vez de hacer zoom (el zoom queda en 100 % para que no se sumen).
  'max-sm:duration-300 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
  'max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100',
].join(' ')

const WIDTH = {
  md: 'sm:max-w-md',
  // El lanzador: ancho para que cada ejemplo en gris entre en un renglón (y nunca de borde a
  // borde: en una tablet deja el mismo aire que el diálogo base).
  lg: 'sm:max-w-[min(50rem,calc(100%-2rem))]',
} as const

/**
 * El cuerpo con scroll. Si queda contenido por ver hacia abajo (un teléfono chico, una notebook
 * baja), el borde de abajo se desvanece: avisa que sigue, en vez de parecer cortado. Al llegar
 * al final el desvanecido se va.
 */
function ScrollBody({
  bodyRef,
  children,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const [more, setMore] = useState(false)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => setMore(body.scrollHeight - body.clientHeight - body.scrollTop > 8)
    measure()
    body.addEventListener('scroll', measure, { passive: true })
    // El alto cambia al girar el teléfono, o si el contenido crece.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(body)
    if (body.firstElementChild) observer?.observe(body.firstElementChild)
    return () => {
      body.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [bodyRef])

  return (
    <div
      ref={bodyRef}
      data-more={more ? '' : undefined}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-4 data-more:[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)] sm:px-4"
    >
      {children}
    </div>
  )
}

export function NavDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  onCloseAutoFocus,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Una línea al pie, fuera del scroll (siempre a la vista). */
  footer?: ReactNode
  size?: keyof typeof WIDTH
  /**
   * Al cerrarse, el foco vuelve a lo que estaba enfocado antes de abrir. Con `preventDefault()`
   * no vuelve: para cuando el diálogo se cierra porque otra hoja ya tomó el foco.
   */
  onCloseAutoFocus?: (event: Event) => void
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
        onCloseAutoFocus={onCloseAutoFocus}
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
        {/* El aire a la derecha es para la X, que comparte renglón solo con el título. */}
        <div className="shrink-0 space-y-1 px-5 pt-3 pb-3 sm:px-6 sm:pt-6">
          <DialogTitle className="pr-10 text-balance font-serif text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </div>
        <ScrollBody bodyRef={bodyRef}>{children}</ScrollBody>
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
