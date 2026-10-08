/**
 * Patrones seguros para las reglas del bar (fase1-estado §5.2, riesgo «regex de
 * las reglas del banco»).
 *
 * Una regla guardada en `acc_import_rules` trae un patrón que escribió una
 * persona. Correrlo como `RegExp` en el servidor es un riesgo: un patrón
 * catastrófico (`(a+)+$`) cuelga el hilo de la función. Por eso en el servidor
 * NUNCA se arma un `RegExp` con el patrón del bar: se lo compila a este
 * subconjunto, que se evalúa en tiempo lineal sin vuelta atrás, y lo que no
 * entra en el subconjunto no se evalúa (la regla se saltea y se informa).
 *
 * El subconjunto (mayúsculas y tildes no importan; la descripción ya viene
 * normalizada: sin tildes, en mayúsculas y con los espacios colapsados):
 * - letras, números, espacios y signos sueltos (`,`, `:`, `-`, `/`…);
 * - `.*` = «cualquier cosa» (también nada);
 * - `.` = un carácter cualquiera; `\d` = un dígito; `\s` y `\s+` = un espacio;
 * - `\` + un signo = ese signo literal (`\.`, `\(`, `\*`…);
 * - `^` al principio y `$` al final de cada alternativa;
 * - `|` entre alternativas (hasta 8), sin paréntesis.
 *
 * Es exactamente lo que arma «Crear regla» (`suggestRulePattern`:
 * `TRANSF\..*A.*FAC`). Cuantificadores (`+`, `?`, `{n}`), clases (`[…]`) y
 * grupos quedan afuera: `saveImportRule` los rechaza con un texto claro.
 *
 * Puro: corre igual en el navegador (vista previa) y en el servidor.
 */

/** Un carácter del patrón: literal, cualquiera, dígito o espacio. */
type Atom =
  | { readonly kind: 'char'; readonly ch: string }
  | { readonly kind: 'any' }
  | { readonly kind: 'digit' }
  | { readonly kind: 'space' }

/** Una alternativa: tramos de largo fijo separados por «cualquier cosa». */
type Alternative = {
  readonly anchoredStart: boolean
  readonly anchoredEnd: boolean
  readonly segments: readonly (readonly Atom[])[]
}

export type SafePattern = {
  /** El patrón tal cual se guardó (para mostrarlo). */
  readonly source: string
  readonly alternatives: readonly Alternative[]
}

/** Tope de alternativas (`A|B|C…`). */
export const SAFE_PATTERN_MAX_ALTERNATIVES = 8
/** Tope del patrón guardado (`airu_pattern`). */
export const SAFE_PATTERN_MAX_LENGTH = 200

/** El texto que se le explica a la persona cuando el patrón no entra. */
export const SAFE_PATTERN_HELP =
  'Usá letras, números y espacios; «.*» quiere decir «cualquier cosa» y «|» separa opciones. Sin paréntesis ni corchetes.'

/**
 * Mayúsculas, sin tildes y con los espacios colapsados: la misma forma que
 * `normalizeBankDescription` (los patrones se comparan contra esa forma).
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PUNCT_ESCAPABLE = new Set([
  '.',
  '*',
  '+',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '\\',
  '/',
  '-',
  '^',
  '$',
  ',',
  ':',
  ';',
  '#',
  '&',
  '_',
  '=',
  '"',
  "'",
  '%',
  '@',
  '!',
  '<',
  '>',
  '~',
])

/** Sin escapar no se aceptan (son de expresiones regulares que no entran en el subconjunto). */
const UNSUPPORTED_BARE = new Set(['(', ')', '[', ']', '{', '}', '+', '?', '*'])

function literal(ch: string): Atom[] {
  // Un literal pasa por la misma normalización que la descripción (puede dar
  // más de un carácter, por ejemplo «ß» → «SS»).
  // Una marca suelta (una tilde combinable) desaparece igual que en la descripción.
  const norm = normalizeForMatch(ch)
  return [...norm].map((c) => (c === ' ' ? ({ kind: 'space' } as const) : { kind: 'char', ch: c }))
}

function compileAlternative(raw: string): Alternative | null {
  let text = raw
  let anchoredStart = false
  let anchoredEnd = false
  if (text.startsWith('^')) {
    anchoredStart = true
    text = text.slice(1)
  }
  // Un `$` final sin escapar (contando las barras de antes) es el ancla.
  if (text.endsWith('$')) {
    let slashes = 0
    for (let i = text.length - 2; i >= 0 && text[i] === '\\'; i--) slashes++
    if (slashes % 2 === 0) {
      anchoredEnd = true
      text = text.slice(0, -1)
    }
  }

  const segments: Atom[][] = [[]]
  const current = (): Atom[] => segments[segments.length - 1] as Atom[]
  const pushSpace = () => {
    const seg = current()
    // Los espacios repetidos no existen en la descripción normalizada.
    if (seg.length > 0 && seg[seg.length - 1]?.kind === 'space') return
    seg.push({ kind: 'space' })
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (ch === '.') {
      if (text[i + 1] === '*') {
        i++
        if (current().length > 0 || segments.length === 1) segments.push([])
        continue
      }
      current().push({ kind: 'any' })
      continue
    }
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === undefined) return null
      i++
      if (next === 'd') {
        current().push({ kind: 'digit' })
        continue
      }
      if (next === 's') {
        if (text[i + 1] === '+') i++
        else if (text[i + 1] === '*' || text[i + 1] === '?') return null
        pushSpace()
        continue
      }
      if (PUNCT_ESCAPABLE.has(next)) {
        current().push({ kind: 'char', ch: next })
        continue
      }
      return null
    }
    if (ch === '^' || ch === '$' || ch === '|') return null
    if (UNSUPPORTED_BARE.has(ch)) return null
    if (/\s/.test(ch)) {
      pushSpace()
      continue
    }
    for (const atom of literal(ch)) {
      if (atom.kind === 'space') pushSpace()
      else current().push(atom)
    }
  }
  return { anchoredStart, anchoredEnd, segments }
}

/** Parte por `|` sin escapar. */
function splitAlternatives(pattern: string): string[] | null {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++
      continue
    }
    if (pattern[i] === '|') {
      out.push(pattern.slice(start, i))
      start = i + 1
    }
  }
  out.push(pattern.slice(start))
  return out.length > SAFE_PATTERN_MAX_ALTERNATIVES ? null : out
}

/**
 * Compila un patrón guardado al subconjunto seguro; `null` si no entra (o si es
 * vacío). Nunca tira.
 */
export function compileSafePattern(pattern: string): SafePattern | null {
  if (typeof pattern !== 'string') return null
  const trimmed = pattern.trim()
  if (trimmed === '' || trimmed.length > SAFE_PATTERN_MAX_LENGTH) return null
  const parts = splitAlternatives(trimmed)
  if (!parts) return null
  const alternatives: Alternative[] = []
  for (const part of parts) {
    if (part.trim() === '') return null
    const alt = compileAlternative(part.trim())
    if (!alt) return null
    alternatives.push(alt)
  }
  return { source: trimmed, alternatives }
}

/** ¿El patrón entra en el subconjunto seguro? */
export function isSafePattern(pattern: string): boolean {
  return compileSafePattern(pattern) !== null
}

function atomMatches(atom: Atom, c: string): boolean {
  switch (atom.kind) {
    case 'char':
      return atom.ch === c
    case 'any':
      return true
    case 'digit':
      return c >= '0' && c <= '9'
    case 'space':
      return c === ' '
  }
}

function matchesAt(text: string, at: number, segment: readonly Atom[]): boolean {
  if (at < 0 || at + segment.length > text.length) return false
  for (let j = 0; j < segment.length; j++) {
    if (!atomMatches(segment[j] as Atom, text[at + j] as string)) return false
  }
  return true
}

/** La primera posición ≥ `from` donde calza el tramo, o −1. O(n·m). */
function findFrom(text: string, from: number, segment: readonly Atom[]): number {
  for (let at = from; at + segment.length <= text.length; at++) {
    if (matchesAt(text, at, segment)) return at
  }
  return -1
}

function alternativeMatches(alt: Alternative, text: string): boolean {
  const segs = alt.segments
  const last = segs.length - 1
  let pos = 0
  for (let i = 0; i <= last; i++) {
    const seg = segs[i] as readonly Atom[]
    const isFirst = i === 0
    const isLast = i === last
    if (isFirst && alt.anchoredStart) {
      if (isLast && alt.anchoredEnd) return seg.length === text.length && matchesAt(text, 0, seg)
      if (!matchesAt(text, 0, seg)) return false
      pos = seg.length
      continue
    }
    if (isLast && alt.anchoredEnd) {
      const at = text.length - seg.length
      return at >= pos && matchesAt(text, at, seg)
    }
    const at = findFrom(text, pos, seg)
    if (at < 0) return false
    pos = at + seg.length
  }
  return true
}

/**
 * ¿Calza el patrón en el texto? El texto se normaliza (mayúsculas, sin tildes,
 * espacios colapsados). Tiempo lineal en el largo del patrón por el del texto.
 */
export function safePatternTest(pattern: SafePattern, text: string): boolean {
  const normalized = normalizeForMatch(text)
  return pattern.alternatives.some((alt) => alternativeMatches(alt, normalized))
}
