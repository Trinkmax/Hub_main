/**
 * El reloj de cada comanda — PURO y testeado.
 *
 * Cuenta desde que la tanda salió a cocina. A los minutos de `pos_settings`
 * pasa a «miralo» (ámbar) y después a «demorada» (rojo).
 */
import { DEFAULT_THRESHOLDS, type KitchenQueue } from '../types'

/** ok = en tiempo · warn = miralo · late = demorada. */
export type AgeLevel = 'ok' | 'warn' | 'late'

export const AGE_WORD: Record<AgeLevel, string | null> = {
  ok: null,
  warn: 'Atención',
  late: 'Demorada',
}

/** Minutos enteros transcurridos. Nunca negativo: un reloj corrido no muestra «-1 min». */
export function elapsedMinutes(fromMs: number, nowMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return 0
  return Math.max(0, Math.floor((nowMs - fromMs) / 60_000))
}

export function kitchenThresholds(settings: KitchenQueue['settings']): {
  warn: number
  late: number
} {
  const warn = positive(settings?.kitchen_warn_minutes) ?? DEFAULT_THRESHOLDS.kitchen_warn_minutes
  const late = positive(settings?.kitchen_late_minutes) ?? DEFAULT_THRESHOLDS.kitchen_late_minutes
  // Si alguien configuró «demorada» antes que «miralo», manda el aviso más temprano.
  return { warn: Math.min(warn, late), late: Math.max(warn, late) }
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function ageLevel(minutes: number, settings: KitchenQueue['settings']): AgeLevel {
  const { warn, late } = kitchenThresholds(settings)
  if (minutes >= late) return 'late'
  if (minutes >= warn) return 'warn'
  return 'ok'
}

/** «7 min» hasta la hora; después «1 h 05». Se devuelve en dos partes porque el número va más grande. */
export function formatElapsed(minutes: number): { value: string; unit: string } {
  const whole = Math.max(0, Math.floor(minutes))
  if (whole < 60) return { value: String(whole), unit: 'min' }
  const hours = Math.floor(whole / 60)
  return { value: `${hours} h ${String(whole % 60).padStart(2, '0')}`, unit: '' }
}

/** Para leer en voz alta o en una frase: «7 min», «1 h 05». */
export function elapsedText(minutes: number): string {
  const { value, unit } = formatElapsed(minutes)
  return unit ? `${value} ${unit}` : value
}
