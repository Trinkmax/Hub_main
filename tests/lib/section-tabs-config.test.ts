import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  activeSectionTab,
  CLIENTES_ORIGENES,
  type ResolvedSection,
  resolveSection,
  SECTION_TABS,
  type SectionKey,
  type SectionViewer,
  sectionBarVisible,
  sectionNeedsViewer,
  sectionViewer,
} from '@/components/shell/section-tabs-config'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import { canAccessManagerPath, SCOPED_MANAGER_ROLES } from '@/lib/tenant/roles'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'

/**
 * Las pestañas de sección (07/10/2026): el sidebar quedó con una entrada por sección y las
 * partes de cada una pasaron a pestañas arriba de la página. Acá: qué ve cada uno, cuál queda
 * marcada en cada URL y que nada de lo que salió del menú se quedó sin camino.
 */

const SLUG = 'hub'
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TENANT_DIR = join(ROOT, 'app/(manager)/[tenantSlug]')

const allOff: TenantFeatures = getTenantFeatures({ feature_flags: {} })
const allOn: TenantFeatures = Object.fromEntries(
  Object.keys(allOff).map((key) => [key, true]),
) as TenantFeatures

const NO_ACCESS: AccountingAccess = {
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
const ACCOUNTANT_ACCESS: AccountingAccess = { ...OWNER_WITH_ACCESS, write: false, admin: false }
const OWNER_CAN_SET_UP: AccountingAccess = { ...NO_ACCESS, enabled: true, canSetUp: true }
const OWNER_WITHOUT_ACCESS: AccountingAccess = { ...NO_ACCESS, enabled: true, setUp: true }

function viewer(over: Partial<SectionViewer> & { role?: TenantRole } = {}): SectionViewer {
  return {
    role: 'owner',
    features: allOff,
    isPlatformAdmin: false,
    accounting: NO_ACCESS,
    ...over,
  }
}

const labels = (section: ResolvedSection) => section.tabs.map((t) => t.label)
const hrefs = (section: ResolvedSection) => section.tabs.map((t) => t.href)

describe('pestañas de sección: qué ve cada uno', () => {
  it('Clientes: Personas, Acreditar y QR del club, sin preguntar quién mira', () => {
    expect(sectionNeedsViewer('clientes')).toBe(false)
    const section = resolveSection('clientes', SLUG)
    expect(section.label).toBe('Secciones de Clientes')
    expect(labels(section)).toEqual(['Personas', 'Acreditar', 'QR del club'])
    expect(hrefs(section)).toEqual(['/hub/clientes', '/hub/acreditar', '/hub/local/captura'])
    expect(section.showWhenNoneActive).toBe(false)
  })

  it('Marketing: Tareas, Link de Instagram y Páginas (Páginas exacta: el editor va sin barra)', () => {
    expect(sectionNeedsViewer('marketing')).toBe(false)
    const section = resolveSection('marketing', SLUG)
    expect(labels(section)).toEqual(['Tareas', 'Link de Instagram', 'Páginas'])
    expect(hrefs(section)).toEqual(['/hub/tareas', '/hub/enlaces', '/hub/paginas'])
    expect(section.tabs.find((t) => t.value === 'paginas')?.exact).toBe(true)
  })

  describe('Estadísticas: Reseñas con la misma regla que tenía el menú', () => {
    const BASE = ['Resumen', 'Cómo nos fue', 'Señas', 'Comisiones']

    it('las cuatro de siempre, en orden y con sus rutas', () => {
      expect(sectionNeedsViewer('estadisticas')).toBe(true)
      const section = resolveSection('estadisticas', SLUG, viewer())
      expect(labels(section)).toEqual(BASE)
      expect(hrefs(section)).toEqual([
        '/hub/estadisticas',
        '/hub/estadisticas/como-nos-fue',
        '/hub/estadisticas/senas',
        '/hub/estadisticas/comisiones',
      ])
      expect(section.tabs[0]?.exact).toBe(true)
    })

    it('con «reviews» prendida aparece Reseñas al final', () => {
      const section = resolveSection(
        'estadisticas',
        SLUG,
        viewer({ features: { ...allOff, reviews: true } }),
      )
      expect(labels(section)).toEqual([...BASE, 'Reseñas'])
      expect(section.tabs.at(-1)?.href).toBe('/hub/reviews')
    })

    it('el superadmin la ve aunque la feature esté apagada', () => {
      const section = resolveSection('estadisticas', SLUG, viewer({ isPlatformAdmin: true }))
      expect(labels(section)).toContain('Reseñas')
    })

    it('es del dueño: otro rol no la ve aunque la feature esté prendida', () => {
      const section = resolveSection(
        'estadisticas',
        SLUG,
        viewer({ role: 'host', features: { ...allOff, reviews: true } }),
      )
      expect(labels(section)).toEqual(BASE)
    })

    it('sin saber quién mira, Reseñas no sale (falla cerrado) y el resto sí', () => {
      expect(labels(resolveSection('estadisticas', SLUG))).toEqual(BASE)
      expect(labels(resolveSection('estadisticas', SLUG, null))).toEqual(BASE)
    })
  })

  describe('Administración: las puertas de los seis ítems que tenía el menú', () => {
    const ALL = ['Resumen', 'Compras', 'Ventas', 'Cajas', 'Libros', 'Plan de cuentas']
    const accountingOn: TenantFeatures = { ...allOff, accounting: true }

    it('dueño con acceso: las seis, con sus rutas; Resumen exacta', () => {
      const section = resolveSection(
        'administracion',
        SLUG,
        viewer({ features: accountingOn, accounting: OWNER_WITH_ACCESS }),
      )
      expect(section.label).toBe('Secciones de Administración')
      expect(labels(section)).toEqual(ALL)
      expect(hrefs(section)).toEqual([
        '/hub/administracion',
        '/hub/administracion/compras',
        '/hub/administracion/ventas',
        '/hub/administracion/cajas',
        '/hub/administracion/libros',
        '/hub/administracion/plan-de-cuentas',
      ])
      expect(section.tabs[0]?.exact).toBe(true)
      expect(section.tabs.slice(1).every((t) => !t.exact)).toBe(true)
      expect(section.showWhenNoneActive).toBe(true)
    })

    it('la contadora ve las mismas seis', () => {
      const section = resolveSection(
        'administracion',
        SLUG,
        viewer({ role: 'accountant', features: accountingOn, accounting: ACCOUNTANT_ACCESS }),
      )
      expect(labels(section)).toEqual(ALL)
    })

    it('antes de configurar, quien puede hacerlo solo tiene «Resumen» (la barra no se muestra)', () => {
      const section = resolveSection(
        'administracion',
        SLUG,
        viewer({ features: accountingOn, accounting: OWNER_CAN_SET_UP }),
      )
      expect(labels(section)).toEqual(['Resumen'])
      expect(sectionBarVisible(section, 'resumen')).toBe(false)
    })

    it('sin acceso, con el flag apagado o con otro rol: nada', () => {
      expect(
        resolveSection(
          'administracion',
          SLUG,
          viewer({ features: accountingOn, accounting: OWNER_WITHOUT_ACCESS }),
        ).tabs,
      ).toEqual([])
      expect(
        resolveSection('administracion', SLUG, viewer({ accounting: OWNER_WITH_ACCESS })).tabs,
      ).toEqual([])
      expect(
        resolveSection(
          'administracion',
          SLUG,
          viewer({ role: 'host', features: accountingOn, accounting: OWNER_WITH_ACCESS }),
        ).tabs,
      ).toEqual([])
      expect(resolveSection('administracion', SLUG).tabs).toEqual([])
    })

    it('el superadmin NO saltea el flag de Administración (lo decide la base)', () => {
      const section = resolveSection(
        'administracion',
        SLUG,
        viewer({ isPlatformAdmin: true, accounting: OWNER_WITH_ACCESS }),
      )
      expect(section.tabs).toEqual([])
    })

    it('falla cerrado si el acceso viene armado a mano sin `enabled`', () => {
      const section = resolveSection(
        'administracion',
        SLUG,
        viewer({ features: accountingOn, accounting: { ...OWNER_WITH_ACCESS, enabled: false } }),
      )
      expect(section.tabs).toEqual([])
    })
  })

  it('sectionViewer arma quién mira desde lo que trae requireTenantAccess', () => {
    const v = sectionViewer({
      tenant: { feature_flags: { reviews: true } },
      role: 'owner',
      isPlatformAdmin: false,
      accounting: OWNER_WITH_ACCESS,
    })
    expect(v.features.reviews).toBe(true)
    expect(v.features.accounting).toBe(false)
    expect(v.role).toBe('owner')
    expect(v.accounting).toBe(OWNER_WITH_ACCESS)
  })
})

describe('pestaña activa según la URL', () => {
  const full = viewer({ features: allOn, accounting: OWNER_WITH_ACCESS })
  const active = (section: SectionKey, pathname: string) =>
    activeSectionTab(resolveSection(section, SLUG, full).tabs, pathname)

  it('Administración: por prefijo, Resumen exacta; fichas, Ajustes y Configurar sin marca', () => {
    expect(active('administracion', '/hub/administracion')).toBe('resumen')
    expect(active('administracion', '/hub/administracion/')).toBe('resumen')
    expect(active('administracion', '/hub/administracion/compras')).toBe('compras')
    expect(active('administracion', '/hub/administracion/compras/proveedores/p1')).toBe('compras')
    expect(active('administracion', '/hub/administracion/compras/nueva')).toBe('compras')
    expect(active('administracion', '/hub/administracion/ventas/clientes/c1')).toBe('ventas')
    expect(active('administracion', '/hub/administracion/ventas/cierre')).toBe('ventas')
    expect(active('administracion', '/hub/administracion/cajas/gasto-bancario')).toBe('cajas')
    expect(active('administracion', '/hub/administracion/libros/subdiarios')).toBe('libros')
    expect(active('administracion', '/hub/administracion/plan-de-cuentas/importar')).toBe(
      'plan-de-cuentas',
    )
    expect(active('administracion', '/hub/administracion/comprobantes/d1')).toBeNull()
    expect(active('administracion', '/hub/administracion/asientos/e1')).toBeNull()
    expect(active('administracion', '/hub/administracion/ajustes')).toBeNull()
    expect(active('administracion', '/hub/administracion/configurar')).toBeNull()
  })

  it('Estadísticas: cada sub-ruta y Reseñas en /reviews', () => {
    expect(active('estadisticas', '/hub/estadisticas')).toBe('resumen')
    expect(active('estadisticas', '/hub/estadisticas/como-nos-fue')).toBe('como-nos-fue')
    expect(active('estadisticas', '/hub/estadisticas/senas')).toBe('senas')
    expect(active('estadisticas', '/hub/estadisticas/comisiones')).toBe('comisiones')
    expect(active('estadisticas', '/hub/estadisticas/comisiones/m1')).toBe('comisiones')
    expect(active('estadisticas', '/hub/reviews')).toBe('resenas')
  })

  it('Clientes: la ficha, el alta y el canje quedan en Personas', () => {
    expect(active('clientes', '/hub/clientes')).toBe('personas')
    expect(active('clientes', '/hub/clientes/c1')).toBe('personas')
    expect(active('clientes', '/hub/clientes/nuevo')).toBe('personas')
    expect(active('clientes', '/hub/clientes/c1/canjear')).toBe('personas')
    expect(active('clientes', '/hub/acreditar')).toBe('acreditar')
    expect(active('clientes', '/hub/local/captura')).toBe('qr')
    // El plano comparte /local pero no es de Clientes.
    expect(active('clientes', '/hub/local/mesas')).toBeNull()
  })

  it('Marketing: el editor de una página no marca nada', () => {
    expect(active('marketing', '/hub/tareas')).toBe('tareas')
    expect(active('marketing', '/hub/enlaces')).toBe('enlaces')
    expect(active('marketing', '/hub/paginas')).toBe('paginas')
    expect(active('marketing', '/hub/paginas/pg1')).toBeNull()
  })

  it('prefijo con borde de segmento, sin query ni hash', () => {
    expect(active('clientes', '/hub/clientes-viejos')).toBeNull()
    expect(active('estadisticas', '/hub/estadisticas-2025')).toBeNull()
    expect(active('estadisticas', '/hub/estadisticas/senas?month=2026-10')).toBe('senas')
    expect(active('marketing', '/hub/tareas#semana')).toBe('tareas')
    expect(active('clientes', '/otro/clientes')).toBeNull()
  })

  it('si matchean dos, gana la más específica (no la primera)', () => {
    const tabs = [
      { value: 'padre', href: '/hub/x' },
      { value: 'hija', href: '/hub/x/y' },
    ]
    expect(activeSectionTab(tabs, '/hub/x/y/z')).toBe('hija')
    expect(activeSectionTab(tabs, '/hub/x/w')).toBe('padre')
  })

  it('la barra: Administración se queda sin marca; Marketing se esconde en el editor', () => {
    const admin = resolveSection('administracion', SLUG, full)
    expect(sectionBarVisible(admin, null)).toBe(true)
    const marketing = resolveSection('marketing', SLUG)
    expect(sectionBarVisible(marketing, null)).toBe(false)
    expect(sectionBarVisible(marketing, 'paginas')).toBe(true)
  })
})

describe('Clientes › Personas: el origen es un filtro de la lista', () => {
  it('Todos los orígenes, Reservas y Walk-in, con el segmento que lee la página', () => {
    expect(CLIENTES_ORIGENES.map((o) => o.label)).toEqual([
      'Todos los orígenes',
      'Reservas',
      'Walk-in',
    ])
    expect(CLIENTES_ORIGENES.map((o) => o.segment)).toEqual([null, 'reserva', 'walkin'])
  })
})

describe('nada de lo que salió del menú se quedó sin camino', () => {
  /** Lo que el sidebar tenía como sub-ítems o entradas sueltas hasta el 07/10/2026. */
  const OLD_SIDEBAR_DESTINATIONS = [
    // Clientes › Personas (Todos / Reservas / Walk-in), Acreditar, QR del club
    '/hub/clientes',
    '/hub/clientes?segment=reserva',
    '/hub/clientes?segment=walkin',
    '/hub/acreditar',
    '/hub/local/captura',
    // Marketing
    '/hub/tareas',
    '/hub/enlaces',
    '/hub/paginas',
    // Negocio › Estadísticas (+ hijos) y Reseñas
    '/hub/estadisticas',
    '/hub/estadisticas/como-nos-fue',
    '/hub/estadisticas/senas',
    '/hub/estadisticas/comisiones',
    '/hub/reviews',
    // Administración (seis ítems)
    '/hub/administracion',
    '/hub/administracion/compras',
    '/hub/administracion/ventas',
    '/hub/administracion/cajas',
    '/hub/administracion/libros',
    '/hub/administracion/plan-de-cuentas',
  ]

  it('cada destino viejo es una pestaña de sección o el filtro de origen de Clientes', () => {
    const full = viewer({ features: allOn, accounting: OWNER_WITH_ACCESS })
    const reachable = new Set<string>([
      ...(Object.keys(SECTION_TABS) as SectionKey[]).flatMap((key) =>
        hrefs(resolveSection(key, SLUG, full)),
      ),
      // Reservas / Walk-in: el filtro «Origen» de la lista arma esta misma URL.
      ...CLIENTES_ORIGENES.map(
        (o) => `/${SLUG}/clientes${o.segment ? `?segment=${o.segment}` : ''}`,
      ),
    ])
    const missing = OLD_SIDEBAR_DESTINATIONS.filter((href) => !reachable.has(href))
    expect(missing).toEqual([])
  })

  it('cada pestaña apunta a una página que existe', () => {
    const missing: string[] = []
    for (const [key, def] of Object.entries(SECTION_TABS)) {
      for (const tab of def.tabs) {
        if (!existsSync(join(TENANT_DIR, tab.path, 'page.tsx'))) missing.push(`${key}: ${tab.path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('cada página de una pestaña tiene arriba un layout que dibuja la barra de su sección', () => {
    const marker = (key: string) =>
      key === 'administracion' ? "resolveSection('administracion'" : `section="${key}"`
    const unwired: string[] = []
    for (const [key, def] of Object.entries(SECTION_TABS)) {
      for (const tab of def.tabs) {
        const parts = tab.path.split('/')
        const wired = parts.some((_, i) => {
          const layout = join(TENANT_DIR, ...parts.slice(0, i + 1), 'layout.tsx')
          return existsSync(layout) && readFileSync(layout, 'utf8').includes(marker(key))
        })
        if (!wired) unwired.push(`${key}: ${tab.path}`)
      }
    }
    expect(unwired).toEqual([])
  })
})

describe('pestañas de sección: el proxy deja abrir todo lo que la barra muestra', () => {
  /** Los segmentos después del slug (`/hub/local/captura` → ['local', 'captura']). */
  const rest = (href: string) => href.split('/').filter(Boolean).slice(1)

  it('si un rol llega a alguna página de la sección, puede abrir cada pestaña que ve', () => {
    // El dueño navega libre; los acotados (anfitrión, editor, contadora) solo por sus prefijos.
    // Los de salón ni ven el panel: el proxy los manda a /salon.
    for (const role of ['owner', ...SCOPED_MANAGER_ROLES] as const) {
      // El peor caso: todo prendido, superadmin y acceso total a Administración.
      const full = viewer({
        role,
        features: allOn,
        isPlatformAdmin: true,
        accounting: OWNER_WITH_ACCESS,
      })
      for (const key of Object.keys(SECTION_TABS) as SectionKey[]) {
        const tabs = resolveSection(key, SLUG, full).tabs
        const open = tabs.filter((tab) => canAccessManagerPath(role, rest(tab.href)))
        // Ninguna página de la sección le abre: nunca llega a ver la barra.
        if (open.length === 0) continue
        expect(
          open.map((t) => t.value),
          `${role} · ${key}`,
        ).toEqual(tabs.map((t) => t.value))
      }
    }
  })

  it('la contadora solo llega a la barra de Administración; el anfitrión y el editor, a ninguna', () => {
    const reachableSections = (role: TenantRole, accounting: AccountingAccess) =>
      (Object.keys(SECTION_TABS) as SectionKey[]).filter((key) =>
        resolveSection(key, SLUG, viewer({ role, features: allOn, accounting })).tabs.some((tab) =>
          canAccessManagerPath(role, rest(tab.href)),
        ),
      )
    expect(reachableSections('accountant', ACCOUNTANT_ACCESS)).toEqual(['administracion'])
    expect(reachableSections('host', NO_ACCESS)).toEqual([])
    expect(reachableSections('editor', NO_ACCESS)).toEqual([])
  })
})
