// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  canSkipCurrentPassword,
  FIRST_PASSWORD_PATH,
  firstPasswordRedirect,
  MUST_CHANGE_CLEARED,
  mustChangeMark,
  mustChangePassword,
  passwordLoginAt,
  roleMustChoosePassword,
} from '@/lib/auth/first-password'

/**
 * La primera contraseña: la que le pone otra persona es para arrancar, y hasta que elija la suya la
 * cuenta no pasa de la pantalla de elegirla.
 */

const MARKED = { provider: 'email', must_change_password: true, must_change_since: 1000 }

describe('la marca', () => {
  it('solo vale un `true` de verdad', () => {
    expect(mustChangePassword(MARKED)).toBe(true)
    expect(mustChangePassword({ must_change_password: 'true' })).toBe(false)
    expect(mustChangePassword({ must_change_password: false })).toBe(false)
    expect(mustChangePassword({})).toBe(false)
    expect(mustChangePassword(null)).toBe(false)
    expect(mustChangePassword('must_change_password')).toBe(false)
    expect(mustChangePassword([true])).toBe(false)
  })

  it('se pone con la hora y se saca borrando las dos claves', () => {
    expect(mustChangeMark(1_764_000_000_999)).toEqual({
      must_change_password: true,
      must_change_since: 1_764_000_000,
    })
    expect(MUST_CHANGE_CLEARED).toEqual({ must_change_password: null, must_change_since: null })
    expect(mustChangePassword(mustChangeMark(Date.now()))).toBe(true)
  })

  it('la cocina no está obligada a cambiarla; las personas sí', () => {
    expect(roleMustChoosePassword('kitchen')).toBe(false)
    for (const role of ['waiter', 'cashier', 'host', 'editor', 'accountant', 'owner']) {
      expect(roleMustChoosePassword(role)).toBe(true)
    }
    expect(roleMustChoosePassword(null)).toBe(false)
  })
})

describe('a dónde va una cuenta marcada', () => {
  it('cualquier pantalla de la app la manda a elegir su contraseña', () => {
    for (const path of [
      '/',
      '/hub',
      '/hub/salon/mapa',
      '/hub/configuracion/equipo',
      '/onboarding',
    ]) {
      expect(firstPasswordRedirect(MARKED, path, false)).toBe(FIRST_PASSWORD_PATH)
    }
    // También las rutas de la API: no se usa la app a medias.
    expect(firstPasswordRedirect(MARKED, '/api/sessions', false)).toBe(FIRST_PASSWORD_PATH)
  })

  it('la pantalla de elegirla, y sus acciones, pasan', () => {
    expect(firstPasswordRedirect(MARKED, FIRST_PASSWORD_PATH, true)).toBeNull()
    expect(firstPasswordRedirect(MARKED, '/auth/callback', true)).toBeNull()
    expect(firstPasswordRedirect(MARKED, '/auth/pin', true)).toBeNull()
  })

  it('lo público sigue siendo público, menos el ingreso', () => {
    expect(firstPasswordRedirect(MARKED, '/carta/hub', true)).toBeNull()
    expect(firstPasswordRedirect(MARKED, '/icons/icon-192.png', true)).toBeNull()
    // Con sesión y marcada, en /login no hay nada que hacer.
    expect(firstPasswordRedirect(MARKED, '/login', true)).toBe(FIRST_PASSWORD_PATH)
  })

  it('una cuenta sin marca no se toca', () => {
    expect(firstPasswordRedirect({ provider: 'email' }, '/hub/salon/mapa', false)).toBeNull()
    expect(firstPasswordRedirect(null, '/login', true)).toBeNull()
  })
})

describe('¿hay que volver a pedirle la contraseña que le dieron?', () => {
  const claims = (method: string, timestamp: number | string) => ({ amr: [{ method, timestamp }] })

  it('lee cuándo entró con contraseña', () => {
    expect(passwordLoginAt(claims('password', 2000))).toBe(2000)
    expect(passwordLoginAt(claims('password', '2000'))).toBe(2000)
    expect(passwordLoginAt(claims('otp', 2000))).toBeNull()
    expect(passwordLoginAt({ amr: 'password' })).toBeNull()
    expect(passwordLoginAt(null)).toBeNull()
    // Con varias entradas, la última con contraseña.
    expect(
      passwordLoginAt({
        amr: [
          { method: 'password', timestamp: 100 },
          { method: 'otp', timestamp: 900 },
          { method: 'password', timestamp: 500 },
        ],
      }),
    ).toBe(500)
  })

  it('no, si la acaba de tipear: entró con contraseña después de que se la pusieran', () => {
    expect(canSkipCurrentPassword(MARKED, claims('password', 1000))).toBe(true)
    expect(canSkipCurrentPassword(MARKED, claims('password', 5000))).toBe(true)
  })

  it('sí, si la sesión es anterior o no entró con contraseña', () => {
    expect(canSkipCurrentPassword(MARKED, claims('password', 999))).toBe(false)
    expect(canSkipCurrentPassword(MARKED, claims('otp', 5000))).toBe(false)
    expect(canSkipCurrentPassword(MARKED, {})).toBe(false)
  })

  it('una marca sin hora (las cuentas del alta del equipo) vale desde siempre', () => {
    expect(canSkipCurrentPassword({ must_change_password: true }, claims('password', 1))).toBe(true)
  })

  it('una cuenta sin marca nunca saltea la contraseña actual', () => {
    expect(canSkipCurrentPassword({}, claims('password', 5000))).toBe(false)
  })
})
