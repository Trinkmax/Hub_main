'use client'

import type { ReactNode } from 'react'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Piezas para armar el cuerpo de una hoja de acción rápida (`acciones/*`).
 * La hoja ya está abierta (la monta `AccountingProvider`): el cuerpo solo
 * dibuja encabezado, contenido con scroll y el pie fijo abajo.
 *
 * ```tsx
 * <>
 *   <ActionSheetHeader title="Nuevo gasto" description="Lo que pagaste hoy, en segundos." />
 *   <ActionSheetBody>…campos…</ActionSheetBody>
 *   <ActionSheetFooter>
 *     <Button type="submit">Guardar gasto</Button>
 *   </ActionSheetFooter>
 * </>
 * ```
 * Si el cuerpo es un `<form>`, que envuelva a Body y Footer con
 * `className="flex min-h-0 flex-1 flex-col"` para que el pie quede abajo.
 *
 * El pie le da el tamaño al botón principal: es el `type="submit"` que tenga
 * adentro. No hace falta (ni conviene) ponerle alto a mano.
 */
export function ActionSheetHeader({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  /** Algo a la derecha o debajo del título (p. ej. «Le debés $ X»). */
  children?: ReactNode
}) {
  return (
    // pr-16: la X de la hoja (44 px en el celular) va arriba a la derecha.
    <SheetHeader className="shrink-0 gap-1.5 border-b border-border/60 px-4 pt-5 pr-16 pb-4 sm:px-7 sm:pt-7 sm:pr-16">
      {/* Mismo título que el lanzador «¿Qué querés cargar?»: de ahí se llega a casi todas. */}
      <SheetTitle className="text-balance font-serif text-2xl leading-tight font-semibold tracking-tight">
        {title}
      </SheetTitle>
      {description ? (
        <SheetDescription className="text-pretty">{description}</SheetDescription>
      ) : null}
      {children}
    </SheetHeader>
  )
}

export function ActionSheetBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    // overscroll-contain: al llegar al final, el scroll no se le pasa a la pantalla de atrás.
    // `data-slot`: para que una hoja pueda volver arriba después de guardar («Cargar otro después»).
    <div
      data-slot="action-sheet-body"
      className={cn(
        'min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * El pie fijo: UN botón principal de 48 px, siempre a la vista, con el área
 * segura del iPhone. El principal es el `type="submit"`: ocupa todo el ancho en
 * el celular y, si el texto no entra («Registrar ajuste · faltan $ 1.234.567»),
 * baja a dos renglones en vez de salirse.
 *
 * «Cancelar» (o cualquier otro botón que acompañe al principal) se ve solo
 * desde `sm`: en el celular la hoja ocupa toda la pantalla y ya tiene la X
 * arriba y el «atrás» del teléfono; un segundo botón abajo le saca lugar al
 * formulario. Si es el único botón del pie («Cerrar»), se queda.
 */
export function ActionSheetFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 border-t border-border/60 bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:justify-end sm:gap-3 sm:px-7 sm:py-4',
        '[&>a]:h-12 [&>button]:h-12',
        '[&>[type=submit]]:h-auto [&>[type=submit]]:min-h-12 [&>[type=submit]]:flex-1 [&>[type=submit]]:px-6 [&>[type=submit]]:py-2',
        '[&>[type=submit]]:text-base [&>[type=submit]]:leading-tight [&>[type=submit]]:font-semibold [&>[type=submit]]:whitespace-normal',
        'sm:[&>[type=submit]]:min-w-52 sm:[&>[type=submit]]:flex-none',
        '[&>button:only-child]:flex-1 sm:[&>button:only-child]:flex-none',
        'max-sm:[&>button:not([type=submit]):not(:only-child)]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}
