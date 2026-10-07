'use client'

import { Mail, Search, Star, Users, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type Tag = { id: string; name: string; color: string }

export type ProgramaCounts = {
  all: number
  with_points: number
  contact_only: number
}

type Programa = 'all' | 'with_points' | 'contact_only'

const PROGRAMA_TABS: {
  value: Programa
  label: string
  icon: typeof Users
  hint: string
}[] = [
  { value: 'all', label: 'Todos', icon: Users, hint: 'Base completa' },
  { value: 'with_points', label: 'Con puntos', icon: Star, hint: 'Ya consumieron' },
  { value: 'contact_only', label: 'Solo contacto', icon: Mail, hint: 'Sin visitas' },
]

export function CustomersFilters({
  tags,
  programaCounts,
}: {
  tags: Tag[]
  programaCounts: ProgramaCounts
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, start] = useTransition()

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value && value.length > 0) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const q = fd.get('q')
    setParam('q', typeof q === 'string' ? q : null)
  }

  const clearAll = () => {
    start(() => router.replace(pathname, { scroll: false }))
  }

  const q = searchParams.get('q') ?? ''
  const tag = searchParams.get('tag') ?? ''
  const since = searchParams.get('since') ?? ''
  const programaRaw = searchParams.get('programa') ?? 'all'
  const programa: Programa =
    programaRaw === 'with_points' || programaRaw === 'contact_only' ? programaRaw : 'all'
  const hasFilters = q.length > 0 || tag.length > 0 || since.length > 0 || programa !== 'all'

  return (
    <div className="space-y-2" aria-busy={pending}>
      <div
        role="tablist"
        aria-label="Segmento de clientes"
        className="card-hairline flex w-full overflow-x-auto rounded-xl border bg-card/60 p-1"
      >
        {PROGRAMA_TABS.map((tab) => {
          const active = programa === tab.value
          const count = programaCounts[tab.value]
          const Icon = tab.icon
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParam('programa', tab.value === 'all' ? null : tab.value)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-sm',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
              <span
                className={cn(
                  'ml-1 inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  active ? 'bg-primary/15 text-primary' : 'bg-secondary/60 text-muted-foreground',
                )}
              >
                {count.toLocaleString('es-AR')}
              </span>
              <span className="sr-only">{tab.hint}</span>
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
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre o teléfono…"
            autoComplete="off"
            className="h-9 w-full rounded-lg border border-transparent bg-background/40 pl-9 pr-3 text-sm shadow-none outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40"
          />
        </label>

        <Select value={tag || 'all'} onValueChange={(v) => setParam('tag', v === 'all' ? null : v)}>
          <SelectTrigger className="h-9 sm:w-[180px]">
            <SelectValue placeholder="Etiqueta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las etiquetas</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={since || 'any'}
          onValueChange={(v) => setParam('since', v === 'any' ? null : v)}
        >
          <SelectTrigger className="h-9 sm:w-[180px]">
            <SelectValue placeholder="Última visita" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Cualquier visita</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
            <SelectItem value="90d">Últimos 90 días</SelectItem>
            <SelectItem value="never">Nunca volvió</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-9 gap-1.5 text-muted-foreground"
          >
            <X className="size-3.5" />
            Limpiar
          </Button>
        ) : null}

        <Button type="submit" size="sm" className="h-9">
          Buscar
        </Button>
      </form>
    </div>
  )
}
