import { describe, expect, it } from 'vitest'
import { readStageTransform } from '@/lib/floor-plan/stage-transform'

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
