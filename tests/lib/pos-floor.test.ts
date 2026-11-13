import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  ellipseFootprint,
  extrude,
  fitBounds,
  floorMatrix,
  floorView,
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
import {
  buildScene,
  chooseCamera,
  HEIGHTS,
  labelSize,
  nearestAnchor,
  occupiedSeats,
} from '@/lib/pos/floor/scene'
import type { FloorElement } from '@/lib/pos/types'

const DEG = Math.PI / 180

/** Las columnas de pantalla que ocupa una huella: dos cosas solo se pueden tapar si comparten alguna. */
function columns(
  camera: Parameters<typeof floorView>[0],
  footprint: Parameters<typeof floorView>[1],
): [number, number] {
  const xs = floorView(camera, footprint).map((p) => p.x)
  return [Math.min(...xs), Math.max(...xs)]
}
function share(a: [number, number], b: [number, number]): boolean {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1
}

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

  it('quien está sentado se dibuja sobre su asiento, y el respaldo lo tapa solo si queda adelante', () => {
    const scene = buildScene({ tilt: 55 * DEG, yaw: 0 }, [table()], { occupancy: { 't-1': 4 } })
    const order = scene.solids.map((s) => s.key)
    const at = (key: string) => order.indexOf(key)
    for (let i = 0; i < 4; i++) {
      expect(at(`el-1:p${i}`)).toBeGreaterThan(at(`el-1:c${i}`))
    }
    // Silla 0: del lado del fondo (arriba). Su respaldo queda detrás de la persona.
    expect(at('el-1:b0')).toBeLessThan(at('el-1:p0'))
    // Silla 1: del lado de quien mira (abajo). Su respaldo tapa a la persona.
    expect(at('el-1:b1')).toBeGreaterThan(at('el-1:p1'))
    // Y los de adelante van después de la tapa de la mesa; los del fondo, antes.
    expect(at('el-1:p1')).toBeGreaterThan(at('el-1:top'))
    expect(at('el-1:p0')).toBeLessThan(at('el-1:top'))
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

  describe('quién tapa a quién', () => {
    const bar = (over: Partial<FloorElement> = {}): FloorElement => ({
      ...table(),
      id: 'bar',
      kind: 'bar',
      table_id: null,
      table_label: null,
      capacity: null,
      x: 100,
      y: 300,
      w: 240,
      h: 40,
      ...over,
    })
    const paintIndex = (scene: ReturnType<typeof buildScene>) => {
      const order = scene.solids.map((s) => s.key)
      return (key: string) => order.indexOf(key)
    }
    const stoolKeys = (scene: ReturnType<typeof buildScene>) =>
      scene.solids.filter((s) => s.role === 'stool').map((s) => s.key)

    // El error que se veía: con la barra larga, de la cuarta banqueta en adelante quedaban detrás.
    it('todas las banquetas de una barra larga van adelante de la barra', () => {
      for (const camera of [MODEL_CAMERA, { tilt: 50 * DEG, yaw: -10 * DEG }]) {
        const scene = buildScene(camera, [bar()])
        const at = paintIndex(scene)
        const stools = stoolKeys(scene)
        expect(stools).toHaveLength(10)
        for (const key of stools) expect(at(key)).toBeGreaterThan(at('bar'))
      }
    })

    it('y con la barra dada vuelta quedan todas detrás', () => {
      const scene = buildScene(MODEL_CAMERA, [bar({ rotation: 180 })])
      const at = paintIndex(scene)
      const stools = stoolKeys(scene)
      expect(stools).toHaveLength(10)
      for (const key of stools) expect(at(key)).toBeLessThan(at('bar'))
    })

    it('una barra parada, con las banquetas del lado de quien mira o del otro', () => {
      // Parada (alta y angosta), las banquetas van a su derecha: con el salón girado a un lado quedan
      // adelante, y girado al otro, detrás. Solo cuenta para las que comparten columna con la barra: la
      // que asoma por el costado no la puede tapar ni quedar tapada.
      const standing = bar({ w: 40, h: 240 })
      const body = rectFootprint(120, 420, 40, 240)
      const stoolAt = (i: number) => ellipseFootprint(152, 317 + (i * 206) / 9, 15, 15, 0, 12)
      for (const [camera, side] of [
        [{ tilt: 54 * DEG, yaw: 14 * DEG }, 'adelante'],
        [MODEL_CAMERA, 'detrás'],
      ] as const) {
        const scene = buildScene(camera, [standing])
        const at = paintIndex(scene)
        let compared = 0
        for (let i = 0; i < 10; i++) {
          if (!share(columns(camera, body), columns(camera, stoolAt(i)))) continue
          compared += 1
          if (side === 'adelante') expect(at(`bar:s${i}`)).toBeGreaterThan(at('bar'))
          else expect(at(`bar:s${i}`)).toBeLessThan(at('bar'))
        }
        expect(compared).toBeGreaterThanOrEqual(8)
      }
    })

    it('las banquetas más cercanas tapan a las de atrás, nunca al revés', () => {
      // Barra parada: la fila de banquetas se aleja de quien mira.
      const scene = buildScene({ tilt: 54 * DEG, yaw: 14 * DEG }, [bar({ w: 40, h: 240 })])
      const at = paintIndex(scene)
      const stools = stoolKeys(scene)
      // `s0` es la del fondo (arriba en el plano) y `s9` la de adelante.
      for (let i = 1; i < 10; i++) expect(at(`bar:s${i}`)).toBeGreaterThan(at(`bar:s${i - 1}`))
      expect(stools).toHaveLength(10)
    })

    it('las sillas de adelante de una mesa larga van después de su tapa, todas', () => {
      const long = table({ w: 240, h: 80, capacity: 8 })
      const scene = buildScene(MODEL_CAMERA, [long])
      const at = paintIndex(scene)
      // 8 lugares en 240×80: tres arriba (0-2), tres abajo (3-5) y uno en cada punta.
      for (const i of [0, 1, 2]) {
        expect(at(`el-1:c${i}`)).toBeLessThan(at('el-1:leg'))
        expect(at(`el-1:b${i}`)).toBeLessThan(at('el-1:leg'))
      }
      for (const i of [3, 4, 5]) {
        expect(at(`el-1:c${i}`)).toBeGreaterThan(at('el-1:top'))
        expect(at(`el-1:b${i}`)).toBeGreaterThan(at('el-1:top'))
      }
    })

    it('una mesa delante de la punta lejana de la barra se dibuja después de la barra', () => {
      const front = table({ id: 'el-front', table_id: 't-front', x: 420, y: 420 })
      const back = table({ id: 'el-back', table_id: 't-back', x: 420, y: 120 })
      const scene = buildScene(MODEL_CAMERA, [front, bar({ w: 440 }), back], { chairs: false })
      const at = paintIndex(scene)
      expect(at('el-front:leg')).toBeGreaterThan(at('bar'))
      expect(at('el-back:top')).toBeLessThan(at('bar'))
    })

    it('una pared larga queda entre las mesas de atrás y las de adelante', () => {
      const wall: FloorElement = {
        ...table(),
        id: 'w',
        kind: 'wall',
        table_id: null,
        x: 0,
        y: 250,
        w: 600,
        h: 16,
      }
      const back = table({ id: 'el-back', table_id: 't-back', x: 480, y: 100 })
      const front = table({ id: 'el-front', table_id: 't-front', x: 480, y: 320 })
      const scene = buildScene(MODEL_CAMERA, [front, wall, back])
      const at = paintIndex(scene)
      // Las dos mesas ocupan las mismas columnas (con sus sillas): los tramos de pared que las comparten
      // van después de TODO lo de la mesa del fondo y antes de TODO lo de la de adelante.
      const tables = columns(MODEL_CAMERA, rectFootprint(520, 250, 128, 400))
      const between = splitLongRect(300, 258, 600, 16, 0)
        .map((part, index) => ({
          index,
          cols: columns(MODEL_CAMERA, rectFootprint(part.cx, part.cy, part.width, part.height)),
        }))
        .filter((part) => share(part.cols, tables))
        .map((part) => at(`w:w${part.index}`))
      expect(between.length).toBeGreaterThanOrEqual(1)
      const lastBack = Math.max(
        ...scene.solids.filter((s) => s.tableId === 't-back').map((s) => at(s.key)),
      )
      const firstFront = Math.min(
        ...scene.solids.filter((s) => s.tableId === 't-front').map((s) => at(s.key)),
      )
      expect(lastBack).toBeLessThan(Math.min(...between))
      expect(firstFront).toBeGreaterThan(Math.max(...between))
    })

    it('lo que está apoyado sobre el escenario se dibuja después del escenario', () => {
      const stage: FloorElement = {
        ...table(),
        id: 'stage',
        kind: 'stage',
        table_id: null,
        x: 0,
        y: 0,
        w: 400,
        h: 300,
      }
      const scene = buildScene(MODEL_CAMERA, [table({ x: 160, y: 110 }), stage])
      const at = paintIndex(scene)
      for (const solid of scene.solids.filter((s) => s.tableId === 't-1')) {
        expect(at(solid.key)).toBeGreaterThan(at('stage'))
      }
    })

    it('dos paredes que se encuentran en una esquina: la que viene hacia adelante va después', () => {
      const wallOf = (over: Partial<FloorElement>): FloorElement => ({
        ...table(),
        kind: 'wall',
        table_id: null,
        ...over,
      })
      // La del fondo y la del costado se pisan en la esquina (un cuadrado de 14 × 14).
      const back = wallOf({ id: 'back', x: 0, y: 0, w: 80, h: 14 })
      const side = wallOf({ id: 'side', x: 0, y: 0, w: 14, h: 80 })
      for (const elements of [
        [back, side],
        [side, back],
      ]) {
        const order = buildScene(MODEL_CAMERA, elements).solids.map((s) => s.key)
        expect(order).toEqual(['back:w0', 'side:w0'])
      }
    })

    it('una columna en medio de una pared asoma: se dibuja después de la pared', () => {
      const wall: FloorElement = {
        ...table(),
        id: 'w',
        kind: 'wall',
        table_id: null,
        x: 0,
        y: 100,
        w: 80,
        h: 40,
      }
      const pillar: FloorElement = {
        ...table(),
        id: 'col',
        kind: 'pillar',
        shape: 'circle',
        table_id: null,
        x: 30,
        y: 110,
        w: 20,
        h: 20,
      }
      const order = buildScene(MODEL_CAMERA, [pillar, wall]).solids.map((s) => s.key)
      expect(order.indexOf('col')).toBeGreaterThan(order.indexOf('w:w0'))
    })

    it('lo más bajo que quedó adentro de algo más alto va antes (queda tapado)', () => {
      // Una mesa metida de lleno en la huella de una isla (más alta): la isla la tapa.
      const island: FloorElement = {
        ...table(),
        id: 'isla',
        kind: 'island',
        table_id: null,
        x: 0,
        y: 0,
        w: 400,
        h: 300,
      }
      const scene = buildScene(MODEL_CAMERA, [island, table({ x: 160, y: 110 })], {
        chairs: false,
      })
      const order = scene.solids.map((s) => s.key)
      expect(order.indexOf('el-1:top')).toBeLessThan(order.indexOf('isla'))
    })

    it('el orden no depende de en qué orden llegan los elementos', () => {
      const elements = [
        bar(),
        table({ id: 'a', table_id: 'ta', x: 60, y: 60 }),
        table({ id: 'b', table_id: 'tb', x: 300, y: 80, w: 160, capacity: 6 }),
        table({ id: 'c', table_id: 'tc', x: 380, y: 400, shape: 'circle' }),
      ]
      const one = buildScene(MODEL_CAMERA, elements).solids.map((s) => s.key)
      const other = buildScene(MODEL_CAMERA, [...elements].reverse()).solids.map((s) => s.key)
      expect(other).toEqual(one)
    })

    it('el número de cada mesa se apila en el mismo orden que su tapa', () => {
      const back = table({ id: 'el-back', table_id: 't-back', y: 60 })
      const front = table({ id: 'el-front', table_id: 't-front', y: 400 })
      const scene = buildScene(MODEL_CAMERA, [front, back])
      const depthOfTable = (id: string) => scene.anchors.find((a) => a.tableId === id)?.depth ?? -1
      expect(depthOfTable('t-front')).toBeGreaterThan(depthOfTable('t-back'))
      expect(scene.solids[depthOfTable('t-back')]?.key).toBe('el-back:top')
      // Cada volumen sabe su lugar: lo usa quien necesite intercalar algo.
      expect(scene.solids.map((s) => s.depth)).toEqual(scene.solids.map((_, i) => i))
    })
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

describe('labelSize — el número de la mesa entra en su tapa', () => {
  it('los números de siempre usan el tamaño de siempre', () => {
    expect(labelSize('7', 60, 24)).toBe(24)
    expect(labelSize('12', 20, 24)).toBe(24)
  })

  it('un nombre largo se achica hasta entrar', () => {
    const size = labelSize('52 TERRAZA VIP', 70, 24)
    expect(size).toBeLessThan(24)
    // 14 caracteres a 0,52 del cuerpo no pasan del 86 % de la tapa.
    expect(14 * 0.52 * size).toBeLessThanOrEqual(70 * 0.86 + 1e-9)
  })

  it('nunca baja del mínimo legible ni sube del tamaño base', () => {
    expect(labelSize('MESA LARGUÍSIMA DEL FONDO', 30, 24)).toBe(8)
    expect(labelSize('101', 400, 24)).toBe(24)
  })

  it('sin ancho conocido no inventa: usa la base', () => {
    expect(labelSize('BARRA', 0, 24)).toBe(24)
  })
})

describe('chooseCamera — al lado del plano no gira', () => {
  const wide = [
    {
      id: 'a',
      area_id: 's',
      kind: 'table',
      shape: 'rect',
      x: 0,
      y: 0,
      w: 80,
      h: 80,
      rotation: 0,
      corner_radius: 8,
      z: 0,
      label: null,
      color: null,
      table_id: 't1',
      table_label: '1',
      capacity: 4,
    },
    {
      id: 'b',
      area_id: 's',
      kind: 'table',
      shape: 'rect',
      x: 900,
      y: 0,
      w: 80,
      h: 80,
      rotation: 0,
      corner_radius: 8,
      z: 0,
      label: null,
      color: null,
      table_id: 't2',
      table_label: '2',
      capacity: 4,
    },
  ] as const

  it('un sector apaisado en una pantalla parada se gira solo…', () => {
    expect(chooseCamera(wide, { width: 360, height: 700 }).turns).toBe(1)
  })

  it('…salvo que se pida que no', () => {
    expect(chooseCamera(wide, { width: 360, height: 700 }, undefined, undefined, false).turns).toBe(
      0,
    )
  })
})
