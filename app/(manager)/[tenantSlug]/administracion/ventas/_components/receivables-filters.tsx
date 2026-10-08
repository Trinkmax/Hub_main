'use client'

import { AlarmClock, HandCoins, Search, Undo2, Users, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ReceivableFilter = 'todos' | 'con-deuda' | 'atrasados' | 'a-favor'

const TABS: ReadonlyArray<{
  value: ReceivableFilter
  label: string
  icon: typeof Users
}> = [
  { value: 'todos', label: 'Todos', icon: Users },
  { value: 'con-deuda', label: 'Te deben', icon: HandCoins },
  { value: 'atrasados', label: 'Atrasados', icon: AlarmClock },
  { value: 'a-favor', label: 'A favor', icon: Undo2 },
]

/**
 * Filtros de «Clientes y plataformas»: el segmento (con su cantidad) y la
 * búsqueda por nombre o CUIT, en la URL (`?filtro=&q=`), igual que la lista
 * de Clientes del panel.
 */
export function ReceivablesFilters({
  active,
  counts,
}: {
  active: ReceivableFilter
  counts: Readonly<Record<ReceivableFilter, number>>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, start] = useTransition()

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value && value.length > 0) next.set(key, value)
    else next.delete(key)
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = new FormData(e.currentTarget).get('q')
    setParam('q', typeof q === 'string' ? q.trim() : null)
  }

  const q = searchParams.get('q') ?? ''

  return (
    <div className="space-y-2" aria-busy={pending}>
      <div
        role="tablist"
        aria-label="Filtrar clientes y plataformas"
        className="card-hairline flex w-full overflow-x-auto rounded-xl border bg-card/60 p-1"
      >
        {TABS.map((tab) => {
          const selected = active === tab.value
          const Icon = tab.icon
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setParam('filtro', tab.value === 'todos' ? null : tab.value)}
              className={cn(
                // Cada filtro en una línea: en el celular el segmentado se desliza
                // de costado en vez de partir «Te deben» en dos renglones.
                'flex min-h-11 flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:min-h-0 sm:text-sm',
                selected
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span>{tab.label}</span>
              <span
                className={cn(
                  'ml-1 inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  selected ? 'bg-primary/15 text-primary' : 'bg-secondary/60 text-muted-foreground',
                )}
              >
                {counts[tab.value].toLocaleString('es-AR')}
              </span>
            </button>
          )
        })}
      </div>

      <form
        onSubmit={onSubmit}
        className="card-hairline flex flex-col gap-2 rounded-xl border bg-card/60 p-2 sm:flex-row sm:items-center"
      >
        <label className="relative flex flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <span className="sr-only">Buscar</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre o CUIT…"
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-transparent bg-background/40 pl-9 pr-3 text-base shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40 sm:h-9 sm:text-sm"
          />
        </label>
        {q ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setParam('q', null)}
            className="h-11 gap-1.5 text-muted-foreground sm:h-9"
          >
            <X className="size-3.5" aria-hidden />
            Limpiar
          </Button>
        ) : null}
        <Button type="submit" size="sm" className="h-11 sm:h-9">
          Buscar
        </Button>
      </form>
    </div>
  )
}
