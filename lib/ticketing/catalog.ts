import { monthLong } from './dates'
import type { GalleryItem, PublicExperience, PublicFunction } from './types'

/**
 * Lo que la cartelera dice de sí misma: cuántas películas y funciones hay,
 * desde cuánto se reserva, de qué meses es y cómo se llama la colección.
 * Puro, para que la página no haga cuentas y se pueda testear.
 */

export type CatalogSummary = {
  films: number
  functions: number
  soldOut: number
  /** La seña más baja (por persona), si alguna película tiene seña. */
  minDepositCents: number | null
  /** El precio total más bajo (por persona). */
  minPriceCents: number | null
  /** «noviembre», «noviembre y diciembre», «noviembre a enero». */
  monthsLabel: string | null
  /** La colección si todas las películas comparten una («Cine y degustación»). */
  series: string | null
  venuePhotos: GalleryItem[]
}

function monthKey(date: string): string {
  return date.slice(0, 7)
}

export function monthsLabel(dates: string[]): string | null {
  const keys = [...new Set(dates.map(monthKey))].sort()
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (!first || !last) return null
  const name = (key: string) => monthLong(`${key}-01`)
  if (keys.length === 1) return name(first)
  if (keys.length === 2) return `${name(first)} y ${name(last)}`
  return `${name(first)} a ${name(last)}`
}

export function summarizeCatalog(experiences: PublicExperience[]): CatalogSummary {
  const functions: PublicFunction[] = experiences.flatMap((e) => e.functions)
  const deposits = experiences.map((e) => e.depositCents).filter((d) => d > 0)
  const prices = experiences.map((e) => e.priceCents).filter((p) => p > 0)

  const seriesSet = new Set(experiences.map((e) => e.series?.trim() || null))
  const onlySeries = seriesSet.size === 1 ? [...seriesSet][0] : null

  const seen = new Set<string>()
  const venuePhotos: GalleryItem[] = []
  for (const e of experiences) {
    for (const item of e.gallery) {
      if (item.kind !== 'venue' || seen.has(item.url)) continue
      seen.add(item.url)
      venuePhotos.push(item)
    }
  }

  return {
    films: experiences.length,
    functions: functions.length,
    soldOut: functions.filter((f) => f.state === 'sold_out').length,
    minDepositCents: deposits.length > 0 ? Math.min(...deposits) : null,
    minPriceCents: prices.length > 0 ? Math.min(...prices) : null,
    monthsLabel: monthsLabel(functions.map((f) => f.date)),
    series: onlySeries ?? null,
    venuePhotos: venuePhotos.slice(0, 12),
  }
}

/**
 * «Cine y degustación» → ["Cine y", "degustación"]: la última palabra va en
 * otro color. Una sola palabra queda entera en la segunda línea.
 */
export function splitHeadline(text: string): [string, string] {
  const words = text.trim().split(/\s+/)
  if (words.length <= 1) return ['', words[0] ?? '']
  return [words.slice(0, -1).join(' '), words[words.length - 1] ?? '']
}

export type AgendaRow = {
  fn: PublicFunction
  experience: Pick<PublicExperience, 'slug' | 'title' | 'posterUrl' | 'accent' | 'series'>
}

export type AgendaMonth = { key: string; label: string; rows: AgendaRow[] }

/** «Por fecha»: todas las funciones juntas, en orden, agrupadas por mes. */
export function buildAgenda(experiences: PublicExperience[]): AgendaMonth[] {
  const rows: AgendaRow[] = experiences.flatMap((e) =>
    e.functions.map((fn) => ({
      fn,
      experience: {
        slug: e.slug,
        title: e.title,
        posterUrl: e.posterUrl,
        accent: e.accent,
        series: e.series,
      },
    })),
  )
  rows.sort((a, b) =>
    `${a.fn.date} ${a.fn.time} ${a.experience.title}`.localeCompare(
      `${b.fn.date} ${b.fn.time} ${b.experience.title}`,
    ),
  )
  const months: AgendaMonth[] = []
  for (const row of rows) {
    const key = monthKey(row.fn.date)
    let month = months[months.length - 1]
    if (!month || month.key !== key) {
      const name = monthLong(row.fn.date)
      month = {
        key,
        label: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${key.slice(0, 4)}`,
        rows: [],
      }
      months.push(month)
    }
    month.rows.push(row)
  }
  return months
}

/** «7 pasos» / «6 pasos + postre»: lo que trae el menú, en una línea. */
export function stepsSummary(steps: PublicExperience['steps']): string | null {
  if (steps.length === 0) return null
  const last = steps[steps.length - 1]
  const dessert = last?.label ? /postre/i.test(last.label) : false
  if (dessert && steps.length > 1) {
    const n = steps.length - 1
    return `${n} ${n === 1 ? 'paso' : 'pasos'} + postre`
  }
  return `${steps.length} ${steps.length === 1 ? 'paso' : 'pasos'}`
}

// ──────────────────────────────────────────────
// Los filtros de la cartelera
// ──────────────────────────────────────────────
// Pedido de los socios (27/10/2026): filtrar por mes, por película y por
// disponibilidad, para que quien quiere ver qué queda no tenga que mirar
// todas las agotadas. Viven en la URL (?mes=2026-11&pelicula=shrek-2&ver=
// disponibles): así un link puede llegar ya filtrado.

/** Qué fechas se ven: todas, solo las que tienen lugar o solo las agotadas. */
export type AvailabilityFilter = 'all' | 'available' | 'sold_out'

export type CatalogFilters = {
  /** «2026-11», o null = todos los meses. */
  month: string | null
  /** El slug de la película, o null = todas. */
  film: string | null
  availability: AvailabilityFilter
}

export const NO_FILTERS: CatalogFilters = { month: null, film: null, availability: 'all' }

export type FilterOption = { value: string; label: string }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/

const AVAILABILITY_PARAM = { available: 'disponibles', sold_out: 'agotadas' } as const

/** Los parámetros de la URL → filtros. Lo que no se entiende se ignora. */
export function parseCatalogFilters(params: {
  mes?: string | string[]
  pelicula?: string | string[]
  ver?: string | string[]
}): CatalogFilters {
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null)
  const month = one(params.mes)
  const film = one(params.pelicula)
  const ver = one(params.ver)
  return {
    month: month && MONTH_RE.test(month) ? month : null,
    film: film && SLUG_RE.test(film) ? film : null,
    availability:
      ver === AVAILABILITY_PARAM.available
        ? 'available'
        : ver === AVAILABILITY_PARAM.sold_out
          ? 'sold_out'
          : 'all',
  }
}

/** Filtros → «?mes=2026-11&ver=disponibles» (vacío sin filtros). */
export function catalogFiltersQuery(filters: CatalogFilters): string {
  const qs = new URLSearchParams()
  if (filters.month) qs.set('mes', filters.month)
  if (filters.film) qs.set('pelicula', filters.film)
  if (filters.availability !== 'all') qs.set('ver', AVAILABILITY_PARAM[filters.availability])
  const out = qs.toString()
  return out ? `?${out}` : ''
}

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return filters.month !== null || filters.film !== null || filters.availability !== 'all'
}

/**
 * Las opciones de cada filtro, sacadas de la cartelera: los meses que tienen
 * funciones («Octubre», «Noviembre»; con el año si cruza de año) y las
 * películas en el orden en que se muestran.
 */
export function catalogFilterOptions(experiences: PublicExperience[]): {
  months: FilterOption[]
  films: FilterOption[]
} {
  const keys = [
    ...new Set(experiences.flatMap((e) => e.functions.map((f) => monthKey(f.date)))),
  ].sort()
  const years = new Set(keys.map((k) => k.slice(0, 4)))
  const months = keys.map((key) => {
    const name = monthLong(`${key}-01`)
    const label = `${name.charAt(0).toUpperCase()}${name.slice(1)}`
    return { value: key, label: years.size > 1 ? `${label} ${key.slice(0, 4)}` : label }
  })
  const films = experiences.map((e) => ({ value: e.slug, label: e.title }))
  return { months, films }
}

/**
 * Un filtro que no está entre las opciones (un link viejo con un mes que ya
 * pasó, una película que se despublicó) se ignora: mejor la cartelera entera
 * que una vacía sin explicación.
 */
export function sanitizeCatalogFilters(
  filters: CatalogFilters,
  options: { months: FilterOption[]; films: FilterOption[] },
): CatalogFilters {
  return {
    month:
      filters.month && options.months.some((o) => o.value === filters.month) ? filters.month : null,
    film: filters.film && options.films.some((o) => o.value === filters.film) ? filters.film : null,
    availability: filters.availability,
  }
}

function functionMatches(fn: PublicFunction, filters: CatalogFilters): boolean {
  if (filters.month && monthKey(fn.date) !== filters.month) return false
  if (filters.availability === 'available' && fn.state === 'sold_out') return false
  if (filters.availability === 'sold_out' && fn.state !== 'sold_out') return false
  return true
}

/**
 * La cartelera filtrada: cada película con las funciones que pasan el filtro.
 * Con mes o disponibilidad, una película sin ninguna función que pase no se
 * muestra (con «Disponibles», Ratatouille agotada desaparece entera).
 */
export function filterCatalog(
  experiences: PublicExperience[],
  filters: CatalogFilters,
): PublicExperience[] {
  const byFunction = filters.month !== null || filters.availability !== 'all'
  const out: PublicExperience[] = []
  for (const e of experiences) {
    if (filters.film && e.slug !== filters.film) continue
    if (!byFunction) {
      out.push(e)
      continue
    }
    const functions = e.functions.filter((fn) => functionMatches(fn, filters))
    if (functions.length > 0) out.push({ ...e, functions })
  }
  return out
}

/**
 * El link a la página de una película. Con «Disponibles» elegido, la película
 * también esconde las fechas agotadas (?ver=disponibles): quien filtró no
 * quiere volver a verlas al pagar.
 */
export function filmHref(
  tenantSlug: string,
  slug: string,
  opts: { date?: string; onlyAvailable?: boolean } = {},
): string {
  const qs = new URLSearchParams()
  if (opts.date) qs.set('fecha', opts.date)
  if (opts.onlyAvailable) qs.set('ver', AVAILABILITY_PARAM.available)
  const query = qs.toString()
  return `/entradas/${tenantSlug}/${slug}${query ? `?${query}` : ''}`
}
