import { describe, expect, it } from 'vitest'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  featuresByGroup,
  getEffectiveFeatures,
  getTenantFeatures,
  isFeatureEnabled,
} from '@/lib/platform/features'

describe('getTenantFeatures — merge de defaults + overrides', () => {
  it('sin overrides usa los defaults del registry (operativas en OFF)', () => {
    const f = getTenantFeatures({ feature_flags: {} })
    for (const key of FEATURE_KEYS) {
      expect(f[key]).toBe(FEATURE_REGISTRY[key].defaultEnabled)
    }
    // todas arrancan apagadas: cada bar prende lo suyo
    expect(f.pos).toBe(false)
    expect(f.purchasing).toBe(false)
    expect(f.reviews).toBe(false)
  })

  it('respeta un override booleano', () => {
    const f = getTenantFeatures({ feature_flags: { pos: true } })
    expect(f.pos).toBe(true)
    expect(f.purchasing).toBe(false) // otras siguen en default
  })

  it('ignora keys desconocidas guardadas en el jsonb', () => {
    const f = getTenantFeatures({ feature_flags: { bogus: true } as Record<string, boolean> })
    expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort())
    expect((f as Record<string, boolean>).bogus).toBeUndefined()
  })

  it('un valor no-booleano cae al default (no rompe)', () => {
    const f = getTenantFeatures({
      feature_flags: { pos: 'yes' as unknown as boolean },
    })
    expect(f.pos).toBe(false)
  })

  it('tolera feature_flags null/undefined', () => {
    const f = getTenantFeatures({ feature_flags: null as unknown as Record<string, boolean> })
    expect(f.pos).toBe(false)
  })
})

describe('isFeatureEnabled', () => {
  it('devuelve el estado efectivo de una key', () => {
    expect(isFeatureEnabled({ feature_flags: { ticket_door: true } }, 'ticket_door')).toBe(true)
    expect(isFeatureEnabled({ feature_flags: {} }, 'ticket_door')).toBe(false)
  })
})

describe('el servicio de mesa anterior ya no existe', () => {
  // Retirado el 18/11/2026: lo reemplazó el punto de venta. Un bar que tenga guardado alguno de sus
  // interruptores no prende nada.
  const OLD = ['table_service', 'floor_plan', 'table_qr', 'auto_accept', 'kitchen']

  it('sus interruptores no están en el registro', () => {
    for (const key of OLD) expect(FEATURE_KEYS as string[]).not.toContain(key)
  })

  it('guardados en un bar, se ignoran', () => {
    const stored = Object.fromEntries(OLD.map((key) => [key, true]))
    const f = getEffectiveFeatures({ feature_flags: stored })
    expect(Object.values(f).every((on) => on === false)).toBe(true)
    for (const key of OLD) expect((f as Record<string, boolean>)[key]).toBeUndefined()
  })

  it('el plano del salón es parte del punto de venta: no hay nada más que prender', () => {
    expect(getEffectiveFeatures({ feature_flags: { pos: true } })).toEqual(
      getTenantFeatures({ feature_flags: { pos: true } }),
    )
  })
})

describe('featuresByGroup', () => {
  it('agrupa todas las features por su grupo y no pierde ninguna', () => {
    const groups = featuresByGroup()
    const total = Object.values(groups).reduce((n, defs) => n + defs.length, 0)
    expect(total).toBe(FEATURE_KEYS.length)
    expect(groups.Salón?.some((d) => d.key === 'pos')).toBe(true)
    expect(groups.Fidelización?.some((d) => d.key === 'reviews')).toBe(true)
  })
})
