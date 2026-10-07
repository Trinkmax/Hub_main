/**
 * Porcentajes de Administración (comisiones, retenciones, % computable):
 * la gente escribe «1,5» y la base guarda puntos básicos (150). Puro.
 *
 * Nunca `Math.round(x * 100)` sobre el binario: `scaledInt` redondea sobre la
 * representación decimal («1,15» → 115, no 114).
 */

import { NBSP, parseLocaleNumber, scaledInt } from '@/lib/money'

export type PercentParse = { ok: true; bp: number | null } | { ok: false; message: string }

/** 150 → «1,5» · 1250 → «12,5» · 105 → «1,05» · 3300 → «33». Vacío si no hay dato. */
export function bpToPercentInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return ''
  const n = Math.trunc(Math.abs(bp))
  const int = Math.floor(n / 100)
  const frac = n % 100
  if (frac === 0) return String(int)
  return frac % 10 === 0 ? `${int},${frac / 10}` : `${int},${String(frac).padStart(2, '0')}`
}

/** 150 → «1,5 %». «—» si no hay dato. */
export function formatBp(bp: number | null | undefined): string {
  const text = bpToPercentInput(bp)
  return text === '' ? '—' : `${text}${NBSP}%`
}

/**
 * «1,5» · «1.5» · «1,5 %» → 150. Vacío → `null` (no es cero). Hasta dos
 * decimales; más que eso no se puede guardar y se avisa.
 */
export function parsePercentToBp(raw: string, opts: { max?: number } = {}): PercentParse {
  const max = opts.max ?? 10_000
  const text = raw.trim().replace(/%$/, '').trim()
  if (text === '') return { ok: true, bp: null }
  const parsed = parseLocaleNumber(text, 'rate')
  if (!parsed.ok) {
    return {
      ok: false,
      message:
        parsed.reason === 'negativo'
          ? 'El porcentaje va sin signo menos.'
          : 'Escribí un porcentaje, por ejemplo 1,5.',
    }
  }
  const bp = scaledInt(parsed.value, 2)
  if (Math.abs(parsed.value * 100 - bp) > 1e-6) {
    return { ok: false, message: 'Usá hasta dos decimales (por ejemplo 1,25).' }
  }
  if (bp > max) {
    return { ok: false, message: `El porcentaje va de 0 a ${bpToPercentInput(max)}.` }
  }
  return { ok: true, bp }
}
