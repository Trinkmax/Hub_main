'use client'

import { X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Combobox, type EntityOption } from '@/components/ui/combobox'
import { SearchField } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

type Tag = { id: string; name: string; color: string }

export type ProgramaCounts = {
  all: number
  with_points: number
  contact_only: number
}

type Programa = 'all' | 'with_points' | 'contact_only'

const PROGRAMA_OPTIONS: { value: Programa; label: string; hint: string }[] = [
  { value: 'all', label: 'Todos', hint: 'toda la base' },
  { value: 'with_points', label: 'Con puntos', hint: 'ya consumieron' },
  { value: 'contact_only', label: 'Solo contacto', hint: 'todavía sin visitas' },
]

const SINCE_OPTIONS = [
  { value: 'any', label: 'Cualquier visita' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'never', label: 'Sin visitas' },
] as const

/**
 * Los filtros de la lista de clientes, en la barra de la tabla (kit HUB §5.2).
 * Todo vive en la URL, como antes: `q`, `programa`, `tag` y `since`; cambiar
 * cualquiera vuelve a la página 1. El `segment` del menú (Reservas, Walk-in)
 * no se toca: «Limpiar filtros» lo conserva.
 *
 * Devuelve los controles sueltos (un fragmento): la página los pone adentro de
 * `DataTableToolbar`, que los alinea en una fila del mismo alto.
 */
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

  const hrefWith = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value && value.length > 0) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    const query = next.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  const setParam = (key: string, value: string | null) => {
    start(() => router.replace(hrefWith(key, value), { scroll: false }))
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = new FormData(e.currentTarget).get('q')
    setParam('q', typeof q === 'string' ? q.trim() : null)
  }

  const q = searchParams.get('q') ?? ''
  // El texto del buscador sigue a la URL cuando cambia desde afuera («Limpiar
  // filtros», atrás); al buscar, la URL ya dice lo tipeado y el foco se queda.
  const [text, setText] = useState(q)
  const [syncedQ, setSyncedQ] = useState(q)
  if (q !== syncedQ) {
    setSyncedQ(q)
    setText(q)
  }
  const tag = searchParams.get('tag') ?? ''
  const since = searchParams.get('since') ?? ''
  const segment = searchParams.get('segment')
  const programaRaw = searchParams.get('programa') ?? 'all'
  const programa: Programa =
    programaRaw === 'with_points' || programaRaw === 'contact_only' ? programaRaw : 'all'
  const hasFilters = q.length > 0 || tag.length > 0 || since.length > 0 || programa !== 'all'

  const clearAll = () => {
    const next = segment ? `${pathname}?${new URLSearchParams({ segment })}` : pathname
    start(() => router.replace(next, { scroll: false }))
  }

  const tagOptions: EntityOption[] = tags.map((t) => ({ value: t.id, label: t.name }))

  return (
    <>
      <search className="flex min-w-48 flex-1">
        <form onSubmit={onSubmit} className="flex w-full items-center gap-2">
          <SearchField
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Buscar clientes por nombre o teléfono"
            placeholder="Buscar por nombre o teléfono"
            onClear={() => {
              setText('')
              if (q) setParam('q', null)
            }}
          />
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
      </search>

      {/* En un celular angosto las tres opciones con sus cuentas pueden no entrar: la fila scrollea. */}
      <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <SegmentedControl
          aria-label="Programa de puntos"
          value={programa}
          className="max-w-none"
          items={PROGRAMA_OPTIONS.map((option) => ({
            value: option.value,
            label: (
              <>
                {option.label}
                <span className="sr-only"> ({option.hint})</span>
              </>
            ),
            count: programaCounts[option.value],
            href: hrefWith('programa', option.value === 'all' ? null : option.value),
          }))}
        />
      </div>

      {tags.length > 0 ? (
        <Combobox
          options={tagOptions}
          value={tag || null}
          onValueChange={(value) => setParam('tag', typeof value === 'string' ? value : null)}
          placeholder="Todas las etiquetas"
          searchPlaceholder="Buscar etiqueta"
          emptyText="No hay una etiqueta con ese nombre."
          clearable
          aria-label="Filtrar por etiqueta"
          className="w-full sm:w-52"
        />
      ) : null}

      <Select
        value={since || 'any'}
        onValueChange={(v) => setParam('since', v === 'any' ? null : v)}
      >
        <SelectTrigger aria-label="Filtrar por última visita" className="w-full sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SINCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button type="button" variant="ghost" onClick={clearAll}>
          <X aria-hidden="true" />
          Limpiar filtros
        </Button>
      ) : null}

      {pending ? <Spinner size={16} label="Actualizando la lista…" /> : null}
    </>
  )
}
