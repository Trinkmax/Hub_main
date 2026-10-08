// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionNav } from '@/components/administracion/section-nav'
import { SectionTabs, scrollLeftToCenter } from '@/components/shell/section-tabs'
import { SectionTabsBar } from '@/components/shell/section-tabs-bar'
import { resolveSection } from '@/components/shell/section-tabs-config'
import { getTenantFeatures } from '@/lib/platform/features'

/**
 * Las pestañas de sección en el primer paint (SSR): lo que tiene que estar para el teclado, los
 * lectores y el celular (aria-current, aria-label, 44 px, anillo de foco, sin barra de scroll), la
 * barra de cada sección según la URL y la Documentación adentro de Configuración.
 */

const nav = vi.hoisted(() => ({ pathname: '/hub' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  nav.pathname = '/hub'
})

const ITEMS = [
  { value: 'proveedores', label: 'Proveedores', href: '/hub/administracion/compras' },
  {
    value: 'comprobantes',
    label: 'Comprobantes',
    href: '/hub/administracion/compras?tab=comprobantes',
    count: 3,
  },
  {
    value: 'gastos-fijos',
    label: 'Gastos fijos',
    shortLabel: 'Fijos',
    href: '/hub/administracion/compras?tab=gastos-fijos',
  },
]

/** Los `<a …>` del HTML, para mirar sus atributos de a uno. */
function anchors(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? []
}

describe('SectionTabs', () => {
  it('nav con nombre, links de verdad y aria-current solo en la activa', () => {
    const html = renderToString(
      createElement(SectionTabs, {
        items: ITEMS,
        active: 'comprobantes',
        label: 'Secciones de Compras',
      }),
    )
    expect(html).toContain('<nav aria-label="Secciones de Compras"')
    const links = anchors(html)
    expect(links).toHaveLength(3)
    expect(links[0]).toContain('href="/hub/administracion/compras"')
    expect(links[1]).toContain('aria-current="page"')
    expect(links.filter((a) => a.includes('aria-current'))).toHaveLength(1)
  })

  it('44 px de alto, anillo de foco que no se recorta y sin barra de scroll a la vista', () => {
    const html = renderToString(
      createElement(SectionTabs, { items: ITEMS, active: 'proveedores', label: 'X' }),
    )
    for (const a of anchors(html)) {
      expect(a).toContain('min-h-11')
      expect(a).toContain('focus-visible:ring-2')
      expect(a).toContain('focus-visible:ring-inset')
    }
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('[scrollbar-width:none]')
    expect(html).toContain('[&amp;::-webkit-scrollbar]:hidden')
  })

  it('etiqueta corta en el celular y contador al lado', () => {
    const html = renderToString(
      createElement(SectionTabs, { items: ITEMS, active: 'proveedores', label: 'X' }),
    )
    expect(html).toContain('<span class="hidden sm:inline">Gastos fijos</span>')
    expect(html).toContain('<span class="sm:hidden">Fijos</span>')
    expect(html).toMatch(/tabular-nums[^"]*">3<\/span>/)
  })

  it('sin activa (una ficha de detalle) no marca ninguna', () => {
    const html = renderToString(
      createElement(SectionTabs, { items: ITEMS, active: null, label: 'X' }),
    )
    expect(html).not.toContain('aria-current')
  })

  it('SectionNav de Administración es el mismo componente (sus pantallas no cambian)', () => {
    expect(SectionNav).toBe(SectionTabs)
  })
})

describe('scrollLeftToCenter: la activa al centro de la barra, sin pasarse', () => {
  it('centra la pestaña', () => {
    // Barra de 300 px, pestaña de 100 px que arranca en x=500 (relativo a la barra: 500).
    expect(
      scrollLeftToCenter({
        scrollLeft: 0,
        overflow: 600,
        navLeft: 0,
        navWidth: 300,
        tabLeft: 500,
        tabWidth: 100,
      }),
    ).toBe(400)
  })

  it('no se pasa de los bordes', () => {
    const base = { navLeft: 0, navWidth: 300, tabWidth: 100 }
    expect(scrollLeftToCenter({ ...base, scrollLeft: 0, overflow: 200, tabLeft: 900 })).toBe(200)
    expect(scrollLeftToCenter({ ...base, scrollLeft: 50, overflow: 200, tabLeft: 10 })).toBe(0)
  })

  it('si la barra entra entera, no corre nada', () => {
    expect(
      scrollLeftToCenter({
        scrollLeft: 0,
        overflow: 0,
        navLeft: 0,
        navWidth: 300,
        tabLeft: 200,
        tabWidth: 100,
      }),
    ).toBe(0)
  })
})

describe('SectionTabsBar: la barra de cada sección según la URL', () => {
  const owner = {
    role: 'owner' as const,
    features: { ...getTenantFeatures({ feature_flags: {} }), accounting: true, reviews: true },
    isPlatformAdmin: false,
    accounting: {
      enabled: true,
      setUp: true,
      read: true,
      write: true,
      admin: true,
      canSetUp: false,
    },
  }

  it('Estadísticas en Señas: Señas marcada, con Reseñas', () => {
    nav.pathname = '/hub/estadisticas/senas'
    const html = renderToString(
      createElement(SectionTabsBar, resolveSection('estadisticas', 'hub', owner)),
    )
    expect(html).toContain('aria-label="Secciones de Estadísticas"')
    const current = anchors(html).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('href="/hub/estadisticas/senas"')
    expect(html).toContain('Reseñas')
    // Mismo contenedor que las páginas (PageShell): no salta al cambiar de pestaña.
    expect(html).toContain('max-w-7xl')
  })

  it('Administración en Ajustes: la barra está, sin ninguna marcada', () => {
    nav.pathname = '/hub/administracion/ajustes'
    const html = renderToString(
      createElement(SectionTabsBar, resolveSection('administracion', 'hub', owner)),
    )
    expect(html).toContain('aria-label="Secciones de Administración"')
    expect(anchors(html)).toHaveLength(6)
    expect(html).not.toContain('aria-current')
  })

  it('Marketing en el editor de una página: sin barra', () => {
    nav.pathname = '/hub/paginas/pg1'
    const html = renderToString(createElement(SectionTabsBar, resolveSection('marketing', 'hub')))
    expect(html).toBe('')
  })

  it('Clientes en la ficha de un cliente: Personas marcada', () => {
    nav.pathname = '/hub/clientes/c1'
    const html = renderToString(createElement(SectionTabsBar, resolveSection('clientes', 'hub')))
    const current = anchors(html).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('href="/hub/clientes"')
  })
})

describe('Configuración: la Documentación vive adentro', () => {
  it('el nav de Configuración tiene «Ayuda › Documentación» → /hub/docs', async () => {
    nav.pathname = '/hub/configuracion/equipo'
    const { SettingsNav } = await import(
      '@/app/(manager)/[tenantSlug]/configuracion/_components/settings-nav'
    )
    const html = renderToString(createElement(SettingsNav, { tenantSlug: 'hub' }))
    expect(html).toContain('aria-label="Secciones de Configuración"')
    expect(html).toContain('Ayuda')
    const docs = anchors(html).find((a) => a.includes('href="/hub/docs"'))
    expect(docs).toBeDefined()
    expect(html).toMatch(/href="\/hub\/docs"[^>]*>Documentación<\/a>/)
  })
})
