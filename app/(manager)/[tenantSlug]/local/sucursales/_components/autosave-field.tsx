'use client'

import { LoaderCircle } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** Lo que se leyó del campo al salir de él. */
export type FieldRead<T> =
  | { kind: 'ok'; value: T }
  /** No se puede guardar así: se dice por qué y el texto queda para corregirlo. */
  | { kind: 'error'; message: string }
  /** No hay nada que guardar (un campo vaciado que no acepta vacío): vuelve a lo que había. */
  | { kind: 'ignore' }

/** Cuánto se ve el tilde de «guardado». */
const SAVED_MS = 1800

const isTouch = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/**
 * Un campo que se guarda solo: Enter o salir del campo guarda, Esc vuelve a lo que había. Sin
 * botón de guardar.
 *
 * - Mientras guarda gira una rueda al final del campo; cuando termina bien queda un tilde un
 *   momento. El aviso con «Deshacer» lo muestra quien lo usa.
 * - Si lo escrito no se puede guardar (`read` devuelve `error`), el texto queda como está con
 *   el motivo debajo: nada se pierde y se puede corregir.
 * - `error` es lo que contestó el servidor (otra persona lo cambió, el nombre ya existe). Se
 *   va cuando la persona vuelve a escribir.
 */
export function AutosaveField<T>({
  label,
  hideLabel = false,
  hint,
  value,
  format,
  read,
  same = Object.is,
  onCommit,
  onEdit,
  saving = false,
  error = null,
  disabled = false,
  placeholder,
  maxLength,
  inputMode,
  autoCapitalize,
  suffix,
  align = 'left',
  size = 'full',
  testId,
  className,
}: {
  label: ReactNode
  /** El rótulo ya está a la vista en otro lado (el título del renglón): acá queda solo para lectores. */
  hideLabel?: boolean
  /** Una línea debajo: para qué sirve o cómo se escribe. */
  hint?: ReactNode
  value: T
  /** Lo que va escrito en el campo para ese valor. */
  format: (value: T) => string
  read: (text: string) => FieldRead<T>
  same?: (a: T, b: T) => boolean
  onCommit: (value: T) => void
  /** La persona volvió a escribir: el error del servidor ya no va. */
  onEdit?: () => void
  saving?: boolean
  error?: string | null
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  inputMode?: 'text' | 'numeric' | 'decimal'
  autoCapitalize?: 'none' | 'words' | 'sentences'
  /** Lo que va pegado al final, adentro del campo: «%». */
  suffix?: ReactNode
  align?: 'left' | 'right'
  /** `short`: un campo angosto, para un número. */
  size?: 'full' | 'short'
  testId?: string
  className?: string
}) {
  const id = useId()
  const messageId = `${id}-message`
  const hintId = `${id}-hint`
  const canonical = format(value)
  // `null` = se muestra lo guardado; con texto = lo que la persona está escribiendo.
  const [text, setText] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // El tilde: aparece cuando termina bien un guardado y se va solo.
  const [justSaved, setJustSaved] = useState(false)
  const wasSaving = useRef(saving)
  useEffect(() => {
    const finished = wasSaving.current && !saving
    wasSaving.current = saving
    if (finished) setJustSaved(!error)
  }, [saving, error])
  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), SAVED_MS)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  const shown = problem ?? error
  const commit = () => {
    if (text === null) return
    const result = read(text)
    if (result.kind === 'error') {
      setProblem(result.message)
      return
    }
    setProblem(null)
    setText(null)
    if (result.kind === 'ok' && !same(result.value, value)) onCommit(result.value)
  }

  const mark = saving ? 'saving' : justSaved && !shown ? 'saved' : 'idle'

  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'block text-sm font-medium leading-snug'}
      >
        {label}
      </label>
      <div className={cn('relative', !hideLabel && 'mt-1.5', size === 'short' ? 'w-32' : 'w-full')}>
        <input
          ref={input}
          id={id}
          type="text"
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          data-testid={testId}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={shown ? true : undefined}
          aria-busy={saving ? true : undefined}
          aria-describedby={
            [shown ? messageId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
          }
          value={text ?? canonical}
          onChange={(event) => {
            setText(event.target.value)
            if (problem) setProblem(null)
            if (error) onEdit?.()
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
              // En el teléfono, Enter guarda y baja el teclado.
              if (isTouch()) event.currentTarget.blur()
            } else if (event.key === 'Escape' && (text !== null || problem)) {
              event.preventDefault()
              event.stopPropagation()
              setText(null)
              setProblem(null)
            }
          }}
          className={cn(
            'h-11 w-full min-w-0 rounded-lg border border-input bg-background/60 pl-3 text-base shadow-2xs outline-none sm:h-10 sm:text-sm',
            'transition-[color,box-shadow,border-color] duration-(--duration-fast) motion-reduce:transition-none',
            'placeholder:text-muted-foreground hover:border-foreground/25',
            'focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/40',
            'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
            'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input',
            'dark:bg-input/30 dark:focus-visible:bg-input/50',
            align === 'right' && 'text-right tabular-nums',
            suffix ? 'pr-14' : 'pr-9',
          )}
        />
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1.5 pr-2.5 text-sm text-muted-foreground">
          {mark === 'saving' ? (
            <LoaderCircle
              aria-hidden
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
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
          ) : null}
          {suffix ? <span aria-hidden>{suffix}</span> : null}
        </span>
      </div>
      {shown ? (
        <p
          id={messageId}
          role="alert"
          className="mt-1.5 text-sm leading-snug text-destructive text-pretty"
        >
          {shown}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-sm leading-snug text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
