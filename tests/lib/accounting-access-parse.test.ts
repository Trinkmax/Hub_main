import { describe, expect, it } from 'vitest'
import { parseAccountingAccess } from '@/lib/tenant/access'
import type { AccountingAccess } from '@/lib/tenant/types'

// La clave `accounting` de `get_tenant_access` llega recién con la migración de
// la fase 1, y el código puede salir antes: sin la clave, o con algo raro, todo
// tiene que quedar en false (Administración cerrada). Falla cerrado.
const CLOSED: AccountingAccess = {
  enabled: false,
  setUp: false,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}

describe('parseAccountingAccess', () => {
  it('sin la clave, todo en false', () => {
    expect(parseAccountingAccess(undefined)).toEqual(CLOSED)
  })

  it('con una clave rara, todo en false', () => {
    for (const raw of [null, 'true', 1, true, [], [true], {}]) {
      expect(parseAccountingAccess(raw)).toEqual(CLOSED)
    }
  })

  it('solo un true literal cuenta como true', () => {
    expect(
      parseAccountingAccess({
        enabled: 'true',
        set_up: 1,
        read: 'yes',
        write: {},
        admin: 'true',
        can_set_up: [true],
      }),
    ).toEqual(CLOSED)
  })

  it('lee las claves snake_case de la base, no camelCase', () => {
    expect(parseAccountingAccess({ enabled: true, setUp: true, canSetUp: true })).toEqual({
      ...CLOSED,
      enabled: true,
    })
  })

  it('dueño administrador con el módulo configurado', () => {
    expect(
      parseAccountingAccess({
        enabled: true,
        set_up: true,
        read: true,
        write: true,
        admin: true,
        can_set_up: false,
      }),
    ).toEqual({ enabled: true, setUp: true, read: true, write: true, admin: true, canSetUp: false })
  })

  it('la contadora lee y nada más', () => {
    expect(
      parseAccountingAccess({
        enabled: true,
        set_up: true,
        read: true,
        write: false,
        admin: false,
        can_set_up: false,
      }),
    ).toEqual({ ...CLOSED, enabled: true, setUp: true, read: true })
  })

  it('dueño que puede hacer la puesta en marcha', () => {
    expect(
      parseAccountingAccess({
        enabled: true,
        set_up: false,
        read: false,
        write: false,
        admin: false,
        can_set_up: true,
      }),
    ).toEqual({ ...CLOSED, enabled: true, canSetUp: true })
  })

  it('no confía en combinaciones que la base nunca arma', () => {
    // Leer o escribir con el módulo apagado o sin configurar.
    expect(
      parseAccountingAccess({ enabled: false, set_up: true, read: true, write: true }),
    ).toEqual({ ...CLOSED, setUp: true })
    expect(
      parseAccountingAccess({ enabled: true, set_up: false, read: true, write: true }),
    ).toEqual({ ...CLOSED, enabled: true })
    // Escribir sin leer.
    expect(
      parseAccountingAccess({ enabled: true, set_up: true, read: false, write: true }),
    ).toEqual({ ...CLOSED, enabled: true, setUp: true })
    // Puesta en marcha con el módulo apagado o ya configurado.
    expect(parseAccountingAccess({ enabled: false, set_up: false, can_set_up: true })).toEqual(
      CLOSED,
    )
    expect(parseAccountingAccess({ enabled: true, set_up: true, can_set_up: true })).toEqual({
      ...CLOSED,
      enabled: true,
      setUp: true,
    })
  })

  it('administrar accesos no depende del flag (gobierno)', () => {
    expect(parseAccountingAccess({ enabled: false, admin: true })).toEqual({
      ...CLOSED,
      admin: true,
    })
  })
})
