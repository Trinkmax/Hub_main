'use client'

import { ChevronsUpDown, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
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

/** «+ Agregar un producto…»: busca en los insumos; primero los de este proveedor. */
export function ItemPicker({
  items,
  supplierNames,
  preferSupplierId,
  excludeIds,
  value,
  onChange,
  className,
}: {
  items: readonly PurItem[]
  supplierNames: ReadonlyMap<string, string>
  preferSupplierId: string | null
  excludeIds: ReadonlySet<string>
  value: string | null
  onChange: (itemId: string | null) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const options = useMemo(
    () =>
      items
        .filter((i) => i.active && !excludeIds.has(i.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [items, excludeIds],
  )
  const mine = options.filter((i) => preferSupplierId && i.supplierId === preferSupplierId)
  const others = options.filter((i) => !preferSupplierId || i.supplierId !== preferSupplierId)
  const selected = value ? items.find((i) => i.id === value) : undefined

  const row = (i: PurItem) => (
    <CommandItem
      key={i.id}
      value={`${i.name} ${i.brand ?? ''} ${i.code ?? ''}`}
      onSelect={() => {
        onChange(i.id)
        setOpen(false)
      }}
      className="min-h-11"
    >
      <span className="min-w-0 flex-1 truncate">{i.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {unitShort(i.unit)}
        {i.supplierId && i.supplierId !== preferSupplierId
          ? ` · ${supplierNames.get(i.supplierId) ?? ''}`
          : ''}
      </span>
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            'flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-left text-[0.95rem]',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2 truncate">
            {!selected ? <Plus className="size-4 shrink-0" aria-hidden /> : null}
            {selected ? selected.name : 'Agregar un producto…'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,26rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar insumo…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No hay ninguno con ese nombre.</CommandEmpty>
            {mine.length ? (
              <CommandGroup heading="De este proveedor">{mine.map(row)}</CommandGroup>
            ) : null}
            {others.length ? (
              <CommandGroup heading={mine.length ? 'Otros' : 'Insumos'}>
                {others.map(row)}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
