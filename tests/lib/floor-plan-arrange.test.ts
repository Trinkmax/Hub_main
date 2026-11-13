import { describe, expect, it } from 'vitest'
import {
  type Box,
  findFreeSpot,
  type MergeCandidate,
  mergedTable,
  mergeTargetAt,
  overlaps,
  rowContinuation,
  SEAT_GAP,
  turnedBounds,
} from '@/lib/floor-plan/arrange'

const AREA = { width: 1200, height: 800 }
const box = (x: number, y: number, width = 80, height = 80): Box => ({ x, y, width, height })

describe('overlaps', () => {
  it('tocarse justo en el borde no es pisarse', () => {
    expect(overlaps(box(0, 0), box(80, 0))).toBe(false)
    expect(overlaps(box(0, 0), box(79, 0))).toBe(true)
  })

  it('con aire pedido, estar pegadas ya cuenta', () => {
    expect(overlaps(box(0, 0), box(80, 0), SEAT_GAP)).toBe(true)
    expect(overlaps(box(0, 0), box(80 + SEAT_GAP, 0), SEAT_GAP)).toBe(false)
  })
})

describe('turnedBounds', () => {
  it('una barra parada ocupa lo que mide al girarla', () => {
    const b = turnedBounds({ x: 100, y: 100, width: 240, height: 40, rotation: 90 })
    expect(b.width).toBeCloseTo(40)
    expect(b.height).toBeCloseTo(240)
    // Mismo centro.
    expect(b.x + b.width / 2).toBeCloseTo(220)
    expect(b.y + b.height / 2).toBeCloseTo(120)
  })

  it('sin girar es la misma caja', () => {
    expect(turnedBounds({ x: 10, y: 20, width: 80, height: 60, rotation: 0 })).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 60,
    })
  })
})

describe('findFreeSpot: una mesa nueva nunca cae encima de otra', () => {
  const center = { x: 560, y: 360 }

  it('con el lugar libre, queda donde se pidió (en la cuadrícula)', () => {
    expect(
      findFreeSpot({
        area: AREA,
        others: [],
        width: 80,
        height: 80,
        preferred: { x: 563, y: 357 },
      }),
    ).toEqual({ x: 560, y: 360 })
  })

  it('con una mesa justo ahí, se corre al lado y deja lugar para las sillas', () => {
    const taken = box(560, 360)
    const spot = findFreeSpot({
      area: AREA,
      others: [taken],
      width: 80,
      height: 80,
      preferred: center,
    })
    expect(spot).not.toEqual(center)
    expect(overlaps({ ...spot, width: 80, height: 80 }, taken, SEAT_GAP)).toBe(false)
    // Cerca: no la manda a la otra punta del salón.
    expect(Math.hypot(spot.x - center.x, spot.y - center.y)).toBeLessThanOrEqual(160)
  })

  it('la décima mesa agregada sin mover ninguna tampoco pisa a las anteriores', () => {
    const placed: Box[] = []
    for (let i = 0; i < 10; i++) {
      const spot = findFreeSpot({
        area: AREA,
        others: placed,
        width: 80,
        height: 80,
        preferred: center,
      })
      const next = { ...spot, width: 80, height: 80 }
      for (const other of placed) expect(overlaps(next, other, SEAT_GAP)).toBe(false)
      placed.push(next)
    }
    expect(new Set(placed.map((p) => `${p.x}:${p.y}`)).size).toBe(10)
  })

  it('nunca se sale del piso', () => {
    const corner = findFreeSpot({
      area: AREA,
      others: [box(1120, 720)],
      width: 80,
      height: 80,
      preferred: { x: 5000, y: 5000 },
    })
    expect(corner.x).toBeGreaterThanOrEqual(0)
    expect(corner.y).toBeGreaterThanOrEqual(0)
    expect(corner.x + 80).toBeLessThanOrEqual(AREA.width)
    expect(corner.y + 80).toBeLessThanOrEqual(AREA.height)
  })

  it('con el piso lleno no se pierde: queda donde se pidió', () => {
    const full = [box(0, 0, 200, 200)]
    expect(
      findFreeSpot({
        area: { width: 200, height: 200 },
        others: full,
        width: 80,
        height: 80,
        preferred: { x: 60, y: 60 },
      }),
    ).toEqual({ x: 60, y: 60 })
  })
})

describe('rowContinuation: la mesa nueva sigue la fila de la última', () => {
  const next = (tables: Box[], area = AREA) =>
    rowContinuation({ area, tables, width: 80, height: 80 })

  it('sin mesas no hay fila que seguir', () => {
    expect(next([])).toBeNull()
  })

  it('con una sola mesa, va a su derecha, a su misma altura', () => {
    expect(next([box(200, 300)])).toEqual({ x: 340, y: 300 })
  })

  it('copia la separación que ya traía la fila', () => {
    // 1, 2 y 3 separadas de a 100: la cuarta queda a 100 de la tercera.
    expect(next([box(160, 220), box(340, 220), box(520, 220)])).toEqual({ x: 700, y: 220 })
  })

  it('sigue la fila de más abajo, no la primera que encuentra', () => {
    const top = [box(160, 220), box(340, 220), box(520, 220)]
    const bottom = [box(160, 420, 160, 80), box(420, 430, 70, 70), box(560, 430, 70, 70)]
    // Detrás de la última de abajo (la redonda de 70): misma separación, centrada con ella.
    expect(next([...top, ...bottom])).toEqual({ x: 700, y: 420 })
  })

  it('tocar «Mesa» varias veces arma una fila pareja, sin pisarse', () => {
    const placed = [box(200, 300)]
    for (let i = 0; i < 4; i++) {
      const spot = next(placed)
      if (!spot) throw new Error('tenía que haber lugar')
      const table = { ...spot, width: 80, height: 80 }
      for (const other of placed) expect(overlaps(table, other, SEAT_GAP)).toBe(false)
      placed.push(table)
    }
    expect(placed.map((p) => p.y)).toEqual([300, 300, 300, 300, 300])
    const gaps = placed.slice(1).map((p, i) => p.x - ((placed[i]?.x ?? 0) + 80))
    expect(new Set(gaps).size).toBe(1)
  })

  it('si no entra a lo ancho, empieza otra fila debajo, desde la primera columna', () => {
    const row = [box(160, 300), box(940, 300), box(1100, 300)]
    expect(next(row)).toEqual({ x: 160, y: 460 })
  })

  it('una separación rara no se copia tal cual: ni pegadas ni en la otra punta', () => {
    // Pegadas: se abre lo mínimo para las sillas.
    expect(next([box(200, 300), box(280, 300)])).toEqual({ x: 400, y: 300 })
    // Lejísimos: no se manda la nueva a la otra punta del salón.
    expect(next([box(0, 300), box(600, 300)])).toEqual({ x: 840, y: 300 })
  })

  it('con el piso lleno hacia abajo, que decida quien llama', () => {
    expect(next([box(0, 100), box(120, 100)], { width: 200, height: 200 })).toBeNull()
  })
})

describe('mergeTargetAt: arrastrar una mesa encima de otra', () => {
  const tables: MergeCandidate[] = [
    { id: 'a', x: 100, y: 100, width: 80, height: 80, rotation: 0, shape: 'rect' },
    { id: 'b', x: 300, y: 100, width: 160, height: 80, rotation: 0, shape: 'rect' },
    { id: 'r', x: 600, y: 100, width: 100, height: 100, rotation: 0, shape: 'circle' },
  ]

  it('con el centro adentro de otra mesa, esa es el destino', () => {
    expect(mergeTargetAt({ x: 380, y: 140 }, tables, 'a')).toBe('b')
  })

  it('acercarla no alcanza: el centro tiene que estar encima', () => {
    expect(mergeTargetAt({ x: 290, y: 140 }, tables, 'a')).toBeNull()
    expect(mergeTargetAt({ x: 380, y: 190 }, tables, 'a')).toBeNull()
  })

  it('una mesa no se junta consigo misma', () => {
    expect(mergeTargetAt({ x: 140, y: 140 }, tables, 'a')).toBeNull()
  })

  it('en una redonda cuenta el círculo, no su caja', () => {
    // La esquina de la caja de la redonda queda afuera del círculo.
    expect(mergeTargetAt({ x: 606, y: 106 }, tables, 'a')).toBeNull()
    expect(mergeTargetAt({ x: 650, y: 150 }, tables, 'a')).toBe('r')
  })

  it('una mesa girada se mira derecha', () => {
    const turned: MergeCandidate[] = [
      { id: 't', x: 300, y: 100, width: 160, height: 40, rotation: 90, shape: 'rect' },
    ]
    // Girada un cuarto de vuelta, ocupa de alto lo que medía de ancho.
    expect(mergeTargetAt({ x: 380, y: 190 }, turned, 'a')).toBe('t')
    expect(mergeTargetAt({ x: 440, y: 120 }, turned, 'a')).toBeNull()
  })

  it('si dos se pisan, gana la que está arriba', () => {
    const stacked: MergeCandidate[] = [
      { id: 'abajo', x: 0, y: 0, width: 100, height: 100, rotation: 0, shape: 'rect' },
      { id: 'arriba', x: 20, y: 20, width: 100, height: 100, rotation: 0, shape: 'rect' },
    ]
    expect(mergeTargetAt({ x: 60, y: 60 }, stacked, 'x')).toBe('arriba')
  })
})

describe('mergedTable: cómo queda la que absorbe a la otra', () => {
  const four = { x: 400, y: 300, width: 80, height: 80, shape: 'rect' as const, capacity: 4 }

  it('dos de cuatro dan una de ocho, el doble de larga y en el mismo lugar', () => {
    const merged = mergedTable(four, { ...four, x: 100, y: 100 }, AREA)
    expect(merged).toEqual({ x: 360, y: 300, width: 160, height: 80, capacity: 8 })
    // El centro no se movió.
    expect(merged.x + merged.width / 2).toBe(four.x + four.width / 2)
  })

  it('una larga parada crece hacia donde ya era larga', () => {
    const tall = { x: 400, y: 200, width: 80, height: 160, shape: 'rect' as const, capacity: 6 }
    const merged = mergedTable(tall, four, AREA)
    expect(merged).toMatchObject({ width: 80, height: 240, capacity: 10 })
  })

  it('una redonda crece en superficie y sigue redonda', () => {
    const round = { x: 400, y: 300, width: 80, height: 80, shape: 'circle' as const, capacity: 4 }
    const merged = mergedTable(round, { ...round, x: 0, y: 0 }, AREA)
    expect(merged.width).toBe(merged.height)
    expect(merged.width).toBeGreaterThan(100)
    expect(merged.width).toBeLessThan(140)
    expect(merged.capacity).toBe(8)
  })

  it('sin lugares cargados cuenta cuatro por mesa', () => {
    expect(
      mergedTable({ ...four, capacity: null }, { ...four, capacity: null }, AREA).capacity,
    ).toBe(8)
    expect(mergedTable({ ...four, capacity: 2 }, { ...four, capacity: null }, AREA).capacity).toBe(
      6,
    )
  })

  it('no se sale del piso aunque esté contra el borde', () => {
    const edge = { ...four, x: 1120, y: 720 }
    const merged = mergedTable(edge, four, AREA)
    expect(merged.x + merged.width).toBeLessThanOrEqual(AREA.width)
    expect(merged.y + merged.height).toBeLessThanOrEqual(AREA.height)
    expect(merged.x).toBeGreaterThanOrEqual(0)
  })

  it('los lugares tienen un tope', () => {
    expect(mergedTable({ ...four, capacity: 30 }, { ...four, capacity: 30 }, AREA).capacity).toBe(
      50,
    )
  })
})
