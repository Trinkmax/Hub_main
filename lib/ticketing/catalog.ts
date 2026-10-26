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
