// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNTING_ACTIONS } from '@/components/administracion/acciones/types'
import {
  admFabFromFrame,
  admNavPinned,
  buildAdmNav,
  MONTH_END_VALUE,
  NAV_MIN_PEEK,
  navRestScroll,
} from '@/components/administracion/nav/adm-nav-model'
import {
  LAUNCHER_GROUPS,
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
  launcherGroups,
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
    // «Fijos» solo no dice qué es: «Gastos fijos» va siempre entero (la fila se desliza igual).
    expect(
      ownerNav.primary.find((item) => item.value === 'gastos-fijos')?.shortLabel,
    ).toBeUndefined()
  })

  it('dueño: Importar callado y «Contadora» con Fin de mes, Libros y Plan de cuentas', () => {
    expect(labels(ownerNav.quiet)).toEqual(['Importar'])
    // «Fin de mes» es el primer renglón: es lo que se viene a hacer una vez por mes.
    expect(labels(ownerNav.books)).toEqual(['Fin de mes', 'Libros', 'Plan de cuentas'])
  })

  it('«Más» del celular: Fin de mes primero, Importar, Libros, Plan de cuentas, Guía y Ajustes', () => {
    expect(labels(ownerNav.more)).toEqual([
      'Fin de mes',
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
    expect(ownerNav.more.find((item) => item.value === 'libros')?.hint).toBe(
      'El diario, el IVA y el fin de mes',
    )
  })

  it('«Fin de mes»: un ítem propio que apunta a /libros/cierres y cuelga de Libros', () => {
    expect(ownerNav.monthEnd).toEqual({
      value: MONTH_END_VALUE,
      label: 'Fin de mes',
      href: `${BASE}/libros/cierres`,
      hint: 'Revisar el mes, cerrarlo y mandarle los libros a tu contadora',
      nested: true,
    })
    expect(MONTH_END_VALUE).toBe('fin-de-mes')
    // No es una pestaña de la sección (`section-tabs-config.ts` no se tocó): lo arma la barra.
    expect(ownerTabs.map((tab) => tab.value)).not.toContain(MONTH_END_VALUE)
    expect(ownerNav.all.filter((item) => item.value === MONTH_END_VALUE)).toHaveLength(1)
    // Una sola vez en cada lugar: nunca dos renglones que lleven a lo mismo.
    for (const list of [ownerNav.books, ownerNav.more, accountantNav.primary]) {
      expect(list.filter((item) => item.href === `${BASE}/libros/cierres`)).toHaveLength(1)
    }
    // Las cinco de todos los días no cambian: no es una píldora del dueño.
    expect(labels(ownerNav.primary)).not.toContain('Fin de mes')
  })

  it('contadora: Libros, Fin de mes y Plan de cuentas son píldoras directas, sin desplegable', () => {
    expect(labels(accountantNav.primary)).toEqual([
      'Resumen',
      'Ventas',
      'Compras y pagos',
      'Gastos fijos',
      'Cajas',
      'Libros',
      'Fin de mes',
      'Plan de cuentas',
    ])
    expect(accountantNav.books).toEqual([])
    // Ya es una píldora: en «Más» no se repite.
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
    // Sin Libros no hay «Fin de mes»: el permiso es el de la pestaña de la que cuelga.
    expect(model.monthEnd).toBeNull()
    expect(labels(model.more)).not.toContain('Fin de mes')
    expect(model.all.map((item) => item.value)).not.toContain(MONTH_END_VALUE)
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
    // Las pestañas + la nueva + Fin de mes, Guía y Ajustes.
    expect(model.all).toHaveLength(ownerTabs.length + 4)
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

  it('en Fin de mes se marca «Fin de mes» y no «Libros»: gana la ruta más específica', () => {
    expect(active(`${BASE}/libros/cierres`)).toBe(MONTH_END_VALUE)
    expect(active(`${BASE}/libros/cierres?mes=2026-09`)).toBe(MONTH_END_VALUE)
    // El resto de Libros sigue siendo de «Libros».
    expect(active(`${BASE}/libros`)).toBe('libros')
    expect(active(`${BASE}/libros?mes=2026-09`)).toBe('libros')
    expect(active(`${BASE}/libros/posicion-iva`)).toBe('libros')
    // Para la contadora, igual (ahí son dos píldoras vecinas).
    expect(activeSectionTab(accountantNav.all, `${BASE}/libros/cierres`)).toBe(MONTH_END_VALUE)
    expect(activeSectionTab(accountantNav.all, `${BASE}/libros/diario`)).toBe('libros')
  })

  it('«Completar la planilla» es de Gastos fijos: la píldora queda marcada', () => {
    expect(active(`${BASE}/gastos-fijos/completar`)).toBe('gastos-fijos')
    expect(active(`${BASE}/gastos-fijos?mes=2026-11`)).toBe('gastos-fijos')
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
      `${BASE}/libros`,
      `${BASE}/libros?mes=2026-09`,
      `${BASE}/gastos-fijos`,
      `${BASE}/guias`,
      `${BASE}/ajustes`,
    ]) {
      expect(admNavPinned(ownerNav.all, path), path).toBe(true)
    }
  })

  it('Fin de mes tiene su renglón pero es una pantalla de tarea: ahí la barra no se pega', () => {
    // Su carátula va pegada justo debajo del topbar (`lg:sticky lg:top-20`).
    for (const nav of [ownerNav, accountantNav]) {
      expect(admNavPinned(nav.all, `${BASE}/libros/cierres`)).toBe(false)
      expect(admNavPinned(nav.all, `${BASE}/libros/cierres?mes=2026-09`)).toBe(false)
    }
  })

  it('«Completar la planilla» de Gastos fijos tiene su pie propio: la barra no se pega', () => {
    expect(admNavPinned(ownerNav.all, `${BASE}/gastos-fijos/completar`)).toBe(false)
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

describe('navRestScroll: dónde descansa la fila deslizable', () => {
  // Un celular de 390 px: la fila mide 326 y «Más» le tapa 46 del borde derecho.
  const pills = [
    { start: 4, end: 110 }, // Resumen
    { start: 116, end: 204 }, // Ventas
    { start: 210, end: 315 }, // Compras
    { start: 321, end: 442 }, // Gastos fijos
    { start: 448, end: 530 }, // Cajas
  ]
  const row = { pills, width: 326, cover: 46, inset: 4, max: 252 }
  const rest = (active: number, current = 0) => navRestScroll({ ...row, active, current })
  /** Lo que se ve de la píldora cortada contra «Más» (0 si no hay ninguna cortada). */
  const peek = (scroll: number) => {
    const edge = scroll + row.width - row.cover
    const cut = pills.find((pill) => pill.start < edge && pill.end > edge + 1)
    return cut ? edge - cut.start : 0
  }

  it('si la activa ya se ve entera, la fila no se mueve (no se «centra»)', () => {
    expect(rest(0)).toBe(0)
    // Ventas entraba entera: correr la fila le comía el ícono a «Resumen».
    expect(rest(1)).toBe(0)
    // Tampoco se mueve si ya la habían deslizado y la activa sigue a la vista.
    expect(rest(2, 112)).toBe(112)
  })

  it('si está cortada, va a donde arranca una píldora y la muestra entera', () => {
    const stops = [0, ...pills.map((pill) => pill.start - row.inset), row.max]
    for (const active of [2, 3, 4]) {
      const scroll = rest(active)
      const pill = pills[active]
      expect(stops, `parada de la ${active}`).toContain(scroll)
      expect(pill?.start).toBeGreaterThanOrEqual(scroll + row.inset - 1)
      expect(pill?.end).toBeLessThanOrEqual(scroll + row.width - row.cover + 1)
    }
    // Compras: arranca en «Ventas», la parada más cercana que la deja entera.
    expect(rest(2)).toBe(112)
  })

  it('nunca deja asomando solo el borde de la siguiente contra «Más»', () => {
    for (const active of [0, 1, 2, 3, 4]) {
      const shown = peek(rest(active))
      expect(shown === 0 || shown >= NAV_MIN_PEEK, `activa ${active}: asoman ${shown} px`).toBe(
        true,
      )
    }
    // En «Gastos fijos» la parada más cercana (206) dejaba 42 px de «Cajas»: va al final.
    expect(peek(206)).toBeLessThan(NAV_MIN_PEEK)
    expect(rest(3)).toBe(252)
  })

  it('sin nada que deslizar, o sin activa en la fila, no inventa nada', () => {
    expect(navRestScroll({ ...row, max: 0, active: 4, current: 0 })).toBe(0)
    expect(navRestScroll({ ...row, active: -1, current: 80 })).toBe(80)
    // Nunca se pasa de los bordes.
    expect(navRestScroll({ ...row, active: -1, current: 999 })).toBe(252)
  })

  it('una píldora más ancha que la ventana: por lo menos desde el principio', () => {
    const wide = [
      { start: 4, end: 110 },
      { start: 116, end: 520 },
    ]
    expect(
      navRestScroll({
        pills: wide,
        active: 1,
        width: 326,
        cover: 46,
        inset: 4,
        current: 0,
        max: 242,
      }),
    ).toBe(112)
  })
})

describe('admFabFromFrame: dónde pone el marco el flotante «＋ Cargar»', () => {
  it('en las pantallas de primer nivel, también Importar, Libros y Plan de cuentas', () => {
    for (const path of [
      BASE,
      `${BASE}/`,
      `${BASE}/ventas`,
      `${BASE}/compras?tab=pagos`,
      `${BASE}/gastos-fijos`,
      `${BASE}/cajas`,
      `${BASE}/importar`,
      `${BASE}/libros`,
      `${BASE}/plan-de-cuentas`,
    ]) {
      expect(admFabFromFrame(BASE, path), path).toBe(true)
    }
  })

  it('en Ajustes no (termina en «Guardar cambios»), en la Guía tampoco, ni en las de tarea', () => {
    for (const path of [
      `${BASE}/ajustes`,
      // La Guía trae en cada parada el botón de su pantalla: el flotante tapaba el que te toca.
      `${BASE}/guias`,
      `${BASE}/ventas/cierre`,
      `${BASE}/compras/nueva`,
      `${BASE}/libros/asiento-manual`,
      // Fin de mes y «Completar la planilla» son sub-rutas: si llevan flotante, lo pone la página.
      `${BASE}/libros/cierres`,
      `${BASE}/gastos-fijos/completar`,
      `${BASE}/guias/dia-a-dia`,
      `${BASE}/configurar`,
      '/hub/clientes',
    ]) {
      expect(admFabFromFrame(BASE, path), path).toBe(false)
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

  it('jerarquía: lo de todos los días arriba y grande; el resto, renglones compactos', () => {
    const { daily, sometimes } = launcherGroups()
    expect(LAUNCHER_GROUPS).toEqual({ daily: 'Todos los días', sometimes: 'Cada tanto' })
    expect(daily.map((item) => item.key)).toEqual(['cierre', 'gasto'])
    expect(sometimes.map((item) => item.key)).toEqual([
      'compra',
      'pagar',
      'cobrar',
      'mover',
      'ajustar',
      'movimiento',
    ])
    // Entre los dos grupos están las ocho, en el orden de siempre.
    expect([...daily, ...sometimes]).toEqual([...LAUNCHER_ITEMS])
    // De punta a punta: el título largo y el cajón de sastre del final. El resto, de a dos.
    expect(sometimes.filter((item) => item.wide).map((item) => item.key)).toEqual([
      'compra',
      'movimiento',
    ])
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

describe('LauncherDoors: las ocho puertas en el primer paint', () => {
  async function render(pending: string | null = null) {
    const { LauncherDoors } = await import('@/components/administracion/nav/launcher')
    return renderToString(createElement(LauncherDoors, { base: BASE, pending, onPick: () => {} }))
  }
  const doors = (html: string) => html.match(/<(?:a|button)\b[^>]*data-launcher-item[^>]*>/g) ?? []

  it('dos grupos con su rótulo y las ocho puertas, cada una link o botón según a dónde lleva', async () => {
    const html = await render()
    expect(html).toContain('Todos los días')
    expect(html).toContain('Cada tanto')
    expect(html.indexOf('Todos los días')).toBeLessThan(html.indexOf('Cada tanto'))
    const all = doors(html)
    expect(all).toHaveLength(LAUNCHER_ITEMS.length)
    expect(all.map((tag) => tag.match(/data-launcher-item="([^"]+)"/)?.[1])).toEqual(
      LAUNCHER_ITEMS.map((item) => item.key),
    )
    // Las que abren pantalla son links; las que abren una hoja, botones.
    const links = all.filter((tag) => tag.startsWith('<a'))
    expect(links).toHaveLength(2)
    expect(links[0]).toContain(`href="${BASE}/ventas/cierre"`)
    expect(links[1]).toContain(`href="${BASE}/compras/nueva"`)
    for (const tag of all) {
      expect(tag).toContain('focus-visible:ring-2')
      expect(tag).toContain('focus-visible:ring-ring')
      expect(tag).not.toContain('aria-busy')
    }
    for (const item of LAUNCHER_ITEMS) {
      expect(html).toContain(item.title)
      expect(html).toContain(item.hint)
    }
  })

  it('las dos de todos los días van con el ícono relleno de marca; las demás, no', async () => {
    const html = await render()
    expect(html.match(/bg-primary text-primary-foreground/g) ?? []).toHaveLength(2)
    expect(html.indexOf('bg-primary')).toBeLessThan(html.indexOf('Cada tanto'))
  })

  it('al elegir una: esa queda «abriendo», las demás se apagan y se avisa al lector', async () => {
    const html = await render('gasto')
    const all = doors(html)
    const busy = all.filter((tag) => tag.includes('aria-busy="true"'))
    expect(busy).toHaveLength(1)
    expect(busy[0]).toContain('data-launcher-item="gasto"')
    const waiting = all.filter((tag) => tag.includes('aria-disabled="true"'))
    expect(waiting).toHaveLength(LAUNCHER_ITEMS.length - 1)
    for (const tag of waiting) expect(tag).toContain('pointer-events-none')
    expect(html).toMatch(/role="status"[^>]*>Abriendo «Pagué algo recién»…/)
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

  it('dueño en Fin de mes: «Contadora ▾» y «Más» quedan marcadas; la barra no se pega', async () => {
    nav.pathname = `${BASE}/libros/cierres`
    const html = await render('owner')
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    const books = buttons.find((b) => b.includes('data-nav-current'))
    // Rellena, como cualquier píldora activa (el renglón «Fin de mes» está adentro del desplegable).
    expect(books).toContain('bg-primary')
    expect(html).toMatch(/<button[^>]*data-nav-current[^>]*>Contadora/)
    const more = buttons.find((b) => b.includes('data-nav-more'))
    expect(more).toContain('bg-primary')
    // Ninguna de las cinco de todos los días queda marcada, ni «Libros» por arrastre.
    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('sticky top-14')
    // En Libros a secas pasa lo mismo de siempre.
    nav.pathname = `${BASE}/libros`
    const libros = await render('owner')
    expect(libros).toMatch(/<button[^>]*data-nav-current[^>]*>Contadora/)
    expect(libros).toContain('sticky top-14')
  })

  it('contadora en Fin de mes: su píldora queda marcada y «Libros», al lado, no', async () => {
    nav.accounting = { ...nav.accounting, readOnly: true }
    nav.pathname = `${BASE}/libros/cierres`
    const html = await render('accountant')
    const current = anchors(html).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain(`href="${BASE}/libros/cierres"`)
    const libros = anchors(html).find((a) => a.includes(`href="${BASE}/libros"`))
    expect(libros).toBeDefined()
    expect(libros).not.toContain('aria-current')
    // Vecinas, en ese orden, y cada una con su ícono.
    expect(html.indexOf(`href="${BASE}/libros"`)).toBeLessThan(
      html.indexOf(`href="${BASE}/libros/cierres"`),
    )
    expect(html.indexOf(`href="${BASE}/libros/cierres"`)).toBeLessThan(
      html.indexOf(`href="${BASE}/plan-de-cuentas"`),
    )
    expect(html).toMatch(
      new RegExp(`<a[^>]*href="${BASE}/libros/cierres"[^>]*><svg[^>]*lucide-calendar-check`),
    )
    expect(html).toContain('Fin de mes')
    expect(html).not.toContain('Contadora')
    expect(html).not.toContain('Cargar')
  })

  it('contadora: en la compu sus ocho píldoras van sin ícono, para que entren; las del dueño no cambian', async () => {
    /** Los `<svg>` de las píldoras de la fila (links directos de la barra, con su ícono adentro). */
    const pillIcons = (html: string) =>
      (
        html.match(
          /<a\b[^>]*data-nav-current[^>]*><svg[^>]*>|<a\b[^>]*href="[^"]*"[^>]*><svg[^>]*>/g,
        ) ?? []
      )
        .filter((tag) => !tag.includes('aria-label='))
        .map((tag) => tag.slice(tag.indexOf('<svg')))

    nav.accounting = { ...nav.accounting, readOnly: true }
    nav.pathname = `${BASE}/libros`
    const accountantIcons = pillIcons(await render('accountant'))
    // Resumen, Ventas, Compras, Gastos fijos, Cajas, Libros, Fin de mes y Plan de cuentas.
    expect(accountantIcons).toHaveLength(8)
    // El ícono sigue en el celular y la tablet (ahí la fila se desliza); en la compu se va.
    for (const icon of accountantIcons) expect(icon).toContain('lg:hidden')

    nav.accounting = { ...nav.accounting, readOnly: false }
    const ownerIcons = pillIcons(await render('owner'))
    expect(ownerIcons).toHaveLength(5)
    for (const icon of ownerIcons) expect(icon).not.toContain('lg:hidden')
  })

  it('en «Completar la planilla» de Gastos fijos: la píldora marcada y la barra sin pegar', async () => {
    nav.pathname = `${BASE}/gastos-fijos/completar`
    const html = await render('owner')
    const current = anchors(html).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain(`href="${BASE}/gastos-fijos"`)
    expect(html).not.toContain('sticky top-14')
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

  it('Importar y «Contadora ▾» van en la fila solo cuando entran enteros; si no, «Más»', async () => {
    nav.pathname = `${BASE}/compras`
    const html = await render('owner')
    const importar = anchors(html).find((a) => a.includes(`href="${BASE}/importar"`))
    // Por ancho de la barra (del contenedor), no de la ventana.
    expect(importar).toContain('hidden')
    expect(importar).toContain('lg:@[63.75rem]:inline-flex')
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    const more = buttons.find((b) => b.includes('data-nav-more'))
    expect(more).toContain('aria-haspopup="dialog"')
    expect(more).toContain('aria-label="Más de Administración"')
    // «Más» y lo que reemplaza nunca se ven a la vez.
    expect(html).toMatch(
      /<span class="[^"]*lg:@\[63\.75rem\]:hidden[^"]*"><button[^>]*data-nav-more/,
    )
    // La fila pasa por debajo de «Más» y descansa donde arranca una píldora.
    expect(html).toContain('snap-x')
    expect(html).toContain('-ml-9')
  })

  it('sin pestañas (sección sin resolver) no dibuja nada', async () => {
    const { AdmNav } = await import('@/components/administracion/nav/adm-nav')
    const html = renderToString(createElement(AdmNav, { label: 'X', tabs: [], audience: 'owner' }))
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
    // Ya no es la barra de tres botones.
    expect(html).not.toContain('Cierre del día')
    expect(html).not.toContain('<nav')
  })

  it('deja su espacio al final de la página para no tapar lo último', async () => {
    expect(await renderFab()).toMatch(/<div aria-hidden="true" class="h-24 lg:hidden"><\/div>/)
  })

  it('lo pone el marco en las pantallas de primer nivel; en Ajustes y en las de tarea, no', async () => {
    for (const path of [BASE, `${BASE}/importar`, `${BASE}/libros`, `${BASE}/plan-de-cuentas`]) {
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
    // Fin de mes está en la barra pero es una sub-ruta: el flotante lo pone su página, una vez.
    nav.pathname = `${BASE}/libros/cierres`
    expect(await renderFab()).toBe('')
    expect((await renderBar()).match(/<button\b/g) ?? []).toHaveLength(1)
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
