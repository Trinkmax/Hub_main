// Note: createSnapModifier and restrictToParent from dnd-kit were removed in the v2
// redesign (react-zoom-pan-pinch + pointer drag replaces dnd-kit on the canvas).
import { describe, expect, it } from 'vitest'
import {
  clampToArea,
  commitDragPosition,
  ELEMENT_DEFAULTS,
  freeDragPosition,
  GRID,
  RESIZE_MIN,
  snapToGrid,
  stagePointFromClient,
} from '@/lib/floor-plan/grid'

describe('constantes', () => {
  it('GRID y RESIZE_MIN tienen los valores del spec', () => {
    expect(GRID).toBe(20)
    expect(RESIZE_MIN).toBe(24)
  })

  it('ELEMENT_DEFAULTS cubre los 5 kinds con shape/width/height correctos', () => {
    expect(ELEMENT_DEFAULTS.table).toEqual({ shape: 'rect', width: 80, height: 80 })
    expect(ELEMENT_DEFAULTS.wall).toEqual({ shape: 'rect', width: 200, height: 16 })
    expect(ELEMENT_DEFAULTS.pillar).toEqual({ shape: 'circle', width: 40, height: 40 })
    expect(ELEMENT_DEFAULTS.island).toEqual({ shape: 'rect', width: 120, height: 80 })
    expect(ELEMENT_DEFAULTS.bar).toEqual({ shape: 'rect', width: 240, height: 40 })
  })
})

describe('snapToGrid', () => {
  it('redondea al múltiplo de GRID por defecto', () => {
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(9)).toBe(0) // 9/20 = 0.45 → round 0
    expect(snapToGrid(10)).toBe(20) // 10/20 = 0.5 → round 1 → 20
    expect(snapToGrid(11)).toBe(20)
    expect(snapToGrid(29)).toBe(20)
    expect(snapToGrid(30)).toBe(40)
    expect(snapToGrid(123)).toBe(120)
  })

  it('redondea negativos correctamente', () => {
    expect(snapToGrid(-9)).toBe(-0) // -9/20 = -0.45 → round -0
    expect(snapToGrid(-10)).toBe(-0) // Math.round(-0.5) = -0 (hacia +∞)
    expect(snapToGrid(-11)).toBe(-20)
    expect(snapToGrid(-30)).toBe(-20) // Math.round(-1.5) = -1 → -20
  })

  it('acepta un grid custom', () => {
    expect(snapToGrid(7, 5)).toBe(5)
    expect(snapToGrid(12, 5)).toBe(10)
    expect(snapToGrid(13, 5)).toBe(15)
  })
})

describe('clampToArea', () => {
  it('deja el elemento adentro si ya cabe', () => {
    expect(clampToArea(100, 100, 80, 80, 1200, 800)).toEqual({ x: 100, y: 100 })
  })

  it('clampea por izquierda/arriba a 0', () => {
    expect(clampToArea(-50, -30, 80, 80, 1200, 800)).toEqual({ x: 0, y: 0 })
  })

  it('clampea por derecha/abajo a areaW-w / areaH-h', () => {
    // x máximo = 1200 - 80 = 1120 ; y máximo = 800 - 80 = 720
    expect(clampToArea(2000, 2000, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 })
  })

  it('si el elemento es más grande que el área, lo fija en 0 (max < min ⇒ gana 0)', () => {
    // areaW-w = 1200 - 1300 = -100 ; clamp a [0, -100] colapsa a 0
    expect(clampToArea(50, 50, 1300, 900, 1200, 800)).toEqual({ x: 0, y: 0 })
  })

  it('borde exacto: x = areaW - w queda igual', () => {
    expect(clampToArea(1120, 720, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 720 })
  })
})

describe('stagePointFromClient', () => {
  const rect = { left: 100, top: 50 }

  it('a scale=1 sin pan: resta solo el origen del wrapper', () => {
    // (300-100-0)/1 = 200 ; (250-50-0)/1 = 200
    expect(stagePointFromClient(300, 250, rect, 1, 0, 0)).toEqual({ x: 200, y: 200 })
  })

  it('a scale=1 con pan: resta origen + pan', () => {
    // (300-100-40)/1 = 160 ; (250-50-30)/1 = 170
    expect(stagePointFromClient(300, 250, rect, 1, 40, 30)).toEqual({ x: 160, y: 170 })
  })

  it('a scale=2 con pan: (pantalla - origen - pan) / scale', () => {
    // x: (300-100-40)/2 = 80 ; y: (250-50-30)/2 = 85
    expect(stagePointFromClient(300, 250, rect, 2, 40, 30)).toEqual({ x: 80, y: 85 })
  })

  it('a scale=0.5 escala hacia arriba el delta de pantalla', () => {
    // x: (300-100-0)/0.5 = 400 ; y: (250-50-0)/0.5 = 400
    expect(stagePointFromClient(300, 250, rect, 0.5, 0, 0)).toEqual({ x: 400, y: 400 })
  })
})

describe('drag-commit math (bug class v1)', () => {
  // En el editor, el commit de drag usa:
  //   newX = snapToGrid(origX + (clientX - startX) / scale)
  //   newY = snapToGrid(origY + (clientY - startY) / scale)
  // Luego clampToArea. A scale=1 delta == delta_lógico; a scale=2 hay que dividir.

  it('a scale=1 el delta se aplica sin corrección (comportamiento normal)', () => {
    const origX = 100
    const origY = 80
    const deltaClientX = 43 // movimiento en px pantalla
    const deltaClientY = 17
    const scale = 1
    const newX = snapToGrid(origX + deltaClientX / scale)
    const newY = snapToGrid(origY + deltaClientY / scale)
    // 100 + 43 = 143 → snapToGrid(143) = round(143/20)*20 = round(7.15)*20 = 7*20 = 140
    expect(newX).toBe(140)
    // 80 + 17 = 97 → snapToGrid(97) = round(4.85)*20 = 5*20 = 100
    expect(newY).toBe(100)
  })

  it('a scale=2 dividir por scale evita el drift doble (BUG v1 sin división)', () => {
    const origX = 100
    const origY = 80
    const deltaClientX = 86 // 43px lógicos * scale 2
    const deltaClientY = 34 // 17px lógicos * scale 2
    const scale = 2

    // Correcto (divide por scale):
    const newXCorrect = snapToGrid(origX + deltaClientX / scale)
    const newYCorrect = snapToGrid(origY + deltaClientY / scale)
    // 100 + 86/2 = 100 + 43 = 143 → snap → 140
    expect(newXCorrect).toBe(140)
    // 80 + 34/2 = 80 + 17 = 97 → snap → 100
    expect(newYCorrect).toBe(100)

    // Sin división (bug v1): el elemento se desplaza el doble del movimiento visual.
    const newXBug = snapToGrid(origX + deltaClientX)
    expect(newXBug).not.toBe(140) // 100 + 86 = 186 → snap → 180 (incorrecto)
    expect(newXBug).toBe(180) // documenta el valor que producía el bug
  })

  it('a scale=0.5 el delta lógico es mayor que el visual (zoom-out)', () => {
    const origX = 200
    const deltaClientX = 20 // 20px en pantalla → 40px lógicos a scale 0.5
    const scale = 0.5
    const newX = snapToGrid(origX + deltaClientX / scale)
    // 200 + 40 = 240 → snap → 240
    expect(newX).toBe(240)
  })

  it('clampToArea después del snap limita al borde del área', () => {
    const origX = 1100
    const deltaClientX = 200 // intento de sacar del área
    const scale = 1
    const areaW = 1200
    const w = 80
    const rawX = origX + deltaClientX / scale // 1300
    const snapped = snapToGrid(rawX) // 1300 → round(65)*20 = 65*20 = 1300
    const { x } = clampToArea(snapped, 0, w, 80, areaW, 800)
    // máx = 1200 - 80 = 1120
    expect(x).toBe(1120)
  })
})

describe('freeDragPosition (posición viva del gesto — SIN snap)', () => {
  // La posición libre sigue al cursor 1:1 en coords lógicas: origX + dxPantalla/scale,
  // sólo clampeada al área. Es lo que se pinta con translate3d durante el drag.

  it('a scale=1 sigue el delta de pantalla 1:1 (sin snap, sin escalonado)', () => {
    expect(freeDragPosition(100, 80, 43, 17, 1, 80, 80, 1200, 800)).toEqual({ x: 143, y: 97 })
  })

  it('a scale=4 un drag CHICO sí mueve (arregla la "zona muerta" a zoom alto)', () => {
    // El bug viejo snapeaba en cada move → a scale 4 drags <40px de pantalla no movían nada.
    // La posición libre se mueve siempre: dx=4 de pantalla = 1px lógico → 101 (NO se clava).
    expect(freeDragPosition(100, 80, 4, 0, 4, 80, 80, 1200, 800)).toEqual({ x: 101, y: 80 })
    expect(freeDragPosition(100, 80, 8, 0, 4, 80, 80, 1200, 800)).toEqual({ x: 102, y: 80 })
    // dx=40 de pantalla = 10px lógicos → 110 (seguimiento exacto, sin saltar de a 20).
    expect(freeDragPosition(100, 80, 40, 0, 4, 80, 80, 1200, 800)).toEqual({ x: 110, y: 80 })
  })

  it('a scale=0.5 amplifica el delta de pantalla a lógico (zoom-out)', () => {
    // 20px de pantalla / 0.5 = 40px lógicos.
    expect(freeDragPosition(200, 200, 20, 20, 0.5, 80, 80, 1200, 800)).toEqual({ x: 240, y: 240 })
  })

  it('clampea al borde del área (sin snap)', () => {
    // raw x = 1100 + 200 = 1300 → clamp a 1200-80 = 1120.
    expect(freeDragPosition(1100, 0, 200, 0, 1, 80, 80, 1200, 800)).toEqual({ x: 1120, y: 0 })
  })
})

describe('commitDragPosition (commit al soltar)', () => {
  // Al soltar: snapToGrid(origX + dxPantalla/scale) + clampToArea, salvo Alt (snap=false → libre).

  it('snap=true a scale=1 cae a la grilla de 20px', () => {
    // 100+43=143 → snap 140 ; 80+17=97 → snap 100.
    expect(commitDragPosition(100, 80, 43, 17, 1, 80, 80, 1200, 800, true)).toEqual({
      x: 140,
      y: 100,
    })
  })

  it('snap=true a scale=4 cae a la grilla aunque el drag haya sido fino', () => {
    // dx=40 pantalla = 10 lógicos → raw 110 → snap 120.
    expect(commitDragPosition(100, 80, 40, 0, 4, 80, 80, 1200, 800, true)).toEqual({
      x: 120,
      y: 80,
    })
    // dx=4 pantalla = 1 lógico → raw 101 → snap 100 (vuelve a la celda; durante el drag SÍ se movió).
    expect(commitDragPosition(100, 80, 4, 0, 4, 80, 80, 1200, 800, true)).toEqual({ x: 100, y: 80 })
  })

  it('snap=false (Alt) deja la posición libre, sólo clampeada', () => {
    expect(commitDragPosition(100, 80, 43, 17, 1, 80, 80, 1200, 800, false)).toEqual({
      x: 143,
      y: 97,
    })
  })

  it('SIEMPRE devuelve enteros (la geometría persistida es z.number().int())', () => {
    // A scale fraccional (p.ej. tras wheel-zoom step 0.2 → 1.3), el commit libre (Alt)
    // daría un float que el schema rechaza → rollback. Debe redondearse a entero.
    const free = commitDragPosition(100, 80, 5, 5, 1.3, 80, 80, 1200, 800, false)
    expect(Number.isInteger(free.x)).toBe(true)
    expect(Number.isInteger(free.y)).toBe(true)
    // x: 100 + 5/1.3 = 103.846… → 104 ; y: 80 + 5/1.3 = 83.846… → 84.
    expect(free).toEqual({ x: 104, y: 84 })
    // El path con snap también es entero (múltiplo de 20) a scale fraccional.
    const snapped = commitDragPosition(100, 80, 5, 5, 1.3, 80, 80, 1200, 800, true)
    expect(Number.isInteger(snapped.x)).toBe(true)
    expect(Number.isInteger(snapped.y)).toBe(true)
  })

  it('clampea después del snap al borde del área', () => {
    // raw 1300 → snap 1300 → clamp 1120.
    expect(commitDragPosition(1100, 0, 200, 0, 1, 80, 80, 1200, 800, true)).toEqual({
      x: 1120,
      y: 0,
    })
  })
})
