'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { SheetClose } from '@/components/ui/sheet'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { DocumentForm, PreviewBundleState } from '@/lib/accounting/server/document-types'
import type { OpenItemRef, PostingContext } from '@/lib/accounting/types'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { SheetBodySkeleton, SheetLoadError } from './feedback'

export { firstLoadableDay } from './periods'

/** Mientras la hoja trae sus datos: el título real y la forma del formulario, sin spinner. */
export function SheetLoading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <>
      <ActionSheetHeader title={title} description={description} />
      <ActionSheetBody>
        <SheetBodySkeleton />
      </ActionSheetBody>
    </>
  )
}

/** No se pudieron traer los datos: el motivo, «Reintentar» y «Cerrar». */
export function SheetFailed({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry: () => void
}) {
  return (
    <>
      <ActionSheetHeader title={title} />
      <ActionSheetBody>
        <SheetLoadError message={message} onRetry={onRetry} />
      </ActionSheetBody>
      <ActionSheetFooter>
        <SheetCancel label="Cerrar" />
      </ActionSheetFooter>
    </>
  )
}

/**
 * «Cancelar» del pie: cierra igual que Esc o la X (si hay algo cargado,
 * pregunta «¿Descartás lo que cargaste?»).
 */
export function SheetCancel({ label = 'Cancelar' }: { label?: string }) {
  return (
    <SheetClose asChild>
      <Button type="button" variant="outline" className="h-11 sm:h-9">
        {label}
      </Button>
    </SheetClose>
  )
}

/**
 * «Ver asiento» armado en el navegador con el MISMO código que corre la
 * acción (zod + el armador del motor, `previewDocumentForm`): el asiento, su
 * hash (lo que va como `previewHash` al guardar) y los avisos. `values` tiene
 * que ser estable (armalo con `useMemo`). `key` identifica esta carga.
 */
export function useDocumentPreview(
  form: DocumentForm,
  values: Record<string, unknown>,
  ctx: PostingContext,
  firstOpenDate: string | null,
): { key: string; state: PreviewBundleState } {
  const key = useMemo(() => JSON.stringify(values), [values])
  const state = useMemo(
    () => previewDocumentForm(form, values, ctx, { firstOpenDate }),
    [form, values, ctx, firstOpenDate],
  )
  return { key, state }
}

/**
 * El contexto con las partidas que eligió la hoja (las ventas de un cobro, lo
 * que falta acreditar de una billetera): las mismas que va a leer la acción.
 */
export function withOpenItems(ctx: PostingContext, items: readonly OpenItemRef[]): PostingContext {
  if (items.length === 0) return ctx
  const openItems = new Map(ctx.openItems)
  for (const item of items) openItems.set(item.lineId, item)
  return { ...ctx, openItems }
}
