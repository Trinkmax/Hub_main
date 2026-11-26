/**
 * Qué estaciones muestra cada pantalla, en la dirección — PURO y testeado.
 *
 * `?estaciones=id,id`: la primera es la grande. Sin el parámetro son todas (el pase), y es lo que se
 * guarda cuando se eligen todas, así una estación nueva aparece sola. Qué se hace con esa lista lo
 * decide `board.ts` (`viewStations`, `normalizeView`).
 */

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

/** El valor para la dirección: `null` cuando son todas (el parámetro se saca). */
export function stationParam(selected: readonly string[]): string | null {
  return selected.length === 0 ? null : selected.join(',')
}
