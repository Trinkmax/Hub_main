import { describe, expect, it } from 'vitest'
import { alignBoxes, computeSnap, SNAP_THRESHOLD } from '@/lib/floor-plan/snap'

const box = (x: number, y: number, width = 80, height = 80) => ({ x, y, width, height })

describe('computeSnap', () => {
  it('sin vecinos → no cambia ni dibuja guías', () => {
    const r = computeSnap(box(33, 47), [], SNAP_THRESHOLD)
    expect(r).toEqual({ x: 33, y: 47, guides: [] })
  })

  it('imana el borde izquierdo a un vecino cercano (dentro del umbral)', () => {
    // Vecino en x=100; el arrastrado en x=104 (diff 4 ≤ 6) → imana a 100.
    const r = computeSnap(box(104, 300), [box(100, 0)])
    expect(r.x).toBe(100)
    expect(r.guides.some((g) => g.axis === 'v' && g.pos === 100)).toBe(true)
  })

  it('no imana si está fuera del umbral', () => {
    const r = computeSnap(box(120, 300), [box(100, 0)])
    expect(r.x).toBe(120)
    expect(r.guides).toHaveLength(0)
  })

  it('imana centros (dos mesas centradas en la misma vertical)', () => {
    // Vecino centrado en x=140 (100..180). Arrastrado 80 de ancho centrado en ~143 → imana centro.
    const r = computeSnap(box(103, 300), [box(100, 0, 80, 80)])
    // centro vecino = 140; arrastrado centro debe quedar en 140 → x = 100.
    expect(r.x).toBe(100)
  })

  it('imana en ambos ejes a la vez', () => {
    const r = computeSnap(box(204, 304), [box(200, 300)])
    expect(r.x).toBe(200)
    expect(r.y).toBe(300)
    expect(r.guides).toHaveLength(2)
  })
})

describe('alignBoxes', () => {
  it('alinea a la izquierda al menor x', () => {
    const res = alignBoxes(
      [
        { id: 'a', box: box(50, 0) },
        { id: 'b', box: box(120, 80) },
        { id: 'c', box: box(90, 160) },
      ],
      'left',
    )
    expect(res.get('a')?.x).toBe(50)
    expect(res.get('b')?.x).toBe(50)
    expect(res.get('c')?.x).toBe(50)
  })

  it('alinea a la derecha al mayor borde derecho', () => {
    const res = alignBoxes(
      [
        { id: 'a', box: box(50, 0, 40, 40) }, // right 90
        { id: 'b', box: box(120, 80, 80, 80) }, // right 200
      ],
      'right',
    )
    expect(res.get('a')?.x).toBe(160) // 200 - 40
    expect(res.get('b')?.x).toBe(120)
  })

  it('con menos de 2 items no hace nada', () => {
    expect(alignBoxes([{ id: 'a', box: box(0, 0) }], 'left').size).toBe(0)
  })
})
