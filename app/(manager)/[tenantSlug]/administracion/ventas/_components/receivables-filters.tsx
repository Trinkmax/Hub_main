import { Search, X } from 'lucide-react'
import Form from 'next/form'
import Link from 'next/link'
import type { ReactNode } from 'react'
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
 * Los filtros de «Quién te debe»: cuatro píldoras con su cantidad (la elegida
 * rellena en tinta) y el buscador por nombre o CUIT. Todo vive en la URL
 * (`?filtro=&q=`), como siempre: los links se pueden compartir.
 *
 * El buscador queda a la vista cuando la lista es larga o ya hay una búsqueda;
 * si no, detrás de «Buscar». No necesita JavaScript propio: es un formulario
 * que navega (`next/form`).
 */
export function ReceivablesFilters({
  base,
  active,
  counts,
  q,
  searchOpen,
  aside,
}: {
  /** `/<bar>/administracion`. */
  base: string
  active: ReceivableFilter
  counts: Readonly<Record<ReceivableFilter, number>>
  /** La búsqueda de la URL. */
  q: string | null
  /** El buscador a la vista sin tocar nada. */
  searchOpen: boolean
  /** A la derecha de las píldoras: el exporte. */
  aside?: ReactNode
}) {
  const hrefOf = (filter: ReceivableFilter) =>
    tabHref(base, 'clientes', { filtro: filter === 'todos' ? null : filter, q })

  const form = (
    <Form
      action={`${base}/ventas`}
      scroll={false}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <input type="hidden" name="tab" value="clientes" />
      {active === 'todos' ? null : <input type="hidden" name="filtro" value={active} />}
      <label className="relative flex flex-1 items-center">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
        />
        <span className="sr-only">Buscar por nombre o CUIT</span>
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar por nombre o CUIT…"
          autoComplete="off"
          className="h-11 w-full rounded-full border border-border/70 bg-card pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:h-9 md:pointer-fine:text-sm"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="outline"
          className="h-11 flex-1 sm:flex-none md:pointer-fine:h-9"
        >
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
      </div>
    </Form>
  )

  return (
    <div className="space-y-2">
      <nav aria-label="Filtrar quién te debe" className="min-w-0 max-w-full">
        <ul className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
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
        <>
          {form}
          {aside ? <div className="flex justify-end">{aside}</div> : null}
        </>
      ) : (
        // «Buscar» y el exporte comparten renglón; al abrir, el buscador baja al suyo. El exporte
        // va AFUERA del <details>: cerrado, lo de adentro no se dibuja.
        <div className="relative">
          <details className="group/search">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:pointer-fine:min-h-9 [&::-webkit-details-marker]:hidden">
              <Search aria-hidden className="size-4" />
              Buscar
            </summary>
            <div className="pt-1">{form}</div>
          </details>
          {aside ? <div className="absolute top-0 right-0">{aside}</div> : null}
        </div>
      )}
    </div>
  )
}
