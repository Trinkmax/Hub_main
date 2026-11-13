'use client'

import { LoaderCircle } from 'lucide-react'
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import {
  formatPesosTyping,
  insertedDigits,
  pesosFieldText,
  pesosFromPaste,
  readPesosField,
} from '@/lib/menu/prices/input'
import { cn } from '@/lib/utils'

/** Cómo se salió del campo: decide a dónde va el foco después. */
export type CommitVia = 'enter' | 'next' | 'previous' | 'blur'
/** `saved`: se guardó (o no había nada que guardar) · `held`: quedó una pregunta abierta. */
export type CommitOutcome = 'saved' | 'held'

const FIELD_SELECTOR = 'input[data-price-field]:not(:disabled)'
/** Cuánto se ve el tilde de «guardado». */
const SAVED_MS = 1800
/** Las teclas con las que la persona se mete a corregir un dígito, en vez de tipear un precio nuevo. */
const EDIT_IN_PLACE = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete'])

/**
 * La cadena: una vez que la persona empezó a cambiar precios (tocó uno o tipeó), Tab salta de
 * precio en precio para poder recorrer una categoría entera sin soltar el teclado. Si solo
 * está pasando con Tab, Tab se comporta como siempre y llega al resto de los botones del
 * renglón. Esc corta la cadena.
 */
let chain = false

function priceFields(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(FIELD_SELECTOR)]
}

function neighbour(current: HTMLInputElement, step: 1 | -1): HTMLInputElement | null {
  const fields = priceFields()
  return fields[fields.indexOf(current) + step] ?? null
}

/** Lleva el foco al precio de un producto (por ejemplo, después de contestar una pregunta). */
export function focusPriceField(itemId: string, opts: { step?: 1 | -1 } = {}): void {
  const field = document.querySelector<HTMLInputElement>(
    `input[data-price-field][data-item="${CSS.escape(itemId)}"]`,
  )
  if (!field) return
  const target = opts.step ? (neighbour(field, opts.step) ?? field) : field
  chain = true
  target.focus()
}

/** El primer precio de la lista: desde el buscador, Enter o flecha abajo caen acá. */
export function focusFirstPriceField(): boolean {
  const first = priceFields()[0]
  if (!first) return false
  chain = true
  first.focus()
  return true
}

const isTouch = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/**
 * El precio de un producto: SIEMPRE es un campo, así en el teléfono se toca y sale el teclado
 * de números sin trucos, y las flechas del teclado del iPhone pasan de precio en precio.
 *
 * - Pesos enteros, con los miles que se separan solos mientras se tipea.
 * - Tocar y tipear reemplaza el precio entero (ver `overwrite`). Un segundo clic, las flechas
 *   o borrar dejan corregir un dígito, como en cualquier campo.
 * - Enter o salir del campo guarda; Esc vuelve a lo que había. Vacío no es cero: vaciarlo y
 *   salir no cambia nada.
 * - Tab (y flecha abajo) guarda y pasa al precio siguiente.
 * - El «$» es también la marca del guardado: gira mientras se guarda y se vuelve un tilde.
 */
export const PriceField = memo(function PriceField({
  itemId,
  label,
  cents,
  saving,
  disabled = false,
  flagged = false,
  describedBy,
  onCommit,
  onCancel,
}: {
  itemId: string
  /** Para lectores: «Precio de Bacon, en pesos». */
  label: string
  /** Centavos: lo que hoy se cobra. */
  cents: number
  saving: boolean
  disabled?: boolean
  /** Hay una pregunta o un error de este precio a la vista. */
  flagged?: boolean
  describedBy?: string
  onCommit: (itemId: string, cents: number, via: CommitVia) => CommitOutcome
  /** Esc: la persona se arrepintió. */
  onCancel?: (itemId: string) => void
}) {
  const canonical = pesosFieldText(cents)
  // `null` = se muestra el precio guardado; con texto = lo que la persona está escribiendo.
  const [text, setText] = useState<string | null>(null)
  const typed = useRef<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const selectAll = useRef(false)
  /**
   * «Pisar»: recién llegada al campo (lo enfocó, guardó o canceló), lo primero que la persona
   * tipee REEMPLAZA el precio entero, esté donde esté el cursor. Es «seleccionar todo» sin
   * depender de que el navegador conserve la selección: en el iPhone no siempre la pone, y un
   * clic sobre lo ya seleccionado la deshace; sin esto, tipear «13900» sobre «16.500» podía
   * terminar en «1.390.016.500».
   */
  const overwrite = useRef(false)
  /** El próximo clic selecciona todo (en vez de dejar el cursor donde se tocó). */
  const armed = useRef(false)
  /** Se decide al apretar el botón del mouse y se cumple al soltarlo, en el clic. */
  const selectOnClick = useRef(false)

  const [, redraw] = useReducer((count: number) => count + 1, 0)

  const write = (next: string | null) => {
    typed.current = next
    setText(next)
  }

  /** La persona acaba de llegar (o de terminar): lo próximo que tipee pisa el precio. */
  const arrive = () => {
    overwrite.current = true
    armed.current = true
  }
  /** Se metió a corregir: desde acá, el campo se comporta como cualquier otro. */
  const settle = () => {
    overwrite.current = false
    armed.current = false
  }

  /**
   * Deja todo el precio seleccionado después del próximo dibujo (cuando el campo ya muestra el
   * precio que quedó). Fuerza ese dibujo: si no hubiera ninguno, el pedido quedaría colgado y
   * se cobraría más tarde, seleccionando todo en medio de lo que la persona tipea.
   */
  const reselect = () => {
    selectAll.current = true
    redraw()
  }

  // El cursor se acomoda después de que React escribe el texto con los miles nuevos.
  useLayoutEffect(() => {
    const node = input.current
    const wantsAll = selectAll.current
    const caret = pendingCaret.current
    selectAll.current = false
    pendingCaret.current = null
    if (!node || document.activeElement !== node) return
    if (wantsAll) node.select()
    else if (caret !== null) node.setSelectionRange(caret, caret)
  })

  // El tilde: aparece cuando termina bien un guardado y se va solo.
  const [justSaved, setJustSaved] = useState(false)
  const wasSaving = useRef(saving)
  useEffect(() => {
    const finished = wasSaving.current && !saving
    wasSaving.current = saving
    if (finished) setJustSaved(!flagged)
  }, [saving, flagged])
  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), SAVED_MS)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  /** Guarda lo escrito, si cambió algo. */
  const commit = (via: CommitVia): CommitOutcome => {
    const current = typed.current
    if (current === null) return 'saved'
    write(null)
    const read = readPesosField(current)
    if (read.kind === 'empty' || read.cents === cents) {
      // Volvió a dejar el precio que había: si quedaba una pregunta abierta, ya está contestada.
      if (flagged) onCancel?.(itemId)
      return 'saved'
    }
    return onCommit(itemId, read.cents, via)
  }

  const move = (node: HTMLInputElement, step: 1 | -1): boolean => {
    const target = neighbour(node, step)
    if (!target) return false
    if (commit(step === 1 ? 'next' : 'previous') === 'held') return true
    chain = true
    target.focus()
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const node = event.currentTarget
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey

    if (event.key === 'Enter') {
      event.preventDefault()
      if (commit('enter') === 'held') return
      if (isTouch()) node.blur()
      else {
        // El campo queda con el foco y todo seleccionado: se puede tipear otro precio encima.
        arrive()
        reselect()
      }
      return
    }
    if (event.key === 'Escape') {
      const dirty = typed.current !== null && typed.current !== canonical
      chain = false
      if (dirty || flagged) {
        event.preventDefault()
        event.stopPropagation()
      }
      write(null)
      arrive()
      reselect()
      onCancel?.(itemId)
      return
    }
    if (event.key === 'Tab' && plain && chain) {
      if (move(node, event.shiftKey ? -1 : 1)) event.preventDefault()
      return
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain && !event.shiftKey) {
      if (move(node, event.key === 'ArrowDown' ? 1 : -1)) event.preventDefault()
      return
    }
    if (EDIT_IN_PLACE.has(event.key)) settle()
  }

  const onMouseDown = (event: MouseEvent<HTMLInputElement>) => {
    if (event.button !== 0) return
    // El clic que le da el foco, o el primero después de guardar o cancelar, selecciona todo.
    if (
      document.activeElement !== event.currentTarget ||
      (armed.current && typed.current === null)
    ) {
      selectOnClick.current = true
      return
    }
    // Un segundo clic es para poner el cursor: de acá en más se corrige dígito por dígito.
    selectOnClick.current = false
    settle()
  }

  const onClick = (event: MouseEvent<HTMLInputElement>) => {
    if (!selectOnClick.current) return
    selectOnClick.current = false
    armed.current = false
    const node = event.currentTarget
    node.select()
    // Cuando el clic cae sobre texto ya seleccionado, el navegador pone el cursor recién al
    // terminar este evento y deshace la selección: se repone apenas termina. (Aunque no se
    // llegara a reponer, lo que se tipee igual pisa el precio: ver `overwrite`.)
    window.setTimeout(() => {
      if (document.activeElement === node && overwrite.current && typed.current === null) {
        node.select()
      }
    }, 0)
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = pesosFromPaste(event.clipboardData.getData('text'))
    if (pasted === null) return
    // Lo pegado reemplaza todo: viene de una planilla o de un mensaje, no es para insertar.
    event.preventDefault()
    chain = true
    settle()
    pendingCaret.current = pasted.length
    write(pasted)
  }

  const mark = saving ? 'saving' : justSaved && !flagged ? 'saved' : 'idle'

  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 flex size-4 -translate-y-1/2 items-center justify-center text-sm text-muted-foreground"
      >
        {mark === 'saving' ? (
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : mark === 'saved' ? (
          <svg
            viewBox="0 0 16 16"
            className="size-3.5 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Guardado</title>
            <path d="M3.5 8.5l3 3 6-7" className="adm-tick adm-tick-draw" />
          </svg>
        ) : (
          '$'
        )}
      </span>
      <input
        ref={input}
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-price-field=""
        data-item={itemId}
        data-testid="price-field"
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={flagged ? true : undefined}
        aria-busy={saving ? true : undefined}
        disabled={disabled}
        value={text ?? canonical}
        onPointerDown={() => {
          chain = true
        }}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onFocus={(event) => {
          const node = event.currentTarget
          arrive()
          node.select()
          // En el teléfono el teclado tapa media pantalla: el campo va al centro.
          if (isTouch()) node.scrollIntoView({ block: 'center' })
        }}
        onChange={(event) => {
          chain = true
          const raw = event.target.value
          // Lo primero que se tipea al llegar pisa el precio, aunque el navegador lo haya
          // insertado en el medio de lo que había.
          const fresh =
            overwrite.current && typed.current === null ? insertedDigits(canonical, raw) : null
          settle()
          const next =
            fresh === null
              ? formatPesosTyping(raw, event.target.selectionStart)
              : formatPesosTyping(fresh, null)
          pendingCaret.current = next.caret
          // Si lo tipeado no cambia el texto (una letra, una coma), React igual lo repone: se
          // fuerza el dibujo para que el cursor vuelva a su lugar y no salte al final.
          if (next.text === typed.current) redraw()
          write(next.text)
        }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          settle()
          selectOnClick.current = false
          commit('blur')
          const to = event.relatedTarget
          if (
            !(to instanceof HTMLElement) ||
            !to.matches('[data-price-field], [data-price-guard]')
          ) {
            chain = false
          }
        }}
        className={cn(
          'h-11 w-[7.25rem] rounded-lg border border-input bg-background/60 pr-3 pl-7 text-right text-base font-medium tabular-nums shadow-2xs outline-none sm:h-10 sm:w-36',
          'transition-[color,box-shadow,border-color] duration-(--duration-fast) motion-reduce:transition-none',
          'hover:border-foreground/25 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/40',
          'aria-invalid:border-warning aria-invalid:ring-warning/25',
          'disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-muted-foreground disabled:shadow-none disabled:hover:border-input',
          'dark:bg-input/30 dark:focus-visible:bg-input/50',
        )}
      />
    </span>
  )
})
