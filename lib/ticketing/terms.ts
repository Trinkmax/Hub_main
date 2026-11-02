/**
 * Las condiciones de una película partidas en su primera frase y el resto: en
 * la entrada de la compu no entran enteras junto al precio, así que se ve la
 * primera («Importante: las señas no tienen devolución.») y el resto se
 * despliega. Sin punto ni salto de línea, todo es la primera frase.
 */
export function splitTerms(terms: string): { first: string; rest: string } {
  const text = terms.trim()
  const newline = text.indexOf('\n')
  // El primer punto seguido de un espacio o un salto (no el de «3.000»).
  const dot = text.search(/\.(\s|$)/)
  const cuts = [newline, dot >= 0 ? dot + 1 : -1].filter((i) => i > 0)
  if (cuts.length === 0) return { first: text, rest: '' }
  const at = Math.min(...cuts)
  return { first: text.slice(0, at).trim(), rest: text.slice(at).trim() }
}
