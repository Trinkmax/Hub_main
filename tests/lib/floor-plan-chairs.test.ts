import { describe, expect, it } from 'vitest'
import {
  CHAIR_MARGIN,
  computeBarStools,
  computeChairs,
  distributeSides,
  MAX_CHAIRS,
} from '@/lib/floor-plan/chairs'

describe('distributeSides', () => {
  it('4-top cuadrado → 1 por lado', () => {
    expect(distributeSides(4, 80, 80)).toEqual({ top: 1, bottom: 1, left: 1, right: 1 })
  })

  it('2-top angosto → 1 arriba + 1 abajo (lados largos)', () => {
    // w >= h ⇒ los lados largos son top/bottom.
    expect(distributeSides(2, 120, 60)).toEqual({ top: 1, bottom: 1, left: 0, right: 0 })
  })

  it('6-top rectangular típico (160×80) → 2/2/1/1', () => {
    expect(distributeSides(6, 160, 80)).toEqual({ top: 2, bottom: 2, left: 1, right: 1 })
  })

  it('6-top en mesa muy larga (240×80) → 3 por lado largo, extremos vacíos', () => {
    // Mesa comunal: la densidad reparte todo a los lados largos.
    expect(distributeSides(6, 240, 80)).toEqual({ top: 3, bottom: 3, left: 0, right: 0 })
  })

  it('8-top rectangular largo → 3/3/1/1', () => {
    expect(distributeSides(8, 240, 80)).toEqual({ top: 3, bottom: 3, left: 1, right: 1 })
  })

  it('suma de lados = n', () => {
    for (const n of [1, 3, 5, 7, 10, 12]) {
      const d = distributeSides(n, 160, 80)
      expect(d.top + d.bottom + d.left + d.right).toBe(n)
    }
  })
})

describe('computeChairs', () => {
  it('decoración (no-table sin booth) no lleva sillas', () => {
    expect(computeChairs('rect', 'wall', 200, 16, null)).toEqual([])
    expect(computeChairs('rect', 'island', 120, 80, 8)).toEqual([])
  })

  it('capacidad nula o ≤0 → sin sillas', () => {
    expect(computeChairs('rect', 'table', 80, 80, null)).toEqual([])
    expect(computeChairs('rect', 'table', 80, 80, 0)).toEqual([])
  })

  it('dibuja exactamente capacity sillas (rect)', () => {
    expect(computeChairs('rect', 'table', 80, 80, 4)).toHaveLength(4)
    expect(computeChairs('rect', 'table', 240, 80, 8)).toHaveLength(8)
  })

  it('clampa al máximo dibujable', () => {
    expect(computeChairs('circle', 'table', 120, 120, 30)).toHaveLength(MAX_CHAIRS)
  })

  it('círculo: sillas equiespaciadas por fuera del cuerpo', () => {
    const chairs = computeChairs('circle', 'table', 80, 80, 4)
    expect(chairs).toHaveLength(4)
    // La primera arranca arriba (cy < 0, por fuera del borde superior del cuerpo).
    expect(chairs[0]?.cy).toBeLessThan(0)
    // Centro horizontal de la mesa (w/2 = 40).
    expect(chairs[0]?.cx).toBeCloseTo(40, 5)
  })

  it('banquette: todas las sillas en un solo lado largo', () => {
    const chairs = computeChairs('banquette', 'table', 200, 60, 4)
    expect(chairs).toHaveLength(4)
    // Lado de abajo (cy > height): todas alineadas en el mismo y.
    const ys = new Set(chairs.map((c) => Math.round(c.cy)))
    expect(ys.size).toBe(1)
    expect(chairs[0]?.cy).toBeGreaterThan(60)
  })

  it('rect: sillas por fuera del cuerpo (cx/cy negativos o > tamaño)', () => {
    const chairs = computeChairs('rect', 'table', 80, 80, 4)
    for (const c of chairs) {
      const outside = c.cx < 0 || c.cy < 0 || c.cx > 80 || c.cy > 80
      expect(outside).toBe(true)
    }
  })

  it('las sillas caben dentro del margen del SVG', () => {
    const chairs = computeChairs('circle', 'table', 80, 80, 8)
    for (const c of chairs) {
      expect(c.cx).toBeGreaterThanOrEqual(-CHAIR_MARGIN)
      expect(c.cx).toBeLessThanOrEqual(80 + CHAIR_MARGIN)
      expect(c.cy).toBeGreaterThanOrEqual(-CHAIR_MARGIN)
      expect(c.cy).toBeLessThanOrEqual(80 + CHAIR_MARGIN)
    }
  })
})

describe('computeBarStools', () => {
  it('barra horizontal → fila de banquetas por debajo del borde', () => {
    const stools = computeBarStools(240, 40)
    expect(stools.length).toBeGreaterThan(0)
    for (const s of stools) expect(s.cy).toBeGreaterThan(40)
  })

  it('barra vertical → banquetas a la derecha', () => {
    const stools = computeBarStools(40, 240)
    expect(stools.length).toBeGreaterThan(0)
    for (const s of stools) expect(s.cx).toBeGreaterThan(40)
  })
})
