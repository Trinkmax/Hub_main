import { describe, expect, it } from 'vitest'
import { computeActiveHrefs } from '@/components/shell/nav-active'
import { type ResolvedNavGroup, resolveNavGroups } from '@/components/shell/nav-config'
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

function adminEntries(groups: ResolvedNavGroup[]) {
  return groups
    .flatMap((g) => g.items)
    .filter((i) => i.href === '/hub/administracion' || i.href.startsWith('/hub/administracion/'))
}

/** La etiqueta de la entrada resaltada en `url` (con o sin query). */
function activeLabels(url: string, groups: ResolvedNavGroup[]): string[] {
  const [pathname = url, search = ''] = url.split('?')
  const active = computeActiveHrefs(pathname, search, groups)
  return groups
    .flatMap((g) => g.items)
    .filter((i) => active.has(i.href))
    .map((i) => i.label)
}

describe('menú: Administración es UNA entrada (H.0)', () => {
  it('dueño con acceso: una sola entrada, en el Negocio después de Estadísticas', () => {
    const groups = resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_WITH_ACCESS)
    const admin = adminEntries(groups)
    expect(admin.map((i) => i.label)).toEqual(['Administración'])
    expect(admin[0]?.href).toBe('/hub/administracion')
    expect(admin[0]?.iconKey).toBe('Landmark')
    // No es exacta: resalta en todo /administracion/*.
    expect(admin[0]?.exact).toBeFalsy()
    const negocio = groups.find((g) => g.label === 'Negocio')?.items.map((i) => i.label) ?? []
    expect(negocio.indexOf('Administración')).toBe(negocio.indexOf('Estadísticas') + 1)
  })

  it('antes de configurar, el que puede hacerlo también la ve (lo lleva al asistente)', () => {
    const groups = resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_CAN_SET_UP)
    expect(adminEntries(groups).map((i) => i.label)).toEqual(['Administración'])
  })

  it('un dueño sin acceso no la ve', () => {
    expect(
      adminEntries(resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_WITHOUT_ACCESS)),
    ).toEqual([])
  })

  it('flag apagado: nadie la ve, tampoco el superadmin', () => {
    expect(adminEntries(resolveNavGroups('owner', SLUG, allOff, true, OWNER_WITH_ACCESS))).toEqual(
      [],
    )
    expect(adminEntries(resolveNavGroups('owner', SLUG, allOff, true, NONE))).toEqual([])
  })

  it('sin el acceso (default), el menú del dueño queda como siempre', () => {
    expect(adminEntries(resolveNavGroups('owner', SLUG, accountingOn, false))).toEqual([])
  })

  it('la contadora ve SOLO esta entrada', () => {
    const groups = resolveNavGroups('accountant', SLUG, accountingOn, false, ACCOUNTANT)
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(['Administración'])
  })

  it('el resto de los roles no la ve aunque el objeto diga que sí', () => {
    for (const role of ['editor', 'host', 'cashier', 'waiter', 'kitchen'] as const) {
      expect(
        adminEntries(resolveNavGroups(role, SLUG, accountingOn, false, OWNER_WITH_ACCESS)),
      ).toEqual([])
    }
  })
})

describe('menú: Administración queda resaltada en toda la sección', () => {
  const owner = resolveNavGroups('owner', SLUG, accountingOn, false, OWNER_WITH_ACCESS)
  const accountant = resolveNavGroups('accountant', SLUG, accountingOn, false, ACCOUNTANT)
  const PAGES = [
    '/hub/administracion',
    '/hub/administracion?accion=gasto',
    '/hub/administracion/compras?tab=proveedores',
    '/hub/administracion/compras/proveedores/abc',
    '/hub/administracion/ventas/cierre',
    '/hub/administracion/cajas/abc',
    '/hub/administracion/libros',
    '/hub/administracion/libros/diario',
    '/hub/administracion/libros/iva-compras',
    '/hub/administracion/plan-de-cuentas/importar',
    '/hub/administracion/comprobantes/abc',
    '/hub/administracion/asientos/abc',
    '/hub/administracion/ajustes',
    '/hub/administracion/configurar',
  ]

  it('para el dueño, cualquier pantalla de Administración resalta sólo Administración', () => {
    for (const url of PAGES) {
      expect(activeLabels(url, owner), url).toEqual(['Administración'])
    }
  })

  it('para la contadora, igual', () => {
    for (const url of PAGES) {
      expect(activeLabels(url, accountant), url).toEqual(['Administración'])
    }
  })

  it('matchea por segmento: /administracion-vieja no es la sección', () => {
    expect(activeLabels('/hub/administracion-vieja', owner)).toEqual([])
  })
})
