/**
 * Qué dice cada color del salón, y a los cuántos minutos cambia — PURO y testeado
 * (`tests/lib/pos-floor-legend.test.ts`).
 *
 * Pedido de los socios (22/11/2026): «¿Cuáles son los tiempos de las demoras? (para revisar colores)».
 * El mapa lo sabía pero no lo decía en ningún lado. Sale de los mismos números que usa el mapa
 * (`lib/pos/table-state.ts`): una prueba compara los dos, así la leyenda nunca miente.
 */
import { RESERVATION_HOLD_BEFORE_MIN, STATE_LABEL, type TableStateKey } from '../table-state'
import { DEFAULT_THRESHOLDS, type PosThresholds } from '../types'

/** Cuánto pasa de la hora de una reserva antes de que la mesa avise (igual que `deriveFreeState`). */
export const RESERVATION_WARN_AFTER_MIN = 15

export type LegendRow = {
  key: TableStateKey | 'late'
  label: string
  /** Qué le pasa a la mesa, en una oración. */
  meaning: string
  /** Desde qué minuto avisa (borde amarillo). `0` = enseguida, `null` = no avisa. */
  warnAt: number | null
  /** Desde qué minuto se pone roja. `null` = nunca. */
  lateAt: number | null
}

/** Los minutos de cada estado, con la misma cuenta que el mapa. */
export function stateTimings(thresholds: PosThresholds | null): Record<
  'seated' | 'kitchen' | 'ready' | 'bill',
  {
    warnAt: number
    lateAt: number
  }
> {
  const t = thresholds ?? DEFAULT_THRESHOLDS
  return {
    seated: { warnAt: t.order_warn_minutes, lateAt: t.order_warn_minutes * 2 },
    kitchen: {
      warnAt: Math.min(t.kitchen_warn_minutes, t.kitchen_late_minutes),
      lateAt: t.kitchen_late_minutes,
    },
    ready: { warnAt: 0, lateAt: t.ready_warn_minutes * 3 },
    bill: { warnAt: t.bill_warn_minutes, lateAt: t.bill_warn_minutes * 2 },
  }
}

export function floorLegend(thresholds: PosThresholds | null): LegendRow[] {
  const timing = stateTimings(thresholds)
  return [
    {
      key: 'free',
      label: STATE_LABEL.free,
      meaning: 'Nadie sentado. Se toca para abrirla.',
      warnAt: null,
      lateAt: null,
    },
    {
      key: 'reserved',
      label: STATE_LABEL.reserved,
      meaning: `La espera una reserva: queda tomada desde ${RESERVATION_HOLD_BEFORE_MIN} min antes de la hora.`,
      warnAt: RESERVATION_WARN_AFTER_MIN,
      lateAt: null,
    },
    {
      key: 'seated',
      label: STATE_LABEL.seated,
      meaning: 'Se sentaron y todavía nadie les tomó el pedido.',
      ...timing.seated,
    },
    {
      key: 'kitchen',
      label: STATE_LABEL.kitchen,
      meaning: 'El pedido está en la cocina.',
      ...timing.kitchen,
    },
    {
      key: 'ready',
      label: STATE_LABEL.ready,
      meaning: 'Ya salió de la cocina: hay que llevarlo a la mesa.',
      ...timing.ready,
    },
    {
      key: 'eating',
      label: STATE_LABEL.eating,
      meaning: 'Tienen todo lo que pidieron.',
      warnAt: null,
      lateAt: null,
    },
    {
      key: 'bill',
      label: STATE_LABEL.bill,
      meaning: 'Pidieron la cuenta y esperan para pagar.',
      ...timing.bill,
    },
    {
      key: 'late',
      label: 'Demorada',
      meaning: 'Se le pasó el tiempo: es la que hay que mirar primero.',
      warnAt: null,
      lateAt: null,
    },
  ]
}

/** «Avisa a los 6 min · roja a los 12», como se lee en la leyenda. */
export function timingWords(row: Pick<LegendRow, 'key' | 'warnAt' | 'lateAt'>): string | null {
  if (row.key === 'reserved') {
    return `Avisa si llegaron y nadie los sentó, o a los ${row.warnAt ?? RESERVATION_WARN_AFTER_MIN} min de pasada la hora`
  }
  if (row.lateAt === null) return null
  const warn =
    row.warnAt === null
      ? null
      : row.warnAt === 0
        ? 'Avisa enseguida'
        : row.warnAt >= row.lateAt
          ? null
          : `Avisa a los ${row.warnAt} min`
  const late = `roja a los ${row.lateAt} min`
  return warn ? `${warn} · ${late}` : `Se pone ${late}`
}
