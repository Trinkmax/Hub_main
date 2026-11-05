/**
 * Buscar un cliente como lo escribe la gente: «Juan Pérez», «Perez, Juan», «351 555-1234», «Juan …1234». Puro: lo usan la
 * pantalla de Clientes y Tex.
 */

/** Sin acentos ni mayúsculas: como lo escribe la gente. */
export function nameKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const NAME_VARIANTS: Readonly<Record<string, string>> = {
  a: '[aáàâäã]',
  e: '[eéèêë]',
  i: '[iíìîï]',
  o: '[oóòôöõ]',
  u: '[uúùûü]',
  n: '[nñ]',
  c: '[cç]',
}

const MAX_NAME_TOKENS = 6
/** Lo que distingue a un teléfono entre los de un bar: tapa el 0, el 15, el 54 y el 9. */
const PHONE_MATCH_DIGITS = 7

export type CustomerQuery = {
  /** Las palabras del nombre, sin acentos y sin nada que PostgREST interprete. */
  names: string[]
  /** Los números a buscar en el teléfono. */
  phone: string | null
}

/** «Juan Pérez», «Pérez, Juan», «351 555-1234», «Juan …1234». */
export function parseCustomerQuery(raw: string): CustomerQuery {
  const names: string[] = []
  let digits = ''
  for (const part of raw.replace(/…/g, ' ').split(/[\s,;]+/)) {
    if (/\d/.test(part) && /^[\d+().-]+$/.test(part)) {
      digits += part.replace(/\D/g, '')
      continue
    }
    const clean = nameKey(part).replace(/[^\p{L}\d'’-]/gu, '')
    if (clean && names.length < MAX_NAME_TOKENS) names.push(clean)
  }
  const phone =
    digits.length >= 8 ? digits.slice(-PHONE_MATCH_DIGITS) : digits.length >= 3 ? digits : null
  return { names, phone }
}

/**
 * El filtro de una palabra del nombre. `ilike` distingue acentos y la gente escribe «Perez» por «Pérez»:
 * va como expresión regular con cada vocal en sus variantes. La palabra ya pasó por `parseCustomerQuery`,
 * así que no trae nada que sea sintaxis de PostgREST ni de la expresión.
 */
export function nameFilter(token: string): string {
  const pattern = [...token].map((char) => NAME_VARIANTS[char] ?? char).join('')
  return `first_name.imatch."${pattern}",last_name.imatch."${pattern}"`
}
