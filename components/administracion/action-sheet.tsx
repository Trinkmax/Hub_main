'use client'

import type { ReactNode } from 'react'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Piezas para armar el cuerpo de una hoja de acción rápida (`acciones/*`).
 * La hoja ya está abierta (la monta `AccountingProvider`): el cuerpo solo
 * dibuja encabezado, contenido con scroll y botones fijos abajo.
 *
 * ```tsx
 * <>
 *   <ActionSheetHeader title="Nuevo gasto" description="Lo que pagaste hoy, en segundos." />
 *   <ActionSheetBody>…campos…</ActionSheetBody>
 *   <ActionSheetFooter>
 *     <Button type="submit" className="h-11 w-full sm:w-auto">Guardar gasto</Button>
 *   </ActionSheetFooter>
 * </>
 * ```
 * Si el cuerpo es un `<form>`, que envuelva a Body y Footer con
 * `className="flex min-h-0 flex-1 flex-col"` para que el pie quede abajo.
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
    <SheetHeader className="gap-1 border-b border-border/60 px-4 pt-5 pb-4 pr-12 sm:px-6">
      <SheetTitle className="font-serif text-xl font-semibold tracking-tight">{title}</SheetTitle>
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
    <div className={cn('min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6', className)}>
      {children}
    </div>
  )
}

/** Botones fijos abajo, con el área segura del iPhone. En el celular, a todo el ancho. */
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
        'flex flex-col-reverse gap-2 border-t border-border/60 bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:flex-row sm:items-center sm:justify-end sm:px-6',
        '[&>*]:min-h-11 sm:[&>*]:min-h-9',
        className,
      )}
    >
      {children}
    </div>
  )
}
