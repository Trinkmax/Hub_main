import { describe, expect, it } from 'vitest'
import {
  formatRequiredTiers,
  isPunchCardUnlocked,
  resolvePunchCardLock,
} from '@/lib/punch-cards/tier-gate'

const GOLD = 'tier-gold'
const BLACK = 'tier-black'
const CLASSIC = 'tier-classic'

describe('isPunchCardUnlocked', () => {
  it('sin niveles atados la puede sellar cualquiera', () => {
    expect(isPunchCardUnlocked([], CLASSIC)).toBe(true)
    expect(isPunchCardUnlocked([], null)).toBe(true)
  })

  it('exclusiva de Gold: la sella Gold', () => {
    expect(isPunchCardUnlocked([GOLD], GOLD)).toBe(true)
  })

  it('exclusiva de Gold: no la sella Classic', () => {
    expect(isPunchCardUnlocked([GOLD], CLASSIC)).toBe(false)
  })

  // El set es arbitrario a propósito: el dueño puede saltear un nivel.
  it('acepta un set salteado (Gold y Black, sin Classic)', () => {
    expect(isPunchCardUnlocked([GOLD, BLACK], BLACK)).toBe(true)
    expect(isPunchCardUnlocked([GOLD, BLACK], CLASSIC)).toBe(false)
  })

  it('el socio sin nivel resuelto queda afuera de una tarjeta restringida', () => {
    expect(isPunchCardUnlocked([GOLD], null)).toBe(false)
  })
})

describe('resolvePunchCardLock', () => {
  it('el habilitado la ve normal', () => {
    expect(resolvePunchCardLock({ tierIds: [GOLD], showWhenLocked: true }, GOLD)).toEqual({
      hidden: false,
      locked: false,
    })
  })

  it('aspiracional: el que no llega la ve bloqueada', () => {
    expect(resolvePunchCardLock({ tierIds: [GOLD], showWhenLocked: true }, CLASSIC)).toEqual({
      hidden: false,
      locked: true,
    })
  })

  it('exclusividad real: el que no llega no la ve', () => {
    expect(resolvePunchCardLock({ tierIds: [GOLD], showWhenLocked: false }, CLASSIC)).toEqual({
      hidden: true,
      locked: true,
    })
  })

  it('sin restricción, `showWhenLocked` no cambia nada', () => {
    expect(resolvePunchCardLock({ tierIds: [], showWhenLocked: false }, null)).toEqual({
      hidden: false,
      locked: false,
    })
  })
})

describe('formatRequiredTiers', () => {
  it('un solo nivel se dice derecho', () => {
    expect(formatRequiredTiers(['Gold'])).toBe('Gold')
  })

  it('dos niveles se unen con "y"', () => {
    expect(formatRequiredTiers(['Gold', 'Black'])).toBe('Gold y Black')
  })

  it('tres o más: comas y "y" al final', () => {
    expect(formatRequiredTiers(['Select', 'Gold', 'Black'])).toBe('Select, Gold y Black')
  })

  it('ignora nombres vacíos', () => {
    expect(formatRequiredTiers(['Gold', '   '])).toBe('Gold')
    expect(formatRequiredTiers([])).toBe('')
  })
})
