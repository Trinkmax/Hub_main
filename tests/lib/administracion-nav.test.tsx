// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNTING_ACTIONS } from '@/components/administracion/acciones/types'
import { admNavPinned, buildAdmNav } from '@/components/administracion/nav/adm-nav-model'
import {
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
  launcherHref,
} from '@/components/administracion/nav/launcher-items'
import {
  activeSectionTab,
  resolveSection,
  type SectionViewer,
} from '@/components/shell/section-tabs-config'
import { getTenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

/**
 * La navegación propia de Administración (rediseño de oct 2026): la barra de píldoras (`AdmNav`),
 * «Más», el lanzador «¿Qué querés cargar?» y el flotante del celular. Acá: qué ve cada uno (los
 * permisos siguen saliendo de `resolveSection`), cuál queda marcada en cada URL, cuándo la barra
 * se pega arriba, y lo que tiene que estar en el primer paint para el teclado y los lectores.
 */

const nav = vi.hoisted(() => ({
  pathname: '/hub/administracion',
  accounting: {
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: true, admin: true },
    readOnly: false,
    openAction: () => {},
    closeAction: () => {},
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
// El contexto lo monta el layout de la sección junto con las hojas (que acá no hacen falta).
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => nav.accounting,
}))
// La tarjeta es del kit de la sección: para la barra alcanza con saber que el lanzador la usa.
vi.mock('@/components/administracion/kit/action-tile', () => ({
  ActionTile: ({ title }: { title: string }) => createElement('span', null, title),
}))

afterEach(() => {
  nav.pathname = '/hub/administracion'
  nav.accounting = { ...nav.accounting, readOnly: false }
})

const BASE = '/hub/administracion'
const features = { ...getTenantFeatures({ feature_flags: {} }), accounting: true }
const FULL: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}
const owner: SectionViewer = {
  role: 'owner',
  features,
  isPlatformAdmin: false,
  accounting: FULL,
}
const accountant: SectionViewer = {
  role: 'accountant',
  features,
  isPlatformAdmin: false,
  accounting: { ...FULL, write: false, admin: false },
}

const ownerTabs = resolveSection('administracion', 'hub', owner).tabs
const accountantTabs = resolveSection('administracion', 'hub', accountant).tabs
const ownerNav = buildAdmNav(ownerTabs, { base: BASE, audience: 'owner' })
const accountantNav = buildAdmNav(accountantTabs, { base: BASE, audience: 'accountant' })

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label)

describe('buildAdmNav: qué va en cada lugar de la barra', () => {
  it('dueño: las cinco de todos los días, en el orden en que se usan', () => {
    expect(labels(ownerNav.primary)).toEqual([
      'Resumen',
      'Ventas',
      'Compras y pagos',
      'Gastos fijos',
      'Cajas',
    ])
    expect(ownerNav.primary.map((item) => item.href)).toEqual([
      BASE,
      `${BASE}/ventas`,
      `${BASE}/compras`,
      `${BASE}/gastos-fijos`,
      `${BASE}/cajas`,
    ])
    // La corta, para cuando no hay lugar.
    expect(ownerNav.primary.find((item) => item.value === 'compras')?.shortLabel).toBe('Compras')
    expect(ownerNav.primary.find((item) => item.value === 'gastos-fijos')?.shortLabel).toBe('Fijos')
  })

  it('dueño: Importar callado y «Contadora» con Libros y Plan de cuentas', () => {
    expect(labels(ownerNav.quiet)).toEqual(['Importar'])
    expect(labels(ownerNav.books)).toEqual(['Libros', 'Plan de cuentas'])
  })

  it('«Más» del celular: Importar, Libros, Plan de cuentas, Guía y Ajustes', () => {
    expect(labels(ownerNav.more)).toEqual([
      'Importar',
      'Libros',
      'Plan de cuentas',
      'Guía',
      'Ajustes',
    ])
    expect(ownerNav.guide.href).toBe(`${BASE}/guias`)
    expect(ownerNav.settings.href).toBe(`${BASE}/ajustes`)
    // En la hoja cada renglón dice para qué sirve.
    expect(ownerNav.more.every((item) => Boolean(item.hint))).toBe(true)
  })

  it('contadora: Libros y Plan de cuentas son píldoras directas, sin desplegable', () => {
    expect(labels(accountantNav.primary)).toEqual([
      'Resumen',
      'Ventas',
      'Compras y pagos',
      'Gastos fijos',
      'Cajas',
      'Libros',
      'Plan de cuentas',
    ])
    expect(accountantNav.books).toEqual([])
    expect(labels(accountantNav.more)).toEqual(['Importar', 'Guía', 'Ajustes'])
  })

  it('los permisos los decide resolveSection: lo que no vino, no aparece', () => {
    const noAccess = resolveSection('administracion', 'hub', {
      ...owner,
      accounting: { ...FULL, read: false, write: false, admin: false },
    }).tabs
    const model = buildAdmNav(noAccess, { base: BASE, audience: 'owner' })
    expect(model.quiet).toEqual([])
    expect(model.books).toEqual([])
    expect(labels(model.primary)).not.toContain('Ventas')
    // Sin nadie que mire (sin sesión), la sección falla cerrada.
    expect(resolveSection('administracion', 'hub', null).tabs).toEqual([])
  })

  it('una pestaña nueva de la sección no se pierde: cae con las calladas y en «Más»', () => {
    const model = buildAdmNav(
      [...ownerTabs, { value: 'nueva', label: 'Algo nuevo', href: `${BASE}/nueva` }],
      { base: BASE, audience: 'owner' },
    )
    expect(labels(model.quiet)).toEqual(['Importar', 'Algo nuevo'])
    expect(labels(model.more)).toContain('Algo nuevo')
    expect(model.all).toHaveLength(ownerTabs.length + 3)
  })
})

describe('la marcada según la URL (también Guía y Ajustes, que antes quedaban sin marca)', () => {
  const active = (path: string) => activeSectionTab(ownerNav.all, path)

  it('las pantallas de la barra y sus fichas', () => {
    expect(active(BASE)).toBe('resumen')
    expect(active(`${BASE}/ventas/cierre`)).toBe('ventas')
    expect(active(`${BASE}/compras/proveedores/p1`)).toBe('compras')
    // El alta de un gasto fijo vive bajo /compras pero es de «Gastos fijos».
    expect(active(`${BASE}/compras/gastos-fijos/g1`)).toBe('gastos-fijos')
    expect(active(`${BASE}/libros/diario`)).toBe('libros')
  })

  it('Ajustes y Guía se marcan, con sus sub-rutas', () => {
    expect(active(`${BASE}/ajustes`)).toBe('ajustes')
    expect(active(`${BASE}/ajustes/arca`)).toBe('ajustes')
    expect(active(`${BASE}/guias`)).toBe('guias')
    expect(active(`${BASE}/guias/como-arrancar`)).toBe('guias')
  })

  it('una ficha suelta (comprobante, asiento) o los saldos iniciales: ninguna', () => {
    expect(active(`${BASE}/comprobantes/c1`)).toBeNull()
    expect(active(`${BASE}/asientos/a1`)).toBeNull()
    expect(active(`${BASE}/configurar`)).toBeNull()
  })
})

describe('admNavPinned: pegada arriba solo en las pantallas de la barra', () => {
  it('el Resumen, las listas, Guía y Ajustes', () => {
    for (const path of [
      BASE,
      `${BASE}/`,
      `${BASE}/ventas`,
      `${BASE}/cajas?tab=flujo`,
      `${BASE}/importar`,
      `${BASE}/guias`,
      `${BASE}/ajustes`,
    ]) {
      expect(admNavPinned(ownerNav.all, path), path).toBe(true)
    }
  })

  it('en las pantallas de tarea se va con la página (tienen su propio resumen pegado)', () => {
    for (const path of [
      `${BASE}/ventas/cierre`,
      `${BASE}/compras/nueva`,
      `${BASE}/importar/arca`,
      `${BASE}/guias/como-arrancar`,
      `${BASE}/ajustes/arca`,
      `${BASE}/comprobantes/c1`,
    ]) {
      expect(admNavPinned(ownerNav.all, path), path).toBe(false)
    }
  })
})

describe('lanzador «¿Qué querés cargar?»: se entra por la situación', () => {
  it('las ocho tarjetas, en orden, con su ejemplo', () => {
    expect(LAUNCHER_TITLE).toBe('¿Qué querés cargar?')
    expect(LAUNCHER_ITEMS.map((item) => [item.title, item.hint])).toEqual([
      ['Cerrar el día', 'Lo que se vendió y cómo te pagaron'],
      ['Pagué algo recién', 'El hielo, la verdulería, un flete'],
      ['Me llegó una factura o un remito y lo pago después', 'Queda como deuda con el proveedor'],
      ['Pago algo que debía', 'A un proveedor o un gasto fijo'],
      ['Me entró plata', 'Una tarjeta, una app de delivery o un cliente'],
      ['Pasé plata de un lado a otro', 'De la caja al banco, pagar la tarjeta'],
      ['Conté la caja', 'Para ver si coincide con el sistema'],
      ['Otra cosa', 'Un socio puso o sacó plata'],
    ])
  })

  it('cada una abre la hoja o la pantalla que ya existía (el contrato ?accion= no cambia)', () => {
    const opens = LAUNCHER_ITEMS.map((item) =>
      item.target.kind === 'sheet' ? `hoja:${item.target.action}` : launcherHref(BASE, item.target),
    )
    expect(opens).toEqual([
      `${BASE}/ventas/cierre`,
      'hoja:gasto',
      `${BASE}/compras/nueva`,
      'hoja:pagar',
      'hoja:cobrar',
      'hoja:mover',
      'hoja:ajustar',
      'hoja:movimiento',
    ])
    // Las seis hojas tienen su tarjeta: nada de lo que se cargaba quedó sin puerta.
    const sheets = LAUNCHER_ITEMS.flatMap((item) =>
      item.target.kind === 'sheet' ? item.target.action : [],
    )
    expect([...sheets].sort()).toEqual([...ACCOUNTING_ACTIONS].sort())
    expect(new Set(LAUNCHER_ITEMS.map((item) => item.key)).size).toBe(LAUNCHER_ITEMS.length)
  })

  it('un solo libro: ningún texto habla de ganancia ni de «en negro / en blanco»', () => {
    const text = LAUNCHER_ITEMS.map((item) => `${item.title} ${item.hint}`)
      .join(' ')
      .toLowerCase()
    for (const banned of ['ganancia', 'ganaste', 'en negro', 'en blanco', 'afuera']) {
      expect(text).not.toContain(banned)
    }
  })
})

/** Los `<a …>` del HTML, para mirar sus atributos de a uno. */
function anchors(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? []
}

describe('AdmNav en el primer paint', () => {
  async function render(audience: 'owner' | 'accountant') {
    const { AdmNav } = await import('@/components/administracion/nav/adm-nav')
    return renderToString(
      createElement(AdmNav, {
        label: 'Secciones de Administración',
        tabs: audience === 'owner' ? ownerTabs : accountantTabs,
        audience,
      }),
    )
  }

  it('dueño en Ventas: nav con nombre, una sola marcada, Guía, Ajustes y «Cargar»', async () => {
    nav.pathname = `${BASE}/ventas`
    const html = await render('owner')
    expect(html).toContain('<nav aria-label="Secciones de Administración"')
    const current = anchors(html).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain(`href="${BASE}/ventas"`)
    expect(html).toContain('Compras y pagos')
    expect(html).toContain('Contadora')
    expect(html).toMatch(new RegExp(`<a[^>]*aria-label="Guía"[^>]*href="${BASE}/guias"`))
    expect(html).toMatch(new RegExp(`<a[^>]*aria-label="Ajustes"[^>]*href="${BASE}/ajustes"`))
    expect(html).toContain('Cargar')
    expect(html).toContain('Más')
  })

  it('en Ajustes y en Guías la barra marca dónde estás', async () => {
    nav.pathname = `${BASE}/ajustes`
    let current = anchors(await render('owner')).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('aria-label="Ajustes"')

    nav.pathname = `${BASE}/guias/como-arrancar`
    current = anchors(await render('owner')).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('aria-label="Guía"')
  })

  it('en la ficha de un comprobante sale igual, sin ninguna marcada', async () => {
    nav.pathname = `${BASE}/comprobantes/c1`
    const html = await render('owner')
    expect(html).toContain('<nav aria-label="Secciones de Administración"')
    expect(html).not.toContain('aria-current')
  })

  it('contadora: Libros y Plan de cuentas a la vista, sin «Contadora ▾» ni «Cargar»', async () => {
    nav.accounting = { ...nav.accounting, readOnly: true }
    nav.pathname = `${BASE}/libros`
    const html = await render('accountant')
    const current = anchors(html).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain(`href="${BASE}/libros"`)
    expect(html).toContain(`href="${BASE}/plan-de-cuentas"`)
    expect(html).not.toContain('Contadora')
    expect(html).not.toContain('Cargar')
  })

  it('pegada bajo el topbar en las pantallas de la barra; en las de tarea, no', async () => {
    nav.pathname = `${BASE}/cajas`
    expect(await render('owner')).toContain('sticky top-14')
    nav.pathname = `${BASE}/ventas/cierre`
    expect(await render('owner')).not.toContain('sticky top-14')
  })

  it('foco visible, sin barra de scroll, y alineada con las páginas angostas', async () => {
    const html = await render('owner')
    for (const a of anchors(html)) {
      expect(a).toContain('focus-visible:ring-2')
      expect(a).toContain('focus-visible:ring-ring')
    }
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('[scrollbar-width:none]')
    // El mismo contenedor que las páginas de 7xl y el corrimiento de las angostas.
    expect(html).toContain('max-w-7xl')
    expect(html).toContain('.max-w-3xl')
    expect(html).toContain('ms-[max(0px,calc((100%_-_80rem)/2))]')
  })

  it('sin pestañas (sección sin resolver) no dibuja nada', async () => {
    const { AdmNav } = await import('@/components/administracion/nav/adm-nav')
    const html = renderToString(createElement(AdmNav, { label: 'X', tabs: [], audience: 'owner' }))
    expect(html).toBe('')
  })
})

describe('QuickActionsBar: el flotante «＋ Cargar» del celular', () => {
  async function render() {
    const { QuickActionsBar } = await import('@/components/administracion/quick-actions')
    return renderToString(createElement(QuickActionsBar))
  }

  it('un solo botón, abajo a la derecha, sobre el área segura y solo en el celular', async () => {
    const html = await render()
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toContain('fixed')
    expect(buttons[0]).toContain('right-4')
    expect(buttons[0]).toContain('env(safe-area-inset-bottom)')
    expect(buttons[0]).toContain('lg:hidden')
    expect(buttons[0]).toContain('aria-haspopup="dialog"')
    expect(buttons[0]).toContain('focus-visible:ring-2')
    expect(html).toContain('Cargar')
    // Ya no es la barra de tres botones.
    expect(html).not.toContain('Cierre del día')
    expect(html).not.toContain('<nav')
  })

  it('deja su espacio al final de la página para no tapar lo último', async () => {
    expect(await render()).toMatch(/<div aria-hidden="true" class="h-24 lg:hidden"><\/div>/)
  })

  it('la contadora no lo ve', async () => {
    nav.accounting = { ...nav.accounting, readOnly: true }
    expect(await render()).toBe('')
  })
})
