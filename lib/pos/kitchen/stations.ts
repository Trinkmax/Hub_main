/**
 * Qué estaciones muestra cada pantalla — PURO y testeado.
 *
 * Una sola tele en la cocina: todas. Una segunda en la barra: solo Barra.
 * La elección es una lista de ids; vacía significa «todas» (y es lo que se
 * guarda cuando se eligen todas, así una estación nueva aparece sola).
 */
import type { MenuStation } from '../types'

/** Lee `?estaciones=id,id`. `null` = la dirección no dice nada (se usa lo guardado en el dispositivo). */
export function parseStationParam(value: string | string[] | null | undefined): string[] | null {
  if (value === null || value === undefined) return null
  const raw = Array.isArray(value) ? value.join(',') : value
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return [...new Set(ids)]
}

/** Deja solo estaciones que existen, en el orden de la carta. Todas o ninguna = todas (`[]`). */
export function normalizeStations(
  selected: readonly string[],
  stations: readonly MenuStation[],
): string[] {
  const wanted = new Set(selected)
  const known = stations.filter((station) => wanted.has(station.id)).map((station) => station.id)
  return known.length === 0 || known.length === stations.length ? [] : known
}

/**
 * Tocar una estación. Desde «todas», deja solo esa (un toque para «la tele de la
 * barra»); después suma o saca. Sacar la última vuelve a «todas»: una pantalla
 * de cocina nunca queda sin nada que mostrar.
 */
export function toggleStation(
  selected: readonly string[],
  id: string,
  stations: readonly MenuStation[],
): string[] {
  const current = normalizeStations(selected, stations)
  const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
  return normalizeStations(next, stations)
}

/** El valor para la dirección: `null` cuando son todas (el parámetro se saca). */
export function stationParam(selected: readonly string[]): string | null {
  return selected.length === 0 ? null : selected.join(',')
}

/** «Todas las estaciones», «Barra», «Cocina + Fríos». */
export function stationSummary(
  selected: readonly string[],
  stations: readonly MenuStation[],
): string {
  const current = normalizeStations(selected, stations)
  if (current.length === 0)
    return stations.length === 1 ? (stations[0]?.name ?? 'Cocina') : 'Todas las estaciones'
  const wanted = new Set(current)
  return stations
    .filter((station) => wanted.has(station.id))
    .map((station) => station.name)
    .join(' + ')
}

/** Lo que se le manda a la base al avanzar: las estaciones de esta pantalla, o nada si son todas. */
export function advanceStations(selected: readonly string[]): string[] | undefined {
  return selected.length === 0 ? undefined : [...selected]
}
