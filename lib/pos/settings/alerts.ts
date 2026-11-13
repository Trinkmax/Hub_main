/**
 * Cuándo avisa una mesa — PURO y testeado (`tests/lib/pos-settings-alerts.test.ts`).
 *
 * Según cuánto lleva una mesa en una situación, el mapa del salón primero avisa («miralo»:
 * la mesa suma al pendiente de su sector y sube en la lista) y después la pinta de rojo («ya
 * es tarde»). La base guarda cinco números de minutos; acá se dice qué significa cada uno EN
 * PANTALLA, con la misma cuenta que usa el mapa (`lib/pos/table-state.ts`). Una prueba compara
 * las dos: si cambia la cuenta del mapa y no esta, la prueba falla.
 *
 *   · sin pedido: avisa a los N, roja al doble;
 *   · esperando la comida: los dos tiempos se eligen por separado (roja nunca antes de avisar)
 *     y son los mismos que pintan las tarjetas de la tele de la cocina;
 *   · comida lista: avisa apenas está lista, roja al triple del número guardado;
 *   · pidió la cuenta: avisa a los N, roja al doble.
 */

import type { PosSettings } from './types'

/** Los topes de la base (`pos_settings`), en minutos. */
export const MINUTE_BOUNDS = {
  orderWarnMinutes: { min: 1, max: 120 },
  kitchenWarnMinutes: { min: 1, max: 240 },
  kitchenLateMinutes: { min: 1, max: 240 },
  readyWarnMinutes: { min: 1, max: 60 },
  billWarnMinutes: { min: 1, max: 60 },
} as const

export type MinuteKey = keyof typeof MINUTE_BOUNDS

/** Rojo = el número guardado por esto. Lo mismo que hace el mapa. */
export const ORDER_LATE_FACTOR = 2
export const READY_LATE_FACTOR = 3
export const BILL_LATE_FACTOR = 2

export type AlertId = 'order' | 'kitchen' | 'ready' | 'bill'

export type AlertLine = {
  id: AlertId
  /** Desde qué minuto avisa. 0 = desde el primer momento. */
  warnAt: number
  /** Desde qué minuto está en rojo. */
  lateAt: number
}

type Minutes = Pick<PosSettings, MinuteKey>

/** Las cuatro situaciones, con los minutos en los que cambian de color. */
export function alertLines(settings: Minutes): AlertLine[] {
  return [
    {
      id: 'order',
      warnAt: settings.orderWarnMinutes,
      lateAt: settings.orderWarnMinutes * ORDER_LATE_FACTOR,
    },
    {
      id: 'kitchen',
      warnAt: settings.kitchenWarnMinutes,
      lateAt: Math.max(settings.kitchenWarnMinutes, settings.kitchenLateMinutes),
    },
    { id: 'ready', warnAt: 0, lateAt: settings.readyWarnMinutes * READY_LATE_FACTOR },
    {
      id: 'bill',
      warnAt: settings.billWarnMinutes,
      lateAt: settings.billWarnMinutes * BILL_LATE_FACTOR,
    },
  ]
}

/**
 * Hasta qué minuto llega la regla donde se dibujan las cuatro: la misma para todas, así se
 * comparan de un vistazo. Media hora alcanza casi siempre; si un aviso es más largo, crece.
 */
export function alertScale(lines: ReadonlyArray<AlertLine>): number {
  const latest = Math.max(0, ...lines.map((line) => line.lateAt))
  const padded = Math.ceil((latest * 1.25) / 10) * 10
  return Math.max(30, padded)
}

export const clampMinutes = (key: MinuteKey, value: number): number => {
  const { min, max } = MINUTE_BOUNDS[key]
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Mover uno de los dos tiempos de «esperando la comida». La mesa nunca se pone roja antes de
 * avisar: el tiempo que se mueve arrastra al otro.
 */
export function nudgeKitchen(
  current: Pick<PosSettings, 'kitchenWarnMinutes' | 'kitchenLateMinutes'>,
  which: 'warn' | 'late',
  next: number,
): Pick<PosSettings, 'kitchenWarnMinutes' | 'kitchenLateMinutes'> {
  if (which === 'warn') {
    const warn = clampMinutes('kitchenWarnMinutes', next)
    return {
      kitchenWarnMinutes: warn,
      kitchenLateMinutes: Math.max(warn, current.kitchenLateMinutes),
    }
  }
  const late = clampMinutes('kitchenLateMinutes', next)
  return {
    kitchenWarnMinutes: Math.min(late, current.kitchenWarnMinutes),
    kitchenLateMinutes: late,
  }
}

/** «Comida lista» se elige por cuándo se pone roja: de a tres minutos, como la guarda la base. */
export const READY_STEP = READY_LATE_FACTOR
export const readyLateOf = (readyWarnMinutes: number) => readyWarnMinutes * READY_LATE_FACTOR
export const readyWarnOf = (lateMinutes: number) =>
  clampMinutes('readyWarnMinutes', Math.round(lateMinutes / READY_LATE_FACTOR))
