import { describe, expect, it } from 'vitest'
import { captureKey, isCaptureSeen, markCaptureSeen } from '@/lib/m-session/capture-dismissal'

function fakeStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
  }
}

describe('capture-dismissal', () => {
  it('genera keys distintas por momento y sesión', () => {
    expect(captureKey('sheet', 's1')).toBe('hub:capture:sheet:s1')
    expect(captureKey('postorder', 's1')).toBe('hub:capture:postorder:s1')
    expect(captureKey('sheet', 's2')).not.toBe(captureKey('sheet', 's1'))
  })

  it('isCaptureSeen es false antes de marcar', () => {
    const store = fakeStore()
    expect(isCaptureSeen('sheet', 's1', store)).toBe(false)
  })

  it('markCaptureSeen luego isCaptureSeen es true', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', 's1', store)
    expect(isCaptureSeen('sheet', 's1', store)).toBe(true)
  })

  it('los momentos son independientes', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', 's1', store)
    expect(isCaptureSeen('postorder', 's1', store)).toBe(false)
  })

  it('las sesiones son independientes', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', 's1', store)
    expect(isCaptureSeen('sheet', 's2', store)).toBe(false)
  })

  it('sessionId vacío es no-op seguro', () => {
    const store = fakeStore()
    markCaptureSeen('sheet', '', store)
    expect(isCaptureSeen('sheet', '', store)).toBe(false)
  })
})
