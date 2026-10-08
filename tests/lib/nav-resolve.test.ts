import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  gateAllows,
  type NavViewer,
  type ResolvedNavGroup,
  resolveNavGroups,
} from '@/components/shell/nav-config'
import {
  FEATURE_KEYS,
  type FeatureKey,
  getTenantFeatures,
  type TenantFeatures,
} from '@/lib/platform/features'
import { canAccessManagerPath, SCOPED_MANAGER_ROLES } from '@/lib/tenant/roles'
import type { AccountingAccess } from '@/lib/tenant/types'

const SLUG = 'hub'
const allOff: TenantFeatures = getTenantFeatures({ feature_flags: {} })
const withFeature = (key: FeatureKey): TenantFeatures => ({ ...allOff, [key]: true })
/** Lo que tiene prendido HUB hoy. */
const HUB: TenantFeatures = getTenantFeatures({ feature_flags: { reviews: true } })
const HUB_WITH_ACCOUNTING: TenantFeatures = { ...HUB, accounting: true }

const OWNER_WITH_ACCESS: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}
const ACCOUNTANT: AccountingAccess = { ...OWNER_WITH_ACCESS, write: false, admin: false }

function clusters(groups: ResolvedNavGroup[]): string[] {
  return groups.map((g) => g.label)
}
function cluster(groups: ResolvedNavGroup[], label: string) {
  return groups.find((g) => g.label === label)
}
function itemLabels(groups: ResolvedNavGroup[], groupLabel: string): string[] {
  return cluster(groups, groupLabel)?.items.map((i) => i.label) ?? []
}
/** Todas las entradas, en el orden en que se ven (la anclada al fondo, última). */
function entries(groups: ResolvedNavGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.label))
}
function entry(groups: ResolvedNavGroup[], label: string) {
  return groups.flatMap((g) => g.items).find((i) => i.label === label)
}

const OWNER_ENTRIES = [
  'Resumen',
  'Operativo',
  'Mensajería',
  'Reservas',
  'Calendario',
  'Clientes',
  'Carta',
  'Club',
  'Marketing',
  'Estadísticas',
  'Configuración',
]

describe('resolveNavGroups — una entrada por sección, por rol', () => {
  it('dueño (flags de HUB): 11 entradas en bloques, Configuración anclada al fondo', () => {
    const groups = resolveNavGroups('owner', SLUG, HUB, false)
    expect(entries(groups)).toEqual(OWNER_ENTRIES)
    expect(clusters(groups)).toEqual(['Hoy', 'Agenda y clientes', 'Negocio', 'Ajustes'])
    expect(itemLabels(groups, 'Hoy')).toEqual(['Resumen', 'Operativo', 'Mensajería'])
    expect(itemLabels(groups, 'Agenda y clientes')).toEqual(['Reservas', 'Calendario', 'Clientes'])
    expect(itemLabels(groups, 'Negocio')).toEqual(['Carta', 'Club', 'Marketing', 'Estadísticas'])
    expect(groups.filter((g) => g.pinned).map((g) => g.label)).toEqual(['Ajustes'])
    expect(itemLabels(groups, 'Ajustes')).toEqual(['Configuración'])
  })

  it('dueño sin Administración: ni con el flag apagado ni con el flag pero sin acceso', () => {
    expect(entries(resolveNavGroups('owner', SLUG, HUB, false, OWNER_WITH_ACCESS))).toEqual(
      OWNER_ENTRIES,
    )
    expect(entries(resolveNavGroups('owner', SLUG, HUB_WITH_ACCOUNTING, false))).toEqual(
      OWNER_ENTRIES,
    )
  })

  it('dueño con acceso a Administración: una sola entrada más, al final del Negocio', () => {
    const groups = resolveNavGroups('owner', SLUG, HUB_WITH_ACCOUNTING, false, OWNER_WITH_ACCESS)
    expect(itemLabels(groups, 'Negocio')).toEqual([
      'Carta',
      'Club',
      'Marketing',
      'Estadísticas',
      'Administración',
    ])
    expect(entries(groups)).toHaveLength(OWNER_ENTRIES.length + 1)
  })

  it('host (anfitrión): Operativo, Reservas, Calendario y Mis números — nada del dueño', () => {
    const groups = resolveNavGroups('host', SLUG, HUB, false)
    expect(entries(groups)).toEqual(['Operativo', 'Reservas', 'Calendario', 'Mis números'])
    expect(clusters(groups)).toEqual(['Hoy', 'Agenda y clientes', 'Negocio'])
    expect(entry(groups, 'Mis números')?.href).toBe('/hub/mis-numeros')
  })

  it('editor (contenido): sólo Carta («Ver carta» vive en la página)', () => {
    const groups = resolveNavGroups('editor', SLUG, HUB, false)
    expect(entries(groups)).toEqual(['Carta'])
    expect(entry(groups, 'Carta')?.href).toBe('/hub/menu')
  })

  it('contadora: sólo Administración', () => {
    const groups = resolveNavGroups('accountant', SLUG, HUB_WITH_ACCOUNTING, false, ACCOUNTANT)
    expect(entries(groups)).toEqual(['Administración'])
  })

  it('los roles de salón no ven el workspace manager (el proxy los manda a /salon)', () => {
    for (const role of ['cashier', 'waiter', 'kitchen'] as const) {
      expect(resolveNavGroups(role, SLUG, HUB, true, OWNER_WITH_ACCESS)).toEqual([])
    }
  })
})

describe('resolveNavGroups — sin desplegables', () => {
  it('ni grupos plegables ni sub-ítems: sólo las claves de una entrada plana', () => {
    const groups = resolveNavGroups('owner', SLUG, HUB_WITH_ACCOUNTING, true, OWNER_WITH_ACCESS)
    for (const g of groups) {
      for (const key of Object.keys(g)) {
        expect(['label', 'items', 'pinned']).toContain(key)
      }
      for (const item of g.items) {
        for (const key of Object.keys(item)) {
          expect(['label', 'href', 'iconKey', 'exact', 'newTab', 'activePaths']).toContain(key)
        }
      }
    }
  })

  it('las partes de cada sección ya no son entradas del menú (son pestañas de la página)', () => {
    const all = entries(
      resolveNavGroups('owner', SLUG, HUB_WITH_ACCOUNTING, true, OWNER_WITH_ACCESS),
    )
    for (const gone of [
      'Personas',
      'Todos',
      'Walk-in',
      'Acreditar',
      'QR del club',
      'Ver carta',
      'Club de beneficios',
      'Puntos y niveles',
      'Aliados',
      'Bienvenida',
      'Punch cards',
      'Tareas',
      'Link de Instagram',
      'Páginas',
      'Cómo nos fue',
      'Señas',
      'Comisiones',
      'Reseñas',
      'Documentación',
      'Compras y proveedores',
      'Ventas y clientes',
      'Cajas y bancos',
      'Libros',
      'Plan de cuentas',
    ]) {
      expect(all).not.toContain(gone)
    }
  })

  it('hrefs únicos y sin query: una entrada = una sección', () => {
    const groups = resolveNavGroups('owner', SLUG, HUB_WITH_ACCOUNTING, true, OWNER_WITH_ACCESS)
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(hrefs.filter((h) => h.includes('?'))).toEqual([])
  })
})

describe('resolveNavGroups — hrefs, íconos y rutas de cada sección', () => {
  const groups = resolveNavGroups('owner', SLUG, HUB_WITH_ACCOUNTING, false, OWNER_WITH_ACCESS)

  it('resuelve los hrefs con el slug', () => {
    expect(entry(groups, 'Resumen')?.href).toBe('/hub')
    expect(entry(groups, 'Resumen')?.exact).toBe(true)
    expect(entry(groups, 'Operativo')?.href).toBe('/hub/operativo')
    expect(entry(groups, 'Mensajería')?.href).toBe('/hub/mensajeria')
    expect(entry(groups, 'Reservas')?.href).toBe('/hub/reservas')
    expect(entry(groups, 'Calendario')?.href).toBe('/hub/eventos/programados')
    expect(entry(groups, 'Clientes')?.href).toBe('/hub/clientes')
    expect(entry(groups, 'Carta')?.href).toBe('/hub/menu')
    expect(entry(groups, 'Club')?.href).toBe('/hub/club')
    expect(entry(groups, 'Marketing')?.href).toBe('/hub/tareas')
    expect(entry(groups, 'Estadísticas')?.href).toBe('/hub/estadisticas')
    expect(entry(groups, 'Administración')?.href).toBe('/hub/administracion')
    expect(entry(groups, 'Configuración')?.href).toBe('/hub/configuracion')
  })

  it('las otras rutas de cada sección también la resaltan (activePaths con el slug)', () => {
    expect(entry(groups, 'Clientes')?.activePaths).toEqual(['/hub/acreditar', '/hub/local/captura'])
    expect(entry(groups, 'Marketing')?.activePaths).toEqual(['/hub/enlaces', '/hub/paginas'])
    expect(entry(groups, 'Estadísticas')?.activePaths).toEqual(['/hub/reviews'])
    expect(entry(groups, 'Configuración')?.activePaths).toEqual(['/hub/docs'])
  })

  it('cada entrada conserva el ícono de siempre', () => {
    const icons = Object.fromEntries(
      groups.flatMap((g) => g.items).map((i) => [i.label, i.iconKey]),
    )
    expect(icons).toEqual({
      Resumen: 'LayoutDashboard',
      Operativo: 'MonitorSmartphone',
      Mensajería: 'MessageCircle',
      Reservas: 'CalendarCheck',
      Calendario: 'CalendarDays',
      Clientes: 'Users',
      Carta: 'UtensilsCrossed',
      Club: 'Star',
      Marketing: 'ListChecks',
      Estadísticas: 'BarChart3',
      Administración: 'Landmark',
      Configuración: 'Settings2',
    })
  })
})

describe('resolveNavGroups — bloque Salón (feature-flags de superadmin)', () => {
  it('el dueño sin features NO ve el bloque Salón', () => {
    expect(cluster(resolveNavGroups('owner', SLUG, allOff, false), 'Salón')).toBeUndefined()
  })

  it('prender una feature revela sólo su entrada', () => {
    const groups = resolveNavGroups('owner', SLUG, withFeature('kitchen'), false)
    expect(itemLabels(groups, 'Salón')).toEqual(['Cocina'])
  })

  it('el superadmin ve las cuatro, planas y sin cambios, antes de Configuración', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, true)
    expect(itemLabels(groups, 'Salón')).toEqual([
      'Salón en vivo',
      'Cocina',
      'Plano y QRs de mesa',
      'Auto-aceptación',
    ])
    expect(clusters(groups)).toEqual(['Hoy', 'Agenda y clientes', 'Negocio', 'Salón', 'Ajustes'])
    expect(entry(groups, 'Salón en vivo')?.newTab).toBe(true)
    expect(entry(groups, 'Cocina')?.newTab).toBe(true)
    expect(entry(groups, 'Plano y QRs de mesa')?.href).toBe('/hub/local/mesas')
    expect(entry(groups, 'Auto-aceptación')?.href).toBe('/hub/local/auto-aceptacion')
  })

  it('ningún rol acotado ve el bloque Salón ni las secciones del dueño', () => {
    for (const role of ['editor', 'host'] as const) {
      const all = entries(resolveNavGroups(role, SLUG, allOff, true))
      for (const ownerOnly of ['Mensajería', 'Clientes', 'Club', 'Marketing', 'Estadísticas']) {
        expect(all).not.toContain(ownerOnly)
      }
      expect(all).not.toContain('Salón en vivo')
      expect(all).not.toContain('Configuración')
    }
  })
})

// ── Lo que el menú muestra se puede abrir ──────────────────────────────────

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ALL_ON = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as TenantFeatures
/** Los segmentos después del slug (`/hub/eventos/programados` → ['eventos', 'programados']). */
const rest = (href: string) => (href.split('?')[0] ?? href).split('/').filter(Boolean).slice(1)

describe('resolveNavGroups — cada entrada lleva a una página que ese rol puede abrir', () => {
  it('host, editor y contadora: el proxy les abre todo lo que ven (nunca rebotan a su home)', () => {
    for (const role of SCOPED_MANAGER_ROLES) {
      // El peor caso: todo prendido, superadmin y acceso total a Administración.
      const items = resolveNavGroups(role, SLUG, ALL_ON, true, OWNER_WITH_ACCESS).flatMap(
        (g) => g.items,
      )
      expect(items.length, role).toBeGreaterThan(0)
      for (const item of items) {
        for (const href of [item.href, ...(item.activePaths ?? [])]) {
          expect(canAccessManagerPath(role, rest(href)), `${role} → ${href}`).toBe(true)
        }
      }
    }
  })

  it('ningún href ni activePath apunta a una ruta que no existe', () => {
    const groups = resolveNavGroups('owner', SLUG, ALL_ON, true, OWNER_WITH_ACCESS)
    const missing: string[] = []
    for (const item of groups.flatMap((g) => g.items)) {
      for (const href of [item.href, ...(item.activePaths ?? [])]) {
        const page = (group: string) =>
          join(ROOT, 'app', group, '[tenantSlug]', ...rest(href), 'page.tsx')
        if (!existsSync(page('(manager)')) && !existsSync(page('(salon)'))) missing.push(href)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('gateAllows — la puerta que comparten el menú y las pestañas de sección', () => {
  const v = (over: Partial<NavViewer> = {}): NavViewer => ({
    role: 'owner',
    features: allOff,
    isPlatformAdmin: false,
    accounting: { ...OWNER_WITH_ACCESS, enabled: false, read: false },
    ...over,
  })

  it('sin puertas pasa siempre; con roles (también readonly) mira el rol', () => {
    expect(gateAllows({}, v({ role: 'kitchen' }))).toBe(true)
    const roles: readonly ('owner' | 'host')[] = ['owner', 'host']
    expect(gateAllows({ roles }, v({ role: 'host' }))).toBe(true)
    expect(gateAllows({ roles }, v({ role: 'editor' }))).toBe(false)
  })

  it('el superadmin saltea las features, salvo Administración', () => {
    expect(gateAllows({ feature: 'reviews' }, v())).toBe(false)
    expect(gateAllows({ feature: 'reviews' }, v({ isPlatformAdmin: true }))).toBe(true)
    expect(gateAllows({ feature: 'accounting' }, v({ isPlatformAdmin: true }))).toBe(false)
  })

  it('Administración: `read` pide lectura; `read_or_setup` también deja pasar al que configura', () => {
    const features = { ...allOff, accounting: true }
    const setUp = { ...OWNER_WITH_ACCESS, setUp: false, read: false, canSetUp: true }
    expect(gateAllows({ accounting: 'read' }, v({ features, accounting: setUp }))).toBe(false)
    expect(gateAllows({ accounting: 'read_or_setup' }, v({ features, accounting: setUp }))).toBe(
      true,
    )
    // Falla cerrado si el objeto viene armado a mano sin `enabled`.
    expect(
      gateAllows(
        { accounting: 'read' },
        v({ features, accounting: { ...OWNER_WITH_ACCESS, enabled: false } }),
      ),
    ).toBe(false)
  })
})
