'use client'

import { type ReactNode, useEffect, useRef } from 'react'
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

/**
 * La voz de las preguntas de una hoja («¿Cuánto gastaste?», «¿Qué pagás?»,
 * «¿Quién te pagó?»): Fraunces, un escalón debajo del título. Las decisiones
 * se leen como preguntas; lo demás («Fecha», «Referencia»), como campos. Es
 * una clase y no un componente porque cada hoja la cuelga del elemento que ya
 * usa como etiqueta de su grupo (`h3`, `legend`, `Label`, `GroupLabel`).
 */
export const ACTION_SHEET_QUESTION = 'font-serif text-lg leading-snug font-semibold tracking-tight'

/**
 * La misma voz cuando la pregunta es la etiqueta de un `MoneyField` («¿Cuánto
 * gastaste?», «¿Cuánto entró?»): va en su `fieldClassName`. El asterisco queda
 * chico y en la letra de los campos.
 */
export const ACTION_SHEET_QUESTION_FIELD =
  'gap-2 [&>label]:gap-1 [&>label]:font-serif [&>label]:text-lg [&>label]:leading-snug [&>label]:font-semibold [&>label]:tracking-tight [&>label>span[aria-hidden]]:font-sans [&>label>span[aria-hidden]]:text-sm'

/** El asterisco de una pregunta obligatoria: chico y en la letra de los campos, no en Fraunces. */
export function ActionSheetRequiredMark() {
  return (
    <span aria-hidden="true" className="ml-1.5 font-sans text-sm text-destructive">
      *
    </span>
  )
}

/** Lo que puede recibir el foco con Tab (los chips de un grupo de radios dejan uno solo). */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(',')

function firstFocusable(root: HTMLElement): HTMLElement | null {
  for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    // Lo que no se ve (un chip escondido en el celular) no cuenta.
    if (node.getClientRects().length > 0) return node
  }
  return null
}

/** Un campo de texto: en el teléfono, darle foco abre el teclado. */
function opensKeyboard(node: HTMLElement): boolean {
  if (node instanceof HTMLTextAreaElement) return true
  if (!(node instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'file', 'button', 'submit', 'range'].includes(node.type)
}

export function ActionSheetBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // El foco inicial se decide una sola vez por cuerpo: después manda la persona.
  const placed = useRef(false)

  // La hoja se abre antes de que llegue su contenido (baja el código, después los datos) y en
  // ese momento lo único que puede recibir el foco es «Cerrar»: viniendo de ⌘K, el primer Enter
  // cerraba la hoja. Cuando aparece el primer control, el foco pasa ahí, como en cualquier
  // diálogo que se abre con el contenido ya puesto. Si la persona ya está en otro lado, no se toca.
  useEffect(() => {
    if (placed.current) return
    const frame = requestAnimationFrame(() => {
      const body = ref.current
      if (placed.current || !body) return
      const first = firstFocusable(body)
      // Todavía cargando (esqueleto): se vuelve a mirar en el próximo render.
      if (!first) return
      placed.current = true
      const active = document.activeElement
      const dialog = body.closest('[role="dialog"]')
      const parked =
        active === null ||
        active === document.body ||
        active === dialog ||
        (active instanceof HTMLElement &&
          active.matches('[data-slot="sheet-close"]') &&
          Boolean(dialog?.contains(active)))
      if (!parked) return
      // En el teléfono no se abre el teclado solo (la hoja que lo quiere, lo pide ella).
      if (opensKeyboard(first) && window.matchMedia('(pointer: coarse)').matches) return
      first.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  })

  return (
    // overscroll-contain: al llegar al final, el scroll no se le pasa a la pantalla de atrás.
    // `data-slot`: para que una hoja pueda volver arriba después de guardar («Cargar otro después»).
    // `relative`: lo que va posicionado adentro sin ancestro propio (el `<input type="file">`
    // oculto de «Agregar foto o PDF», el input espejo de un `Checkbox`) queda colgado de este
    // cuerpo y se mueve con su scroll. Sin esto colgaba de la hoja entera, le sumaba cientos de
    // píxeles de scroll oculto y, al tomar el foco, la corría toda hacia arriba.
    <div
      ref={ref}
      data-slot="action-sheet-body"
      className={cn(
        'relative min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7',
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
 * «Cancelar» (o cualquier otro botón que acompañe al principal) no se ve: la
 * hoja ya se cierra con la X, con Esc, tocando afuera y con el «atrás» del
 * teléfono, y así las seis tienen el mismo pie (antes cuatro lo mostraban en la
 * compu y dos no). Si es el único botón del pie («Cerrar» de una hoja que no
 * cargó), se queda.
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
        '[&>button:not([type=submit]):not(:only-child)]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}
