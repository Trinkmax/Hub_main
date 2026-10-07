'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'
import {
  FormActions as FieldFormActions,
  type FormActionsProps as FieldFormActionsProps,
} from '@/components/ui/field'

/**
 * Las acciones de un formulario con Server Action (kit HUB §3.2 y §5.4): el
 * `FormActions` de `field.tsx` más el **foco al primer error**.
 *
 * - **La barra es una sola:** esto envuelve la de `field.tsx`, no la copia.
 *   En el celular va fija abajo (44 px, del mismo ancho, dos como máximo) y,
 *   mientras está montada, escribe su alto en `<html>` como
 *   `--sticky-actions-h` (lo leen el Toaster y el `scroll-padding` del
 *   documento); en escritorio va en línea a la derecha. Mismas props
 *   (`sticky`, `align`), mismo `data-slot="form-actions"`.
 * - **Foco al primer error:** la barra vive adentro del `<form>`, así que
 *   `useFormStatus()` sabe cuándo terminó el envío sin que cada página cablee
 *   el estado. Cuando el `<form action>` deja de estar pendiente enfoca el
 *   primer `[aria-invalid="true"]` o, si no hay, el `FormError`. Su efecto
 *   corre después del del `FormError` (que se enfoca solo al aparecer y va
 *   antes en el formulario), así gana el campo, como pide §3.2.
 *
 * `useFocusFirstInvalid(formRef, state)` de `field.tsx` sigue sirviendo para
 * formularios sin esta barra o con `onSubmit`; si están los dos, enfocan lo
 * mismo.
 */
export type FormActionsProps = FieldFormActionsProps & {
  /** Al volver la respuesta del server, enfoca el primer campo inválido (o el `FormError`). Default `true`. */
  focusFirstInvalid?: boolean
}

/** Lo que hay que enfocar después de un envío: el primer campo inválido o, si no hay, el `FormError`. */
export function firstInvalidTarget(root: Pick<ParentNode, 'querySelector'>): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    root.querySelector<HTMLElement>('[data-slot="form-error"]')
  )
}

function FormActions({ focusFirstInvalid = true, ref, ...props }: FormActionsProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const wasPending = React.useRef(false)
  // Afuera de un <form> (botones con `form="…"`) nunca está pendiente: no hace nada.
  const { pending } = useFormStatus()

  React.useEffect(() => {
    if (pending) {
      wasPending.current = true
      return
    }
    // Solo al terminar un envío: al montar o al re-renderizar por otra cosa
    // no se le roba el foco a nadie.
    if (!wasPending.current) return
    wasPending.current = false
    if (!focusFirstInvalid) return
    const form = rootRef.current?.closest('form')
    if (form) firstInvalidTarget(form)?.focus()
  }, [pending, focusFirstInvalid])

  // El ref de quien llama sigue llegando a la raíz (el envoltorio de la barra).
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  return <FieldFormActions ref={setRef} {...props} />
}

export { FormActions }
