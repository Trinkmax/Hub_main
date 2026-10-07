'use client'

import { Plus } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useFormReset } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import {
  defaultLineLabel,
  focusAfterRemove,
  type LineFocusTarget,
  lineControlLabel,
  stripLineKeys,
} from './line-items-model'

export type LineItemsApi<L> = {
  /** Cambia campos de esta línea. */
  update: (patch: Partial<L>) => void
  /** Quita la línea y lleva el foco a la siguiente (o a la anterior, o a «Agregar línea»). */
  remove: () => void
  /** `false` por debajo de `minLines` o en solo lectura: entonces «Quitar» no se dibuja. */
  canRemove: boolean
  /** Agrega una línea al final y la enfoca (Enter en la última fila del asiento manual). */
  add: () => void
  /** `false` en solo lectura o con `maxLines` alcanzado. */
  canAdd: boolean
  index: number
  /** «Línea 2». */
  label: string
  /** «Cuenta, línea 2»: el `aria-label` de cada control de la fila. */
  controlLabel: (control: string) => string
  readOnly: boolean
}

export type LineItemsProps<L extends { key: string }> = Omit<
  React.ComponentProps<'div'>,
  'children' | 'onChange' | 'defaultValue'
> & {
  /** Un `<input type="hidden" name>` con el JSON canónico de las líneas (lo valida zod en el server). */
  name?: string
  /** Las líneas de arranque (no controlado). Con keys estables: van al DOM y tienen que coincidir con el server. */
  defaultLines: L[]
  /** Controlado: las líneas vienen de afuera y los cambios salen por `onLinesChange`. */
  lines?: L[]
  /** Default 1. Por debajo, «Quitar» no se dibuja. */
  minLines?: number
  /** Al llegar, «Agregar línea» no se dibuja. */
  maxLines?: number
  /** Una línea vacía nueva, con una `key` que no se repita. */
  newLine: () => L
  renderLine: (line: L, index: number, api: LineItemsApi<L>) => React.ReactNode
  /** Default «Agregar línea». */
  addLabel?: string
  /** Default «Línea 2»: el nombre del grupo de la fila y el prefijo de sus controles. */
  lineLabel?: (index: number) => string
  readOnly?: boolean
  onLinesChange?: (lines: L[]) => void
  /** Lo que va en el hidden. Default: las líneas sin `key`. */
  serialize?: (lines: readonly L[]) => unknown
  /** Antes de las líneas (encabezados de columna, solo para la vista). */
  header?: React.ReactNode
  /** Después de «Agregar línea» (totales, el sello «Cuadra»). */
  footer?: React.ReactNode
  /** Clases de cada fila (p. ej. `subgrid` para alinear con el encabezado). */
  lineClassName?: string
}

/** Lo que se puede enfocar adentro de una fila (lo que se ve y está en el orden del Tab). */
const FOCUSABLE =
  'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])'

function firstFocusable(container: Element): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.matches(':disabled') || element.tabIndex < 0) continue
    if (element.closest('[aria-hidden="true"], [hidden], [inert]')) continue
    // Algo escondido por CSS (display: none) no tiene cajas.
    if (element.getClientRects().length === 0) continue
    return element
  }
  return null
}

/**
 * Filas que se agregan y se quitan dentro de un formulario (kit §3.8): el
 * primitivo de `EntryEditor` (asiento manual) y de los medios de una orden de
 * pago o de un cobro (medio · cuenta · importe).
 *
 * - **Estado y serialización:** un `<input type="hidden" name>` con el JSON
 *   canónico (sin las `key`, que son de la vista); `form.reset()` vuelve a las
 *   líneas de arranque.
 * - **Foco:** «Agregar línea» crea la fila y enfoca su primer control; «Quitar»
 *   enfoca el primer control de la siguiente (o de la anterior si era la
 *   última, o «Agregar línea»). Nunca se queda en `<body>`.
 * - **Nombres accesibles:** cada fila es un grupo «Línea 2» y la API le da a
 *   cada control su `aria-label` con ese prefijo («Cuenta, línea 2»).
 * - Las filas por debajo de `minLines` no muestran «Quitar» (`api.canRemove`).
 * - Layout libre: `renderLine` dibuja la fila; `className` y `lineClassName`
 *   permiten una grilla con `subgrid` (encabezado, filas y pie alineados).
 */
function LineItems<L extends { key: string }>({
  name,
  defaultLines,
  lines: linesProp,
  minLines = 1,
  maxLines,
  newLine,
  renderLine,
  addLabel = 'Agregar línea',
  lineLabel = defaultLineLabel,
  readOnly = false,
  onLinesChange,
  serialize = stripLineKeys,
  header,
  footer,
  lineClassName,
  className,
  ...props
}: LineItemsProps<L>) {
  const controlled = linesProp !== undefined
  const [innerLines, setInnerLines] = React.useState<L[]>(defaultLines)
  const lines = controlled ? linesProp : innerLines
  const rootRef = React.useRef<HTMLDivElement>(null)
  const addRef = React.useRef<HTMLButtonElement>(null)
  const [focusRequest, setFocusRequest] = React.useState<{
    target: LineFocusTarget
    seq: number
  } | null>(null)

  // Las últimas líneas: dos cambios seguidos en el mismo evento no se pisan.
  const latestRef = React.useRef(lines)
  React.useEffect(() => {
    latestRef.current = lines
  }, [lines])

  function commit(next: L[]) {
    latestRef.current = next
    if (!controlled) setInnerLines(next)
    onLinesChange?.(next)
  }

  function requestFocus(target: LineFocusTarget) {
    setFocusRequest((previous) => ({ target, seq: (previous?.seq ?? 0) + 1 }))
  }

  // El foco va después de que la fila nueva (o la que queda) está en el DOM.
  React.useEffect(() => {
    if (focusRequest === null) return
    const root = rootRef.current
    if (!root) return
    let element: HTMLElement | null = null
    if (focusRequest.target !== 'add') {
      const key = focusRequest.target.key
      const row = Array.from(root.querySelectorAll<HTMLElement>('[data-line-key]')).find(
        (candidate) => candidate.dataset.lineKey === key,
      )
      element = row ? firstFocusable(row) : null
    }
    ;(element ?? addRef.current ?? root).focus()
  }, [focusRequest])

  useFormReset(rootRef, () => {
    commit(defaultLines)
  })

  const atMax = maxLines !== undefined && lines.length >= maxLines
  const canRemove = !readOnly && lines.length > minLines

  function add() {
    if (readOnly || atMax) return
    const line = newLine()
    commit([...latestRef.current, line])
    requestFocus({ key: line.key })
  }

  function removeLine(key: string) {
    const current = latestRef.current
    if (readOnly || current.length <= minLines) return
    const keys = current.map((line) => line.key)
    const index = keys.indexOf(key)
    if (index === -1) return
    const target = focusAfterRemove(keys, index)
    commit(current.filter((line) => line.key !== key))
    requestFocus(target)
  }

  function updateLine(key: string, patch: Partial<L>) {
    if (readOnly) return
    commit(latestRef.current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <div
      ref={rootRef}
      data-slot="line-items"
      data-readonly={readOnly ? '' : undefined}
      // Respaldo del foco si no hay «Agregar línea» (solo lectura o tope): nunca `<body>`.
      tabIndex={-1}
      className={cn('outline-none', className)}
      {...props}
    >
      {header}
      {lines.map((line, index) => {
        const label = lineLabel(index)
        const api: LineItemsApi<L> = {
          update: (patch) => updateLine(line.key, patch),
          remove: () => removeLine(line.key),
          canRemove,
          add,
          canAdd: !readOnly && !atMax,
          index,
          label,
          controlLabel: (control) => lineControlLabel(control, label),
          readOnly,
        }
        return (
          // biome-ignore lint/a11y/useSemanticElements: un <fieldset> por fila traería borde, relleno y `min-inline-size: min-content`, que rompen el `subgrid`; el grupo solo nombra la fila («Línea 2»)
          <div
            key={line.key}
            role="group"
            aria-label={label}
            data-slot="line-item"
            data-line-key={line.key}
            className={lineClassName}
          >
            {renderLine(line, index, api)}
          </div>
        )
      })}
      {!readOnly && !atMax ? (
        <div data-slot="line-items-add" className="col-span-full">
          <Button ref={addRef} type="button" variant="ghost" size="sm" onClick={add}>
            <Plus aria-hidden="true" />
            {addLabel}
          </Button>
        </div>
      ) : null}
      {footer}
      {name ? <input type="hidden" name={name} value={JSON.stringify(serialize(lines))} /> : null}
    </div>
  )
}

export { LineItems }
