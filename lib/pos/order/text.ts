/**
 * Texto para buscar y comparar — PURO.
 *
 * El mozo escribe apurado, con una mano y sin acentos: «cafe», «muzza», «cheese» (y la carta dice
 * «Chesse»). Todo lo que se compara pasa primero por acá.
 */

/** Minúsculas, sin acentos y sin signos: «Café c/ Leche» → «cafe c leche». */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Las palabras de un texto, ya normalizadas. */
export function wordsOf(text: string): string[] {
  const clean = normalize(text)
  return clean ? clean.split(' ') : []
}

/**
 * ¿`a` y `b` son la misma palabra con, a lo sumo, un dedazo? Un dedazo es una letra cambiada, una de
 * más, una de menos o dos vecinas cruzadas («mojtio»).
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false

  if (la === lb) {
    let first = -1
    let diffs = 0
    for (let i = 0; i < la; i++) {
      if (a[i] === b[i]) continue
      diffs++
      if (diffs === 1) first = i
      else if (diffs === 2) {
        // Dos letras distintas solo valen si son vecinas y están cruzadas.
        if (i !== first + 1 || a[first] !== b[i] || a[i] !== b[first]) return false
      } else return false
    }
    return true
  }

  // Una letra de más o de menos: la larga, sin una letra, tiene que dar la corta.
  const long = la > lb ? a : b
  const short = la > lb ? b : a
  let i = 0
  let j = 0
  let skipped = false
  while (i < long.length && j < short.length) {
    if (long[i] === short[j]) {
      i++
      j++
      continue
    }
    if (skipped) return false
    skipped = true
    i++
  }
  return true
}

/**
 * ¿Lo escrito es el comienzo de la palabra, con un dedazo de tolerancia? Solo para lo que ya tiene
 * cuatro letras (con menos, casi todo se parece a todo) y siempre que arranque con la misma letra.
 */
export function nearPrefix(word: string, typed: string): boolean {
  const n = typed.length
  if (n < 4 || word.length < n - 1 || word[0] !== typed[0]) return false
  for (const length of [n, n - 1, n + 1]) {
    if (length > word.length && length !== n) continue
    if (withinOneEdit(word.slice(0, length), typed)) return true
  }
  return false
}
