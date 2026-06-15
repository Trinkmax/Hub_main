import { describe, expect, it } from 'vitest'
import { computeRunAtOffsetMs } from '@/lib/broadcasts/throttle'

describe('computeRunAtOffsetMs', () => {
  it('los primeros `rate` mensajes salen en el segundo 0', () => {
    expect(computeRunAtOffsetMs(0, 10)).toBe(0)
    expect(computeRunAtOffsetMs(9, 10)).toBe(0)
  })
  it('el mensaje rate sale en el segundo 1', () => {
    expect(computeRunAtOffsetMs(10, 10)).toBe(1000)
    expect(computeRunAtOffsetMs(19, 10)).toBe(1000)
    expect(computeRunAtOffsetMs(20, 10)).toBe(2000)
  })
  it('rate inválido se trata como 1/seg', () => {
    expect(computeRunAtOffsetMs(3, 0)).toBe(3000)
    expect(computeRunAtOffsetMs(3, -5)).toBe(3000)
  })
})
