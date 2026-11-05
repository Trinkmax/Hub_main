/**
 * Encontrar en la pantalla lo que Tex quiere señalar, por el texto que se lee. No hace falta marcar
 * cada pantalla a mano: si lo ve la persona, Tex lo encuentra.
 */

export function normalizeTexText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Cuánto sirve un texto para lo buscado (mayor es mejor; `null`: no sirve). Puro. */
export function rankTexMatch(
  candidate: string,
  wanted: string,
  opts: { interactive?: boolean } = {},
): number | null {
  const a = normalizeTexText(candidate)
  const b = normalizeTexText(wanted)
  if (!a || !b || a.length > 160) return null
  let score: number
  if (a === b) score = 100
  else if (a.startsWith(b)) score = 70
  else if (a.includes(b)) score = 50
  else return null
  // Más cerca de lo buscado es mejor; un botón gana a un párrafo que lo menciona.
  score -= Math.min(30, (a.length - b.length) / 4)
  if (opts.interactive) score += 15
  return score
}

const TARGET_SELECTOR =
  'button,a,[role="tab"],[role="button"],[role="menuitem"],summary,label,th,td,h1,h2,h3,h4,li,dt,dd'
const INTERACTIVE_SELECTOR = 'button,a,[role="tab"],[role="button"],[role="menuitem"],summary,label'

function isVisible(el: Element): boolean {
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return false
  const style = window.getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
}

/** Lo que mejor coincide con ese texto, en lo que está a la vista de la página (no en Tex). */
export function findTexTarget(wanted: string): HTMLElement | null {
  const root = document.body
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let best: { el: HTMLElement; score: number } | null = null

  const consider = (el: HTMLElement, text: string) => {
    if (el.closest('[data-tex-ui]')) return
    const interactive = el.matches(INTERACTIVE_SELECTOR)
    const score = rankTexMatch(text, wanted, { interactive })
    if (score === null || (best && score <= best.score) || !isVisible(el)) return
    best = { el, score }
  }

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || parent.closest('script,style,noscript')) continue
    const text = node.textContent ?? ''
    if (!text.trim()) continue
    const target = (parent.closest(TARGET_SELECTOR) as HTMLElement | null) ?? parent
    consider(target, target.textContent ?? text)
  }

  // Lo que no tiene texto a la vista: un icono con su nombre, un campo con su placeholder.
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>('[aria-label],[placeholder],[title]'),
  )) {
    const label =
      el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('title')
    if (label) consider(el, label)
  }
  return (best as { el: HTMLElement; score: number } | null)?.el ?? null
}
