'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'
import { cn } from '@/lib/utils'

export type FormActionsProps = React.ComponentProps<'div'> & {
  /** `mobile` (default): barra fija abajo en el celular · `always`: también pegada abajo en escritorio · `false`: nunca. */
  sticky?: 'mobile' | 'always' | false
  align?: 'end' | 'between'
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

/**
 * Celular con alto suficiente (≥ 480 px): barra fija abajo. Con menos alto
 * (apaisado, zoom de 200 %) deja de ser fija: dos barras fijas taparían el
 * formulario (WCAG 1.4.10).
 *
 * Arranca `--form-actions-offset` arriba del borde de la pantalla (default 0):
 * lo pone un layout que tiene su propia barra fija abajo (las pestañas de
 * Mensajería), así la de acciones queda encima y no la tapa. Ahí el área
 * segura del iPhone ya la cubre esa barra: el relleno de abajo la descuenta.
 */
const MOBILE_FIXED = [
  'max-sm:[@media(min-height:30rem)]:fixed max-sm:[@media(min-height:30rem)]:inset-x-0',
  'max-sm:[@media(min-height:30rem)]:bottom-(--form-actions-offset,0px) max-sm:[@media(min-height:30rem)]:z-40',
  'max-sm:[@media(min-height:30rem)]:border-t max-sm:[@media(min-height:30rem)]:border-border',
  'max-sm:[@media(min-height:30rem)]:bg-background max-sm:[@media(min-height:30rem)]:px-4',
  'max-sm:[@media(min-height:30rem)]:pt-3',
  'max-sm:[@media(min-height:30rem)]:pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-var(--form-actions-offset,0px)))]',
].join(' ')

/**
 * En el celular, botones de 44 px del mismo ancho y dos por fila (§3.2).
 *
 * Es un flex que envuelve y no una grilla que cuenta hijos: lo oculto (el
 * «Cancelar» con `className="max-sm:hidden"`, o un `hidden`) no es un ítem
 * del flex, así que no ocupa lugar ni entra en la cuenta. Cada acción arranca
 * en media fila menos 1 rem (lugar para el gap, aunque se lo cambie por
 * `className`) y crece, así que `grow` reparte el resto en partes iguales:
 *
 * - una visible llena la fila;
 * - dos la parten al medio;
 * - con tres, la principal (la última) queda sola en una fila entera, abajo:
 *   el orden de la pantalla es el del DOM, que es el del lector y el del Tab.
 *
 * Una etiqueta que no entra en media fila baja a una fila propia en lugar de
 * desbordar el botón.
 */
const MOBILE_ROWS = [
  'max-sm:[&>*]:grow max-sm:[&>*]:basis-[calc(50%-1rem)]',
  'max-sm:[&>[data-slot=button]]:h-11',
].join(' ')

const STICKY_DESKTOP =
  'sm:sticky sm:bottom-0 sm:z-10 sm:border-t sm:border-border sm:bg-background sm:py-3'

/**
 * Las acciones de un formulario (kit HUB §3.2 y §5.4): secundario y después
 * principal, que es la acción más frecuente. Es la única implementación:
 * `@/components/ui/field` la re-exporta tal cual.
 *
 * - **Celular:** barra fija abajo (ver `MOBILE_FIXED` y `MOBILE_ROWS`), dos
 *   acciones como máximo. Si el encabezado tiene `back`, «Cancelar» sale de la
 *   barra con `className="max-sm:hidden"` (el `back` ya cancela). En
 *   escritorio va en línea a la derecha.
 * - **`--sticky-actions-h`:** mientras la barra está fija escribe en `<html>`
 *   cuánto tapa desde el borde de abajo de la pantalla: su alto más el
 *   `--form-actions-offset` (y lo borra al desmontarse o al dejar de ser
 *   fija). Una variable puesta en la barra no le llegaría al Toaster ni al
 *   `scroll-padding-bottom` del documento, que están arriba en el árbol. El
 *   envoltorio reserva el alto de la barra (eso menos el offset), así el final
 *   del formulario no queda tapado.
 * - **`--form-actions-offset`:** un layout con su propia barra fija abajo lo
 *   define con el alto de esa barra (Mensajería, con sus pestañas del
 *   celular). La barra de acciones queda arriba de la otra, sin `sticky={false}`.
 * - **Foco al primer error:** la barra vive adentro del `<form>`, así que
 *   `useFormStatus()` sabe cuándo terminó el envío sin que cada página cablee
 *   el estado. Cuando el `<form action>` deja de estar pendiente enfoca el
 *   primer `[aria-invalid="true"]` o, si no hay, el `FormError`. Su efecto
 *   corre después del del `FormError` (que se enfoca solo al aparecer y va
 *   antes en el formulario), así gana el campo, como pide §3.2. Afuera de un
 *   `<form>` (botones con `form="…"`) o con `onSubmit` nunca está pendiente y
 *   no hace nada; ahí sirve `useFocusFirstInvalid(formRef, state)` de
 *   `field.tsx` (si están los dos, enfocan lo mismo).
 *
 * `className` va a la barra; el resto de las props (`id`, `data-tour`, `ref`…)
 * a la raíz, el envoltorio con `data-slot="form-actions"`.
 */
function FormActions({
  sticky = 'mobile',
  align = 'end',
  focusFirstInvalid = true,
  className,
  children,
  ...props
}: FormActionsProps) {
  const barRef = React.useRef<HTMLDivElement>(null)
  const wasPending = React.useRef(false)
  const { pending } = useFormStatus()

  React.useEffect(() => {
    if (sticky === false) return
    const bar = barRef.current
    if (!bar) return
    const root = document.documentElement
    const update = () => {
      const style = getComputedStyle(bar)
      if (style.position === 'fixed') {
        // Lo que tapa desde el borde: la barra y, si está levantada, lo de abajo.
        const offset = Number.parseFloat(style.bottom) || 0
        root.style.setProperty('--sticky-actions-h', `${bar.offsetHeight + offset}px`)
      } else {
        root.style.removeProperty('--sticky-actions-h')
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty('--sticky-actions-h')
    }
  }, [sticky])

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
    const form = barRef.current?.closest('form')
    if (form) firstInvalidTarget(form)?.focus()
  }, [pending, focusFirstInvalid])

  return (
    <div
      data-slot="form-actions"
      // Sin `--sticky-actions-h` (la barra no está fija) el calc no vale y el
      // alto queda en auto: la barra ocupa su lugar en el flujo.
      className={cn(
        sticky !== false &&
          'max-sm:h-[calc(var(--sticky-actions-h)-var(--form-actions-offset,0px))]',
      )}
      {...props}
    >
      <div
        ref={barRef}
        data-slot="form-actions-bar"
        className={cn(
          'flex flex-wrap items-center gap-2',
          align === 'between' ? 'justify-between' : 'justify-end',
          MOBILE_ROWS,
          sticky !== false && MOBILE_FIXED,
          sticky === 'always' && STICKY_DESKTOP,
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export { FormActions }
