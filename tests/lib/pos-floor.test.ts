import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  extrude,
  fitBounds,
  floorMatrix,
  lift,
  MODEL_CAMERA,
  mixCamera,
  PLAN_CAMERA,
  polygonPath,
  project,
  rectFootprint,
  splitLongRect,
  unproject,
} from '@/lib/pos/floor/projection'
import { buildScene, HEIGHTS, nearestAnchor, occupiedSeats } from '@/lib/pos/floor/scene'
import type { FloorElement } from '@/lib/pos/types'

const DEG = Math.PI / 180

function table(over: Partial<FloorElement> = {}): FloorElement {
  return {
    id: 'el-1',
    area_id: 'a',
    kind: 'table',
    shape: 'rect',
    x: 100,
    y: 100,
    w: 80,
    h: 80,
    rotation: 0,
    corner_radius: 8,
    z: 0,
    label: null,
    color: null,
    table_id: 't-1',
    table_label: '12',
    capacity: 4,
    ...over,
  }
}

describe('proyección', () => {
  it('con la cámara cenital es el plano de siempre', () => {
    expect(project(PLAN_CAMERA, 120, 45, 30)).toEqual({ x: 120, y: 45 })
    expect(lift(PLAN_CAMERA, 30)).toBe(0)
    expect(floorMatrix(PLAN_CAMERA)).toEqual([1, 0, -0, 1, 0, 0])
  })

  it('inclinar achica el fondo y la altura sube en pantalla', () => {
    const camera = { tilt: 60 * DEG, yaw: 0 }
    const floor = project(camera, 0, 100, 0)
    expect(floor.x).toBeCloseTo(0)
    expect(floor.y).toBeCloseTo(50)
    const raised = project(camera, 0, 100, 20)
    expect(raised.y).toBeLessThan(floor.y)
    expect(floor.y - raised.y).toBeCloseTo(lift(camera, 20))
  })

  it('la matriz del piso coincide con proyectar punto por punto', () => {
    const [a, b, c, d] = floorMatrix(MODEL_CAMERA)
    const p = project(MODEL_CAMERA, 37, -12, 0)
    expect(a * 37 + c * -12).toBeCloseTo(p.x)
    expect(b * 37 + d * -12).toBeCloseTo(p.y)
  })

  it('desproyectar devuelve el punto del piso', () => {
    const p = project(MODEL_CAMERA, 210, 340, 0)
    const back = unproject(MODEL_CAMERA, p.x, p.y)
    expect(back?.x).toBeCloseTo(210)
    expect(back?.y).toBeCloseTo(340)
    expect(unproject({ tilt: 90 * DEG, yaw: 0 }, 1, 1)).toBeNull()
  })

  it('interpola de plano a maqueta', () => {
    expect(mixCamera(PLAN_CAMERA, MODEL_CAMERA, 0)).toEqual(PLAN_CAMERA)
    expect(mixCamera(PLAN_CAMERA, MODEL_CAMERA, 1)).toEqual(MODEL_CAMERA)
    expect(mixCamera(PLAN_CAMERA, MODEL_CAMERA, 5)).toEqual(MODEL_CAMERA)
    expect(mixCamera(PLAN_CAMERA, MODEL_CAMERA, 0.5).tilt).toBeCloseTo(MODEL_CAMERA.tilt / 2)
  })
})

describe('volúmenes', () => {
  const square = rectFootprint(0, 0, 80, 80)

  it('en el plano no hay caras laterales', () => {
    const prism = extrude(PLAN_CAMERA, square, 0, 30)
    expect(prism.sides).toHaveLength(0)
    expect(prism.top).toHaveLength(4)
  })

  it('de frente se ve solo la cara de adelante', () => {
    const prism = extrude({ tilt: 55 * DEG, yaw: 0 }, square, 0, 30)
    expect(prism.sides).toHaveLength(1)
    const face = prism.sides[0]
    // La cara de adelante: su borde de arriba es el borde delantero de la tapa.
    expect(Math.max(...(face?.points.map((p) => p.y) ?? []))).toBeCloseTo(prism.bounds.maxY)
  })

  it('girada se ven dos caras, y la que mira a la luz queda más clara', () => {
    const prism = extrude(MODEL_CAMERA, square, 0, 30)
    expect(prism.sides).toHaveLength(2)
    const lights = prism.sides.map((s) => s.light).sort()
    expect(lights[0]).toBeLessThan(lights[1] ?? 0)
  })

  it('las esquinas redondeadas siguen siendo un polígono cerrado y convexo', () => {
    const rounded = rectFootprint(0, 0, 80, 60, 30, 12)
    expect(rounded.length).toBe(20)
    const b = boundsOf(rounded)
    expect(b.maxX - b.minX).toBeGreaterThan(60)
    expect(polygonPath(rounded).endsWith('Z')).toBe(true)
  })

  it('una pared larga se parte en tramos que cubren el mismo largo', () => {
    const parts = splitLongRect(500, 100, 400, 16, 0, 90)
    expect(parts).toHaveLength(5)
    expect(parts.reduce((sum, p) => sum + p.width, 0)).toBeCloseTo(400)
    expect(parts[0]?.cx).toBeCloseTo(340)
    expect(splitLongRect(0, 0, 60, 16, 0)).toHaveLength(1)
  })

  it('encuadra el contenido centrado y sin pasarse del máximo', () => {
    const fit = fitBounds(
      { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      { width: 400, height: 400 },
      0,
      1.5,
    )
    expect(fit.scale).toBe(1.5)
    expect(fit.offsetX).toBeCloseTo(50)
    expect(fit.offsetY).toBeCloseTo(125)
  })
})

describe('maqueta', () => {
  it('una mesa de cuatro trae tapa, pata, cuatro sillas con respaldo y su ancla', () => {
    const scene = buildScene(MODEL_CAMERA, [table()])
    const roles = scene.solids.map((s) => s.role)
    expect(roles.filter((r) => r === 'tabletop')).toHaveLength(1)
    expect(roles.filter((r) => r === 'pedestal')).toHaveLength(1)
    expect(roles.filter((r) => r === 'chair')).toHaveLength(4)
    expect(roles.filter((r) => r === 'chairback')).toHaveLength(4)
    expect(scene.anchors).toHaveLength(1)
    expect(scene.anchors[0]).toMatchObject({ tableId: 't-1', label: '12', seats: 4 })
  })

  it('sienta tantos comensales como personas hay, y no más que sillas', () => {
    const three = buildScene(MODEL_CAMERA, [table()], { occupancy: { 't-1': 3 } })
    expect(three.solids.filter((s) => s.role === 'pawn')).toHaveLength(3)
    const nine = buildScene(MODEL_CAMERA, [table()], { occupancy: { 't-1': 9 } })
    expect(nine.solids.filter((s) => s.role === 'pawn')).toHaveLength(4)
    expect(three.solids.find((s) => s.role === 'pawn')?.head).toBeDefined()
  })

  it('sin sillas (maqueta chica) quedan solo las mesas', () => {
    const scene = buildScene(MODEL_CAMERA, [table()], { chairs: false, occupancy: { 't-1': 3 } })
    expect(scene.solids.map((s) => s.role).sort()).toEqual(['pedestal', 'tabletop'])
  })

  it('lo de atrás se dibuja antes que lo de adelante', () => {
    const back = table({ id: 'el-back', table_id: 't-back', y: 60 })
    const front = table({ id: 'el-front', table_id: 't-front', y: 400 })
    const scene = buildScene({ tilt: 55 * DEG, yaw: 0 }, [front, back], { chairs: false })
    const order = scene.solids.filter((s) => s.role === 'tabletop').map((s) => s.tableId)
    expect(order).toEqual(['t-back', 't-front'])
  })

  it('la tapa va después de su pata', () => {
    const scene = buildScene(MODEL_CAMERA, [table()], { chairs: false })
    expect(scene.solids.map((s) => s.role)).toEqual(['pedestal', 'tabletop'])
  })

  it('en el plano la mesa queda donde estaba', () => {
    const scene = buildScene(PLAN_CAMERA, [table()], { chairs: false })
    expect(scene.anchors[0]?.x).toBeCloseTo(140)
    expect(scene.anchors[0]?.y).toBeCloseTo(140)
    expect(scene.solids.every((s) => s.sides.every((d) => d === ''))).toBe(true)
  })

  it('paredes, barra con banquetas y carteles', () => {
    const wall: FloorElement = {
      ...table(),
      id: 'w',
      kind: 'wall',
      table_id: null,
      x: 0,
      y: 0,
      w: 300,
      h: 16,
    }
    const bar: FloorElement = {
      ...table(),
      id: 'b',
      kind: 'bar',
      table_id: null,
      x: 0,
      y: 300,
      w: 240,
      h: 40,
    }
    const sign: FloorElement = {
      ...table(),
      id: 's',
      kind: 'text',
      table_id: null,
      label: 'Terraza',
    }
    const scene = buildScene(MODEL_CAMERA, [wall, bar, sign])
    expect(scene.solids.filter((s) => s.role === 'wall').length).toBeGreaterThan(1)
    expect(scene.solids.filter((s) => s.role === 'bar')).toHaveLength(1)
    expect(scene.solids.filter((s) => s.role === 'stool').length).toBeGreaterThan(3)
    expect(scene.decals).toEqual([expect.objectContaining({ kind: 'text', label: 'Terraza' })])
    expect(scene.anchors).toHaveLength(0)
  })

  it('la losa del piso contiene todo lo dibujado', () => {
    const scene = buildScene(MODEL_CAMERA, [
      table(),
      table({ id: 'el-2', table_id: 't-2', x: 500, y: 300 }),
    ])
    expect(scene.floor.top).not.toBe('')
    expect(scene.bounds.maxX - scene.bounds.minX).toBeGreaterThan(400)
  })

  it('la mesa sube en pantalla lo que mide de alto', () => {
    const flat = buildScene(PLAN_CAMERA, [table()], { chairs: false }).anchors[0]
    const model = buildScene({ tilt: 90 * DEG * 0.5, yaw: 0 }, [table()], { chairs: false })
      .anchors[0]
    const floorY = project({ tilt: 45 * DEG, yaw: 0 }, 140, 140, 0).y
    expect(flat?.y).toBeCloseTo(140)
    expect(floorY - (model?.y ?? 0)).toBeCloseTo(lift({ tilt: 45 * DEG, yaw: 0 }, HEIGHTS.tableTop))
  })
})

describe('repartir comensales', () => {
  it('reparte en vez de llenar un solo lado', () => {
    expect([...occupiedSeats(4, 2)].sort()).toEqual([0, 2])
    expect([...occupiedSeats(6, 3)].sort()).toEqual([0, 2, 4])
    expect(occupiedSeats(4, 4).size).toBe(4)
    expect(occupiedSeats(4, 7).size).toBe(4)
    expect(occupiedSeats(0, 3).size).toBe(0)
    expect(occupiedSeats(4, 0).size).toBe(0)
  })
})

describe('soltar una mesa sobre otra', () => {
  it('devuelve la más cercana dentro del radio', () => {
    const scene = buildScene(
      PLAN_CAMERA,
      [table(), table({ id: 'el-2', table_id: 't-2', x: 400 })],
      {
        chairs: false,
      },
    )
    expect(nearestAnchor(scene.anchors, 430, 150, 60)?.tableId).toBe('t-2')
    expect(nearestAnchor(scene.anchors, 900, 900, 60)).toBeNull()
  })
})
