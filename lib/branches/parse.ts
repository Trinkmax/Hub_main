import type { BranchRef } from './types'

/**
 * La clave `branches` de `get_tenant_access` (la arma `my_branches` en la base) → `BranchRef[]`.
 *
 * Falla cerrado: lo que no tiene id, nombre o slug no entra; un color raro cae al verde del bar. Si la clave falta
 * (el código puede salir antes que la migración) devuelve `[]` y el sistema se comporta como un bar de una sola
 * sucursal: sin selector y sin filtros.
 */

const HEX = /^#[0-9a-f]{6}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const FALLBACK_COLOR = '#2f5d50'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function parseBranchRef(raw: unknown): BranchRef | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const name = text(raw.name)
  const slug = text(raw.slug)
  if (!id || !name || !slug) return null
  const color =
    typeof raw.color === 'string' && HEX.test(raw.color) ? raw.color.toLowerCase() : FALLBACK_COLOR
  const position =
    typeof raw.position === 'number' && Number.isFinite(raw.position) ? raw.position : 0
  const seats =
    typeof raw.seat_capacity === 'number' &&
    Number.isInteger(raw.seat_capacity) &&
    raw.seat_capacity > 0
      ? raw.seat_capacity
      : null
  const openedOn =
    typeof raw.opened_on === 'string' && DATE.test(raw.opened_on) ? raw.opened_on : null
  return {
    id,
    name,
    shortName: text(raw.short_name),
    slug,
    color,
    address: text(raw.address),
    position,
    isDefault: raw.is_default === true,
    openedOn,
    seatCapacity: seats,
  }
}

/** La lista entera, sin repetidos, la principal primero y después el orden de Sucursales. */
export function parseBranchRefs(raw: unknown): BranchRef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: BranchRef[] = []
  for (const item of raw) {
    const branch = parseBranchRef(item)
    if (!branch || seen.has(branch.id)) continue
    seen.add(branch.id)
    out.push(branch)
  }
  return out.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.position - b.position ||
      a.name.localeCompare(b.name, 'es'),
  )
}
