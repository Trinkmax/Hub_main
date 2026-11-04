import { Search, X } from 'lucide-react'
import Form from 'next/form'
import Link from 'next/link'
import { PillLink } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { tabHref } from '../_lib/ventas-view'

export type ReceivableFilter = 'todos' | 'con-deuda' | 'atrasados' | 'a-favor'

const FILTERS: ReadonlyArray<{ value: ReceivableFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'con-deuda', label: 'Te deben' },
  { value: 'atrasados', label: 'Atrasados' },
  { value: 'a-favor', label: 'A favor' },
]

/** `?filtro=` de la URL; lo que no se conoce es «Todos». */
export function parseReceivableFilter(value: string | null): ReceivableFilter {
  return value === 'con-deuda' || value === 'atrasados' || value === 'a-favor' ? value : 'todos'
}

/**
 * Los filtros de «Por cobrar»: cuatro píldoras con su cantidad (la elegida rellena en tinta) y, si
 * la lista es larga o ya hay una búsqueda, el buscador por nombre o CUIT. Todo vive en la URL
 * (`?filtro=&q=`), como siempre: los links se pueden compartir. El buscador no necesita JavaScript
 * propio: es un formulario que navega (`next/form`).
 */
export function ReceivablesFilters({
  base,
  active,
  counts,
  q,
  searchOpen,
}: {
  /** `/<bar>/administracion`. */
  base: string
  active: ReceivableFilter
  counts: Readonly<Record<ReceivableFilter, number>>
  /** La búsqueda de la URL. */
  q: string | null
  /** El buscador a la vista. */
  searchOpen: boolean
}) {
  const hrefOf = (filter: ReceivableFilter) =>
    tabHref(base, 'clientes', { filtro: filter === 'todos' ? null : filter, q })

  return (
    <>
      <nav aria-label="Filtrar quién te debe" className="min-w-0 max-w-full">
        <ul className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((filter) => (
            <li key={filter.value} className="shrink-0">
              <PillLink
                href={hrefOf(filter.value)}
                scroll={false}
                active={active === filter.value}
                count={counts[filter.value]}
                size="touch"
                className="md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
              >
                {filter.label}
              </PillLink>
            </li>
          ))}
        </ul>
      </nav>
      {searchOpen ? (
        <Form action={`${base}/ventas`} scroll={false} className="flex items-center gap-2">
          <input type="hidden" name="tab" value="clientes" />
          {active === 'todos' ? null : <input type="hidden" name="filtro" value={active} />}
          <label className="relative flex items-center">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            />
            <span className="sr-only">Buscar por nombre o CUIT</span>
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Nombre o CUIT"
              autoComplete="off"
              className="h-11 w-48 rounded-full border border-border/70 bg-card pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:h-9 md:pointer-fine:text-sm"
            />
          </label>
          <Button type="submit" variant="outline" className="h-11 md:pointer-fine:h-9">
            Buscar
          </Button>
          {q ? (
            <Button
              asChild
              variant="ghost"
              className="h-11 gap-1.5 text-muted-foreground md:pointer-fine:h-9"
            >
              <Link
                href={tabHref(base, 'clientes', { filtro: active === 'todos' ? null : active })}
                scroll={false}
              >
                <X className="size-3.5" aria-hidden />
                Limpiar
              </Link>
            </Button>
          ) : null}
        </Form>
      ) : null}
    </>
  )
}
