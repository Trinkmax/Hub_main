'use client'

import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { cleanText, OPTION_DELTA_MAX_CENTS } from '@/lib/menu/kitchen/schemas'
import { formatPesosTyping, pesosFieldText, readPesosField } from '@/lib/menu/prices/input'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

const FIELD =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-background/60 px-3 text-base outline-none transition-[box-shadow,border-color] duration-(--duration-fast) placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive motion-reduce:transition-none sm:h-10 sm:text-sm dark:bg-input/30'

/**
 * Un texto que se edita en el lugar y se guarda solo: al salir del campo o con Enter. Esc vuelve
 * a lo que había. Vacío no se guarda: vuelve a lo que había y lo dice.
 */
export function InlineText({
  value,
  onCommit,
  label,
  maxLength,
  placeholder,
  check,
  error,
  className,
  testId,
}: {
  value: string
  onCommit: (next: string) => void
  /** Para lectores: «Nombre de la estación». */
  label: string
  maxLength: number
  placeholder?: string
  /** Algo más que revisar antes de guardar: devuelve por qué no, o `null`. */
  check?: (next: string) => string | null
  /** Por qué no se guardó la última vez (lo dice el servidor). */
  error?: string
  className?: string
  testId?: string
}) {
  const noteId = useId()
  const [draft, setDraft] = useState(value)
  const [source, setSource] = useState(value)
  const [focused, setFocused] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Lo que hay en la base cambió (lo guardó esta pantalla u otra): si no se está escribiendo,
  // el campo lo muestra.
  if (source !== value && !focused) {
    setSource(value)
    setDraft(value)
  }
  const skip = useRef(false)

  const commit = () => {
    setFocused(false)
    if (skip.current) {
      skip.current = false
      return
    }
    const next = cleanText(draft)
    if (next === value) {
      setDraft(value)
      setProblem(null)
      return
    }
    const why = next === '' ? 'No puede quedar vacío: quedó como estaba.' : (check?.(next) ?? null)
    if (why) {
      setDraft(value)
      setProblem(why)
      return
    }
    setProblem(null)
    setDraft(next)
    setSource(next)
    onCommit(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // Dentro de una hoja, Esc primero cancela lo que se estaba escribiendo.
      event.stopPropagation()
      skip.current = true
      setDraft(value)
      setProblem(null)
      event.currentTarget.blur()
    }
  }

  const note = problem ?? error ?? null
  return (
    <span className={cn('block min-w-0', className)}>
      <input
        type="text"
        aria-label={label}
        aria-invalid={note ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        data-testid={testId}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (problem) setProblem(null)
        }}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={FIELD}
      />
      {note ? (
        <span id={noteId} role="alert" className="mt-1 block text-xs text-destructive text-pretty">
          {note}
        </span>
      ) : null}
    </span>
  )
}

/**
 * Lo que una opción le suma al precio, en PESOS (la base guarda centavos). Vacío es «no suma
 * nada». Los miles se separan solos mientras se tipea.
 */
export function ExtraPriceField({
  cents,
  onCommit,
  name,
  disabled = false,
  testId,
}: {
  cents: number
  onCommit: (cents: number) => void
  /** El nombre de la opción, para lectores. */
  name: string
  disabled?: boolean
  testId?: string
}) {
  const noteId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const shown = cents === 0 ? '' : pesosFieldText(cents)
  const [text, setText] = useState(shown)
  const [source, setSource] = useState(cents)
  const [focused, setFocused] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (source !== cents && !focused) {
    setSource(cents)
    setText(shown)
  }
  const caret = useRef<number | null>(null)
  // El cursor se queda donde estaba después de separar los miles.
  useLayoutEffect(() => {
    if (caret.current === null) return
    inputRef.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const skip = useRef(false)

  const commit = () => {
    setFocused(false)
    if (skip.current) {
      skip.current = false
      return
    }
    const read = readPesosField(text)
    const next = read.kind === 'empty' ? 0 : read.cents
    if (next > OPTION_DELTA_MAX_CENTS) {
      setText(shown)
      setProblem(`Lo máximo es ${formatCentsShort(OPTION_DELTA_MAX_CENTS)}: quedó como estaba.`)
      return
    }
    setProblem(null)
    if (next === cents) {
      setText(shown)
      return
    }
    setSource(next)
    setText(next === 0 ? '' : pesosFieldText(next))
    onCommit(next)
  }

  return (
    <span className="block">
      <span
        className={cn(
          'flex h-11 w-[7.5rem] items-center gap-1 rounded-lg border border-input bg-background/60 pr-2.5 pl-2.5 transition-[box-shadow,border-color] duration-(--duration-fast) focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40 motion-reduce:transition-none sm:h-10 dark:bg-input/30',
          disabled && 'opacity-50',
          problem && 'border-destructive',
        )}
      >
        <span aria-hidden className="shrink-0 text-sm text-muted-foreground">
          + $
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Cuánto suma ${name} al precio, en pesos. Vacío si no suma nada`}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? noteId : undefined}
          data-testid={testId}
          disabled={disabled}
          placeholder="0"
          value={text}
          onChange={(event) => {
            const typed = formatPesosTyping(event.target.value, event.target.selectionStart)
            caret.current = typed.caret
            setText(typed.text)
            if (problem) setProblem(null)
          }}
          onFocus={(event) => {
            setFocused(true)
            event.currentTarget.select()
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              skip.current = true
              setText(shown)
              setProblem(null)
              event.currentTarget.blur()
            }
          }}
          className="h-full w-full min-w-0 bg-transparent text-right text-base tabular-nums outline-none placeholder:text-muted-foreground/70 sm:text-sm"
        />
      </span>
      {problem ? (
        <span id={noteId} role="alert" className="mt-1 block text-xs text-destructive text-pretty">
          {problem}
        </span>
      ) : null}
    </span>
  )
}
