import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Lector mínimo de los bloques de tokens de `app/globals.css`, para los tests
 * de paridad y de contraste. No es un parser de CSS general: entiende lo que
 * ese archivo usa (comentarios, reglas de primer nivel, `@media` de primer
 * nivel y `@theme inline`) y saltea el resto (`@layer`, `@utility`,
 * `@keyframes`, `@property`). Los selectores y los valores se comparan con los
 * espacios normalizados.
 */

export type TokenRule = {
  /** Selectores de la regla, normalizados («:root», «.theme-light»…). */
  selectors: string[]
  /** El prelude de la `@media` que la envuelve, o `null` si es de primer nivel. */
  media: string | null
  /** `--token` → valor (la última declaración gana, como en el navegador). */
  tokens: Map<string, string>
  /** Posición en el archivo: el orden de los bloques importa (ver globals.css). */
  index: number
}

export const SCOPE = {
  newLight: ':root, .theme-light',
  newDark: '.dark, .theme-dark',
  frozenLight: '.force-light, .legacy-theme',
  frozenDark: ':is(.dark .legacy-theme, .legacy-theme.dark)',
  invariant: ':root, .theme-light, .dark, .theme-dark, .force-light, .legacy-theme',
} as const

export function readGlobalsCss(): string {
  return readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Índice del cierre de la comilla que abre en `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start]
  let i = start + 1
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1
  return i
}

/** Índice de la `}` que cierra la `{` que abre en `start`. */
function matchBrace(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") i = skipString(text, i)
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  throw new Error('globals.css: llave sin cerrar')
}

/** Los bloques `prelude { cuerpo }` de un nivel; las sentencias `…;` se saltean. */
function blocks(text: string): Array<{ prelude: string; body: string }> {
  const out: Array<{ prelude: string; body: string }> = []
  let start = 0
  let parens = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") i = skipString(text, i)
    else if (ch === '(') parens++
    else if (ch === ')') parens--
    else if (ch === ';' && parens === 0) start = i + 1
    else if (ch === '{' && parens === 0) {
      const end = matchBrace(text, i)
      out.push({ prelude: normalize(text.slice(start, i)), body: text.slice(i + 1, end) })
      i = end
      start = end + 1
    }
  }
  return out
}

/** Corta por `separator` sin entrar en paréntesis (`:is(a, b)`, `oklch(…)`). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let parens = 0
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? ''
    if (ch === '(') parens++
    else if (ch === ')') parens--
    if (ch === separator && parens === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts.map(normalize).filter(Boolean)
}

/** Las custom properties de un cuerpo de regla (las reglas anidadas se saltean). */
function customProperties(body: string): Map<string, string> {
  const tokens = new Map<string, string>()
  let flat = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? ''
    if (ch === '{') {
      // Regla anidada: se descarta junto con su prelude.
      i = matchBrace(body, i)
      flat = flat.slice(0, flat.lastIndexOf(';') + 1)
    } else flat += ch
  }
  for (const declaration of splitTopLevel(flat, ';')) {
    const colon = declaration.indexOf(':')
    const name = declaration.slice(0, colon).trim()
    if (colon > 0 && name.startsWith('--'))
      tokens.set(name, normalize(declaration.slice(colon + 1)))
  }
  return tokens
}

/** Las reglas de primer nivel y las de las `@media` de primer nivel, en orden. */
export function parseTokenRules(css: string): TokenRule[] {
  const rules: TokenRule[] = []
  let index = 0
  const push = (prelude: string, body: string, media: string | null) => {
    rules.push({
      selectors: splitTopLevel(prelude, ','),
      media,
      tokens: customProperties(body),
      index: index++,
    })
  }
  for (const block of blocks(stripComments(css))) {
    if (block.prelude.startsWith('@media')) {
      for (const inner of blocks(block.body)) {
        if (!inner.prelude.startsWith('@')) push(inner.prelude, inner.body, block.prelude)
      }
    } else if (!block.prelude.startsWith('@')) {
      push(block.prelude, block.body, null)
    } else {
      index++
    }
  }
  return rules
}

/** Los `--*` del bloque `@theme inline` (lo que se registra en Tailwind). */
export function parseThemeTokens(css: string): Map<string, string> {
  const theme = blocks(stripComments(css)).find((b) => b.prelude === '@theme inline')
  if (!theme) throw new Error('globals.css: falta el bloque @theme inline')
  return customProperties(theme.body)
}

/** Las reglas cuya lista de selectores es exactamente `selectorList`. */
export function rulesFor(
  rules: TokenRule[],
  selectorList: string,
  media: string | null = null,
): TokenRule[] {
  return rules.filter((rule) => rule.selectors.join(', ') === selectorList && rule.media === media)
}

/** Sigue un `var(--x)` suelto hasta el valor literal, dentro del mismo scope. */
export function resolveToken(tokens: Map<string, string>, name: string, depth = 0): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`globals.css: falta ${name}`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
  if (alias === undefined) return value
  if (depth > 8) throw new Error(`globals.css: alias circular en ${name}`)
  return resolveToken(tokens, alias, depth + 1)
}
