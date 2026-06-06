import type { Transform } from '@dnd-kit/utilities'
import { describe, expect, it } from 'vitest'
import {
  clampToArea,
  createSnapModifier,
  ELEMENT_DEFAULTS,
  GRID,
  RESIZE_MIN,
  restrictToParent,
  snapToGrid,
  stagePointFromClient,
} from '@/lib/floor-plan/grid'

// ClientRect de dnd-kit: { width, height, top, left, right, bottom }.
type RectLike = {
  width: number
  height: number
  top: number
  left: number
  right: number
  bottom: number
}

function rect(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function transform(x: number, y: number, scaleX = 1, scaleY = 1): Transform {
  return { x, y, scaleX, scaleY }
}

// Llama un Modifier construyendo el subconjunto de args que usa (transform +
// los dos rects). El resto de campos del ModifierArguments no se leen en
// nuestros modifiers, así que casteamos la función a la firma mínima.
function callModifier(
  modifier: ReturnType<typeof createSnapModifier>,
  args: {
    transform: Transform
    draggingNodeRect?: RectLike | null
    containerNodeRect?: RectLike | null
  },
): Transform {
  const fn = modifier as unknown as (a: {
    transform: Transform
    draggingNodeRect: RectLike | null
    containerNodeRect: RectLike | null
  }) => Transform
  return fn({
    transform: args.transform,
    draggingNodeRect: args.draggingNodeRect ?? null,
    containerNodeRect: args.containerNodeRect ?? null,
  })
}

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

describe('createSnapModifier', () => {
  it('a scale=1 snapea x/y al grid lógico (= px pantalla)', () => {
    const m = createSnapModifier(GRID, () => 1)
    // 23 px → round(23/1/20)*20*1 = round(1.15)*20 = 20
    const out = callModifier(m, { transform: transform(23, 9) })
    expect(out.x).toBe(20)
    expect(out.y).toBe(0) // round(9/20)=0
  })

  it('a scale=2 snapea en espacio lógico y devuelve px de pantalla', () => {
    const m = createSnapModifier(GRID, () => 2)
    // x pantalla 50 → lógico 25 → round(25/20)=1 → lógico 20 → pantalla 40
    const out = callModifier(m, { transform: transform(50, 86) })
    expect(out.x).toBe(40)
    // y pantalla 86 → lógico 43 → round(43/20)=2 → lógico 40 → pantalla 80
    expect(out.y).toBe(80)
  })

  it('preserva scaleX/scaleY (return { ...transform, x, y })', () => {
    const m = createSnapModifier(GRID, () => 1)
    const out = callModifier(m, { transform: transform(23, 9, 1, 1) })
    expect(out.scaleX).toBe(1)
    expect(out.scaleY).toBe(1)
  })

  it('lee el scale vigente desde getScale en cada llamada (closure)', () => {
    let scale = 1
    const m = createSnapModifier(GRID, () => scale)
    expect(callModifier(m, { transform: transform(50, 0) }).x).toBe(60) // lógico 50→40? -> ver abajo
    // a scale=1: x=50 → round(50/20)=3 (2.5→3) → 60
    scale = 2
    // a scale=2: x=50 → lógico 25 → round(1.25)=1 → lógico 20 → pantalla 40
    expect(callModifier(m, { transform: transform(50, 0) }).x).toBe(40)
  })
})

describe('restrictToParent', () => {
  it('sin rects devuelve el transform sin tocar (no puede clampear)', () => {
    const m = restrictToParent(() => 1)
    const out = callModifier(m, { transform: transform(123, 45) })
    expect(out.x).toBe(123)
    expect(out.y).toBe(45)
    expect(out.scaleX).toBe(1)
  })

  it('a scale=1 clampea para que el elemento no se salga del contenedor', () => {
    const m = restrictToParent(() => 1)
    // contenedor (viewport): left 0, top 0, 1000×600
    const container = rect(0, 0, 1000, 600)
    // elemento arrastrado: actualmente en left 900, top 500, 80×80
    const dragging = rect(900, 500, 80, 80)
    // empuje +200/+200 → saldría a 1100/700 (right 1180, bottom 780) fuera del contenedor.
    // máx x permitido = 1000 - (900+80) = 20 ; máx y = 600 - (500+80) = 20
    const out = callModifier(m, {
      transform: transform(200, 200),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.x).toBe(20)
    expect(out.y).toBe(20)
  })

  it('a scale=1 clampea por el borde mínimo (no dejar pasar el top/left del contenedor)', () => {
    const m = restrictToParent(() => 1)
    const container = rect(0, 0, 1000, 600)
    const dragging = rect(100, 80, 80, 80)
    // empuje -300/-300 → left -200, top -220 (fuera por arriba/izq)
    // mín x = 0 - 100 = -100 ; mín y = 0 - 80 = -80
    const out = callModifier(m, {
      transform: transform(-300, -300),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.x).toBe(-100)
    expect(out.y).toBe(-80)
  })

  it('a scale=2 clampea en espacio lógico (divide los rects por scale)', () => {
    const m = restrictToParent(() => 2)
    // rects en px PANTALLA (lo que reporta dnd-kit bajo transform: scale(2))
    // contenedor pantalla 0,0,2000×1200 → lógico 0,0,1000×600
    const container = rect(0, 0, 2000, 1200)
    // elemento pantalla en left 1800, top 1000, 160×160 → lógico left 900, top 500, 80×80
    const dragging = rect(1800, 1000, 160, 160)
    // transform en px PANTALLA: +400/+400 → lógico +200/+200
    // en lógico: máx x = 1000 - (900+80) = 20 ; clamp lógico 200→20 → pantalla 40
    const out = callModifier(m, {
      transform: transform(400, 400),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.x).toBe(40) // 20 lógico * 2
    expect(out.y).toBe(40)
  })

  it('preserva scaleX/scaleY al clampear', () => {
    const m = restrictToParent(() => 1)
    const container = rect(0, 0, 1000, 600)
    const dragging = rect(900, 500, 80, 80)
    const out = callModifier(m, {
      transform: transform(200, 200, 1, 1),
      draggingNodeRect: dragging,
      containerNodeRect: container,
    })
    expect(out.scaleX).toBe(1)
    expect(out.scaleY).toBe(1)
  })
})

describe('stagePointFromClient', () => {
  it('a scale=1 sin pan devuelve clientX-rect.left, clientY-rect.top', () => {
    // rect.left=50, rect.top=80; posX=0, posY=0; scale=1
    // clientX=350, clientY=280 → x=(350-50-0)/1=300, y=(280-80-0)/1=200
    expect(stagePointFromClient(350, 280, { left: 50, top: 80 }, 1, 0, 0)).toEqual({
      x: 300,
      y: 200,
    })
  })

  it('a scale=2 sin pan divide por scale', () => {
    // rect.left=0, rect.top=0; posX=0, posY=0; scale=2
    // clientX=200, clientY=100 → x=200/2=100, y=100/2=50
    expect(stagePointFromClient(200, 100, { left: 0, top: 0 }, 2, 0, 0)).toEqual({
      x: 100,
      y: 50,
    })
  })

  it('a scale=1 con pan (posX=100, posY=60) descuenta el pan antes de dividir', () => {
    // rect.left=0, rect.top=0; posX=100, posY=60; scale=1
    // clientX=250, clientY=160 → x=(250-0-100)/1=150, y=(160-0-60)/1=100
    expect(stagePointFromClient(250, 160, { left: 0, top: 0 }, 1, 100, 60)).toEqual({
      x: 150,
      y: 100,
    })
  })

  it('a scale=2 con pan y rect offset combina los tres factores', () => {
    // rect.left=20, rect.top=10; posX=40, posY=20; scale=2
    // clientX=180, clientY=90
    // x=(180-20-40)/2 = 120/2 = 60
    // y=(90-10-20)/2  = 60/2  = 30
    expect(stagePointFromClient(180, 90, { left: 20, top: 10 }, 2, 40, 20)).toEqual({
      x: 60,
      y: 30,
    })
  })
})
