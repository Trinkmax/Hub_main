// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADM_SECTIONS,
  activeAdmSection,
  activeAdmSub,
  admFabFromFrame,
  buildAdmNav,
} from '@/components/administracion/nav/adm-nav-model'
import {
  LAUNCHER_DROP_HINT,
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
  launcherGroups,
  launcherHref,
} from '@/components/administracion/nav/launcher-items'
import { resolveSection, type SectionViewer } from '@/components/shell/section-tabs-config'
import { getTenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

/**
 * La navegación de Administración (reunión del 29/10/2026, prototipo aprobado el 04/11): seis
 * palabras arriba, el engranaje y «Cargar», con las solapas de cada sección. Acá: qué ve cada uno
 * (los permisos siguen saliendo de `resolveSection`), cuál queda marcada en cada URL, y lo que tiene
 * que estar en el primer paint para el teclado y los lectores.
 */

const nav = vi.hoisted(() => ({
  pathname: '/hub/administracion',
  search: '',
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
  useSearchParams: () => new URLSearchParams(nav.search),
}))
// El contexto lo monta el layout de la sección junto con las hojas (que acá no hacen falta).
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => nav.accounting,
}))
afterEach(() => {
  nav.pathname = '/hub/administracion'
  nav.search = ''
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
const ownerNav = buildAdmNav(ownerTabs, { base: BASE })
const accountantNav = buildAdmNav(accountantTabs, { base: BASE, audience: 'accountant' })

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label)

describe('buildAdmNav: seis palabras', () => {
  it('dueño: las seis, en orden, cada una a su pantalla', () => {
    expect(labels(ownerNav.sections)).toEqual([
      'Resumen',
      'Compras y pagos',
      'Gastos y sueldos',
      'Ventas',
      'Caja',
      'Contabilidad',
    ])
    expect(ownerNav.sections.map((section) => section.href)).toEqual([
      BASE,
      `${BASE}/compras`,
      `${BASE}/gastos-fijos`,
      `${BASE}/ventas`,
      `${BASE}/cajas`,
      `${BASE}/libros/sumas-y-saldos`,
    ])
  })

  it('las que no entran en el celular llevan su versión corta', () => {
    const short = (value: string) =>
      ownerNav.sections.find((section) => section.value === value)?.shortLabel
    expect(short('compras')).toBe('Compras')
    expect(short('gastos')).toBe('Gastos')
    expect(short('caja')).toBeUndefined()
  })

  it('Importar y la Guía no están en la fila: viven detrás del engranaje', () => {
    expect(labels(ownerNav.sections)).not.toContain('Importar')
    expect(labels(ownerNav.sections)).not.toContain('Guía')
    expect(ownerNav.settings.href).toBe(`${BASE}/ajustes`)
    expect(labels(ownerNav.settings.sub)).toEqual([
      'Ajustes',
      'Puesta en marcha',
      'Guía',
      'Importar',
    ])
  })

  it('cada sección tiene sus solapas, y Contabilidad su acción fija', () => {
    const sub = (value: string) =>
      labels(ownerNav.sections.find((section) => section.value === value)?.sub ?? [])
    expect(sub('resumen')).toEqual([])
    expect(sub('compras')).toEqual(['Proveedores', 'Plan de la semana', 'Comprobantes'])
    expect(sub('gastos')).toEqual(['Gastos fijos', 'Sueldos'])
    expect(sub('ventas')).toEqual(['Planilla del mes', 'Por cobrar', 'Lo que llegó'])
    expect(sub('caja')).toEqual([])
    expect(sub('contabilidad')).toEqual([
      'Sumas y saldos',
      'Mayor',
      'Libro diario',
      'IVA',
      'Plan de cuentas',
      'Cierre de mes',
    ])
    const contabilidad = ownerNav.sections.find((section) => section.value === 'contabilidad')
    expect(contabilidad?.action).toEqual({
      label: 'Asiento manual',
      href: `${BASE}/libros/asiento-manual`,
    })
  })

  it('la contadora arranca por Contabilidad y no tiene Resumen', () => {
    expect(labels(accountantNav.sections)).toEqual([
      'Contabilidad',
      'Compras y pagos',
      'Gastos y sueldos',
      'Ventas',
      'Caja',
    ])
  })

  it('para la contadora, un comprobante es de Contabilidad; para el dueño, de Compras', () => {
    expect(activeAdmSection(accountantNav, `${BASE}/comprobantes/c1`)?.value).toBe('contabilidad')
    expect(activeAdmSection(ownerNav, `${BASE}/comprobantes/c1`)?.value).toBe('compras')
  })

  it('los permisos los decide resolveSection: lo que no vino, no aparece', () => {
    const noAccess = resolveSection('administracion', 'hub', {
      ...owner,
      accounting: { ...FULL, read: false, write: false, admin: false },
    }).tabs
    const model = buildAdmNav(noAccess, { base: BASE })
    expect(labels(model.sections)).not.toContain('Ventas')
    expect(labels(model.sections)).not.toContain('Contabilidad')
    // Sin nadie que mire (sin sesión), la sección falla cerrada.
    expect(resolveSection('administracion', 'hub', null).tabs).toEqual([])
    expect(buildAdmNav([], { base: BASE }).sections).toEqual([])
  })

  it('cada sección nace de una pestaña que existe', () => {
    const known = new Set(ownerTabs.map((tab) => tab.value))
    for (const section of ADM_SECTIONS) expect(known.has(section.tab), section.value).toBe(true)
  })
})

describe('activeAdmSection: la marcada según la URL', () => {
  const active = (path: string) => activeAdmSection(ownerNav, path)?.value ?? null

  it('las pantallas de la fila y sus fichas', () => {
    expect(active(BASE)).toBe('resumen')
    expect(active(`${BASE}/`)).toBe('resumen')
    expect(active(`${BASE}/compras/proveedores/p1`)).toBe('compras')
    expect(active(`${BASE}/compras/nueva`)).toBe('compras')
    expect(active(`${BASE}/compras/semana`)).toBe('compras')
    expect(active(`${BASE}/comprobantes/c1`)).toBe('compras')
    expect(active(`${BASE}/ventas/cierre`)).toBe('ventas')
    expect(active(`${BASE}/cajas/c1`)).toBe('caja')
  })

  it('el alta de un gasto fijo vive bajo /compras pero es de Gastos y sueldos', () => {
    expect(active(`${BASE}/compras/gastos-fijos/g1`)).toBe('gastos')
    expect(active(`${BASE}/gastos-fijos/completar`)).toBe('gastos')
    expect(active(`${BASE}/sueldos`)).toBe('gastos')
  })

  it('Contabilidad se queda con los libros, los asientos y el plan', () => {
    expect(active(`${BASE}/libros`)).toBe('contabilidad')
    expect(active(`${BASE}/libros/mayor`)).toBe('contabilidad')
    expect(active(`${BASE}/libros/asiento-manual`)).toBe('contabilidad')
    expect(active(`${BASE}/asientos/a1`)).toBe('contabilidad')
    expect(active(`${BASE}/plan-de-cuentas`)).toBe('contabilidad')
  })

  it('el engranaje se queda con Ajustes, Importar, la Guía y el asistente', () => {
    expect(active(`${BASE}/ajustes`)).toBe('ajustes')
    expect(active(`${BASE}/ajustes/arca`)).toBe('ajustes')
    expect(active(`${BASE}/importar/mercado-pago`)).toBe('ajustes')
    expect(active(`${BASE}/guias/como-arrancar`)).toBe('ajustes')
    expect(active(`${BASE}/configurar`)).toBe('ajustes')
  })

  it('una ruta de otra sección: ninguna', () => {
    expect(active('/hub/clientes')).toBeNull()
    // No confunde el prefijo: /comprasotra no es Compras.
    expect(active(`${BASE}/comprasotra`)).toBe(null)
  })
})

describe('activeAdmSub: la solapa marcada', () => {
  const sub = (value: string, path: string, search = '') =>
    activeAdmSub(
      ownerNav.sections.find((section) => section.value === value) ?? null,
      `${BASE}${path}`,
      search,
    )

  it('la de por defecto y la de `?tab=` comparten ruta', () => {
    expect(sub('compras', '/compras')).toBe('proveedores')
    expect(sub('compras', '/compras', 'tab=comprobantes')).toBe('comprobantes')
    expect(sub('ventas', '/ventas')).toBe('planilla')
    expect(sub('ventas', '/ventas', 'tab=clientes')).toBe('cobrar')
    expect(sub('ventas', '/ventas', 'tab=neto-por-medio')).toBe('llego')
  })

  it('un `?tab=` sin solapa propia sigue marcando la de por defecto', () => {
    expect(sub('compras', '/compras', 'tab=pagos')).toBe('proveedores')
    expect(sub('ventas', '/ventas', 'tab=facturas')).toBe('planilla')
  })

  it('una sub-ruta marca la de su prefijo más largo', () => {
    expect(sub('compras', '/compras/semana')).toBe('semana')
    expect(sub('compras', '/compras/proveedores/p1')).toBe('proveedores')
    expect(sub('gastos', '/compras/gastos-fijos/g1')).toBe('fijos')
    expect(sub('gastos', '/sueldos')).toBe('sueldos')
    expect(sub('contabilidad', '/libros/iva-compras')).toBe('iva')
    expect(sub('contabilidad', '/libros/cierres')).toBe('cierre')
  })

  it('sin sección o sin solapas, ninguna', () => {
    expect(activeAdmSub(null, BASE, '')).toBeNull()
    expect(sub('caja', '/cajas')).toBeNull()
    expect(sub('resumen', '')).toBeNull()
  })
})

describe('admFabFromFrame: dónde pone el marco el flotante «＋ Cargar»', () => {
  it('en las planillas de primer nivel', () => {
    for (const path of [
      BASE,
      `${BASE}/`,
      `${BASE}/ventas`,
      `${BASE}/compras?tab=pagos`,
      `${BASE}/compras/semana`,
      `${BASE}/gastos-fijos`,
      `${BASE}/sueldos`,
      `${BASE}/cajas`,
      `${BASE}/libros/sumas-y-saldos`,
      `${BASE}/plan-de-cuentas`,
    ]) {
      expect(admFabFromFrame(BASE, path), path).toBe(true)
    }
  })

  it('en Ajustes, en la Guía y en las pantallas de tarea, no', () => {
    for (const path of [
      `${BASE}/ajustes`,
      `${BASE}/guias`,
      `${BASE}/importar`,
      `${BASE}/ventas/cierre`,
      `${BASE}/compras/nueva`,
      `${BASE}/libros/asiento-manual`,
      `${BASE}/libros/cierres`,
      `${BASE}/gastos-fijos/completar`,
      `${BASE}/configurar`,
      '/hub/clientes',
    ]) {
      expect(admFabFromFrame(BASE, path), path).toBe(false)
    }
  })
})

describe('el lanzador «¿Qué cargás?»: con las palabras del bar', () => {
  it('la Compra primero; el orden que tienen educado al equipo', () => {
    expect(LAUNCHER_TITLE).toBe('¿Qué cargás?')
    expect(LAUNCHER_DROP_HINT).toContain('arrastrar')
    const { daily, sometimes } = launcherGroups()
    expect(daily.map((item) => item.title)).toEqual([
      'Compra',
      'Compra y pago',
      'Pago',
      'Cierre del día',
    ])
    expect(sometimes.map((item) => item.title)).toEqual([
      'Adelanto o sueldo',
      'Entró plata',
      'Socio puso o sacó',
      'Gasto del banco',
      'Contar la caja',
    ])
  })

  it('las cuatro principales se abren con su número, en orden', () => {
    const { daily } = launcherGroups()
    expect(daily.map((item) => item.shortcut)).toEqual(['1', '2', '3', '4'])
    expect(launcherGroups().sometimes.every((item) => !item.shortcut)).toBe(true)
  })

  it('cada una abre su hoja o su pantalla', () => {
    const opens = LAUNCHER_ITEMS.map((item) =>
      item.target.kind === 'sheet' ? `hoja:${item.target.action}` : launcherHref(BASE, item.target),
    )
    expect(opens).toEqual([
      `${BASE}/compras/nueva`,
      `${BASE}/compras/nueva?modo=pago`,
      'hoja:pagar',
      `${BASE}/ventas/cierre`,
      `${BASE}/sueldos`,
      'hoja:cobrar',
      'hoja:movimiento',
      `${BASE}/cajas/gasto-bancario`,
      'hoja:ajustar',
    ])
    expect(new Set(LAUNCHER_ITEMS.map((item) => item.key)).size).toBe(LAUNCHER_ITEMS.length)
  })

  it('«Mover plata» salió del frente; un solo libro: nada de ganancia ni «en negro»', () => {
    const text = LAUNCHER_ITEMS.map((item) => `${item.title} ${item.hint ?? ''}`)
      .join(' ')
      .toLowerCase()
    for (const banned of ['mover', 'ganancia', 'ganaste', 'en negro', 'en blanco', 'afuera']) {
      expect(text).not.toContain(banned)
    }
  })
})

describe('LauncherDoors: las puertas en el primer paint', () => {
  async function render(pending: string | null = null) {
    const { LauncherDoors } = await import('@/components/administracion/nav/launcher')
    return renderToString(createElement(LauncherDoors, { base: BASE, pending, onPick: () => {} }))
  }
  const doors = (html: string) => html.match(/<(?:a|button)\b[^>]*data-launcher-item[^>]*>/g) ?? []

  it('están todas, en orden, cada una link o botón según a dónde lleva', async () => {
    const html = await render()
    const all = doors(html)
    expect(all.map((tag) => tag.match(/data-launcher-item="([^"]+)"/)?.[1])).toEqual(
      LAUNCHER_ITEMS.map((item) => item.key),
    )
    // Las que abren pantalla son links; las que abren una hoja, botones.
    const links = all.filter((tag) => tag.startsWith('<a'))
    expect(links.map((tag) => tag.match(/href="([^"]+)"/)?.[1])).toEqual([
      `${BASE}/compras/nueva`,
      `${BASE}/compras/nueva?modo=pago`,
      `${BASE}/ventas/cierre`,
      `${BASE}/sueldos`,
      `${BASE}/cajas/gasto-bancario`,
    ])
    for (const tag of all) {
      expect(tag).toContain('focus-visible:ring-2')
      expect(tag).not.toContain('aria-busy')
    }
  })

  it('al elegir una: esa queda «abriendo», las demás se apagan y se avisa al lector', async () => {
    const html = await render('compra-y-pago')
    const all = doors(html)
    const busy = all.filter((tag) => tag.includes('aria-busy="true"'))
    expect(busy).toHaveLength(1)
    expect(busy[0]).toContain('data-launcher-item="compra-y-pago"')
    const waiting = all.filter((tag) => tag.includes('aria-disabled="true"'))
    expect(waiting).toHaveLength(LAUNCHER_ITEMS.length - 1)
    for (const tag of waiting) expect(tag).toContain('pointer-events-none')
    expect(html).toMatch(/role="status"[^>]*>Abriendo «Compra y pago»…/)
  })
})

/** Los `<a …>` del HTML, para mirar sus atributos de a uno. */
function anchors(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? []
}

describe('AdmNav en el primer paint', () => {
  async function render(audience: 'owner' | 'accountant' = 'owner') {
    const { AdmNav } = await import('@/components/administracion/nav/adm-nav')
    return renderToString(
      createElement(AdmNav, {
        label: 'Secciones de Administración',
        tabs: audience === 'owner' ? ownerTabs : accountantTabs,
        audience,
      }),
    )
  }
  const current = (html: string) => anchors(html).filter((a) => a.includes('aria-current="page"'))

  it('dueño en Ventas: nav con nombre, una sola sección marcada, engranaje y «Cargar»', async () => {
    nav.pathname = `${BASE}/ventas`
    const html = await render()
    expect(html).toContain('<nav aria-label="Secciones de Administración"')
    // La sección y su solapa.
    expect(current(html).map((a) => a.match(/href="([^"]+)"/)?.[1])).toEqual([
      `${BASE}/ventas`,
      `${BASE}/ventas`,
    ])
    expect(html).toContain('Compras y pagos')
    expect(html).toMatch(new RegExp(`<a[^>]*aria-label="Ajustes"[^>]*href="${BASE}/ajustes"`))
    expect(html).toContain('Cargar')
  })

  it('siempre pegada bajo el topbar: una planilla larga no te hace perder el menú', async () => {
    for (const path of [`${BASE}/cajas`, `${BASE}/ventas/cierre`, `${BASE}/compras/nueva`]) {
      nav.pathname = path
      expect(await render(), path).toContain('sticky top-14')
    }
  })

  it('en Ajustes marca el engranaje y muestra sus solapas', async () => {
    nav.pathname = `${BASE}/ajustes`
    const html = await render()
    const [gear] = current(html)
    expect(gear).toContain('aria-label="Ajustes"')
    expect(html).toContain('Puesta en marcha')
    expect(html).toContain(`href="${BASE}/importar"`)
  })

  it('las solapas de la sección: una marcada, y la acción de Contabilidad', async () => {
    nav.pathname = `${BASE}/libros/mayor`
    const html = await render()
    expect(current(html).map((a) => a.match(/href="([^"]+)"/)?.[1])).toEqual([
      `${BASE}/libros/sumas-y-saldos`,
      `${BASE}/libros/mayor`,
    ])
    expect(html).toContain('Asiento manual')
    expect(html).toContain('aria-label="Contabilidad"')
  })

  it('contadora: arranca por Contabilidad, sin Resumen ni «Cargar»', async () => {
    nav.accounting = { ...nav.accounting, readOnly: true }
    nav.pathname = `${BASE}/libros/sumas-y-saldos`
    const html = await render('accountant')
    expect(html).not.toContain('Resumen')
    expect(html).not.toContain('Cargar')
    expect(html.indexOf('Contabilidad')).toBeLessThan(html.indexOf('Compras y pagos'))
  })

  it('foco visible y sin barra de scroll', async () => {
    const html = await render()
    for (const a of anchors(html)) {
      expect(a).toContain('focus-visible:ring-2')
      expect(a).toContain('focus-visible:ring-ring')
    }
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('[scrollbar-width:none]')
    expect(html).toContain('max-w-7xl')
  })

  it('sin pestañas (sección sin resolver) no dibuja nada', async () => {
    const { AdmNav } = await import('@/components/administracion/nav/adm-nav')
    const html = renderToString(createElement(AdmNav, { label: 'X', tabs: [] }))
    expect(html).toBe('')
  })
})

describe('el flotante «＋ Cargar» del celular', () => {
  async function renderFab() {
    const { AdmFab } = await import('@/components/administracion/nav/launcher-fab')
    return renderToString(createElement(AdmFab))
  }
  async function renderBar() {
    const { QuickActionsBar } = await import('@/components/administracion/quick-actions')
    return renderToString(createElement(QuickActionsBar))
  }

  it('un solo botón, abajo a la derecha, sobre el área segura y solo en el celular', async () => {
    const html = await renderFab()
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toContain('fixed')
    expect(buttons[0]).toContain('right-4')
    expect(buttons[0]).toContain('env(safe-area-inset-bottom)')
    expect(buttons[0]).toContain('lg:hidden')
    expect(buttons[0]).toContain('aria-haspopup="dialog"')
    expect(buttons[0]).toContain('focus-visible:ring-2')
    // El aro del color del fondo lo despega de un botón del mismo verde o del panel oscuro.
    expect(buttons[0]).toContain('ring-4')
    expect(buttons[0]).toContain('ring-background')
    // La palabra sigue en el botón aunque se achique al bajar: es su nombre.
    expect(html).toContain('Cargar')
    expect(html).not.toContain('<nav')
  })

  it('deja su espacio al final de la página para no tapar lo último', async () => {
    expect(await renderFab()).toMatch(/<div aria-hidden="true" class="h-24 lg:hidden"><\/div>/)
  })

  it('lo pone el marco en las planillas; en Ajustes y en las de tarea, no', async () => {
    for (const path of [BASE, `${BASE}/compras/semana`, `${BASE}/plan-de-cuentas`]) {
      nav.pathname = path
      expect((await renderFab()).match(/<button\b/g) ?? [], path).toHaveLength(1)
    }
    for (const path of [
      `${BASE}/ajustes`,
      `${BASE}/guias`,
      `${BASE}/ventas/cierre`,
      `${BASE}/compras/nueva`,
    ]) {
      nav.pathname = path
      expect(await renderFab(), path).toBe('')
    }
  })

  it('QuickActionsBar no lo repite donde ya lo pone el marco, y lo pone en una sub-ruta', async () => {
    // Las páginas de primer nivel que todavía lo incluyen no dibujan un segundo botón.
    for (const path of [BASE, `${BASE}/ventas`, `${BASE}/cajas`]) {
      nav.pathname = path
      expect(await renderBar(), path).toBe('')
    }
    nav.pathname = `${BASE}/compras/proveedores/p1`
    const html = await renderBar()
    expect(html.match(/<button\b/g) ?? []).toHaveLength(1)
    expect(html).toContain('fixed')
    expect(html).toContain('h-24 lg:hidden')
  })

  it('la contadora no lo ve, lo ponga quien lo ponga', async () => {
    nav.accounting = { ...nav.accounting, readOnly: true }
    expect(await renderFab()).toBe('')
    nav.pathname = `${BASE}/compras/proveedores/p1`
    expect(await renderBar()).toBe('')
  })
})

describe('los filtros de período de Ventas y Cajas: píldoras, con los mismos botones de siempre', () => {
  const buttonsOf = (html: string) => html.match(/<button\b[^>]*>/g) ?? []
  /** El atributo, no la variante `disabled:` de las clases. */
  const isDisabled = (button: string | undefined) => / disabled=""/.test(button ?? '')

  async function renderStepper(props: { month: string; today: string; minMonth?: string | null }) {
    const { MonthStepper } = await import('@/components/administracion/cajas-ventas/period-filters')
    return renderToString(createElement(MonthStepper, props))
  }
  async function renderRange(range: {
    kind: 'month' | 'range'
    month: string | null
    from: string
    to: string
    label: string
  }) {
    const { RangeFilter } = await import('@/components/administracion/cajas-ventas/period-filters')
    return renderToString(createElement(RangeFilter, { range, today: '2026-10-13' }))
  }

  it('el mes con flechas es una píldora de papel, como la navegación de día del cierre', async () => {
    const html = await renderStepper({ month: '2026-10', today: '2026-10-13' })
    expect(html).toMatch(/<div class="[^"]*rounded-full[^"]*bg-card[^"]*shadow-xs[^"]*">/)
    expect(html).not.toContain('rounded-xl')
    expect(html).toContain('Octubre 2026')
    const buttons = buttonsOf(html)
    // En el mes de hoy no hay «Este mes»: solo las dos flechas.
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toContain('aria-label="Mes anterior: Septiembre 2026"')
    expect(buttons[1]).toContain('aria-label="Mes siguiente: Noviembre 2026"')
    // No se puede ir más allá de hoy.
    expect(isDisabled(buttons[0])).toBe(false)
    expect(isDisabled(buttons[1])).toBe(true)
    for (const button of buttons) {
      expect(button).toContain('rounded-full')
      // 44 px de toque en el celular.
      expect(button).toContain('size-11')
      // El mismo anillo de foco que las píldoras de al lado (no el del botón de fábrica).
      expect(button).toContain('focus-visible:ring-2')
      expect(button).toMatch(/focus-visible:ring-ring(?![/\w-])/)
      expect(button).not.toContain('focus-visible:ring-[3px]')
      expect(button).not.toContain('focus-visible:ring-ring/50')
    }
  })

  it('mirando otro mes aparece «Este mes»; antes del primer mes con cuentas no se retrocede', async () => {
    const html = await renderStepper({ month: '2026-09', today: '2026-10-13', minMonth: '2026-09' })
    const buttons = buttonsOf(html)
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toContain('aria-label="Mes anterior: Agosto 2026"')
    expect(isDisabled(buttons[0])).toBe(true)
    expect(isDisabled(buttons[1])).toBe(false)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>(?:<[^>]*>)*Este mes/)
    expect(buttons[2]).toContain('h-11')
    expect(buttons[2]).toContain('rounded-full')
  })

  it('en un mes: «Este mes» va RELLENA en tinta y «Rango» abre su diálogo', async () => {
    const html = await renderRange({
      kind: 'month',
      month: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
      label: 'Octubre 2026',
    })
    const buttons = buttonsOf(html)
    // Dos flechas + «Este mes» + «Rango».
    expect(buttons).toHaveLength(4)
    const thisMonth = buttons[2] ?? ''
    expect(thisMonth).toContain('aria-pressed="true"')
    expect(thisMonth).toContain('bg-foreground')
    expect(thisMonth).toContain('text-background')
    // El verde queda para la barra de la sección.
    expect(thisMonth).not.toContain('bg-primary')
    const range = buttons[3] ?? ''
    expect(range).toContain('aria-pressed="false"')
    expect(range).toContain('aria-haspopup="dialog"')
    expect(range).toContain('aria-expanded="false"')
    expect(range).not.toContain('text-background')
    // En el celular «Rango» queda solo para el lector de pantalla (la píldora es el ícono).
    expect(html).toMatch(/<span class="max-sm:sr-only">Rango<\/span>/)
    expect(html).not.toContain('Rango elegido')
    for (const button of [thisMonth, range]) {
      // 44 px donde se toca con el dedo (también una tablet); con mouse, la medida de las
      // píldoras de vista. El corte es por puntero, no por ancho.
      expect(button).toContain('h-11')
      expect(button).toContain('md:pointer-fine:h-9')
      expect(button).not.toMatch(/(?<![:\w-])md:h-9/)
      expect(button).toContain('focus-visible:ring-2')
      expect(button).toContain('focus-visible:ring-ring')
    }
  })

  it('con un rango elegido: las fechas SON el botón que las cambia, relleno, y no hay otra etiqueta', async () => {
    const html = await renderRange({
      kind: 'range',
      month: null,
      from: '2026-09-01',
      to: '2026-09-20',
      label: '01/09 – 20/09/2026',
    })
    const buttons = buttonsOf(html)
    // Sin flechas: las fechas (que abren el selector) + «Este mes».
    expect(buttons).toHaveLength(2)
    const range = buttons[0] ?? ''
    expect(range).toContain('aria-pressed="true"')
    expect(range).toContain('aria-haspopup="dialog"')
    expect(range).toContain('bg-foreground')
    expect(range).toContain('h-11')
    expect(buttons[1]).toContain('aria-pressed="false"')
    // Las fechas van una sola vez, adentro del botón; para lectores, con su nombre adelante.
    expect(html.split('01/09 – 20/09/2026')).toHaveLength(2)
    expect(html).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*>(?:<[^>]*>)*<span class="sr-only">Rango elegido: <\/span>(?:<!-- -->)?01\/09 – 20\/09\/2026/,
    )
    // Ya no hay una píldora quieta con las fechas al lado de otro botón «Rango».
    expect(html).not.toMatch(/<div class="[^"]*rounded-full[^"]*bg-card[^"]*shadow-xs[^"]*min-h-11/)
    expect(html).not.toMatch(/>Rango<\/span><\/button>/)
  })
})
