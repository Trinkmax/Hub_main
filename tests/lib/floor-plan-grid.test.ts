// Note: createSnapModifier and restrictToParent from dnd-kit were removed in the v2
// redesign (react-zoom-pan-pinch + pointer drag replaces dnd-kit on the canvas).
import { describe, expect, it } from 'vitest'
import {
  clampToArea,
  ELEMENT_DEFAULTS,
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
