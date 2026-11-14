import { describe, expect, it } from 'vitest'
import { type AccountingAccess, TENANT_ROLES } from '@/lib/tenant/types'
import {
  accountingAs,
  canViewAs,
  encodeViewAs,
  readViewAs,
  resolveViewAs,
  routingRole,
  VIEW_AS_CHOICES,
  VIEW_AS_ROLES,
} from '@/lib/tenant/view-as'

const UID = '3924fd2f-4fc9-44f6-9cfd-352ac2972de9'
const OTHER = '0f6b1f0e-0000-4000-8000-000000000001'

const FULL: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}

describe('readViewAs', () => {
  it('devuelve el rol de la cookie del mismo usuario', () => {
    expect(readViewAs(encodeViewAs(UID, 'waiter'), UID)).toBe('waiter')
    expect(readViewAs(encodeViewAs(UID, 'accountant'), UID)).toBe('accountant')
  })

  it('no vale para otro usuario (otra persona que entra en la misma compu)', () => {
    expect(readViewAs(encodeViewAs(UID, 'waiter'), OTHER)).toBeNull()
  })

  it('ignora «dueño», roles que no existen y cookies rotas', () => {
    expect(readViewAs(`${UID}:owner`, UID)).toBeNull()
    expect(readViewAs(`${UID}:superadmin`, UID)).toBeNull()
    expect(readViewAs('waiter', UID)).toBeNull()
    expect(readViewAs(':waiter', UID)).toBeNull()
    expect(readViewAs('', UID)).toBeNull()
    expect(readViewAs(undefined, UID)).toBeNull()
    expect(readViewAs(encodeViewAs(UID, 'waiter'), null)).toBeNull()
  })
})

describe('canViewAs', () => {
  it('solo superadmin y dueño del bar', () => {
    expect(canViewAs('owner', true)).toBe(true)
    expect(canViewAs('owner', false)).toBe(false)
    expect(canViewAs('host', true)).toBe(false)
    expect(canViewAs('waiter', true)).toBe(false)
  })
})

describe('accountingAs', () => {
  it('el dueño queda igual', () => {
    expect(accountingAs(FULL, 'owner')).toEqual(FULL)
  })

  it('la contadora lee pero no carga, no cierra ni da accesos', () => {
    expect(accountingAs(FULL, 'accountant')).toEqual({
      enabled: true,
      setUp: true,
      read: true,
      write: false,
      admin: false,
      canSetUp: false,
    })
  })

  it('la contadora no lee si el dueño tampoco', () => {
    expect(accountingAs({ ...FULL, read: false, write: false }, 'accountant').read).toBe(false)
  })

  it('el resto del equipo no ve Administración', () => {
    for (const role of ['cashier', 'waiter', 'kitchen', 'editor', 'host'] as const) {
      const view = accountingAs(FULL, role)
      expect(view.read || view.write || view.admin || view.canSetUp).toBe(false)
    }
  })
})

describe('resolveViewAs', () => {
  const base = { accounting: FULL, userId: UID }

  it('superadmin dueño con cookie: mira ese rol y deja de ser superadmin', () => {
    expect(
      resolveViewAs({
        ...base,
        realRole: 'owner',
        isPlatformAdmin: true,
        cookie: encodeViewAs(UID, 'host'),
      }),
    ).toEqual({
      role: 'host',
      realRole: 'owner',
      viewAs: 'host',
      canViewAs: true,
      isPlatformAdmin: false,
      accounting: accountingAs(FULL, 'host'),
    })
  })

  it('sin cookie: todo como siempre, y puede usar el selector', () => {
    expect(
      resolveViewAs({ ...base, realRole: 'owner', isPlatformAdmin: true, cookie: undefined }),
    ).toEqual({
      role: 'owner',
      realRole: 'owner',
      viewAs: null,
      canViewAs: true,
      isPlatformAdmin: true,
      accounting: FULL,
    })
  })

  it('un dueño que no es superadmin no puede, aunque tenga la cookie', () => {
    const view = resolveViewAs({
      ...base,
      realRole: 'owner',
      isPlatformAdmin: false,
      cookie: encodeViewAs(UID, 'waiter'),
    })
    expect(view.role).toBe('owner')
    expect(view.viewAs).toBeNull()
    expect(view.canViewAs).toBe(false)
  })

  it('un superadmin que en este bar no es dueño tampoco (nunca sube permisos)', () => {
    const view = resolveViewAs({
      ...base,
      realRole: 'host',
      isPlatformAdmin: true,
      cookie: encodeViewAs(UID, 'cashier'),
    })
    expect(view.role).toBe('host')
    expect(view.canViewAs).toBe(false)
    expect(view.isPlatformAdmin).toBe(true)
  })

  it('la cookie de otro usuario no cuenta', () => {
    const view = resolveViewAs({
      ...base,
      realRole: 'owner',
      isPlatformAdmin: true,
      cookie: encodeViewAs(OTHER, 'waiter'),
    })
    expect(view.role).toBe('owner')
    expect(view.viewAs).toBeNull()
  })
})

describe('routingRole (proxy)', () => {
  it('el dueño con cookie se rutea como el rol que mira', () => {
    expect(routingRole('owner', encodeViewAs(UID, 'waiter'), UID)).toBe('waiter')
    expect(routingRole('owner', encodeViewAs(UID, 'editor'), UID)).toBe('editor')
  })

  it('sin cookie, con la de otro o sin ser dueño: el rol del JWT', () => {
    expect(routingRole('owner', undefined, UID)).toBe('owner')
    expect(routingRole('owner', encodeViewAs(OTHER, 'waiter'), UID)).toBe('owner')
    expect(routingRole('waiter', encodeViewAs(UID, 'host'), UID)).toBe('waiter')
    expect(routingRole(null, encodeViewAs(UID, 'host'), UID)).toBeNull()
  })
})

describe('opciones del selector', () => {
  it('están todos los roles una vez, con dueño primero', () => {
    const roles = VIEW_AS_CHOICES.map((choice) => choice.role)
    expect(roles[0]).toBe('owner')
    expect([...roles].sort()).toEqual([...TENANT_ROLES].sort())
    expect(new Set(roles).size).toBe(roles.length)
  })

  it('«dueño» no es un rol para mirar: es salir', () => {
    expect(VIEW_AS_ROLES).not.toContain('owner')
    expect(VIEW_AS_ROLES).toHaveLength(TENANT_ROLES.length - 1)
  })
})
