'use client'

import { X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { FilterBar, FilterSearch } from '@/components/ui/filter-bar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SlidingTabs } from '@/components/ui/sliding-tabs'

/** Lo que se borra al cambiar un filtro: la página (vuelve a la primera). */
const PAGE_PARAMS = ['pagina', 'despues']

function useParamSetter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, start] = useTransition()

  const set = (updates: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    for (const key of PAGE_PARAMS) next.delete(key)
    const query = next.toString()
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }
  return { set, pending, searchParams }
}

/**
 * El segmentado de una lista (Todos · Con deuda · Vencidos…): `SlidingTabs`
 * del panel, solo para filtros. El valor viaja en la URL (`?filtro=`): la
 * lista se comparte y «atrás» funciona.
 */
export function SegmentFilter<T extends string>({
  options,
  value,
  param,
  defaultValue,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  param: string
  /** El valor que no se escribe en la URL. */
  defaultValue: T
  label: string
}) {
  const { set, pending } = useParamSetter()
  return (
    <fieldset
      aria-busy={pending}
      className="-mx-4 my-0 min-w-0 overflow-x-auto border-0 px-4 py-0 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      <legend className="sr-only">{label}</legend>
      <SlidingTabs
        tabs={options.map((o) => ({ value: o.value, label: o.label }))}
        value={value}
        onChange={(next) => set({ [param]: next === defaultValue ? null : next })}
      />
    </fieldset>
  )
}

/**
 * Buscador + (opcional) un `Select` de estado, en la barra de filtros del
 * panel. Buscar reemplaza `?q=` sin perder los demás parámetros.
 */
export function SearchFilter({
  placeholder,
  status,
}: {
  placeholder: string
  status?: {
    param: string
    value: string
    defaultValue: string
    label: string
    options: ReadonlyArray<{ value: string; label: string }>
  }
}) {
  const { set, pending, searchParams } = useParamSetter()
  const q = searchParams.get('q') ?? ''
  const hasFilters = q !== '' || (status ? status.value !== status.defaultValue : false)

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('q')
    set({ q: typeof value === 'string' && value.trim() !== '' ? value.trim() : null })
  }

  return (
    <form onSubmit={onSubmit} aria-busy={pending}>
      <FilterBar>
        <FilterSearch key={q} placeholder={placeholder} defaultValue={q} />
        {status ? (
          <Select
            value={status.value}
            onValueChange={(next) =>
              set({ [status.param]: next === status.defaultValue ? null : next })
            }
          >
            <SelectTrigger
              aria-label={status.label}
              className="sm:w-[190px] data-[size=default]:h-11 sm:data-[size=default]:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {status.options.map((o) => (
                <SelectItem key={o.value} value={o.value} className="min-h-11 md:min-h-8">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 gap-1.5 text-muted-foreground sm:h-9"
            onClick={() => set({ q: null, ...(status ? { [status.param]: null } : {}) })}
          >
            <X className="size-3.5" aria-hidden />
            Limpiar
          </Button>
        ) : null}
        <Button type="submit" size="sm" className="h-11 sm:h-9">
          Buscar
        </Button>
      </FilterBar>
    </form>
  )
}
