// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ageLevel } from '@/lib/pos/kitchen/age'
import {
  alertLines,
  alertScale,
  clampMinutes,
  MINUTE_BOUNDS,
  nudgeKitchen,
  readyLateOf,
  readyWarnOf,
} from '@/lib/pos/settings/alerts'
import { DEFAULT_POS_SETTINGS, type PosSettings } from '@/lib/pos/settings/types'
import { deriveSessionState, type Urgency } from '@/lib/pos/table-state'
import { DEFAULT_THRESHOLDS, type FloorSession, type PosThresholds } from '@/lib/pos/types'

/**
 * Lo que la pantalla de ajustes DICE que va a pasar tiene que ser lo que el mapa del salón
 * HACE. Acá se comparan las dos cuentas: la de `lib/pos/settings/alerts.ts` (lo que se le
 * muestra al dueño) y la de `lib/pos/table-state.ts` (lo que pinta el mapa).
 */

const NOW = Date.parse('2026-11-14T01:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const session = (over: Partial<FloorSession>): FloorSession => ({
  id: 's',
  table_id: 't',
  opened_at: ago(0),
  party_size: 2,
  alias: null,
  reservation_id: null,
  bill_requested_at: null,
  total_cents: 0,
  is_practice: false,
  kind: 'table',
  customer: null,
  held_tickets: 0,
  items_queued: 0,
  items_preparing: 0,
  items_ready: 0,
  items_served: 0,
  waiting_since: null,
  ready_since: null,
  last_served_at: null,
  first_order_at: null,
  ...over,
})

const thresholds = (settings: PosSettings): PosThresholds => ({
  order_warn_minutes: settings.orderWarnMinutes,
  kitchen_warn_minutes: settings.kitchenWarnMinutes,
  kitchen_late_minutes: settings.kitchenLateMinutes,
  ready_warn_minutes: settings.readyWarnMinutes,
  bill_warn_minutes: settings.billWarnMinutes,
})

/** Cómo ve el mapa a una mesa que lleva `minutes` en cada situación. */
const onTheMap = {
  order: (minutes: number, t: PosThresholds): Urgency =>
    deriveSessionState(session({ opened_at: ago(minutes) }), NOW, t).urgency,
  kitchen: (minutes: number, t: PosThresholds): Urgency =>
    deriveSessionState(session({ items_queued: 1, waiting_since: ago(minutes) }), NOW, t).urgency,
  ready: (minutes: number, t: PosThresholds): Urgency =>
    deriveSessionState(session({ items_ready: 1, ready_since: ago(minutes) }), NOW, t).urgency,
  bill: (minutes: number, t: PosThresholds): Urgency =>
    deriveSessionState(session({ bill_requested_at: ago(minutes) }), NOW, t).urgency,
}

const CASES: PosSettings[] = [
  DEFAULT_POS_SETTINGS,
  {
    ...DEFAULT_POS_SETTINGS,
    orderWarnMinutes: 9,
    kitchenWarnMinutes: 15,
    kitchenLateMinutes: 28,
    readyWarnMinutes: 4,
    billWarnMinutes: 7,
  },
  {
    ...DEFAULT_POS_SETTINGS,
    orderWarnMinutes: 1,
    kitchenWarnMinutes: 10,
    kitchenLateMinutes: 10,
    readyWarnMinutes: 1,
    billWarnMinutes: 1,
  },
]

describe('lo que dice la pantalla es lo que hace el mapa', () => {
  for (const [index, settings] of CASES.entries()) {
    it(`caso ${index + 1}: cada situación cambia justo en los minutos anunciados`, () => {
      const t = thresholds(settings)
      for (const line of alertLines(settings)) {
        const urgencyAt = (minutes: number) => onTheMap[line.id](minutes, t)
        // Un minuto antes de ponerse roja todavía no lo está; en el minuto, sí.
        expect(urgencyAt(line.lateAt), `${line.id} roja`).toBe('late')
        if (line.lateAt > 0) {
          expect(urgencyAt(line.lateAt - 1), `${line.id} antes de roja`).not.toBe('late')
        }
        // Y avisa desde el minuto anunciado, no antes.
        if (line.warnAt < line.lateAt) {
          expect(urgencyAt(line.warnAt), `${line.id} avisa`).toBe('warn')
        }
        if (line.warnAt > 0) {
          expect(urgencyAt(line.warnAt - 1), `${line.id} antes de avisar`).toBe('none')
        }
      }
    })
  }

  it('la comida lista avisa desde el primer momento', () => {
    const ready = alertLines(DEFAULT_POS_SETTINGS).find((line) => line.id === 'ready')
    expect(ready).toEqual({ id: 'ready', warnAt: 0, lateAt: 6 })
    expect(onTheMap.ready(0, DEFAULT_THRESHOLDS)).toBe('warn')
  })

  it('los dos tiempos de la cocina son los que pintan las tarjetas de la tele', () => {
    const settings = { ...DEFAULT_POS_SETTINGS, kitchenWarnMinutes: 14, kitchenLateMinutes: 22 }
    const tv = { kitchen_warn_minutes: 14, kitchen_late_minutes: 22 }
    const kitchen = alertLines(settings).find((line) => line.id === 'kitchen')
    expect(kitchen).toEqual({ id: 'kitchen', warnAt: 14, lateAt: 22 })
    expect(ageLevel(13, tv)).toBe('ok')
    expect(ageLevel(14, tv)).toBe('warn')
    expect(ageLevel(21, tv)).toBe('warn')
    expect(ageLevel(22, tv)).toBe('late')
  })

  it('los de fábrica de la pantalla son los de fábrica del mapa', () => {
    expect(thresholds(DEFAULT_POS_SETTINGS)).toEqual(DEFAULT_THRESHOLDS)
  })
})

describe('alertLines con los de fábrica', () => {
  it('sin pedido 6 y 12 · cocina 12 y 20 · lista 0 y 6 · cuenta 4 y 8', () => {
    expect(alertLines(DEFAULT_POS_SETTINGS)).toEqual([
      { id: 'order', warnAt: 6, lateAt: 12 },
      { id: 'kitchen', warnAt: 12, lateAt: 20 },
      { id: 'ready', warnAt: 0, lateAt: 6 },
      { id: 'bill', warnAt: 4, lateAt: 8 },
    ])
  })
})

describe('alertScale', () => {
  it('media hora alcanza para los tiempos de siempre', () => {
    expect(alertScale(alertLines(DEFAULT_POS_SETTINGS))).toBe(30)
  })

  it('crece, de a diez, si un aviso es más largo', () => {
    const slow = { ...DEFAULT_POS_SETTINGS, kitchenWarnMinutes: 30, kitchenLateMinutes: 45 }
    const scale = alertScale(alertLines(slow))
    expect(scale).toBe(60)
    expect(scale % 10).toBe(0)
  })

  it('sin situaciones sigue habiendo una regla', () => {
    expect(alertScale([])).toBe(30)
  })
})

describe('clampMinutes', () => {
  it('no deja salir de los topes de la base', () => {
    expect(clampMinutes('orderWarnMinutes', 0)).toBe(MINUTE_BOUNDS.orderWarnMinutes.min)
    expect(clampMinutes('orderWarnMinutes', 999)).toBe(120)
    expect(clampMinutes('readyWarnMinutes', 61)).toBe(60)
    expect(clampMinutes('kitchenLateMinutes', 240)).toBe(240)
    expect(clampMinutes('billWarnMinutes', 4.6)).toBe(5)
    expect(clampMinutes('billWarnMinutes', Number.NaN)).toBe(1)
  })
})

describe('nudgeKitchen', () => {
  const base = { kitchenWarnMinutes: 12, kitchenLateMinutes: 20 }

  it('mover uno deja al otro donde estaba, mientras no se crucen', () => {
    expect(nudgeKitchen(base, 'warn', 15)).toEqual({
      kitchenWarnMinutes: 15,
      kitchenLateMinutes: 20,
    })
    expect(nudgeKitchen(base, 'late', 25)).toEqual({
      kitchenWarnMinutes: 12,
      kitchenLateMinutes: 25,
    })
  })

  it('subir el aviso por encima del rojo se lleva al rojo', () => {
    expect(nudgeKitchen(base, 'warn', 24)).toEqual({
      kitchenWarnMinutes: 24,
      kitchenLateMinutes: 24,
    })
  })

  it('bajar el rojo por debajo del aviso se lleva al aviso', () => {
    expect(nudgeKitchen(base, 'late', 8)).toEqual({ kitchenWarnMinutes: 8, kitchenLateMinutes: 8 })
  })

  it('nunca devuelve el rojo antes del aviso ni sale de los topes', () => {
    for (const next of [-5, 0, 1, 12, 20, 21, 240, 500]) {
      for (const which of ['warn', 'late'] as const) {
        const moved = nudgeKitchen(base, which, next)
        expect(moved.kitchenLateMinutes).toBeGreaterThanOrEqual(moved.kitchenWarnMinutes)
        expect(moved.kitchenWarnMinutes).toBeGreaterThanOrEqual(1)
        expect(moved.kitchenLateMinutes).toBeLessThanOrEqual(240)
      }
    }
  })
})

describe('comida lista: se elige por cuándo se pone roja', () => {
  it('va y vuelve sin perder nada', () => {
    for (let stored = 1; stored <= 60; stored++) {
      expect(readyWarnOf(readyLateOf(stored))).toBe(stored)
    }
  })

  it('el rojo es el triple de lo guardado, y no deja pasar el tope', () => {
    expect(readyLateOf(2)).toBe(6)
    expect(readyWarnOf(6)).toBe(2)
    expect(readyWarnOf(0)).toBe(1)
    expect(readyWarnOf(999)).toBe(60)
  })
})
