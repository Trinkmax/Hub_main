'use client'

import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type ComboOption = {
  value: string
  label: string
  /** A la izquierda, en mono: el código de una cuenta. */
  code?: string
  /** Debajo, chico: «CUIT 30-71876543-5 · Responsable inscripto», el camino de una cuenta. */
  description?: string | null
  /** A la derecha: un saldo. */
  meta?: ReactNode
  /** Encabezado de grupo (no se puede elegir). */
  group?: string | null
}

export type EntityComboboxProps = {
  id?: string
  /** `<input type="hidden" name>` con el id elegido (`""` si no hay). */
  name?: string
  value: string | null
  /** Etiqueta de lo elegido, para el disparador (puede no estar en la lista filtrada). */
  selectedLabel?: ReactNode
  /** Opciones YA filtradas y ordenadas para `query`. */
  filter: (query: string) => ComboOption[]
  onSelect: (value: string) => void
  /** Fila «Crear «…»» al final. Recibe lo tipeado. */
  onCreate?: (query: string) => void
  createLabel?: (query: string) => string
  placeholder: string
  searchPlaceholder: string
  emptyText?: (query: string) => ReactNode
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-labelledby'?: string
  'aria-label'?: string
  className?: string
}

/**
 * Combo con buscador del panel (Popover + Command, el patrón de ⌘K y de las
 * etiquetas). Una tecla en el disparador abre con esa letra ya tipeada;
 * Enter elige; Esc cierra y vuelve al disparador. 44 px en el celular.
 */
export function EntityCombobox({
  id: idProp,
  name,
  value,
  selectedLabel,
  filter,
  onSelect,
  onCreate,
  createLabel = (q) => `Crear «${q}»`,
  placeholder,
  searchPlaceholder,
  emptyText = (q) => (q ? `No encontramos nada con «${q}».` : 'No hay opciones.'),
  disabled,
  invalid,
  className,
  ...aria
}: EntityComboboxProps) {
  const autoId = useId()
  const id = idProp ?? `combo-${autoId}`
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const options = open ? filter(trimmed) : []

  const groups: Array<{ heading: string | null; items: ComboOption[] }> = []
  for (const option of options) {
    const heading = option.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.heading === heading) last.items.push(option)
    else groups.push({ heading, items: [option] })
  }

  const choose = (next: string) => {
    onSelect(next)
    setOpen(false)
    setQuery('')
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Tipear sobre el combo cerrado lo abre con esa letra ya en el buscador.
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.key !== ' '
    ) {
      event.preventDefault()
      setQuery(event.key)
      setOpen(true)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={aria['aria-describedby']}
          aria-labelledby={aria['aria-labelledby']}
          aria-label={aria['aria-label']}
          disabled={disabled}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            'flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background/60 px-3 text-left text-base shadow-2xs md:h-10 md:text-sm',
            'outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
            'aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
            className,
          )}
        >
          <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground')}>
            {value ? (selectedLabel ?? placeholder) : placeholder}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-[min(320px,calc(100vw-2rem))] p-0"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            className="text-base md:text-sm"
          />
          <CommandList id={listId} className="max-h-[min(320px,50vh)]">
            {options.length === 0 && !(onCreate && trimmed) ? (
              <CommandEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyText(trimmed)}
              </CommandEmpty>
            ) : null}
            {groups.map((group, index) => (
              <CommandGroup
                key={`${group.heading ?? 'sin-grupo'}-${index.toString()}`}
                heading={group.heading ?? undefined}
              >
                {group.items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => choose(option.value)}
                    className="min-h-11 items-start gap-2 py-2 md:min-h-9"
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        option.value === value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        {option.code ? (
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            {option.code}
                          </span>
                        ) : null}
                        <span className="truncate">{option.label}</span>
                      </span>
                      {option.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {option.meta ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{option.meta}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {onCreate && trimmed ? (
              <CommandGroup>
                <CommandItem
                  value={`__crear__${trimmed}`}
                  onSelect={() => {
                    setOpen(false)
                    setQuery('')
                    onCreate(trimmed)
                  }}
                  className="min-h-11 gap-2 text-primary md:min-h-9"
                >
                  <Plus aria-hidden="true" className="size-4 text-primary" />
                  {createLabel(trimmed)}
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
    </Popover>
  )
}
