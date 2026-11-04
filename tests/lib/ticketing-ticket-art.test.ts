import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import {
  guillocheFor,
  QR_EYE,
  seedFromId,
  stampRing,
  tornClipBottom,
  tornClipTop,
  tornProfile,
} from '@/lib/ticketing/ticket-art'
import { buildTicketQr } from '@/lib/ticketing/ticket-qr'

const URL = 'https://www.hubbar.com.ar/e/q83vEjR4TmSUaKxZ0Qd9bw'

/** Módulos que pinta el trazo: cada `M x y` + `V y2` o un punto suelto. */
function paintedModules(path: string): Set<string> {
  const painted = new Set<string>()
  for (const m of path.matchAll(/M([\d.]+) ([\d.]+)(?:V([\d.]+)|v\.001)/g)) {
    const x = Number(m[1]) - 0.5
    const y0 = Number(m[2]) - 0.5
    const y1 = m[3] ? Number(m[3]) - 0.5 : y0
    for (let y = y0; y <= y1; y++) painted.add(`${x},${y}`)
  }
  return painted
}

describe('el QR de la entrada', () => {
  const qr = buildTicketQr(URL)

  it('pinta exactamente los módulos del estándar, salvo los ojos y el hueco', () => {
    const { modules } = QRCode.create(URL, { errorCorrectionLevel: 'Q' })
    const size = modules.size
    expect(qr.size).toBe(size)
    const from = (size - qr.hole) / 2
    const painted = paintedModules(qr.path)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inEye =
          (x < QR_EYE && y < QR_EYE) ||
          (x >= size - QR_EYE && y < QR_EYE) ||
          (x < QR_EYE && y >= size - QR_EYE)
        const inHole = x >= from && x < from + qr.hole && y >= from && y < from + qr.hole
        const expected = modules.data[y * size + x] === 1 && !inEye && !inHole
        expect(painted.has(`${x},${y}`), `módulo ${x},${y}`).toBe(expected)
      }
    }
  })

  it('el hueco del centro es impar (queda centrado) y chico para la corrección Q', () => {
    expect(qr.hole % 2).toBe(1)
    expect((qr.hole * qr.hole) / (qr.size * qr.size)).toBeLessThan(0.03)
  })

  it('una URL como la de producción entra en una versión baja: puntos grandes', () => {
    expect(qr.size).toBeLessThanOrEqual(37)
  })
})

describe('la roseta del talón', () => {
  it('el mismo pedido, el mismo dibujo; otro pedido, otro', () => {
    const a = guillocheFor('ab7f3e12-9c4d-4a1b-8e2f-0d1c2b3a4f5e', 200)
    expect(guillocheFor('ab7f3e12-9c4d-4a1b-8e2f-0d1c2b3a4f5e', 200)).toEqual(a)
    expect(guillocheFor('11111111-9c4d-4a1b-8e2f-0d1c2b3a4f5e', 200).path).not.toBe(a.path)
  })

  it('es una curva cerrada', () => {
    const { path, copies, step } = guillocheFor('x', 100)
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(copies).toBeGreaterThan(1)
    expect(step).toBeGreaterThan(0)
  })
})

describe('el corte del talón', () => {
  const profile = tornProfile('pedido')

  it('es reproducible y va a los dientes (arriba, abajo, arriba…)', () => {
    expect(tornProfile('pedido')).toEqual(profile)
    expect(profile[0]).toBeGreaterThan(profile[1] as number)
    expect(profile[2]).toBeGreaterThan(profile[1] as number)
  })

  it('los dos lados del corte usan todos los dientes y son polígonos válidos', () => {
    const top = tornClipTop(profile)
    const bottom = tornClipBottom(profile)
    expect(top.startsWith('polygon(0 0, 100% 0,')).toBe(true)
    expect(bottom.endsWith('100% 100%, 0 100%)')).toBe(true)
    expect(top.split(',').length).toBe(profile.length + 2)
    expect(bottom.split(',').length).toBe(profile.length + 2)
  })
})

describe('el anillo del sello', () => {
  it('un nombre corto se repite hasta dar la vuelta', () => {
    expect(stampRing('Hub')).toBe('HUB ✦ BOLETERÍA ✦ HUB ✦ BOLETERÍA ✦ ')
  })
  it('un nombre largo va una sola vez', () => {
    expect(stampRing('HUB! Coffee & Bar')).toBe('HUB! COFFEE & BAR ✦ BOLETERÍA ✦ ')
  })
})

describe('seedFromId', () => {
  it('siempre un entero positivo', () => {
    expect(seedFromId('')).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(seedFromId('abc'))).toBe(true)
  })
})
