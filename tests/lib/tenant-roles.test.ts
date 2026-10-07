import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_READ_ROLES,
  ACCOUNTING_WRITE_ROLES,
  assignableRoles,
  canAccessManagerPath,
  canAccessSalonPath,
  canManageAccountant,
  homePathForRole,
  MANAGER_SCOPED_PREFIXES,
  MENU_EDIT_ROLES,
  REDEMPTION_STAFF_ROLES,
  RESERVATION_OPERATOR_ROLES,
  RESERVATION_STAFF_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  roleLabel,
  SALON_READ_ROLES,
  SALON_ROLES,
  SCOPED_MANAGER_ROLES,
  TEMPLATE_EDIT_ROLES,
} from '@/lib/tenant/roles'
import { isTenantRole, TENANT_ROLES, type TenantRole } from '@/lib/tenant/types'

// El proxy usa estas dos funciones para decidir a dónde cae cada rol al
// loguearse y qué rutas del manager puede abrir. La lista /reservas volvió al
// menú (22/09) y vuelve a ser el home de la anfitriona; el calendario, desde
// donde también reserva, le sigue abierto.
describe('homePathForRole', () => {
  it('la anfitriona arranca en la lista de reservas', () => {
    expect(homePathForRole('host', 'hub')).toBe('/hub/reservas')
  })

  it('la contadora arranca (y vive) en Administración', () => {
    expect(homePathForRole('accountant', 'hub')).toBe('/hub/administracion')
  })

  it('el resto de los roles no cambia', () => {
    expect(homePathForRole('owner', 'hub')).toBe('/hub')
    expect(homePathForRole('editor', 'hub')).toBe('/hub/menu')
    expect(homePathForRole('waiter', 'hub')).toBe('/hub/salon')
    expect(homePathForRole('cashier', 'hub')).toBe('/hub/salon')
    expect(homePathForRole('kitchen', 'hub')).toBe('/hub/salon')
  })
})

describe('canAccessManagerPath', () => {
  it('el host abre la lista, el alta y la ficha de reservas', () => {
    expect(MANAGER_SCOPED_PREFIXES.host).toContain('reservas')
    expect(canAccessManagerPath('host', ['reservas'])).toBe(true)
    expect(canAccessManagerPath('host', ['reservas', 'nuevo'])).toBe(true)
    expect(canAccessManagerPath('host', ['reservas', '6f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f'])).toBe(
      true,
    )
  })

  it('el host también abre el calendario (reserva desde los dos lados)', () => {
    expect(canAccessManagerPath('host', ['eventos', 'programados'])).toBe(true)
  })

  it('el host no entra a lo del dueño ni al home del manager', () => {
    expect(canAccessManagerPath('host', ['clientes'])).toBe(false)
    expect(canAccessManagerPath('host', [])).toBe(false)
  })

  it('el editor solo ve la carta y el owner navega libre', () => {
    expect(canAccessManagerPath('editor', ['menu'])).toBe(true)
    expect(canAccessManagerPath('editor', ['eventos', 'programados'])).toBe(false)
    expect(canAccessManagerPath('owner', ['lo-que-sea'])).toBe(true)
  })

  it('la contadora solo abre Administración: ni clientes, ni el home, ni reservas', () => {
    expect(canAccessManagerPath('accountant', ['administracion'])).toBe(true)
    expect(canAccessManagerPath('accountant', ['administracion', 'libros', 'diario'])).toBe(true)
    expect(canAccessManagerPath('accountant', ['clientes'])).toBe(false)
    expect(canAccessManagerPath('accountant', [])).toBe(false)
    expect(canAccessManagerPath('accountant', ['reservas'])).toBe(false)
    expect(canAccessManagerPath('accountant', ['configuracion', 'equipo'])).toBe(false)
  })

  it('la contadora tampoco entra a ninguna sub-ruta del salón', () => {
    expect(canAccessSalonPath('accountant', ['salon'])).toBe(false)
    expect(canAccessSalonPath('accountant', ['salon', 'reservas-operativo'])).toBe(false)
  })

  it('todo rol acotado tiene prefijos, y solo los acotados los tienen', () => {
    for (const role of SCOPED_MANAGER_ROLES) {
      expect(MANAGER_SCOPED_PREFIXES[role]?.length ?? 0).toBeGreaterThan(0)
    }
    expect(Object.keys(MANAGER_SCOPED_PREFIXES).sort()).toEqual([...SCOPED_MANAGER_ROLES].sort())
  })

  it('el home de cada rol acotado es una ruta que ese rol puede abrir (sin loops del proxy)', () => {
    for (const role of SCOPED_MANAGER_ROLES) {
      const rest = homePathForRole(role, 'hub').split('/').filter(Boolean).slice(1)
      expect(canAccessManagerPath(role, rest)).toBe(true)
    }
    expect(SCOPED_MANAGER_ROLES).toContain('accountant')
  })
})

describe('registro de roles', () => {
  it('TENANT_ROLES trae los siete roles, sin repetidos', () => {
    expect([...TENANT_ROLES].sort()).toEqual(
      ['accountant', 'cashier', 'editor', 'host', 'kitchen', 'owner', 'waiter'].sort(),
    )
    expect(new Set(TENANT_ROLES).size).toBe(TENANT_ROLES.length)
  })

  it('cada rol tiene label y descripción, y no sobra ninguno', () => {
    for (const role of TENANT_ROLES) {
      expect(ROLE_LABELS[role].trim()).not.toBe('')
      expect(ROLE_DESCRIPTIONS[role].trim()).not.toBe('')
    }
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...TENANT_ROLES].sort())
    expect(Object.keys(ROLE_DESCRIPTIONS).sort()).toEqual([...TENANT_ROLES].sort())
    expect(ROLE_LABELS.accountant).toBe('Contabilidad')
  })

  it('isTenantRole acepta los roles conocidos y nada más', () => {
    for (const role of TENANT_ROLES) expect(isTenantRole(role)).toBe(true)
    for (const raro of [
      'superuser',
      'Owner',
      '',
      '__proto__',
      'constructor',
      42,
      null,
      undefined,
    ]) {
      expect(isTenantRole(raro)).toBe(false)
    }
  })

  it('roleLabel muestra el label, o el valor tal cual si no lo conocemos', () => {
    expect(roleLabel('owner')).toBe('Dueño')
    expect(roleLabel('accountant')).toBe('Contabilidad')
    expect(roleLabel('superuser')).toBe('superuser')
  })
})

describe('Administración: roles', () => {
  it('leen dueño y contadora; escribe solo el dueño', () => {
    expect([...ACCOUNTING_READ_ROLES].sort()).toEqual(['accountant', 'owner'])
    expect(ACCOUNTING_WRITE_ROLES).toEqual(['owner'])
  })

  it('la contadora no entra en ninguna otra capacidad (las RLS espejan estos sets)', () => {
    const sets: ReadonlyArray<ReadonlyArray<TenantRole>> = [
      SALON_ROLES,
      MENU_EDIT_ROLES,
      RESERVATION_STAFF_ROLES,
      TEMPLATE_EDIT_ROLES,
      RESERVATION_OPERATOR_ROLES,
      SALON_READ_ROLES,
      REDEMPTION_STAFF_ROLES,
      ACCOUNTING_WRITE_ROLES,
    ]
    for (const set of sets) expect(set).not.toContain('accountant')
  })

  it('sumar a la contadora exige el módulo prendido y administrar los accesos', () => {
    expect(canManageAccountant({ enabled: true, admin: true })).toBe(true)
    expect(canManageAccountant({ enabled: false, admin: true })).toBe(false)
    expect(canManageAccountant({ enabled: true, admin: false })).toBe(false)
    expect(canManageAccountant({ enabled: false, admin: false })).toBe(false)
  })

  it('Equipo esconde «Contabilidad» salvo para quien puede sumarla', () => {
    expect(assignableRoles(false)).not.toContain('accountant')
    expect(assignableRoles(false)).toEqual(TENANT_ROLES.filter((r) => r !== 'accountant'))
    expect(assignableRoles(true)).toEqual([...TENANT_ROLES])
  })

  it('el rol actual de una fila se mantiene en la lista (el select no queda en blanco)', () => {
    expect(assignableRoles(false, 'accountant')).toContain('accountant')
    expect(assignableRoles(false, 'host')).not.toContain('accountant')
  })
})
