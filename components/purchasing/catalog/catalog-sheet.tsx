'use client'

import { X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { isTouchPointer, useHydrated, useMediaQuery, WIDE_QUERY } from './use-media-query'

/**
 * La hoja de los editores de Compras (insumos, zonas, proveedores, recetas).
 *
 * - En el celular sale desde abajo y se apoya ARRIBA del teclado: se mide con lo que de verdad se ve
 *   (`visualViewport`), así el botón de guardar del pie nunca queda tapado mientras se escribe.
 * - Desde 640 px es una hoja al costado, de alto completo.
 * - La X mide 44 px en el celular. Mientras guarda no se cierra; con cambios sin guardar, pregunta.
 *
 * El cuerpo va en `CatalogSheetBody` (con scroll propio) y el botón principal en `CatalogSheetFooter`
 * (fijo abajo). Si el cuerpo es un `<form>`, que envuelva a los dos con `className="contents"`.
 */
export function CatalogSheet({
  open,
  onClose,
  title,
  description,
  busy = false,
  dirty = false,
  tall = false,
  focusOnTouch = false,
  onCloseAutoFocus,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Guardando: la hoja no se cierra. */
  busy?: boolean
  /** Hay cambios sin guardar: antes de cerrar, pregunta. */
  dirty?: boolean
  /** En el celular ocupa casi toda la pantalla aunque tenga poco adentro (listas con búsqueda). */
  tall?: boolean
  /** Con el dedo, el primer campo toma el foco al abrir (y se abre el teclado). */
  focusOnTouch?: boolean
  /** Al cerrar el foco vuelve a lo que abrió la hoja; con `preventDefault` se queda donde se lo mande. */
  onCloseAutoFocus?: (event: Event) => void
  children: ReactNode
}) {
  const wide = useMediaQuery(WIDE_QUERY)
  const hydrated = useHydrated()
  const shown = open && hydrated
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [confirming, setConfirming] = useState(false)
  useKeyboardSafeSheet(node, shown && !wide)

  const requestClose = () => {
    if (busy) return
    if (dirty) {
      setConfirming(true)
      return
    }
    onClose()
  }

  return (
    <>
      <Sheet
        open={shown}
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
      >
        <SheetContent
          ref={setNode}
          side={wide ? 'right' : 'bottom'}
          showClose={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const sheet = event.currentTarget
            if (!(sheet instanceof HTMLElement)) return
            // En el celular el teclado no se abre solo: el foco queda en la hoja (los lectores de
            // pantalla arrancan por el título) hasta que la persona toque un campo.
            if (!focusOnTouch && isTouchPointer()) {
              sheet.focus()
              return
            }
            // En la compu, al primer campo pero SIN seleccionar lo escrito (Radix lo selecciona, y
            // la primera tecla borraba el nombre del insumo).
            const target = sheet.querySelector<HTMLElement>(FIRST_FIELD) ?? sheet
            target.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          onPointerDownOutside={keepOpenOnToast}
          onInteractOutside={keepOpenOnToast}
          className={cn(
            'gap-0 p-0 outline-none',
            wide
              ? 'w-full sm:max-w-lg'
              : [
                  // Apoyada arriba del teclado (o del borde de abajo) y nunca más alta que lo que se ve.
                  'bottom-[var(--pur-kb,0px)] pb-0',
                  tall
                    ? 'h-[calc(var(--pur-vh,100dvh)-2.5rem)]'
                    : 'max-h-[calc(var(--pur-vh,100dvh)-2.5rem)]',
                ],
          )}
        >
          {wide ? null : <SheetGrabber />}
          {/* pr-16: la X va arriba a la derecha. */}
          <SheetHeader className="shrink-0 gap-1 border-b border-border/60 px-4 pt-6 pr-16 pb-4 sm:px-6 sm:pt-6">
            <SheetTitle className="font-serif text-xl leading-tight font-semibold tracking-tight text-balance sm:text-2xl">
              {title}
            </SheetTitle>
            {description ? (
              <SheetDescription className="text-pretty">{description}</SheetDescription>
            ) : null}
          </SheetHeader>
          {children}
          {/* Después del cuerpo en el DOM: en la compu el foco cae en el primer campo, no en «Cerrar». */}
          <SheetClose className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:top-4 sm:right-4 sm:size-10">
            <X className="size-5 sm:size-4" aria-hidden />
            <span className="sr-only">Cerrar</span>
          </SheetClose>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartás los cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Si cerrás ahora, lo que cambiaste en esta hoja no se guarda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-9"
              onClick={() => {
                setConfirming(false)
                onClose()
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** El cuerpo de la hoja: lo único que hace scroll (el encabezado y el pie quedan quietos). */
export function CatalogSheetBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    // overscroll-contain: al llegar al final, el scroll no se le pasa a la pantalla de atrás.
    <div
      className={cn(
        'relative min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * El pie fijo con el botón principal: 48 px y a todo el ancho en el celular, con el área segura del
 * iPhone (que no hace falta con el teclado abierto: ahí el pie va pegado al teclado).
 */
export function CatalogSheetFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] in-data-keyboard:pb-3',
        'sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-6 sm:py-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Lo primero que puede recibir el foco adentro de la hoja (la X va al final del DOM). */
const FIRST_FIELD = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Las clases del botón principal del pie (guardar). */
export const SHEET_PRIMARY_BUTTON =
  'h-12 w-full text-base font-semibold sm:h-10 sm:w-auto sm:min-w-44 sm:text-sm'

/** Tocar un toast («Deshacer», un error) no cierra la hoja. */
function keepOpenOnToast(event: Event): void {
  const target = event.target
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) event.preventDefault()
}

/**
 * En el celular `position: fixed` queda atado a la pantalla entera y el teclado le pasa por encima.
 * Esto mide lo que de verdad se ve y lo deja en `--pur-kb` (lo que tapa el teclado) y `--pur-vh` (el
 * alto visible), que usan las clases de la hoja. Con dos dedos se agranda la pantalla: eso no es un
 * teclado y no se toca nada.
 */
function useKeyboardSafeSheet(node: HTMLElement | null, enabled: boolean): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!enabled || !node || !viewport) return
    let lastCovered = -1
    const update = () => {
      if (viewport.scale > 1.01) return
      const covered = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      )
      node.style.setProperty('--pur-kb', `${covered}px`)
      node.style.setProperty('--pur-vh', `${Math.round(viewport.height)}px`)
      if (covered > 80) node.setAttribute('data-keyboard', '')
      else node.removeAttribute('data-keyboard')
      if (covered === lastCovered) return
      lastCovered = covered
      // Se abrió (o cambió) el teclado: lo que se está escribiendo queda a la vista.
      const active = document.activeElement
      if (covered > 0 && active instanceof HTMLElement && node.contains(active)) {
        requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest' }))
      }
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      node.style.removeProperty('--pur-kb')
      node.style.removeProperty('--pur-vh')
      node.removeAttribute('data-keyboard')
    }
  }, [node, enabled])
}
