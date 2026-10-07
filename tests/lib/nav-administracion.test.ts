import { describe, expect, it } from 'vitest'
import { resolveNavGroups } from '@/components/shell/nav-config'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

const SLUG = 'hub'
const allOff: TenantFeatures = getTenantFeatures({ feature_flags: {} })
const accountingOn: TenantFeatures = { ...allOff, accounting: true }

const NONE: AccountingAccess = {
  enabled: false,
  setUp: false,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}
const OWNER_WITH_ACCESS: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}
const ACCOUNTANT: AccountingAccess = { ...OWNER_WITH_ACCESS, write: false, admin: false }
const OWNER_CAN_SET_UP: AccountingAccess = { ...NONE, enabled: true, canSetUp: true }
const OWNER_WITHOUT_ACCESS: AccountingAccess = { ...NONE, enabled: true, setUp: true }

function adminItems(groups: ReturnType<typeof resolveNavGroups>): string[] {
  return groups.find((g) => g.label === 'Administración')?.items.map((i) => i.label) ?? []
}

const ALL = [
  'Resumen',
  'Compras y proveedores',
  'Ventas y clientes',
  'Cajas y bancos',
  'Libros',
  'Plan de cuentas',
]

describe('menú: grupo Administración (H.0)', () => {
  it('dueño con acceso: los seis ítems, después de Clientes, con sus rutas', () => {
    const groups = resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_WITH_ACCESS)
    expect(adminItems(groups)).toEqual(ALL)
    const labels = groups.map((g) => g.label)
    expect(labels.indexOf('Administración')).toBe(labels.indexOf('Clientes') + 1)
    const admin = groups.find((g) => g.label === 'Administración')
    expect(admin?.items[0]?.href).toBe('/hub/administracion')
    expect(admin?.items[0]?.exact).toBe(true)
    expect(admin?.items[5]?.href).toBe('/hub/administracion/plan-de-cuentas')
    expect(admin?.collapsible).toBe(true)
  })

  it('antes de configurar, el que puede hacerlo ve solo «Resumen»', () => {
    const groups = resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_CAN_SET_UP)
    expect(adminItems(groups)).toEqual(['Resumen'])
  })

  it('un dueño sin acceso no ve el grupo', () => {
    expect(
      adminItems(resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_WITHOUT_ACCESS)),
    ).toEqual([])
  })

  it('flag apagado: nadie lo ve, tampoco el superadmin', () => {
    expect(adminItems(resolveNavGroups('owner', SLUG, allOff, true, OWNER_WITH_ACCESS))).toEqual([])
    expect(adminItems(resolveNavGroups('owner', SLUG, allOff, true, NONE))).toEqual([])
  })

  it('sin el acceso (default), el menú del dueño queda como siempre', () => {
    expect(adminItems(resolveNavGroups('owner', SLUG, accountingOn, false))).toEqual([])
  })

  it('la contadora ve SOLO este grupo, sin acordeones', () => {
    const groups = resolveNavGroups('accountant', SLUG, accountingOn, false, ACCOUNTANT)
    expect(groups.map((g) => g.label)).toEqual(['Administración'])
    expect(adminItems(groups)).toEqual(ALL)
    expect(groups.every((g) => !g.collapsible)).toBe(true)
  })

  it('el resto de los roles acotados no lo ve aunque el objeto diga que sí', () => {
    for (const role of ['editor', 'host', 'cashier'] as const) {
      expect(
        adminItems(resolveNavGroups(role, SLUG, accountingOn, false, OWNER_WITH_ACCESS)),
      ).toEqual([])
    }
  })
})
