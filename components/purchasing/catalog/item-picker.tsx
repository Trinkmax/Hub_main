'use client'

import { AlertTriangle, ChevronsUpDown } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PurItem } from '@/lib/purchasing/types'
import { unitShort } from '@/lib/purchasing/units'
import { cn } from '@/lib/utils'
import { CatalogSheet } from './catalog-sheet'
import { matchesSearch, searchKey } from './form-bits'
import { useMediaQuery, WIDE_QUERY } from './use-media-query'

/** Cuántos resultados se dibujan a la vez (con 270 insumos, el resto llega escribiendo). */
const MAX_RESULTS = 60

/**
 * Elegir un insumo de la lista, buscando por nombre, marca o código. En la compu es un desplegable
 * pegado al renglón; en el celular, una hoja con la búsqueda arriba y la lista que queda a la vista
 * con el teclado abierto.
 */
export function ItemPicker({
  id,
  items,
  selected,
  fallbackName,
  open,
  onOpenChange,
  onPick,
  describedById,
  invalid = false,
}: {
  id: string
  /** Las opciones: los insumos activos. */
  items: readonly PurItem[]
  /** El insumo del renglón (puede estar desactivado). */
  selected: PurItem | null
  /** El nombre que trae el renglón cuando no tiene insumo («Langostino», de la planilla). */
  fallbackName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Después de elegir, el foco lo decide quien usa el selector (va a la cantidad). */
  onPick: (item: PurItem) => void
  describedById?: string
  invalid?: boolean
}) {
  const wide = useMediaQuery(WIDE_QUERY)
  // Si se eligió algo, el foco no vuelve al botón: lo mueve `onPick` (a la cantidad).
  const picked = useRef(false)

  const pick = (item: PurItem) => {
    picked.current = true
    onPick(item)
    onOpenChange(false)
  }
  const keepFocusAfterPick = (event: Event) => {
    if (!picked.current) return
    picked.current = false
    event.preventDefault()
  }

  const triggerClass = cn(
    'flex h-11 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background/60 px-3 text-left text-base shadow-2xs md:h-10 md:text-sm',
    'transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
    invalid && 'border-warning',
  )
  const label = selected ? (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className={cn('truncate font-medium', !selected.active && 'text-warning-text')}>
        {selected.name}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {selected.active ? `· ${unitShort(selected.unit)}` : '· desactivado'}
      </span>
    </span>
  ) : fallbackName ? (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-warning-text">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="truncate">«{fallbackName}»</span>
      <span className="shrink-0 text-sm">· elegir</span>
    </span>
  ) : (
    <span className="min-w-0 flex-1 truncate text-muted-foreground">Elegí el insumo</span>
  )
  const chevron = <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />

  if (wide) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" id={id} aria-describedby={describedById} className={triggerClass}>
            {label}
            {chevron}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          onCloseAutoFocus={keepFocusAfterPick}
          className="w-[min(28rem,calc(100vw-2rem))] p-0"
        >
          <ItemSearch items={items} onPick={pick} variant="popover" />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={describedById}
        onClick={() => onOpenChange(true)}
        className={triggerClass}
      >
        {label}
        {chevron}
      </button>
      <CatalogSheet
        open={open}
        onClose={() => onOpenChange(false)}
        title="Elegí el insumo"
        description="Buscá por nombre, marca o código."
        tall
        focusOnTouch
        onCloseAutoFocus={keepFocusAfterPick}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <ItemSearch items={items} onPick={pick} variant="sheet" />
        </div>
      </CatalogSheet>
    </>
  )
}

function ItemSearch({
  items,
  onPick,
  variant,
}: {
  items: readonly PurItem[]
  onPick: (item: PurItem) => void
  variant: 'popover' | 'sheet'
}) {
  const [query, setQuery] = useState('')
  const key = searchKey(query)
  // Primero los que empiezan con lo que se escribió; después, por nombre.
  const matches = items
    .filter((item) => matchesSearch(query, [item.name, item.brand, item.code]))
    .sort((a, b) => {
      const aStarts = key && searchKey(a.name).startsWith(key) ? 0 : 1
      const bStarts = key && searchKey(b.name).startsWith(key) ? 0 : 1
      return aStarts - bStarts || a.name.localeCompare(b.name, 'es')
    })
  const shown = matches.slice(0, MAX_RESULTS)
  const more = matches.length - shown.length

  return (
    <Command
      shouldFilter={false}
      loop
      className={cn(
        '**:data-[slot=command-input-wrapper]:h-12',
        variant === 'sheet' ? 'min-h-0 flex-1 rounded-none bg-transparent' : '',
      )}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Buscar insumo"
        aria-label="Buscar insumo"
        className="text-base md:text-sm"
      />
      <CommandList
        className={cn(
          'overscroll-contain',
          variant === 'sheet'
            ? 'max-h-none min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]'
            : 'max-h-72',
        )}
      >
        <CommandEmpty>
          {items.length
            ? `No hay insumos con «${query.trim()}».`
            : 'Todavía no hay insumos activos.'}
        </CommandEmpty>
        {shown.length ? (
          <CommandGroup>
            {shown.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                onSelect={() => onPick(item)}
                className="min-h-11 gap-3 py-2 md:min-h-9"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.name}</span>
                  {item.brand ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.brand}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                  {unitShort(item.unit)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {more > 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Hay {more} más: seguí escribiendo para encontrarlo.
          </p>
        ) : null}
      </CommandList>
    </Command>
  )
}
