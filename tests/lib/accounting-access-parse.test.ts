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
  buyRead: false,
  buyWrite: false,
  scope: null,
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
    ).toEqual({
      enabled: true,
      setUp: true,
      read: true,
      write: true,
      admin: true,
      canSetUp: false,
      // Quien ve todo también entra a Compras y pagos, aunque la base todavía no mande esas claves.
      buyRead: true,
      buyWrite: true,
      scope: null,
    })
  })

  it('con las claves de nivel: el socio tiene acceso completo', () => {
    expect(
      parseAccountingAccess({
        enabled: true,
        set_up: true,
        read: true,
        write: true,
        admin: true,
        can_set_up: false,
        buy_read: true,
        buy_write: true,
        scope: 'full',
      }),
    ).toEqual({
      enabled: true,
      setUp: true,
      read: true,
      write: true,
      admin: true,
      canSetUp: false,
      buyRead: true,
      buyWrite: true,
      scope: 'full',
    })
  })

  it('el empleado con «solo compras y pagos» entra a Compras y a nada más', () => {
    expect(
      parseAccountingAccess({
        enabled: true,
        set_up: true,
        read: false,
        write: false,
        admin: false,
        can_set_up: false,
        buy_read: true,
        buy_write: true,
        scope: 'purchases',
      }),
    ).toEqual({
      ...CLOSED,
      enabled: true,
      setUp: true,
      buyRead: true,
      buyWrite: true,
      scope: 'purchases',
    })
  })

  it('las llaves de compras también fallan cerrado', () => {
    // Solo un true literal.
    expect(
      parseAccountingAccess({ enabled: true, set_up: true, buy_read: 'true', buy_write: 1 }),
    ).toEqual({ ...CLOSED, enabled: true, setUp: true })
    // Cargar sin poder entrar.
    expect(
      parseAccountingAccess({ enabled: true, set_up: true, buy_read: false, buy_write: true }),
    ).toEqual({ ...CLOSED, enabled: true, setUp: true })
    // Con el módulo apagado o sin configurar.
    expect(
      parseAccountingAccess({ enabled: false, set_up: true, buy_read: true, buy_write: true }),
    ).toEqual({ ...CLOSED, setUp: true })
    expect(
      parseAccountingAccess({ enabled: true, set_up: false, buy_read: true, buy_write: true }),
    ).toEqual({ ...CLOSED, enabled: true })
    // Un nivel que no existe es ningún nivel.
    expect(
      parseAccountingAccess({ enabled: true, set_up: true, buy_read: true, scope: 'todo' }),
    ).toEqual({ ...CLOSED, enabled: true, setUp: true, buyRead: true })
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
    ).toEqual({ ...CLOSED, enabled: true, setUp: true, read: true, buyRead: true })
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
