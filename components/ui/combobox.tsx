'use client'

import { Check, ChevronsUpDown, Plus, Search, X } from 'lucide-react'
import * as React from 'react'
import { type ControlSize, useControlSize } from '@/components/ui/control-size'
import {
  useField,
  useFieldControl,
  useFieldErrorReporter,
  useFieldLabelId,
  useFormReset,
} from '@/components/ui/field'
import { fieldSurface } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { focusIfFirstInvalid, mergeRefs } from '@/lib/dom/form-control'
import { entitySearchResponseSchema } from '@/lib/search/entity-option'
import { cn } from '@/lib/utils'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type EntityOption<T = unknown> = {
  value: string
  label: string
  /** «CUIT 30-00000000-0 · Responsable inscripto». */
  description?: string
  /** A la derecha: saldo, puntos. */
  meta?: React.ReactNode
  keywords?: string[]
  group?: string
  disabled?: boolean
  data?: T
}

/**
 * Búsqueda asíncrona: `fetch` a un Route Handler GET con el `signal` (cada
 * tecla cancela la anterior de verdad). Una Server Action también entra e
 * ignora el `signal`: ahí las respuestas viejas se descartan por número de
 * secuencia.
 */
export type ComboboxSearch<T = unknown> = (
  query: string,
  signal: AbortSignal,
) => Promise<EntityOption<T>[]>

export type ComboboxValue = string | string[] | null

type ComboboxOwnProps<T> = {
  id?: string
  /** `<input type="hidden" name value>` (uno por valor si `multiple`). */
  name?: string
  multiple?: boolean
  value?: ComboboxValue
  defaultValue?: ComboboxValue
  onValueChange?: (value: ComboboxValue, option: EntityOption<T> | EntityOption<T>[] | null) => void
  /** Estático: filtra en el cliente (sin tildes; prefijo, inicio de palabra, contiene). */
  options?: EntityOption<T>[]
  search?: ComboboxSearch<T>
  /** Lo que se ve con la búsqueda vacía (recientes). */
  defaultOptions?: EntityOption<T>[]
  /** La etiqueta del valor actual en modo asíncrono (formularios de edición). */
  selectedOption?: EntityOption<T> | null
  /** Default 0 estático · 2 asíncrono. */
  minQueryLength?: number
  /** Default 200 ms. */
  debounceMs?: number
  /**
   * «Crear «…»». Si devuelve una opción, queda elegida; si abre una hoja para
   * cargar el resto, puede no devolver nada y elegirla después por `value`.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: es el tipo de retorno de un callback que puede no devolver nada
  onCreate?: (query: string) => Promise<EntityOption<T> | void> | EntityOption<T> | void
  /** Default `q => Crear «q»`. */
  createLabel?: (query: string) => string
  renderOption?: (option: EntityOption<T>) => React.ReactNode
  /** Default «Elegí…». */
  placeholder?: string
  /** Default «Buscar…». */
  searchPlaceholder?: string
  /** Default «No encontramos nada con «…»». */
  emptyText?: React.ReactNode
  clearable?: boolean
  size?: ControlSize
  disabled?: boolean
  required?: boolean
  readOnly?: boolean
  invalid?: boolean
  'aria-label'?: string
  className?: string
}

export type ComboboxProps<T = unknown> = Omit<
  React.ComponentProps<'button'>,
  keyof ComboboxOwnProps<T> | 'children' | 'type' | 'role'
> &
  ComboboxOwnProps<T>

// ─── Filtro (puro) ───────────────────────────────────────────────────────────

/** Sin tildes y en minúscula: «Ñandú» y «nandu» se encuentran. */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** El texto normalizado y, para cada letra suya, en qué posición del original estaba. */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    for (const char of normalizeSearchText(text.charAt(i))) {
      normalized += char
      map.push(i)
    }
  }
  return { normalized, map }
}

const WORD_CHAR = /[\p{L}\p{N}]/u

export type OptionMatch = {
  /** 0 prefijo · 1 inicio de palabra · 2 contiene · 3 solo en la descripción o las palabras clave. */
  rank: 0 | 1 | 2 | 3
  /** Qué parte de la etiqueta coincide, en posiciones del original (para la negrita). */
  range: [number, number] | null
}

/** ¿Coincide la opción con la búsqueda, y qué tan bien? `null` si no coincide. */
export function matchOption(
  option: Pick<EntityOption, 'label' | 'description' | 'keywords'>,
  query: string,
): OptionMatch | null {
  const q = normalizeSearchText(query.trim())
  if (q === '') return { rank: 2, range: null }
  const { normalized, map } = normalizeWithMap(option.label)
  const toRange = (start: number): [number, number] => [
    map[start] ?? 0,
    (map[start + q.length - 1] ?? option.label.length - 1) + 1,
  ]
  if (normalized.startsWith(q)) return { rank: 0, range: toRange(0) }
  let wordStart = -1
  let contains = -1
  for (let at = normalized.indexOf(q); at !== -1; at = normalized.indexOf(q, at + 1)) {
    if (contains === -1) contains = at
    if (!WORD_CHAR.test(normalized.charAt(at - 1))) {
      wordStart = at
      break
    }
  }
  if (wordStart !== -1) return { rank: 1, range: toRange(wordStart) }
  if (contains !== -1) return { rank: 2, range: toRange(contains) }
  const extra = [option.description ?? '', ...(option.keywords ?? [])]
  if (extra.some((text) => normalizeSearchText(text).includes(q))) return { rank: 3, range: null }
  return null
}

/**
 * Filtra y ordena opciones estáticas: prefijo, después inicio de palabra,
 * después «contiene» (y lo que coincide solo por la descripción o las palabras
 * clave). A igual puntaje queda el orden original. Con la búsqueda vacía, todo.
 */
export function filterOptions<T>(
  options: readonly EntityOption<T>[],
  query: string,
): Array<{ option: EntityOption<T>; range: [number, number] | null }> {
  if (query.trim() === '') return options.map((option) => ({ option, range: null }))
  return options
    .map((option, index) => ({ option, index, match: matchOption(option, query) }))
    .filter((entry): entry is typeof entry & { match: OptionMatch } => entry.match !== null)
    .sort((a, b) => a.match.rank - b.match.rank || a.index - b.index)
    .map(({ option, match }) => ({ option, range: match.range }))
}

/** Agrupa respetando el orden: los grupos salen en el orden de su primera opción; sin grupo, primero. */
export function groupEntries<E extends { option: { group?: string } }>(
  entries: readonly E[],
): Array<{ group: string | null; entries: E[] }> {
  const groups = new Map<string, E[]>()
  for (const entry of entries) {
    const key = entry.option.group ?? ''
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }
  const ungrouped = groups.get('')
  const out: Array<{ group: string | null; entries: E[] }> = ungrouped
    ? [{ group: null, entries: ungrouped }]
    : []
  for (const [group, list] of groups) if (group !== '') out.push({ group, entries: list })
  return out
}

/** Una búsqueda que coincide exacto con una etiqueta ya no ofrece «Crear». */
function hasExactLabel(options: readonly EntityOption[], query: string): boolean {
  const q = normalizeSearchText(query.trim())
  return options.some((option) => normalizeSearchText(option.label) === q)
}

function toArray(value: ComboboxValue | undefined): string[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : value === '' ? [] : [value]
}

// ─── Búsqueda por Route Handler ──────────────────────────────────────────────

export type RouteSearchOptions<T> = {
  /** Nombre del parámetro con lo tipeado. Default `q`. */
  param?: string
  /** Parámetros fijos de cada búsqueda (`{ tipo: 'proveedor' }`). */
  params?: Record<string, string>
  /**
   * De la respuesta JSON a opciones (para armar `meta` o `data`). Default:
   * valida `{ options: [...] }` con zod (`lib/search/entity-option.ts`).
   * Memoizarla: si cambia en cada render, la función de búsqueda también.
   */
  parse?: (json: unknown) => EntityOption<T>[]
}

/**
 * La función `search` de un Combobox que busca en un Route Handler GET
 * (`/api/[tenantSlug]/search/<entidad>?q=`, decisión 19 del kit): `fetch` con
 * el `AbortSignal` del Combobox, así cada tecla cancela la búsqueda anterior.
 * Un error HTTP o una respuesta que no valida tira, y el Combobox muestra «No
 * pudimos buscar» con «Reintentar».
 */
export function useRouteSearch<T = unknown>(
  endpoint: string,
  opts: RouteSearchOptions<T> = {},
): ComboboxSearch<T> {
  const { param = 'q', params, parse } = opts
  // Estable aunque el objeto `params` sea nuevo en cada render.
  const paramsKey = params ? JSON.stringify(Object.entries(params).sort()) : ''
  return React.useCallback(
    async (query: string, signal: AbortSignal) => {
      const search = new URLSearchParams(
        paramsKey ? (JSON.parse(paramsKey) as Array<[string, string]>) : undefined,
      )
      search.set(param, query)
      const separator = endpoint.includes('?') ? '&' : '?'
      const response = await fetch(`${endpoint}${separator}${search.toString()}`, {
        signal,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`La búsqueda respondió ${response.status}`)
      const json: unknown = await response.json()
      if (parse) return parse(json)
      return entitySearchResponseSchema.parse(json).options
    },
    [endpoint, param, paramsKey, parse],
  )
}

// ─── Componente ──────────────────────────────────────────────────────────────

const TRIGGER_HEIGHT: Record<ControlSize, string> = {
  sm: 'h-(--control-sm)',
  md: 'h-(--control-md)',
  lg: 'h-(--control-lg)',
}

/** La fila «Buscando…» aparece recién a los 300 ms, así no parpadea. */
const SPINNER_DELAY_MS = 300
/** RePág y AvPág saltan de a 10. */
const PAGE_JUMP = 10

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

type ListItem<T> =
  | { kind: 'option'; key: string; option: EntityOption<T>; range: [number, number] | null }
  | { kind: 'create'; key: string; query: string }
  | { kind: 'retry'; key: string }

/** La etiqueta con la parte que coincide en negrita. */
function Highlighted({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return <>{text}</>
  const [start, end] = range
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent font-semibold text-inherit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}

/**
 * Elegir uno (o varios) entre muchos (kit §3.2): proveedor, cliente, cuenta,
 * socio, etiqueta. Botón disparador + popover con buscador.
 *
 * **Disparador** (`role="combobox"`): se nombra con la etiqueta del Field más
 * el valor visible («Proveedor, Coca-Cola»); sin valor, el placeholder no se lee
 * como valor. Enter, Espacio, ↓ o Alt + ↓ abren, y **una tecla imprimible abre
 * con esa letra ya tipeada**.
 *
 * **Adentro** (el buscador lleva `aria-activedescendant`): ↑ ↓ mueven, Inicio
 * y Fin van a los extremos, RePág y AvPág saltan de a 10, Enter elige, Esc
 * cierra y Tab cierra sin elegir; las dos vuelven al disparador (el popover
 * vive al final de `<body>` y un Tab suelto se iría a la barra del navegador).
 *
 * **Asíncrono** (`search`): debounce de 200 ms, mínimo de 2 letras, «Buscando…»
 * a los 300 ms y «No pudimos buscar» con «Reintentar» si falla.
 *
 * **Formulario:** `<input type="hidden" name>` con el valor (uno por valor si
 * es múltiple). Con `required`, un envío sin elegir se frena con «Elegí una
 * opción.» en el Field.
 *
 * Las props sueltas (`data-tour`, `aria-*`) van al disparador; `className`, a
 * la caja.
 */
function Combobox<T = unknown>({
  id: idProp,
  name,
  multiple = false,
  value,
  defaultValue,
  onValueChange,
  options,
  search,
  defaultOptions,
  selectedOption,
  minQueryLength,
  debounceMs = 200,
  onCreate,
  createLabel = (query) => `Crear «${query}»`,
  renderOption,
  placeholder = 'Elegí…',
  searchPlaceholder = 'Buscar…',
  emptyText,
  clearable = false,
  size,
  disabled: disabledProp,
  required: requiredProp,
  readOnly: readOnlyProp,
  invalid,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  onKeyDown,
  ref,
  ...props
}: ComboboxProps<T>) {
  const field = useField()
  const reportError = useFieldErrorReporter()
  const fieldLabelId = useFieldLabelId()
  const resolvedSize = useControlSize(size)
  const control = useFieldControl({
    id: idProp,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': invalid ? true : undefined,
    required: requiredProp,
    disabled: disabledProp,
    readOnly: readOnlyProp,
  })
  const triggerId = control.id
  const disabled = control.disabled ?? false
  const readOnly = control.readOnly ?? false
  const required = control.required ?? false
  const hiddenName = name ?? field?.name
  const listboxId = `${triggerId}-listbox`
  const valueId = `${triggerId}-value`

  const isAsync = typeof search === 'function'
  const minLength = minQueryLength ?? (isAsync ? 2 : 0)

  const controlled = value !== undefined
  const [innerValue, setInnerValue] = React.useState<string[]>(() => toArray(defaultValue))
  const selected = controlled ? toArray(value) : innerValue
  const [known, setKnown] = React.useState<Record<string, EntityOption<T>>>({})
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeKey, setActiveKey] = React.useState<string | null>(null)
  const [localError, setLocalError] = React.useState<string | null>(null)

  const [results, setResults] = React.useState<EntityOption<T>[]>([])
  const [status, setStatus] = React.useState<SearchStatus>('idle')
  const [showSpinner, setShowSpinner] = React.useState(false)
  const [retryToken, setRetryToken] = React.useState(0)
  const lastRetryToken = React.useRef(0)
  const controllerRef = React.useRef<AbortController | null>(null)
  const seqRef = React.useRef(0)
  const spinnerTimer = React.useRef<number | undefined>(undefined)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  // La ref del que llama va al disparador sin pisar la propia (el foco vuelve ahí).
  const mergedTriggerRef = React.useMemo(() => mergeRefs(triggerRef, ref), [ref])

  // `form.reset()`: vuelve al valor de arranque, como los demás campos compuestos.
  useFormReset(triggerRef, () => {
    setOpen(false)
    setLocalError(null)
    reportError(null)
    if (controlled) return
    const resetValue = toArray(defaultValue)
    setInnerValue(resetValue)
    if (resetValue.join('\u0000') !== innerValue.join('\u0000')) emit(resetValue)
  })

  /** Las opciones conocidas por valor, para las etiquetas del disparador. */
  function resolve(v: string): EntityOption<T> | null {
    return (
      known[v] ??
      options?.find((option) => option.value === v) ??
      (selectedOption?.value === v ? selectedOption : undefined) ??
      results.find((option) => option.value === v) ??
      defaultOptions?.find((option) => option.value === v) ??
      null
    )
  }

  // ── Búsqueda asíncrona ──
  const trimmed = query.trim()
  const queryReady = trimmed.length >= minLength && (trimmed !== '' || minLength === 0)

  const runSearch = React.useEffectEvent((q: string) => {
    if (!search) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const seq = ++seqRef.current
    setStatus('loading')
    setShowSpinner(false)
    window.clearTimeout(spinnerTimer.current)
    spinnerTimer.current = window.setTimeout(() => {
      if (seqRef.current === seq) setShowSpinner(true)
    }, SPINNER_DELAY_MS)
    search(q, controller.signal).then(
      (found) => {
        if (seq !== seqRef.current || controller.signal.aborted) return
        window.clearTimeout(spinnerTimer.current)
        setResults(found)
        setStatus('ready')
        setShowSpinner(false)
      },
      (error: unknown) => {
        if (seq !== seqRef.current || controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        window.clearTimeout(spinnerTimer.current)
        setStatus('error')
        setShowSpinner(false)
      },
    )
  })

  const cancelSearch = React.useEffectEvent(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    seqRef.current++
    window.clearTimeout(spinnerTimer.current)
    setShowSpinner(false)
  })

  React.useEffect(() => {
    if (!isAsync || !open) return
    if (!queryReady) {
      cancelSearch()
      setStatus('idle')
      setResults([])
      return
    }
    // Cada tecla cancela de verdad la búsqueda anterior (y descarta su
    // respuesta si llegara tarde); la nueva sale después del debounce.
    cancelSearch()
    // «Reintentar» busca ya; tipear espera el debounce.
    const retrying = retryToken !== lastRetryToken.current
    lastRetryToken.current = retryToken
    const timer = window.setTimeout(() => runSearch(trimmed), retrying ? 0 : debounceMs)
    return () => window.clearTimeout(timer)
  }, [isAsync, open, queryReady, trimmed, debounceMs, retryToken])

  // Cerrado o desmontado: nada queda buscando.
  React.useEffect(() => {
    if (!open) cancelSearch()
  }, [open])
  React.useEffect(() => () => cancelSearch(), [])

  // ── Lo que se lista ──
  let entries: Array<{ option: EntityOption<T>; range: [number, number] | null }> = []
  let statusRow: { tone: 'loading' | 'empty' | 'hint'; content: React.ReactNode } | null = null
  let showRetry = false

  if (!isAsync) {
    entries = filterOptions(options ?? [], query)
    if (entries.length === 0) {
      statusRow = {
        tone: 'empty',
        content:
          emptyText ?? (trimmed ? `No encontramos nada con «${trimmed}».` : 'No hay opciones.'),
      }
    }
  } else if (!queryReady) {
    if (trimmed === '' && defaultOptions?.length) {
      entries = defaultOptions.map((option) => ({ option, range: null }))
    } else {
      statusRow = {
        tone: 'hint',
        content:
          minLength <= 1
            ? 'Escribí para buscar.'
            : `Escribí al menos ${minLength} letras para buscar.`,
      }
    }
  } else if (status === 'error') {
    showRetry = true
  } else {
    entries = results.map((option) => ({
      option,
      range: matchOption(option, query)?.range ?? null,
    }))
    if (status === 'loading' && showSpinner) {
      statusRow = { tone: 'loading', content: 'Buscando…' }
    } else if (status === 'ready' && entries.length === 0) {
      statusRow = {
        tone: 'empty',
        content: emptyText ?? `No encontramos nada con «${trimmed}».`,
      }
    }
  }

  const visibleOptions = entries.map((entry) => entry.option)
  const showCreate =
    Boolean(onCreate) &&
    trimmed !== '' &&
    (!isAsync || queryReady) &&
    !showRetry &&
    status !== 'loading' &&
    !hasExactLabel(visibleOptions, trimmed)
  const groups = groupEntries(entries)

  const items: ListItem<T>[] = []
  if (showRetry) items.push({ kind: 'retry', key: 'retry' })
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!entry.option.disabled) {
        items.push({
          kind: 'option',
          key: `o:${entry.option.value}`,
          option: entry.option,
          range: entry.range,
        })
      }
    }
  }
  if (showCreate) items.push({ kind: 'create', key: 'create', query: trimmed })

  const foundIndex = activeKey ? items.findIndex((item) => item.key === activeKey) : -1
  const activeIndex = foundIndex !== -1 ? foundIndex : items.length > 0 ? 0 : -1
  const activeItem = items[activeIndex] ?? null
  const activeDomId = activeItem ? `${listboxId}-${activeIndex}` : undefined

  // El resaltado siempre a la vista (sin animar: se mueve con las flechas).
  React.useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  // ── Elegir ──
  function emit(next: string[], extra?: EntityOption<T>) {
    const lookup = (v: string) => (extra?.value === v ? extra : resolve(v))
    if (multiple) {
      const chosen = next.map(lookup).filter((option): option is EntityOption<T> => option !== null)
      onValueChange?.(next, chosen)
    } else {
      const first = next[0]
      onValueChange?.(first ?? null, first ? lookup(first) : null)
    }
  }

  function commit(next: string[], extra?: EntityOption<T>) {
    if (!controlled) setInnerValue(next)
    if (localError !== null && next.length > 0) {
      setLocalError(null)
      reportError(null)
    }
    emit(next, extra)
  }

  function choose(option: EntityOption<T>) {
    if (option.disabled) return
    setKnown((prev) => ({ ...prev, [option.value]: option }))
    if (multiple) {
      const next = selected.includes(option.value)
        ? selected.filter((v) => v !== option.value)
        : [...selected, option.value]
      commit(next, option)
      return
    }
    commit([option.value], option)
    setOpen(false)
  }

  async function create(q: string) {
    if (!onCreate) return
    // Si `onCreate` abre una hoja para cargar el resto (CUIT, condición frente
    // al IVA), el popover se cierra primero; la opción que devuelve queda elegida.
    if (!multiple) setOpen(false)
    const created = await onCreate(q)
    if (created) choose(created)
  }

  function activate(item: ListItem<T> | null) {
    if (!item) return
    if (item.kind === 'option') choose(item.option)
    else if (item.kind === 'create') void create(item.query)
    else setRetryToken((n) => n + 1)
  }

  function clear() {
    commit([])
    triggerRef.current?.focus()
  }

  function openWith(initialQuery: string) {
    if (disabled || readOnly) return
    setQuery(initialQuery)
    setActiveKey(!multiple && selected[0] && initialQuery === '' ? `o:${selected[0]}` : null)
    setOpen(true)
  }

  function moveActive(delta: number) {
    if (items.length === 0) return
    const from = activeIndex === -1 ? (delta > 0 ? -1 : items.length) : activeIndex
    const next = Math.min(items.length - 1, Math.max(0, from + delta))
    setActiveKey(items[next]?.key ?? null)
  }

  // ── Disparador ──
  const selectedOptions = selected
    .map((v) => resolve(v) ?? ({ value: v, label: v } as EntityOption<T>))
    .filter(Boolean)
  const hasValue = selectedOptions.length > 0
  const labelledBy =
    [
      ariaLabelledBy ?? (fieldLabelId && !ariaLabel ? fieldLabelId : ariaLabel ? triggerId : null),
      hasValue ? valueId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined
  const isInvalid = control['aria-invalid'] === true || localError !== null

  let valueContent: React.ReactNode
  if (!hasValue) {
    valueContent = <span className="truncate text-subtle-foreground">{placeholder}</span>
  } else if (!multiple) {
    valueContent = (
      <span id={valueId} className="truncate">
        {selectedOptions[0]?.label}
      </span>
    )
  } else {
    const shown = selectedOptions.slice(0, 2)
    const rest = selectedOptions.length - shown.length
    valueContent = (
      <span id={valueId} className="flex min-w-0 items-center gap-1">
        {shown.map((option) => (
          <span
            key={option.value}
            className="inline-flex max-w-[9rem] min-w-0 items-center rounded-sm bg-secondary px-1.5 type-caption text-secondary-foreground"
          >
            <span className="truncate">{option.label}</span>
          </span>
        ))}
        {rest > 0 ? (
          <span className="shrink-0 type-caption text-muted-foreground">
            +{rest}
            <span className="sr-only"> más</span>
          </span>
        ) : null}
      </span>
    )
  }

  const showClear = clearable && hasValue && !disabled && !readOnly
  const announcement =
    status === 'loading' && showSpinner
      ? 'Buscando…'
      : showRetry
        ? 'No pudimos buscar.'
        : open && (status === 'ready' || !isAsync) && trimmed !== ''
          ? entries.length === 1
            ? '1 resultado'
            : `${entries.length} resultados`
          : ''

  let itemIndex = -1
  const nextIndex = () => {
    itemIndex += 1
    return itemIndex
  }

  return (
    <div data-slot="combobox" className={cn('relative w-full min-w-0', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) openWith('')
          else setOpen(false)
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={mergedTriggerRef}
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-labelledby={labelledBy}
            aria-label={ariaLabel}
            aria-describedby={control['aria-describedby']}
            aria-invalid={isInvalid ? true : undefined}
            aria-required={required ? true : undefined}
            aria-readonly={readOnly ? true : undefined}
            data-placeholder={hasValue ? undefined : ''}
            data-size={resolvedSize}
            {...props}
            id={triggerId}
            disabled={disabled}
            onKeyDown={(event) => {
              onKeyDown?.(event)
              if (event.defaultPrevented || disabled || readOnly) return
              const { key } = event
              if (key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault()
                openWith('')
                return
              }
              if (showClear && (key === 'Backspace' || key === 'Delete')) {
                event.preventDefault()
                clear()
                return
              }
              // Una tecla imprimible abre con esa letra ya tipeada.
              if (
                key.length === 1 &&
                key !== ' ' &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
              ) {
                event.preventDefault()
                openWith(key)
              }
            }}
            className={cn(
              fieldSurface,
              'flex items-center gap-2 px-3 text-start',
              TRIGGER_HEIGHT[resolvedSize],
              'aria-readonly:border-border aria-readonly:bg-muted',
            )}
          >
            {/* Con «Quitar», el valor le deja lugar a la X, que va antes del chevron. */}
            <span className={cn('flex min-w-0 flex-1 items-center', showClear && 'me-7')}>
              {valueContent}
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          size="auto"
          className="w-(--radix-popover-trigger-width) min-w-64 p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const input = searchRef.current
            if (!input) return
            input.focus()
            // Abierto con una letra: el cursor queda después de ella, para seguir tipeando.
            input.setSelectionRange(input.value.length, input.value.length)
          }}
        >
          <div
            data-slot="combobox-search"
            className="flex h-10 items-center gap-2 border-b border-border px-3 pointer-coarse:h-11"
          >
            <Search aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeDomId}
              aria-label={searchPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                // Cada búsqueda nueva arranca con la primera opción resaltada.
                setActiveKey(null)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                switch (event.key) {
                  case 'ArrowDown':
                    event.preventDefault()
                    moveActive(1)
                    break
                  case 'ArrowUp':
                    event.preventDefault()
                    moveActive(-1)
                    break
                  case 'PageDown':
                    event.preventDefault()
                    moveActive(PAGE_JUMP)
                    break
                  case 'PageUp':
                    event.preventDefault()
                    moveActive(-PAGE_JUMP)
                    break
                  case 'Home':
                    event.preventDefault()
                    setActiveKey(items[0]?.key ?? null)
                    break
                  case 'End':
                    event.preventDefault()
                    setActiveKey(items[items.length - 1]?.key ?? null)
                    break
                  case 'Enter':
                    event.preventDefault()
                    activate(activeItem)
                    break
                  case 'Tab':
                    // Cierra sin elegir y vuelve al disparador (Radix le devuelve el foco).
                    event.preventDefault()
                    setOpen(false)
                    break
                  case 'Backspace':
                    if (multiple && query === '' && selected.length > 0) {
                      event.preventDefault()
                      commit(selected.slice(0, -1))
                    }
                    break
                }
              }}
              className="h-full w-full min-w-0 bg-transparent text-(length:--control-font) text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </div>
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={ariaLabel ? undefined : fieldLabelId}
            aria-label={ariaLabel ?? (fieldLabelId ? undefined : 'Opciones')}
            aria-multiselectable={multiple ? true : undefined}
            data-slot="combobox-list"
            className="max-h-72 overflow-y-auto overscroll-contain p-1"
          >
            {showRetry ? (
              <ComboboxRow
                index={nextIndex()}
                listboxId={listboxId}
                active={activeItem?.kind === 'retry'}
                onActivate={() => setActiveKey('retry')}
                onChoose={() => setRetryToken((n) => n + 1)}
                aria-label="No pudimos buscar. Reintentar"
              >
                <span className="flex-1 text-muted-foreground">No pudimos buscar.</span>
                <span className="rounded-sm border border-border-strong bg-card px-2 py-0.5 type-caption font-medium">
                  Reintentar
                </span>
              </ComboboxRow>
            ) : null}
            {statusRow?.tone === 'loading' ? (
              <div
                role="presentation"
                className="flex min-h-8 items-center gap-2 px-2 type-small text-muted-foreground"
              >
                <Spinner size={14} aria-hidden />
                {statusRow.content}
              </div>
            ) : null}
            {groups.map((group) => (
              <React.Fragment key={group.group ?? '__sin-grupo'}>
                {group.group ? (
                  <div
                    role="presentation"
                    data-slot="combobox-group"
                    className="px-2 pt-2 pb-1 type-caption text-subtle-foreground"
                  >
                    {group.group}
                  </div>
                ) : null}
                {group.entries.map(({ option, range }) => {
                  const isSelected = selected.includes(option.value)
                  if (option.disabled) {
                    return (
                      // biome-ignore lint/a11y/useFocusableInteractive: el foco queda en el buscador y las flechas saltean las opciones deshabilitadas
                      <div
                        key={option.value}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled="true"
                        className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 type-body opacity-50 pointer-coarse:min-h-11"
                      >
                        <OptionBody option={option} range={range} renderOption={renderOption} />
                      </div>
                    )
                  }
                  const index = nextIndex()
                  const key = `o:${option.value}`
                  return (
                    <ComboboxRow
                      key={option.value}
                      index={index}
                      listboxId={listboxId}
                      active={activeItem?.key === key}
                      selected={isSelected}
                      onActivate={() => setActiveKey(key)}
                      onChoose={() => choose(option)}
                    >
                      <OptionBody option={option} range={range} renderOption={renderOption} />
                      {isSelected ? (
                        <Check aria-hidden className="size-4 shrink-0 text-primary" />
                      ) : (
                        <span aria-hidden className="size-4 shrink-0" />
                      )}
                    </ComboboxRow>
                  )
                })}
              </React.Fragment>
            ))}
            {statusRow && statusRow.tone !== 'loading' ? (
              <div
                role="presentation"
                className="px-2 py-6 text-center type-small text-pretty text-muted-foreground"
              >
                {statusRow.content}
              </div>
            ) : null}
            {showCreate ? (
              <ComboboxRow
                index={nextIndex()}
                listboxId={listboxId}
                active={activeItem?.kind === 'create'}
                onActivate={() => setActiveKey('create')}
                onChoose={() => void create(trimmed)}
              >
                <Plus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{createLabel(trimmed)}</span>
              </ComboboxRow>
            ) : null}
          </div>
          <div aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </PopoverContent>
      </Popover>
      {showClear ? (
        <button
          type="button"
          aria-label="Quitar lo elegido"
          onClick={clear}
          data-slot="combobox-clear"
          className="absolute top-1/2 right-8 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-subtle-foreground outline-offset-2 outline-(--ring) hover:bg-hover hover:text-foreground focus-visible:outline-2 hit-area"
        >
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
      {hiddenName ? (
        multiple ? (
          selected.map((v) => (
            <input key={v} type="hidden" name={hiddenName} value={v} disabled={disabled} />
          ))
        ) : (
          <input type="hidden" name={hiddenName} value={selected[0] ?? ''} disabled={disabled} />
        )
      ) : null}
      {required && !disabled ? (
        // Un <button type="button"> no entra en la validación del formulario:
        // este campo oculto frena el envío si no se eligió nada.
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={selected.length > 0 ? 'ok' : ''}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault()
            const message = 'Elegí una opción.'
            setLocalError(message)
            reportError(message)
            if (triggerRef.current) focusIfFirstInvalid(triggerRef.current)
          }}
          className="pointer-events-none absolute inset-0 -z-10 opacity-0"
        />
      ) : null}
    </div>
  )
}

function OptionBody<T>({
  option,
  range,
  renderOption,
}: {
  option: EntityOption<T>
  range: [number, number] | null
  renderOption?: (option: EntityOption<T>) => React.ReactNode
}) {
  if (renderOption) return <span className="min-w-0 flex-1">{renderOption(option)}</span>
  return (
    <>
      <span className="grid min-w-0 flex-1">
        <span className="truncate">
          <Highlighted text={option.label} range={range} />
        </span>
        {option.description ? (
          <span className="truncate type-caption text-subtle-foreground">{option.description}</span>
        ) : null}
      </span>
      {option.meta ? (
        <span className="shrink-0 type-small type-amount text-muted-foreground">{option.meta}</span>
      ) : null}
    </>
  )
}

/** Una fila elegible: opción, «Crear…» o «Reintentar». No toma el foco: el foco queda en el buscador. */
function ComboboxRow({
  index,
  listboxId,
  active,
  selected,
  onActivate,
  onChoose,
  children,
  'aria-label': ariaLabel,
}: {
  index: number
  listboxId: string
  active: boolean
  selected?: boolean
  onActivate: () => void
  onChoose: () => void
  children: React.ReactNode
  'aria-label'?: string
}) {
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: el foco queda en el buscador (aria-activedescendant); la fila no se enfoca
    // biome-ignore lint/a11y/useKeyWithClickEvents: el teclado lo maneja el buscador (flechas y Enter)
    <div
      id={`${listboxId}-${index}`}
      role="option"
      aria-selected={selected ?? false}
      aria-label={ariaLabel}
      data-index={index}
      data-active={active ? '' : undefined}
      data-slot="combobox-option"
      // Pasar el mouse resalta; elegir con el mouse no le saca el foco al buscador.
      onPointerMove={active ? undefined : onActivate}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className={cn(
        'flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 type-body select-none pointer-coarse:min-h-11',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </div>
  )
}

/**
 * El preset asíncrono (kit §3.2): `search` obligatorio y mínimo de 2 letras.
 * Los pickers de dominio (proveedor, partícipe) lo envuelven con su
 * `useRouteSearch('/api/<slug>/search/<entidad>')`.
 */
function EntityPicker<T = unknown>(
  props: ComboboxProps<T> & { search: NonNullable<ComboboxProps<T>['search']> },
) {
  return <Combobox<T> minQueryLength={2} {...props} />
}

export { Combobox, EntityPicker }
