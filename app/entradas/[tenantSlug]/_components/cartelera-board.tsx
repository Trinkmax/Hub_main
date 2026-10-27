'use client'

import { ChevronDown, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { allSoldOut } from '@/lib/ticketing/availability'
import {
  type AvailabilityFilter,
  buildAgenda,
  type CatalogFilters,
  catalogFilterOptions,
  catalogFiltersQuery,
  type FilterOption,
  filterCatalog,
  hasActiveFilters,
  NO_FILTERS,
  sanitizeCatalogFilters,
} from '@/lib/ticketing/catalog'
import type { PublicExperience } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { Reveal } from '../../_components/reveal'
import { AgendaList } from './agenda-list'
import { FilmCard } from './film-card'

type View = 'films' | 'dates'

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'films', label: 'Películas' },
  { value: 'dates', label: 'Por fecha' },
]

const AVAILABILITY_OPTIONS: FilterOption[] = [
  { value: 'available', label: 'Disponibles' },
  { value: 'sold_out', label: 'Agotadas' },
]

const FILTER_PARAMS = ['mes', 'pelicula', 'ver']

/**
 * La cartelera con dos lentes: por película (el afiche manda) o por fecha
 * (para el que ya sabe qué día puede). La elegida va rellena.
 *
 * Y tres filtros (pedido de los socios, 27/10/2026): mes, película y
 * disponibilidad. Con «Disponibles» desaparece todo lo agotado, y la página
 * de la película tampoco lo muestra. Los filtros viven en la URL (sin ensuciar
 * el Atrás): un link puede llegar ya filtrado, p. ej. ?ver=disponibles.
 */
export function CarteleraBoard({
  experiences,
  tenantSlug,
  today,
  whatsapp,
  venueName,
  initialFilters = NO_FILTERS,
}: {
  experiences: PublicExperience[]
  tenantSlug: string
  today: string
  whatsapp: string | null
  venueName: string
  initialFilters?: CatalogFilters
}) {
  const [view, setView] = useState<View>('films')
  const options = useMemo(() => catalogFilterOptions(experiences), [experiences])
  const [filters, setFilters] = useState<CatalogFilters>(() =>
    sanitizeCatalogFilters(initialFilters, options),
  )
  const baseId = useId()

  const visible = useMemo(() => filterCatalog(experiences, filters), [experiences, filters])
  const agenda = useMemo(() => buildAgenda(visible), [visible])
  const originals = useMemo(
    () => new Map(experiences.map((e, i) => [e.id, { e, i }])),
    [experiences],
  )
  const active = hasActiveFilters(filters)
  const onlyAvailable = filters.availability === 'available'
  const count = visible.reduce((n, e) => n + e.functions.length, 0)

  // La URL dice qué se está mirando (replaceState: no suma pasos al Atrás).
  useEffect(() => {
    const url = new URL(window.location.href)
    for (const key of FILTER_PARAMS) url.searchParams.delete(key)
    new URLSearchParams(catalogFiltersQuery(filters)).forEach((value, key) => {
      url.searchParams.set(key, value)
    })
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, '', url)
    }
  }, [filters])

  const set = (patch: Partial<CatalogFilters>) => setFilters((prev) => ({ ...prev, ...patch }))
  const clear = () => setFilters(NO_FILTERS)

  return (
    <div>
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
        <div
          role="tablist"
          aria-label="Cómo ver la cartelera"
          className="inline-flex shrink-0 rounded-full border border-(--ent-line-strong) bg-(--ent-bg-2) p-1"
        >
          {VIEWS.map((v) => {
            const selected = view === v.value
            return (
              <button
                key={v.value}
                type="button"
                role="tab"
                id={`${baseId}-tab-${v.value}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${v.value}`}
                onClick={() => setView(v.value)}
                className={cn(
                  'ent-press h-10 rounded-full px-5 text-sm font-semibold transition-colors duration-200',
                  selected
                    ? 'bg-(--ent-cream) text-(--ent-ink)'
                    : 'text-(--ent-cream-2) hover:text-(--ent-cream)',
                )}
              >
                {v.label}
              </button>
            )
          })}
        </div>

        {/* En el celular, una fila que se desliza (como los talones), sin
            partirse en dos renglones; en la compu, al lado de las vistas.
            Disponibilidad primero: es el filtro que más se usa. */}
        <fieldset className="-mx-5 flex max-w-[calc(100%+2.5rem)] min-w-0 items-center gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:mx-0 sm:max-w-full sm:flex-wrap sm:overflow-visible sm:px-0">
          <legend className="sr-only">Filtrar la cartelera</legend>
          <FilterPill
            label="Disponibilidad"
            allLabel="Disponibles y agotadas"
            value={filters.availability === 'all' ? null : filters.availability}
            options={AVAILABILITY_OPTIONS}
            onChange={(value) => set({ availability: (value ?? 'all') as AvailabilityFilter })}
          />
          {options.months.length > 1 || filters.month ? (
            <FilterPill
              label="Mes"
              allLabel="Todos los meses"
              value={filters.month}
              options={options.months}
              onChange={(month) => set({ month })}
            />
          ) : null}
          {options.films.length > 1 || filters.film ? (
            <FilterPill
              label="Película"
              allLabel="Todas las películas"
              value={filters.film}
              options={options.films}
              onChange={(film) => set({ film })}
            />
          ) : null}
          {active ? (
            <button
              type="button"
              onClick={clear}
              className="ent-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold whitespace-nowrap text-(--ent-cream-2) hover:text-(--ent-cream)"
            >
              <X className="size-4" aria-hidden />
              Limpiar
            </button>
          ) : null}
        </fieldset>
      </div>

      {/* Cuántas quedan con el filtro: se ve y el lector de pantalla lo dice. */}
      <p
        className={cn('text-sm text-(--ent-muted)', active ? 'mt-3' : 'sr-only')}
        aria-live="polite"
      >
        {active && count > 0
          ? `${count} ${count === 1 ? 'función' : 'funciones'}${onlyAvailable ? ' con lugar' : ''}`
          : null}
      </p>

      {active && visible.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-(--ent-line-strong) px-5 py-10 text-center">
          <p className="ent-display text-2xl text-balance">No hay funciones con esos filtros.</p>
          <button
            type="button"
            onClick={clear}
            className="ent-press mt-5 inline-flex h-11 items-center rounded-full bg-(--ent-cream) px-5 text-sm font-semibold text-(--ent-ink)"
          >
            Ver toda la cartelera
          </button>
        </div>
      ) : (
        <>
          <div
            role="tabpanel"
            id={`${baseId}-panel-films`}
            aria-labelledby={`${baseId}-tab-films`}
            hidden={view !== 'films'}
            className="mt-8"
          >
            <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
              {visible.map((experience, i) => {
                const original = originals.get(experience.id)
                return (
                  // min-w-0: sin esto, la película con más fechas (la fila de
                  // talones no se parte en el celular) ensanchaba la columna y
                  // todo se salía.
                  <Reveal key={experience.id} index={i % 2} className="min-w-0">
                    <FilmCard
                      experience={experience}
                      // El número y el «Se agotaron todas» son de la película
                      // entera, no de lo que dejó ver el filtro.
                      index={original?.i ?? i}
                      soldOut={
                        original
                          ? original.e.functions.length > 0 && allSoldOut(original.e.functions)
                          : undefined
                      }
                      onlyAvailable={onlyAvailable}
                      tenantSlug={tenantSlug}
                      whatsapp={whatsapp}
                      venueName={venueName}
                      priority={i < 2}
                    />
                  </Reveal>
                )
              })}
            </div>
          </div>

          <div
            role="tabpanel"
            id={`${baseId}-panel-dates`}
            aria-labelledby={`${baseId}-tab-dates`}
            hidden={view !== 'dates'}
            className="mt-8 max-w-3xl"
          >
            <AgendaList
              months={agenda}
              tenantSlug={tenantSlug}
              today={today}
              onlyAvailable={onlyAvailable}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Un filtro: una píldora que dice qué está elegido («Mes», o «Noviembre»
 * rellena) con un <select> de verdad encima, invisible. Teclado, lector de
 * pantalla y la rueda del celular salen gratis; la píldora solo se ve.
 */
function FilterPill({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string | null
  options: FilterOption[]
  onChange: (value: string | null) => void
}) {
  const selected = options.find((o) => o.value === value) ?? null
  return (
    <span className="ent-filter shrink-0" data-active={selected ? 'true' : 'false'}>
      <span aria-hidden className="truncate">
        {selected?.label ?? label}
      </span>
      <ChevronDown aria-hidden className="size-4 shrink-0 opacity-70" />
      <select
        aria-label={`Filtrar por ${label.toLowerCase()}`}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}
