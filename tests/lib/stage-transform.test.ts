import { describe, expect, it } from 'vitest'
import { fitTransform, readStageTransform } from '@/lib/floor-plan/stage-transform'

// Regresión del bug: el ref de react-zoom-pan-pinch expone getControls() → { instance, ... },
// SIN `.state`. Leer `ref.current.state.scale` lanzaba en runtime (el tipo lo declara, pero
// no existe). El estado vivo está en `instance.transformState`.

type StageRef = Parameters<typeof readStageTransform>[0]

// Stub estructural del ref (el tipo real ReactZoomPanPinchRef es enorme; sólo nos importa
// lo que la función lee). Cast vía unknown para no usar `any`.
const makeRef = (current: unknown): StageRef => ({ current }) as unknown as StageRef

describe('readStageTransform', () => {
  it('lee scale/posición desde instance.transformState', () => {
    const ref = makeRef({
      instance: { transformState: { scale: 2.5, positionX: 40, positionY: -12 } },
    })
    expect(readStageTransform(ref)).toEqual({ scale: 2.5, positionX: 40, positionY: -12 })
  })

  it('cae a defaults (1, 0, 0) si el ref todavía no montó (current null)', () => {
    expect(readStageTransform(makeRef(null))).toEqual({ scale: 1, positionX: 0, positionY: 0 })
  })

  it('cae a defaults si instance/transformState faltan', () => {
    expect(readStageTransform(makeRef({ instance: undefined }))).toEqual({
      scale: 1,
      positionX: 0,
      positionY: 0,
    })
    expect(readStageTransform(makeRef({ instance: {} }))).toEqual({
      scale: 1,
      positionX: 0,
      positionY: 0,
    })
  })

  it('NO usa `.state` (el ref real de rzpp no lo expone) aunque esté presente', () => {
    const ref = makeRef({
      state: { scale: 9, positionX: 99, positionY: 99 }, // trampa: no debe leerse
      instance: { transformState: { scale: 3, positionX: 5, positionY: 7 } },
    })
    expect(readStageTransform(ref)).toEqual({ scale: 3, positionX: 5, positionY: 7 })
  })
})

describe('fitTransform', () => {
  const viewport = { width: 600, height: 400 }

  it('encaja el piso entero centrado, con margen', () => {
    const t = fitTransform(viewport, { x: 0, y: 0, width: 1200, height: 800 }, { padding: 20 })
    // Manda el alto, que es lo que menos lugar tiene: (400 - 40) / 800.
    expect(t.scale).toBeCloseTo(360 / 800, 6)
    // El piso queda centrado en el visor.
    expect(t.positionX + (1200 * t.scale) / 2).toBeCloseTo(300, 6)
    expect(t.positionY + (800 * t.scale) / 2).toBeCloseTo(200, 6)
  })

  it('una caja corrida del origen también queda centrada (su esquina cuenta)', () => {
    const box = { x: 400, y: 300, width: 200, height: 100 }
    const t = fitTransform(viewport, box)
    expect(t.scale).toBeCloseTo(3, 6)
    // Punto lógico → pantalla: positionX + x · scale.
    expect(t.positionX + (box.x + box.width / 2) * t.scale).toBeCloseTo(300, 6)
    expect(t.positionY + (box.y + box.height / 2) * t.scale).toBeCloseTo(200, 6)
  })

  it('no agranda más allá de maxScale: un sector chico no se infla', () => {
    const t = fitTransform(viewport, { x: 0, y: 0, width: 100, height: 100 }, { maxScale: 1.25 })
    expect(t.scale).toBe(1.25)
    expect(t.positionX).toBeCloseTo((600 - 125) / 2, 6)
    expect(t.positionY).toBeCloseTo((400 - 125) / 2, 6)
  })

  it('no achica por debajo de minScale (el límite del zoom)', () => {
    const t = fitTransform(viewport, { x: 0, y: 0, width: 60000, height: 100 }, { minScale: 0.1 })
    expect(t.scale).toBe(0.1)
  })

  it('aguanta un visor todavía sin medir sin dividir por cero', () => {
    const t = fitTransform({ width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(Number.isFinite(t.positionX)).toBe(true)
    expect(Number.isFinite(t.positionY)).toBe(true)
  })

  describe('con herramientas flotando encima (inset)', () => {
    // El tablero del editor: la barra de agregar arriba, la paleta a la izquierda y el zoom abajo.
    const inset = { top: 52, right: 8, bottom: 52, left: 68 }
    const box = { x: 0, y: 0, width: 1200, height: 800 }

    it('el piso entra entero en lo que queda libre: nada queda debajo de una herramienta', () => {
      const t = fitTransform(viewport, box, { inset, padding: 14 })
      const left = t.positionX
      const top = t.positionY
      const right = t.positionX + box.width * t.scale
      const bottom = t.positionY + box.height * t.scale
      expect(left).toBeGreaterThanOrEqual(inset.left + 14 - 1e-6)
      expect(top).toBeGreaterThanOrEqual(inset.top + 14 - 1e-6)
      expect(right).toBeLessThanOrEqual(viewport.width - inset.right - 14 + 1e-6)
      expect(bottom).toBeLessThanOrEqual(viewport.height - inset.bottom - 14 + 1e-6)
    })

    it('y queda centrado en esa zona libre, no en el visor entero', () => {
      const t = fitTransform(viewport, box, { inset })
      const freeCenterX = inset.left + (viewport.width - inset.left - inset.right) / 2
      const freeCenterY = inset.top + (viewport.height - inset.top - inset.bottom) / 2
      expect(t.positionX + (box.width / 2) * t.scale).toBeCloseTo(freeCenterX, 6)
      expect(t.positionY + (box.height / 2) * t.scale).toBeCloseTo(freeCenterY, 6)
    })

    it('sin inset da exactamente lo de siempre', () => {
      expect(fitTransform(viewport, box, { padding: 28, inset: {} })).toEqual(
        fitTransform(viewport, box, { padding: 28 }),
      )
    })

    it('un inset más grande que el visor no rompe la cuenta', () => {
      const t = fitTransform({ width: 100, height: 80 }, box, {
        inset: { top: 60, right: 60, bottom: 60, left: 60 },
      })
      expect(t.scale).toBeGreaterThan(0)
      expect(Number.isFinite(t.positionX)).toBe(true)
      expect(Number.isFinite(t.positionY)).toBe(true)
    })
  })
})
