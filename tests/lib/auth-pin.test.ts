// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  encodeDevice,
  isPinShape,
  isWeakPin,
  PIN_LENGTH,
  parseDevice,
  parsePinAccounts,
  parsePinVerify,
  pinFailureMessage,
  pinProblem,
  safeNext,
} from '@/lib/auth/pin'

/**
 * El PIN de ingreso por equipo: qué PIN se acepta, cómo se lee la cookie del equipo y qué se le dice a
 * quien no pudo entrar. (Guardarlo, comprobarlo y bloquearlo lo hace la base: `tests/rls/device-pins`.)
 */

const DEVICE = '3b0f1c52-9a41-4a7e-8c2d-5e6f7a8b9c0d'
const SECRET = 'q7Zk2mN8pL4xV1bT6yH3wR9sD5fG0jC_aB-cEdFgHiJ'

describe('qué PIN se acepta', () => {
  it('son cuatro números, ni más ni menos', () => {
    expect(PIN_LENGTH).toBe(4)
    expect(isPinShape('4827')).toBe(true)
    for (const bad of ['482', '48271', '48a7', '', ' 4827', '４８２７', 4827, null, undefined]) {
      expect(isPinShape(bad)).toBe(false)
    }
  })

  it('no los que cualquiera prueba primero: cuatro iguales o una escalera', () => {
    for (const weak of ['0000', '1111', '9999', '0123', '1234', '6789', '9876', '4321', '3210']) {
      expect(isWeakPin(weak)).toBe(true)
    }
    for (const fine of ['4827', '1357', '1235', '1122', '2580', '0852', '1212']) {
      expect(isWeakPin(fine)).toBe(false)
    }
  })

  it('dice por qué no sirve, en palabras de la persona', () => {
    expect(pinProblem('4827')).toBeNull()
    expect(pinProblem('48')).toBe('El PIN son 4 números.')
    expect(pinProblem('1234')).toMatch(/fácil de adivinar/)
  })
})

describe('la cookie del equipo', () => {
  it('va y vuelve', () => {
    const value = encodeDevice({ id: DEVICE, secret: SECRET })
    expect(value).toBe(`${DEVICE}.${SECRET}`)
    expect(parseDevice(value)).toEqual({ id: DEVICE, secret: SECRET })
    expect(parseDevice(value.toUpperCase())?.id).toBe(DEVICE)
  })

  it('algo con otra forma es como no tener cookie', () => {
    for (const bad of [
      null,
      undefined,
      '',
      DEVICE,
      `${DEVICE}.`,
      `.${SECRET}`,
      `no-es-un-id.${SECRET}`,
      `${DEVICE}.corto`,
      `${DEVICE}.${SECRET}; otra=cosa`,
      `${DEVICE}.<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa`,
    ]) {
      expect(parseDevice(bad)).toBeNull()
    }
  })
})

describe('quiénes pueden entrar con PIN en un equipo', () => {
  it('toma solo las filas con forma de cuenta, y nunca un mail', () => {
    const accounts = parsePinAccounts([
      { id: DEVICE, name: 'Sofi G.', locked: false },
      { id: 'no-es-un-id', name: 'Intruso' },
      { id: '4c1e2d63-0b52-4b8f-9d3e-6f7a8b9c0d1e', name: '  ', locked: true, email: 'x@y.com' },
      null,
      'texto',
    ])
    expect(accounts).toEqual([
      { id: DEVICE, name: 'Sofi G.', locked: false },
      { id: '4c1e2d63-0b52-4b8f-9d3e-6f7a8b9c0d1e', name: 'Sin nombre', locked: true },
    ])
    expect(parsePinAccounts(null)).toEqual([])
    expect(parsePinAccounts({ id: DEVICE })).toEqual([])
  })
})

describe('lo que contesta la base al comprobar un PIN', () => {
  it('acertó: a quién abrirle la sesión', () => {
    expect(parsePinVerify({ ok: true, user_id: 'u1', email: 'sofi@bar.com' })).toEqual({
      ok: true,
      userId: 'u1',
      email: 'sofi@bar.com',
    })
  })

  it('un «ok» sin datos no abre nada', () => {
    expect(parsePinVerify({ ok: true })).toEqual({ ok: false, reason: 'gone' })
    expect(parsePinVerify({ ok: true, user_id: 'u1', email: 'sin-arroba' })).toEqual({
      ok: false,
      reason: 'gone',
    })
    expect(parsePinVerify({ ok: 'true', user_id: 'u1', email: 'a@b.c' })).toEqual({
      ok: false,
      reason: 'gone',
    })
  })

  it('se equivocó: cuántos intentos quedan; sin intentos, está bloqueado', () => {
    expect(parsePinVerify({ ok: false, reason: 'wrong', left: 3 })).toEqual({
      ok: false,
      reason: 'wrong',
      left: 3,
    })
    expect(parsePinVerify({ ok: false, reason: 'wrong', left: 0 })).toEqual({
      ok: false,
      reason: 'locked',
    })
    expect(parsePinVerify({ ok: false, reason: 'wrong' })).toEqual({ ok: false, reason: 'locked' })
  })

  it('lo que no se entiende es «ese PIN ya no está»', () => {
    for (const odd of [null, undefined, 'ok', 42, {}, { ok: false, reason: 'otra' }]) {
      expect(parsePinVerify(odd)).toEqual({ ok: false, reason: 'gone' })
    }
    expect(parsePinVerify({ ok: false, reason: 'locked' })).toEqual({ ok: false, reason: 'locked' })
    expect(parsePinVerify({ ok: false, reason: 'password' })).toEqual({
      ok: false,
      reason: 'password',
    })
  })

  it('se lo dice claro a la persona', () => {
    expect(pinFailureMessage({ ok: false, reason: 'wrong', left: 4 })).toBe(
      'Ese no es. Te quedan 4 intentos.',
    )
    expect(pinFailureMessage({ ok: false, reason: 'wrong', left: 1 })).toBe(
      'Ese no es. Te queda 1 intento.',
    )
    expect(pinFailureMessage({ ok: false, reason: 'locked' })).toMatch(/bloqueado/)
    expect(pinFailureMessage({ ok: false, reason: 'password' })).toMatch(/contraseña/)
    expect(pinFailureMessage({ ok: false, reason: 'gone' })).toMatch(/ya no está/)
  })
})

describe('a dónde se vuelve después de entrar', () => {
  it('solo a direcciones de esta misma app', () => {
    expect(safeNext('/hub/salon/mapa')).toBe('/hub/salon/mapa')
    expect(safeNext('//otro.sitio')).toBe('/')
    expect(safeNext('https://otro.sitio')).toBe('/')
    expect(safeNext('')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
})
