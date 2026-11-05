'use client'

import { LoaderCircle } from 'lucide-react'
import { type KeyboardEvent, type Ref, useEffect, useState } from 'react'
import { scrollIntoViewOnTouch } from '@/components/administracion/money-input'
import { CELL_INPUT } from '@/components/administracion/planilla'
import {
  centsToPesosInput,
  type MoneyParse,
  moneyParseMessage,
  parseMoneyToCents,
} from '@/lib/money'
import { cn } from '@/lib/utils'

/** Lo que se muestra en la misma columna que una celda: alineado con sus números (`CELL_INPUT`, `px-2`). */
export const AMOUNT_ALIGN = 'pr-[calc(0.5rem+1px)]'

/** Cómo va el guardado de una celda. */
export type CellSave = 'idle' | 'saving' | 'saved' | 'error'

const FADE_MS = 2000

const textOf = (cents: number | null) =>
  cents === null ? '' : centsToPesosInput(cents, { decimals: 'auto' })

/** Qué hacer con lo que quedó escrito en una celda al salir de ella. */
export type CellRead =
  | { kind: 'save'; cents: number | null }
  /** Se vació y vaciarla no es un dato: vuelve lo que había. */
  | { kind: 'revert' }
  /** No se entiende: no se guarda nunca. */
  | { kind: 'error'; message: string }

export function readCell(
  text: string,
  opts: { emptyAllowed?: boolean; minCents?: number } = {},
): CellRead {
  const parsed = parseMoneyToCents(text, { minCents: opts.minCents })
  if (parsed.ok) return { kind: 'save', cents: parsed.cents }
  if (parsed.reason === 'vacio') {
    return opts.emptyAllowed ? { kind: 'save', cents: null } : { kind: 'revert' }
  }
  return { kind: 'error', message: moneyParseMessage(parsed, text) }
}

/** Enter baja: el foco pasa a la celda de la misma columna, en la fila de abajo. */
export function focusCellBelow(input: HTMLInputElement): void {
  const column = input.dataset.cell
  const table = input.closest('table')
  if (!column || !table) {
    input.blur()
    return
  }
  const cells = [
    ...table.querySelectorAll<HTMLInputElement>(`input[data-cell="${column}"]:not(:disabled)`),
  ]
  const next = cells[cells.indexOf(input) + 1]
  if (next) next.focus()
  else input.blur()
}

/**
 * Una celda de plata de la planilla, como en el Excel: pide y muestra pesos, y guarda solo. Se guarda
 * al salir del campo; Enter guarda y baja a la de abajo; Esc vuelve a lo que había.
 *
 * Solo dibuja y avisa: el guardado es de quien la usa. `onValueChange` lee cada tecla (la tira de pago
 * muestra el monto que se está escribiendo) y `onCommit` es «guardá». Lo que no se entiende no se
 * guarda nunca: se marca y se queda en la celda. Vacío no es cero.
 */
export function CellMoney({
  column,
  label,
  value,
  onValueChange,
  onCommit,
  onRevert,
  emptyAllowed = false,
  minCents,
  placeholder,
  save = 'idle',
  inputRef,
}: {
  /** El nombre de la columna: Enter baja a la siguiente celda con el mismo. */
  column: string
  /** Para lectores: «Monto de EPEC». */
  label: string
  /** Centavos. `null` = vacío. */
  value: number | null
  onValueChange?: (cents: number | null) => void
  onCommit: (cents: number | null) => void
  onRevert?: () => void
  /** Vaciar la celda es un dato («sin monto»); si no, vaciarla vuelve a lo que había. */
  emptyAllowed?: boolean
  minCents?: number
  placeholder?: string
  save?: CellSave
  /** Para llevar el cursor a la celda (tildar uno sin monto). */
  inputRef?: Ref<HTMLInputElement>
}) {
  const [text, setText] = useState(() => textOf(value))
  const [synced, setSynced] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)

  const parse = (raw: string): MoneyParse => parseMoneyToCents(raw, { minCents })

  // Lo cambió alguien de afuera (se guardó, se refrescó la pantalla, «Volver»): se reescribe. Si es
  // el eco de lo que se está tipeando, no se toca (si no, «1234,» se volvería «1.234» en cada tecla).
  if (value !== synced) {
    setSynced(value)
    const current = parse(text)
    if (!(current.ok && current.cents === value) && !(value === null && text.trim() === '')) {
      setText(textOf(value))
      setError(null)
    }
  }

  // El tilde de «guardado» se muestra un rato y se va: lo que importa quedó en la celda.
  useEffect(() => {
    if (save !== 'saved') return
    setFresh(true)
    const timer = window.setTimeout(() => setFresh(false), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [save])

  /** Guarda lo escrito. `false`: no se entiende, y queda marcado. */
  const commit = (): boolean => {
    const read = readCell(text, { emptyAllowed, minCents })
    if (read.kind === 'error') {
      setError(read.message)
      return false
    }
    setError(null)
    if (read.kind === 'revert') {
      setText(textOf(value))
      return true
    }
    setText(textOf(read.cents))
    onCommit(read.cents)
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (commit()) focusCellBelow(event.currentTarget)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setText(textOf(value))
      setError(null)
      onRevert?.()
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="relative inline-flex items-center">
        <span aria-hidden className="absolute -left-4 flex size-3.5 items-center justify-center">
          {save === 'saving' ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : save === 'saved' && fresh ? (
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="size-3.5 text-success"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.5 8.5l3 3 6-7" className="adm-tick adm-tick-draw" />
            </svg>
          ) : null}
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-cell={column}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            const parsed = parse(next)
            if (parsed.ok) {
              setError(null)
              setSynced(parsed.cents)
              onValueChange?.(parsed.cents)
            } else if (parsed.reason === 'vacio' && emptyAllowed) {
              setError(null)
              setSynced(null)
              onValueChange?.(null)
            }
          }}
          onFocus={(event) => {
            scrollIntoViewOnTouch(event)
            event.currentTarget.select()
          }}
          onBlur={() => {
            commit()
          }}
          onKeyDown={onKeyDown}
          className={cn(
            CELL_INPUT,
            'placeholder:text-xs placeholder:text-muted-foreground/70 pointer-coarse:min-h-11 pointer-coarse:text-base',
            error && 'border-destructive focus:border-destructive',
          )}
        />
      </span>
      {error ? (
        <span
          role="alert"
          className="max-w-44 text-right text-xs whitespace-normal text-destructive text-pretty"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
}
