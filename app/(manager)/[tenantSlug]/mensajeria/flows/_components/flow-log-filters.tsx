'use client'

import { RefreshCw, X } from 'lucide-react'
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
import { ACTION_OPTIONS, STATUS_OPTIONS } from '@/lib/flows/execution-log-labels'
import type { FlowLogContact } from '@/lib/flows/execution-log-queries'

// Filtros del registro de ejecuciones. Todo vive en la URL (searchParams) para
// que la página siga siendo un Server Component y el estado sea compartible.

export function FlowLogFilters({
  contacts,
  desde,
  hasta,
}: {
  contacts: FlowLogContact[]
  /** Rango ya resuelto por el server (incluye el default de 30 días). */
  desde: string
  hasta: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, start] = useTransition()

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value && value.length > 0) next.set(key, value)
    else next.delete(key)
    // Cambiar un filtro siempre vuelve a la primera página.
    next.delete('page')
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }

  const accion = searchParams.get('accion') ?? ''
  const estado = searchParams.get('estado') ?? ''
  const contacto = searchParams.get('contacto') ?? ''
  const hasFilters = Boolean(
    searchParams.get('desde') || searchParams.get('hasta') || accion || estado || contacto,
  )

  return (
    <div
      className="card-hairline flex flex-col gap-2 rounded-xl border bg-card/60 p-2 sm:flex-row sm:flex-wrap sm:items-center"
      aria-busy={pending}
    >
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="log-desde">
          Desde
        </label>
        <input
          id="log-desde"
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => setParam('desde', e.target.value)}
          className="h-9 rounded-lg border border-transparent bg-background/40 px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/40"
        />
        <span className="text-xs text-muted-foreground">a</span>
        <label className="sr-only" htmlFor="log-hasta">
          Hasta
        </label>
        <input
          id="log-hasta"
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => setParam('hasta', e.target.value)}
          className="h-9 rounded-lg border border-transparent bg-background/40 px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/40"
        />
      </div>

      <Select
        value={accion || 'all'}
        onValueChange={(v) => setParam('accion', v === 'all' ? null : v)}
      >
        <SelectTrigger className="h-9 sm:w-[180px]">
          <SelectValue placeholder="Todas las acciones" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las acciones</SelectItem>
          {ACTION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={estado || 'all'}
        onValueChange={(v) => setParam('estado', v === 'all' ? null : v)}
      >
        <SelectTrigger className="h-9 sm:w-[170px]">
          <SelectValue placeholder="Todos los estados" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={contacto || 'all'}
        onValueChange={(v) => setParam('contacto', v === 'all' ? null : v)}
      >
        <SelectTrigger className="h-9 sm:w-[200px]">
          <SelectValue placeholder="Seleccionar contacto" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los contactos</SelectItem>
          {contacts.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.first_name} {c.last_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5 sm:ml-auto">
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => start(() => router.replace(pathname, { scroll: false }))}
            className="h-9 gap-1.5 text-muted-foreground"
          >
            <X className="size-3.5" />
            Limpiar
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => start(() => router.refresh())}
          className="h-9 gap-1.5"
        >
          <RefreshCw className={pending ? 'size-3.5 animate-spin' : 'size-3.5'} />
          Actualizar
        </Button>
      </div>
    </div>
  )
}
