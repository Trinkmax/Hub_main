/**
 * Cómo se llama una sucursal — PURO y testeado (`tests/lib/pos-branches-naming.test.ts`).
 *
 * El dueño escribe UN nombre («Cerro»). De ahí salen solos el `slug` (lo que va en el link de
 * la tele) y, si el nombre es largo, un nombre corto para la barra del salón.
 */

import { slugify } from '@/lib/tenant/slugify'

/** Los topes de la base (`branches`): nombre 1–60, corto hasta 14, dirección hasta 160, slug hasta 40. */
export const NAME_MAX = 60
export const SHORT_NAME_MAX = 14
export const ADDRESS_MAX = 160
export const SLUG_MAX = 40

/** Hasta acá el nombre entra entero en la barra del salón y no hace falta uno corto. */
const FITS_IN_CHIP = 12

/** Sin espacios a los costados ni dobles en el medio. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Como compara la base los nombres (`lower(btrim(name))` en el índice único por bar): sin
 * espacios a los costados y sin distinguir mayúsculas.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * ¿Ya hay una sucursal con ese nombre? Cuentan también las desactivadas: el nombre es único
 * en todo el bar. `exceptId` deja afuera a la que se está renombrando.
 */
export function isNameTaken(
  branches: ReadonlyArray<{ id: string; name: string }>,
  name: string,
  exceptId?: string | null,
): boolean {
  const wanted = nameKey(name)
  if (!wanted) return false
  return branches.some((branch) => branch.id !== exceptId && nameKey(branch.name) === wanted)
}

const VALID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * El `slug` de una sucursal nueva: el nombre sin acentos ni espacios, y único en el bar (si
 * «cerro» ya está, «cerro-2»). Un nombre del que no sale nada («!!!») queda como «sucursal».
 */
export function branchSlug(name: string, taken: ReadonlyArray<string>): string {
  const used = new Set(taken)
  const clip = (text: string, max: number) => text.slice(0, max).replace(/-+$/, '')
  const base = clip(slugify(name), SLUG_MAX)
  const root = VALID_SLUG.test(base) ? base : 'sucursal'
  if (!used.has(root)) return root
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`
    const candidate = `${clip(root, SLUG_MAX - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${clip(root, SLUG_MAX - 9)}-${Date.now().toString(36).slice(-8)}`
}

/** Palabras que no hacen falta en un nombre corto: «Cerro de las Rosas» → «Cerro Rosas». */
const FILLER = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'en'])

const initial = (word: string) => `${word.charAt(0).toLocaleUpperCase('es')}.`

/**
 * Un nombre corto para la barra del salón, o `null` si el nombre ya entra entero.
 * «Nueva Córdoba Centro» → «N. C. Centro». Siempre hasta 14 letras.
 */
export function suggestShortName(name: string): string | null {
  const clean = cleanText(name)
  if (clean.length <= FITS_IN_CHIP) return null

  const words = clean.split(' ')
  const meaningful = words.filter((word) => !FILLER.has(word.toLocaleLowerCase('es')))
  const parts = meaningful.length > 0 ? meaningful : words
  // Se achican las palabras de adelante hacia atrás; la última es la que más dice.
  for (let shortened = 0; shortened < parts.length; shortened++) {
    const candidate = parts
      .map((word, index) => (index < shortened ? initial(word) : word))
      .join(' ')
    if (candidate.length <= SHORT_NAME_MAX) return candidate
  }
  const last = parts[parts.length - 1] ?? clean
  return last.slice(0, SHORT_NAME_MAX).trim()
}

/** Lo que dice la barra del salón: el nombre corto, o el nombre si no tiene. */
export function chipLabel(branch: { name: string; shortName: string | null }): string {
  return branch.shortName?.trim() || branch.name
}
