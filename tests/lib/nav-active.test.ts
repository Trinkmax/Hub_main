import { describe, expect, it } from 'vitest'
import { computeActiveHrefs, matchesPath } from '@/components/shell/nav-active'
import { type ResolvedNavGroup, resolveNavGroups } from '@/components/shell/nav-config'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

/** Las etiquetas resaltadas para una URL (con o sin query). Nunca debería haber más de una. */
function activeLabels(url: string, groups: ResolvedNavGroup[]): string[] {
  const [pathname = url, search = ''] = url.split('?')
  const active = computeActiveHrefs(pathname, search, groups)
  return groups
    .flatMap((g) => g.items)
    .filter((i) => active.has(i.href))
    .map((i) => i.label)
}

describe('matchesPath', () => {
  it('prefijo con borde de segmento, ignorando la query del href', () => {
    expect(matchesPath('/x/reservas', '/x/reservas')).toBe(true)
    expect(matchesPath('/x/reservas/nuevo', '/x/reservas')).toBe(true)
    expect(matchesPath('/x/reservas-viejas', '/x/reservas')).toBe(false)
    expect(matchesPath('/x/clientes', '/x/clientes?segment=walkin')).toBe(true)
  })

  it('exacto sólo por igualdad', () => {
    expect(matchesPath('/x', '/x', true)).toBe(true)
    expect(matchesPath('/x/clientes', '/x', true)).toBe(false)
  })
})

// Espejo reducido para las reglas del algoritmo (no de la IA real).
const mirror: ResolvedNavGroup[] = [
  {
    label: 'A',
    items: [
      { label: 'Resumen', href: '/x', iconKey: 'LayoutDashboard', exact: true },
      {
        label: 'Clientes',
        href: '/x/clientes',
        iconKey: 'Users',
        activePaths: ['/x/acreditar', '/x/local/captura'],
      },
      { label: 'Local', href: '/x/local', iconKey: 'LayoutGrid' },
      { label: 'Plano', href: '/x/local/mesas', iconKey: 'LayoutGrid' },
      { label: 'Salón en vivo', href: '/x/salon/mesas', iconKey: 'ClipboardList', newTab: true },
    ],
  },
  {
    label: 'B',
    items: [
      // Empata con «Clientes» en /x/clientes: gana el primero del menú.
      { label: 'Duplicado', href: '/x/otra', iconKey: 'Users', activePaths: ['/x/clientes'] },
      { label: 'Walk-in', href: '/x/clientes?segment=walkin', iconKey: 'Users' },
    ],
  },
]

describe('computeActiveHrefs — reglas', () => {
  it('el item exacto sólo en su pathname exacto', () => {
    expect(activeLabels('/x', mirror)).toEqual(['Resumen'])
    expect(activeLabels('/x/clientes', mirror)).not.toContain('Resumen')
  })

  it('las activePaths resaltan la entrada de su sección, también en sub-rutas', () => {
    expect(activeLabels('/x/acreditar', mirror)).toEqual(['Clientes'])
    expect(activeLabels('/x/local/captura', mirror)).toEqual(['Clientes'])
    expect(activeLabels('/x/local/captura/imprimir', mirror)).toEqual(['Clientes'])
  })

  it('gana el match más largo: /x/local/captura le gana a /x/local', () => {
    expect(activeLabels('/x/local', mirror)).toEqual(['Local'])
    expect(activeLabels('/x/local/mesas', mirror)).toEqual(['Plano'])
    expect(activeLabels('/x/local/otra', mirror)).toEqual(['Local'])
  })

  it('a igual largo gana la primera del menú: nunca dos resaltadas', () => {
    expect(activeLabels('/x/clientes', mirror)).toEqual(['Clientes'])
    expect(computeActiveHrefs('/x/clientes', '', mirror).size).toBe(1)
  })

  it('un href con query sólo gana si la query actual la trae', () => {
    expect(activeLabels('/x/clientes?segment=walkin&page=2', mirror)).toEqual(['Walk-in'])
    expect(activeLabels('/x/clientes?segment=reserva', mirror)).toEqual(['Clientes'])
    expect(activeLabels('/x/clientes?q=ramirez', mirror)).toEqual(['Clientes'])
  })

  it('lo que abre en otra pestaña nunca queda resaltado', () => {
    expect(activeLabels('/x/salon/mesas', mirror)).toEqual([])
  })

  it('sin ningún match devuelve el set vacío', () => {
    expect(computeActiveHrefs('/y/otra-cosa', '', mirror).size).toBe(0)
  })
})

// ── La IA real ─────────────────────────────────────────────────────────────

const SLUG = 'hub'
const OWNER_WITH_ACCESS: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}
/** Todo prendido: así se ven también las entradas del Salón y Administración. */
const EVERYTHING: TenantFeatures = getTenantFeatures({
  feature_flags: {
    reviews: true,
    accounting: true,
    table_service: true,
    floor_plan: true,
    auto_accept: true,
    kitchen: true,
  },
})
const owner = resolveNavGroups('owner', SLUG, EVERYTHING, false, OWNER_WITH_ACCESS)
const ownerHub = resolveNavGroups(
  'owner',
  SLUG,
  getTenantFeatures({ feature_flags: { reviews: true } }),
  false,
)
const host = resolveNavGroups('host', SLUG, EVERYTHING, false)

describe('computeActiveHrefs — una entrada por sección (IA real)', () => {
  const CASES: Array<[url: string, label: string]> = [
    ['/hub', 'Resumen'],
    ['/hub/operativo', 'Operativo'],
    ['/hub/mensajeria', 'Mensajería'],
    ['/hub/mensajeria/flows/abc/registros', 'Mensajería'],
    ['/hub/reservas?day=2026-09-10', 'Reservas'],
    ['/hub/reservas/nuevo?date=2026-09-10&volver=calendario', 'Reservas'],
    ['/hub/reservas/abc', 'Reservas'],
    ['/hub/eventos/programados?day=2026-09-10', 'Calendario'],
    ['/hub/eventos/programados/nuevo', 'Calendario'],
    ['/hub/clientes', 'Clientes'],
    ['/hub/clientes?segment=walkin', 'Clientes'],
    ['/hub/clientes?segment=reserva&page=2', 'Clientes'],
    ['/hub/clientes/abc/canjear', 'Clientes'],
    ['/hub/acreditar', 'Clientes'],
    ['/hub/local/captura', 'Clientes'],
    ['/hub/menu', 'Carta'],
    ['/hub/menu/tags', 'Carta'],
    ['/hub/club', 'Club'],
    ['/hub/club?tab=aliados', 'Club'],
    ['/hub/club/simular', 'Club'],
    ['/hub/tareas', 'Marketing'],
    ['/hub/enlaces', 'Marketing'],
    ['/hub/paginas', 'Marketing'],
    ['/hub/paginas/abc', 'Marketing'],
    ['/hub/estadisticas', 'Estadísticas'],
    ['/hub/estadisticas/como-nos-fue', 'Estadísticas'],
    ['/hub/estadisticas/senas', 'Estadísticas'],
    ['/hub/estadisticas/comisiones/abc', 'Estadísticas'],
    ['/hub/reviews', 'Estadísticas'],
    ['/hub/administracion', 'Administración'],
    ['/hub/administracion/libros/diario', 'Administración'],
    ['/hub/local/mesas', 'Plano y QRs de mesa'],
    ['/hub/local/auto-aceptacion', 'Auto-aceptación'],
    ['/hub/configuracion', 'Configuración'],
    ['/hub/configuracion/equipo', 'Configuración'],
    ['/hub/docs', 'Configuración'],
  ]

  for (const [url, label] of CASES) {
    it(`${url} → ${label}`, () => {
      expect(activeLabels(url, owner)).toEqual([label])
    })
  }

  it('/hub/local/mesas NO resalta Clientes (con o sin el plano prendido)', () => {
    expect(activeLabels('/hub/local/mesas', owner)).not.toContain('Clientes')
    expect(activeLabels('/hub/local/mesas', ownerHub)).toEqual([])
  })

  it('el Resumen es exacto: ninguna sub-ruta lo resalta', () => {
    expect(activeLabels('/hub/clientes', owner)).not.toContain('Resumen')
    expect(activeLabels('/hub/otra-cosa', owner)).toEqual([])
  })

  it('matchea por segmento, no por texto suelto', () => {
    expect(activeLabels('/hub/reservas-viejas', owner)).toEqual([])
    expect(activeLabels('/hub/clientes-viejos', owner)).toEqual([])
  })

  it('lo que abre en otra pestaña (Salón en vivo, Cocina) no se resalta', () => {
    expect(activeLabels('/hub/salon/mesas', owner)).toEqual([])
    expect(activeLabels('/hub/salon/cocina', owner)).toEqual([])
  })

  it('el host: su home y sus números', () => {
    expect(activeLabels('/hub/reservas', host)).toEqual(['Reservas'])
    expect(activeLabels('/hub/eventos/programados', host)).toEqual(['Calendario'])
    expect(activeLabels('/hub/operativo', host)).toEqual(['Operativo'])
    expect(activeLabels('/hub/mis-numeros', host)).toEqual(['Mis números'])
  })

  // Todas las páginas del workspace manager (app/(manager)/[tenantSlug]/**/page.tsx,
  // con ids de ejemplo): en ninguna quedan dos entradas resaltadas.
  it('en ninguna página del panel quedan dos entradas resaltadas', () => {
    const PAGES = [
      '/hub',
      '/hub/acreditar',
      '/hub/administracion/compras/nueva',
      '/hub/administracion/libros/sumas-y-saldos',
      '/hub/clientes/nuevo',
      '/hub/club/punch-cards',
      '/hub/configuracion/resenas',
      '/hub/configuracion/tortas',
      '/hub/docs',
      '/hub/enlaces',
      '/hub/estadisticas/comisiones',
      '/hub/eventos/programados/abc',
      '/hub/local/auto-aceptacion',
      '/hub/local/captura',
      '/hub/local/mesas',
      '/hub/mensajeria/audiencias/nueva',
      '/hub/mensajeria/difusiones/abc',
      '/hub/menu',
      '/hub/mis-numeros',
      '/hub/onboarding',
      '/hub/operativo',
      '/hub/paginas/abc',
      '/hub/reservas/nuevo',
      '/hub/reviews',
      '/hub/tareas',
      '/hub/visitas/nueva',
    ]
    for (const groups of [owner, ownerHub, host]) {
      for (const url of PAGES) {
        expect(activeLabels(url, groups).length, url).toBeLessThanOrEqual(1)
      }
    }
  })
})
