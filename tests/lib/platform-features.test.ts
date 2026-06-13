import { describe, expect, it } from 'vitest'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  featuresByGroup,
  getTenantFeatures,
  isFeatureEnabled,
} from '@/lib/platform/features'

describe('getTenantFeatures — merge de defaults + overrides', () => {
  it('sin overrides usa los defaults del registry (operativas en OFF)', () => {
    const f = getTenantFeatures({ feature_flags: {} })
    for (const key of FEATURE_KEYS) {
      expect(f[key]).toBe(FEATURE_REGISTRY[key].defaultEnabled)
    }
    // todas las features de Fase 1 arrancan apagadas
    expect(f.table_service).toBe(false)
    expect(f.kitchen).toBe(false)
    expect(f.reviews).toBe(false)
  })

  it('respeta un override booleano', () => {
    const f = getTenantFeatures({ feature_flags: { table_service: true } })
    expect(f.table_service).toBe(true)
    expect(f.kitchen).toBe(false) // otras siguen en default
  })

  it('ignora keys desconocidas guardadas en el jsonb', () => {
    const f = getTenantFeatures({ feature_flags: { bogus: true } as Record<string, boolean> })
    expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort())
    expect((f as Record<string, boolean>).bogus).toBeUndefined()
  })

  it('un valor no-booleano cae al default (no rompe)', () => {
    const f = getTenantFeatures({
      feature_flags: { table_service: 'yes' as unknown as boolean },
    })
    expect(f.table_service).toBe(false)
  })

  it('tolera feature_flags null/undefined', () => {
    const f = getTenantFeatures({ feature_flags: null as unknown as Record<string, boolean> })
    expect(f.floor_plan).toBe(false)
  })
})

describe('isFeatureEnabled', () => {
  it('devuelve el estado efectivo de una key', () => {
    expect(isFeatureEnabled({ feature_flags: { kitchen: true } }, 'kitchen')).toBe(true)
    expect(isFeatureEnabled({ feature_flags: {} }, 'kitchen')).toBe(false)
  })
})

describe('featuresByGroup', () => {
  it('agrupa todas las features por su grupo y no pierde ninguna', () => {
    const groups = featuresByGroup()
    const total = Object.values(groups).reduce((n, defs) => n + defs.length, 0)
    expect(total).toBe(FEATURE_KEYS.length)
    expect(groups['Salón']?.some((d) => d.key === 'table_service')).toBe(true)
    expect(groups['Fidelización']?.some((d) => d.key === 'reviews')).toBe(true)
  })
})
