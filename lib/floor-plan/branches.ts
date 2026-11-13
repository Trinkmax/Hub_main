/**
 * Sucursales y sectores en el editor del plano — PURO y testeado
 * (`tests/lib/floor-plan-branches.test.ts`).
 *
 * Un bar tiene sucursales (`branches`); el mapa, las mesas y sus QR son de cada
 * una. El editor trabaja parado en UNA sucursal: sus sectores, lo que hay en
 * ellos y las mesas sin ubicar de esa sucursal. Con una sola sucursal no hay
 * nada que elegir y el editor se ve como siempre.
 *
 * En pantalla un área es un «sector» (un piso y un sector son lo mismo para el
 * sistema: «Planta alta», «Terraza», «Salón»).
 */

export type PlanBranch = {
  id: string
  name: string
  short_name: string | null
  slug: string
  color: string
  is_default: boolean
}

/** Con una sola sucursal no se muestra el selector. */
export function hasBranchChoice(branches: readonly unknown[]): boolean {
  return branches.length > 1
}

/** El editor parado en una sucursal: la elección viaja en la URL (`?sucursal=<slug>`). */
export function planHref(tenantSlug: string, branchSlug?: string | null): string {
  const base = `/${tenantSlug}/local/mesas`
  return branchSlug ? `${base}?sucursal=${encodeURIComponent(branchSlug)}` : base
}

/**
 * Como compara la base los nombres de sector (`lower(btrim(name))` en el índice
 * único por sucursal): sin espacios a los costados y sin distinguir mayúsculas.
 */
export function normalizeSectorName(name: string): string {
  return name.trim().toLocaleLowerCase('es')
}

/**
 * ¿Ya hay un sector con ese nombre en la sucursal? `sectors` son los de UNA
 * sucursal: dos sucursales pueden tener cada una su «Terraza». `exceptId` deja
 * afuera al sector que se está renombrando.
 */
export function isSectorNameTaken(
  sectors: readonly { id: string; name: string }[],
  name: string,
  exceptId?: string | null,
): boolean {
  const wanted = normalizeSectorName(name)
  if (!wanted) return false
  return sectors.some(
    (sector) => sector.id !== exceptId && normalizeSectorName(sector.name) === wanted,
  )
}

const MAX_NUMBER_START = 100_000

/**
 * Desde qué número conviene numerar las mesas de un sector nuevo: la decena
 * que sigue a la mesa más alta de la sucursal, así dos sectores no repiten
 * número (las reservas y el salón nombran a la mesa por su número).
 * Sin mesas numeradas arranca en 1. Las mesas con nombre («Barra») no cuentan.
 */
export function suggestNumberStart(existingLabels: readonly string[]): number {
  let highest = 0
  for (const label of existingLabels) {
    const clean = label.trim()
    if (!/^\d+$/.test(clean)) continue
    const n = Number(clean)
    if (Number.isSafeInteger(n) && n > highest) highest = n
  }
  if (highest === 0) return 1
  return Math.min(MAX_NUMBER_START, (Math.floor(highest / 10) + 1) * 10)
}

/** Luminancia relativa (WCAG 2.x) de un color `#rrggbb`; `null` si no es un hex válido. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!match) return null
  const channel = (value: string) => {
    const c = Number.parseInt(value, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [, r, g, b] = match
  if (!r || !g || !b) return null
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Hasta qué luminancia el color de una sucursal aguanta texto claro encima.
 *
 * La franja del editor oscurece el color un 14 % (igual que la del salón), lo
 * que baja la luminancia a ~0,64 de la original; el texto claro llega a 4,5:1
 * mientras la franja no pase de 0,183 → el color original, de 0,288. Por encima
 * se usa tinta sobre el color sin oscurecer, que ahí ya supera 4,5:1.
 */
export const LIGHT_INK_MAX_LUMINANCE = 0.288

/**
 * ¿Texto claro u oscuro sobre el color de una sucursal? El color lo elige el
 * dueño, así que puede ser un amarillo: no se asume que es oscuro.
 */
export function inkOn(hex: string): 'light' | 'dark' {
  const luminance = relativeLuminance(hex)
  if (luminance === null) return 'light'
  return luminance <= LIGHT_INK_MAX_LUMINANCE ? 'light' : 'dark'
}
