'use client'

import { RefreshCw, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { DataTableToolbar } from '@/components/ui/data-table'
import { type Period, PeriodPicker } from '@/components/ui/period-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { endOfMonth, periodRange, todayInCordoba } from '@/lib/dates'
import { ACTION_OPTIONS, STATUS_OPTIONS } from '@/lib/flows/execution-log-labels'
import type { FlowLogContact } from '@/lib/flows/execution-log-queries'

// Filtros del registro de ejecuciones. Todo vive en la URL (searchParams) para
// que la página siga siendo un Server Component y el estado sea compartible.
// El período sigue viajando como `desde`/`hasta` (los links viejos andan): el
// PeriodPicker del kit va en modo controlado y escribe esos dos parámetros.

/** `desde`/`hasta` → el período que mejor los describe: un día, un mes entero o un rango. */
function periodFromRange(desde: string, hasta: string): Period {
  if (desde === hasta) return { kind: 'day', date: desde }
  const month = desde.slice(0, 7)
  if (desde.endsWith('-01') && hasta === endOfMonth(month)) return { kind: 'month', month }
  return { kind: 'range', from: desde, to: hasta }
}

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

  // `replace` y no `push`: cambiar un filtro no deja una entrada por tecla en el historial.
  const navigate = (next: URLSearchParams) => {
    // Cambiar un filtro siempre vuelve a la primera página.
    next.delete('page')
    const query = next.toString()
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value && value.length > 0) next.set(key, value)
    else next.delete(key)
    navigate(next)
  }

  const setPeriod = (period: Period) => {
    const { from, to } = periodRange(period)
    const next = new URLSearchParams(searchParams.toString())
    next.set('desde', from)
    next.set('hasta', to)
    navigate(next)
  }

  const accion = searchParams.get('accion') ?? ''
  const estado = searchParams.get('estado') ?? ''
  const contacto = searchParams.get('contacto') ?? ''
  const hasFilters = Boolean(
    searchParams.get('desde') || searchParams.get('hasta') || accion || estado || contacto,
  )

  return (
    <DataTableToolbar
      role="group"
      aria-label="Filtros del registro"
      aria-busy={pending || undefined}
    >
      <PeriodPicker
        aria-label="Período del registro"
        kinds={['day', 'month', 'range']}
        value={periodFromRange(desde, hasta)}
        onValueChange={setPeriod}
        max={todayInCordoba()}
      />

      <Select
        value={accion || 'all'}
        onValueChange={(v) => setParam('accion', v === 'all' ? null : v)}
      >
        <SelectTrigger aria-label="Acción" className="sm:w-44">
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
        <SelectTrigger aria-label="Estado" className="sm:w-40">
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

      {/* Muchos contactos: buscador (Combobox) en vez de una lista larga. */}
      <Combobox
        aria-label="Contacto"
        className="sm:w-52"
        clearable
        placeholder="Todos los contactos"
        searchPlaceholder="Buscar contacto…"
        emptyText="No encontramos ese contacto en este registro."
        value={contacto || null}
        onValueChange={(v) => setParam('contacto', typeof v === 'string' ? v : null)}
        options={contacts.map((c) => ({
          value: c.id,
          label: `${c.first_name} ${c.last_name}`.trim(),
        }))}
      />

      <div className="flex items-center gap-2 sm:ms-auto">
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => start(() => router.replace(pathname, { scroll: false }))}
          >
            <X aria-hidden />
            Limpiar filtros
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => start(() => router.refresh())}
          loading={pending}
        >
          <RefreshCw aria-hidden />
          Actualizar
        </Button>
      </div>
    </DataTableToolbar>
  )
}
