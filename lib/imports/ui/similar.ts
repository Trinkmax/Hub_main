/**
 * «¿Lo tenés de antes?»: para un proveedor que llega en un archivo de ARCA con
 * un CUIT que el bar no tiene cargado, qué proveedores YA cargados (sin CUIT)
 * se le parecen por el nombre.
 *
 * Por qué existe: el cruce de la importación va solo por CUIT. Un bar que cargó
 * sus proveedores a mano casi nunca les puso el CUIT, así que el primer archivo
 * los listaba a todos como «nuevos» y crearlos los duplicaba.
 *
 * Es solo una sugerencia: nunca se elige sola. La persona toca «Sí: es {…}» o
 * dice que es otro. Puro (sin React).
 */

/** Guardarle el CUIT a un proveedor ya cargado desde la revisión (la decisión está anotada como duda del dueño). */
export const LINK_KNOWN_SUPPLIERS = true

/** Lo que hace falta de un proveedor del bar para compararlo. */
export type SimilarCandidate = {
  id: string
  name: string
  tradeName?: string | null
  taxId?: string | null
  active?: boolean
  kind?: string
}

export type SimilarMatch = { id: string; label: string; score: number }

/** Las formas societarias y los conectores no dicen quién es: no se comparan. */
const NOISE = new Set([
  'sa',
  'srl',
  'sas',
  'sh',
  'saic',
  'sca',
  'scs',
  'sociedad',
  'anonima',
  'responsabilidad',
  'limitada',
  'simple',
  'hecho',
  'cia',
  'compania',
  'hnos',
  'hermanos',
  'los',
  'las',
  'del',
  'the',
])

/** Desde cuántas letras una palabra cuenta como abreviatura de otra («distrib» de «distribuidora»). */
const PREFIX_MIN = 4
/** Parecido mínimo para ofrecerlo como respuesta. */
export const SIMILAR_MIN_SCORE = 0.5

/**
 * Las palabras que identifican un nombre: sin tildes, sin signos, sin la forma
 * societaria («S.A.», «SRL») y de tres letras o más.
 */
export function nameTokens(name: string): string[] {
  const plain = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // «S.A.», «S.R.L.»: las siglas con puntos se juntan antes de cortar por signos.
    .replace(/\b((?:[a-z]\.){2,})/g, (m) => m.replace(/\./g, ''))
    .replace(/[^a-z0-9]+/g, ' ')
  const out: string[] = []
  for (const word of plain.split(' ')) {
    if (word.length < 3 || NOISE.has(word) || out.includes(word)) continue
    out.push(word)
  }
  return out
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= PREFIX_MIN && long.startsWith(short)
}

/**
 * Cuánto se parecen dos nombres, de 0 a 1: las palabras en común contra el
 * total (coeficiente de Dice). Dos nombres sin palabras comparables dan 0.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0) return 0
  const left = [...tb]
  let shared = 0
  for (const word of ta) {
    const at = left.findIndex((other) => sameWord(word, other))
    if (at >= 0) {
      shared++
      left.splice(at, 1)
    }
  }
  return (2 * shared) / (ta.length + tb.length)
}

/** ¿Se le puede guardar un CUIT? Proveedor activo, sin CUIT. */
export function isLinkable(party: SimilarCandidate): boolean {
  return (
    party.active !== false &&
    (party.kind === undefined || party.kind === 'supplier') &&
    (party.taxId === null || party.taxId === undefined || party.taxId.trim() === '')
  )
}

/**
 * Los proveedores del bar sin CUIT que más se parecen a `name` (el nombre o el
 * nombre de fantasía), del más parecido al menos, hasta `max`.
 */
export function similarParties(
  name: string,
  parties: readonly SimilarCandidate[],
  max = 3,
): SimilarMatch[] {
  if (nameTokens(name).length === 0) return []
  const out: SimilarMatch[] = []
  for (const party of parties) {
    if (!isLinkable(party)) continue
    const trade = party.tradeName?.trim() || null
    const score = Math.max(
      nameSimilarity(name, party.name),
      trade ? nameSimilarity(name, trade) : 0,
    )
    if (score >= SIMILAR_MIN_SCORE) out.push({ id: party.id, label: trade ?? party.name, score })
  }
  return out
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'es'))
    .slice(0, Math.max(0, max))
}
