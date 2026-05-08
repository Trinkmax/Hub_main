'use client'

import { Search, X } from 'lucide-react'
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

type Tag = { id: string; name: string; color: string }

export function CustomersFilters({ tags }: { tags: Tag[] }) {
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
  const hasFilters = q.length > 0 || tag.length > 0 || since.length > 0

  return (
    <form
      onSubmit={onSubmit}
      className="card-hairline flex flex-col gap-2 rounded-xl border bg-card/60 p-2 sm:flex-row sm:items-center"
      aria-busy={pending}
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
  )
}
