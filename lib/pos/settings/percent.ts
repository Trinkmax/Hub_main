/**
 * El recargo de crédito, como se escribe y como se lee — PURO y testeado
 * (`tests/lib/pos-settings-percent.test.ts`).
 *
 * La base guarda puntos básicos (1000 = 10 %), que es con lo que hace la cuenta. En pantalla
 * nadie ve un punto básico: se escribe «10» o «12,5» y se lee «10 %».
 */

import { NBSP } from '@/lib/money'

/** El tope de la base (`credit_surcharge_bp between 0 and 5000`): 50 %. */
export const SURCHARGE_MAX_BP = 5000

export type PercentRead =
  | { kind: 'ok'; bp: number }
  /** Vacío no es cero: un campo borrado no cambia nada. */
  | { kind: 'empty' }
  /** No es un número, tiene más de dos decimales o es negativo. */
  | { kind: 'invalid' }
  /** Pasa el tope. */
  | { kind: 'too_high'; maxBp: number }

/**
 * Lee lo que se tipeó en el campo del recargo: «10», «12,5», «12.5», «10 %». Hasta dos
 * decimales (un punto básico es una centésima de punto).
 */
export function readPercent(text: string, maxBp: number = SURCHARGE_MAX_BP): PercentRead {
  // `\s` incluye el espacio duro de «10 %» pegado desde otro lado.
  const clean = text.replace(/[\s%]/g, '').replace(',', '.')
  if (clean === '') return { kind: 'empty' }
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(clean)) return { kind: 'invalid' }
  const [whole = '0', decimals = ''] = clean.split('.')
  const bp = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  if (!Number.isSafeInteger(bp)) return { kind: 'invalid' }
  if (bp > maxBp) return { kind: 'too_high', maxBp }
  return { kind: 'ok', bp }
}

/** Lo que va DENTRO del campo: «10», «12,5», «0». Sin el signo. */
export function percentFieldText(bp: number): string {
  const safe = Number.isFinite(bp) ? Math.max(0, Math.round(bp)) : 0
  const whole = Math.floor(safe / 100)
  const decimals = safe % 100
  if (decimals === 0) return String(whole)
  const text = String(decimals).padStart(2, '0').replace(/0$/, '')
  return `${whole},${text}`
}

/** Como se lee: «10 %», «12,5 %». */
export function formatPercent(bp: number): string {
  return `${percentFieldText(bp)}${NBSP}%`
}
