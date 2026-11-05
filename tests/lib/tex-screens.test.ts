import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAB_VALUES } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/rooms'
import { isComprasTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  resolveBookMonth,
  resolveBookRange,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/periods'
import { parseTab } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/ventas-view'
import { resolveMonth, resolveRange } from '@/components/administracion/cajas-ventas/periods'
import {
  TEX_ADMIN_SCREENS,
  TEX_AJUSTES_TABS,
  TEX_SCREENS,
  texScreen,
  texScreenAllowed,
  texScreenHref,
  texScreensFor,
  texScreenUrlName,
} from '@/lib/tex/screens'

const PANEL = resolve(__dirname, '../../app/(manager)/[tenantSlug]')
const ADMIN = join(PANEL, 'administracion')
const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const TODAY = '2026-11-05'

const source = (file: string) => readFileSync(join(ADMIN, file), 'utf8')

/** La carpeta de esa ruta en `app/`. `:id` es el segmento dinámico que haya ahí: `[id]`, `[managerId]`… */
const folderOf = (path: string, root = false) => {
  let dir = root ? PANEL : ADMIN
  for (const part of path.split('/').filter(Boolean)) {
    if (part !== ':id') {
      dir = join(dir, part)
      continue
    }
    const dynamic = existsSync(dir)
      ? readdirSync(dir).find((name) => /^\[[^\]]+\]$/.test(name))
      : undefined
    dir = join(dir, dynamic ?? '[id]')
  }
  return dir
}
const pageOf = (path: string, root = false) => join(folderOf(path, root), 'page.tsx')

/** Todo el código de una pantalla: su página y lo suyo, sin las pantallas que cuelgan de ella. */
function codeOf(dir: string): string {
  let text = ''
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name.startsWith('_')) text += codeOf(full)
    } else if (/\.tsx?$/.test(name)) {
      text += readFileSync(full, 'utf8')
    }
  }
  return text
}

describe('las pantallas existen', () => {
  it.each(
    TEX_SCREENS.map((s) => [s.id, s.path, s.root ?? false] as const),
  )('%s → %s', (_id, path, root) => {
    expect(existsSync(pageOf(path, root))).toBe(true)
  })

  it('no hay dos con el mismo id', () => {
    const ids = TEX_SCREENS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('el :id de la ruta va declarado, y al revés', () => {
    for (const screen of TEX_SCREENS) {
      expect(screen.path.includes(':id'), screen.id).toBe(screen.params?.includes('id') ?? false)
    }
  })
})

describe('los valores fijos de la URL son los que la pantalla acepta', () => {
  const queryOf = (id: string) => new URLSearchParams(texScreen(id)?.query ?? '')

  it.each(['ventas.cobrar', 'ventas.llego', 'ventas.facturas', 'ventas.cobros'])('%s', (id) => {
    const tab = queryOf(id).get('tab')
    expect(tab).not.toBeNull()
    expect(parseTab(tab)).toBe(tab)
  })

  it('compras.comprobantes', () => {
    expect(isComprasTab(queryOf('compras.comprobantes').get('tab'))).toBe(true)
  })

  it('caja.detalle abre «Entró y salió»', () => {
    expect(queryOf('caja.detalle').get('tab')).toBe('flujo')
    expect(source('cajas/page.tsx')).toMatch(/firstParam\(sp\.tab\) === 'flujo'/)
  })

  it('compras.nueva_y_pago abre con el pago', () => {
    expect(queryOf('compras.nueva_y_pago').get('modo')).toBe('pago')
    expect(source('compras/nueva/page.tsx')).toMatch(/firstParam\(sp\.modo\) === 'pago'/)
  })

  it('las solapas de Ajustes son las de sus habitaciones', () => {
    expect([...TEX_AJUSTES_TABS].sort()).toEqual([...TAB_VALUES].sort())
  })
})

/**
 * Dónde lee cada pantalla cada parámetro. Si una pantalla deja de leerlo, o se declara uno sin mirar la
 * página, esto falla: un parámetro que la pantalla ignora le muestra a la persona otro período
 * creyendo que es el pedido.
 */
const RANGE_IN_BOOKS = /resolveBookRange\(sp,/
const MONTH_IN_BOOKS = /resolveBookMonth\(sp,/
const READS: Readonly<Record<string, Readonly<Record<string, readonly [string, RegExp]>>>> = {
  'compras.semana': { semana: ['compras/semana/page.tsx', /firstParam\(sp\.semana\)/] },
  'compras.comprobantes': {
    mes: ['compras/_lib/period.ts', /mes: first\(sp\.mes\)/],
    desde: ['compras/_lib/period.ts', /desde: first\(sp\.desde\)/],
    hasta: ['compras/_lib/period.ts', /hasta: first\(sp\.hasta\)/],
  },
  'gastos.fijos': { mes: ['gastos-fijos/page.tsx', /firstParam\(sp\.mes\)/] },
  sueldos: { mes: ['sueldos/page.tsx', /firstParam\(sp\.mes\)/] },
  'ventas.proyeccion': { mes: ['ventas/page.tsx', /resolveMonth\(sp, today\)/] },
  'ventas.cierre': { fecha: ['ventas/cierre/page.tsx', /firstParam\(sp\.fecha\)/] },
  'ventas.llego': {
    mes: ['ventas/_components/net-view.tsx', /rangeOrError\(sp, today\)/],
    desde: ['ventas/_components/net-view.tsx', /rangeOrError\(sp, today\)/],
    hasta: ['ventas/_components/net-view.tsx', /rangeOrError\(sp, today\)/],
  },
  'ventas.facturas': {
    mes: ['ventas/_components/invoices-view.tsx', /rangeOrError\(sp, today\)/],
    desde: ['ventas/_components/invoices-view.tsx', /rangeOrError\(sp, today\)/],
    hasta: ['ventas/_components/invoices-view.tsx', /rangeOrError\(sp, today\)/],
  },
  'ventas.cobros': {
    mes: ['ventas/_components/collections-view.tsx', /rangeOrError\(sp, today\)/],
    desde: ['ventas/_components/collections-view.tsx', /rangeOrError\(sp, today\)/],
    hasta: ['ventas/_components/collections-view.tsx', /rangeOrError\(sp, today\)/],
  },
  'caja.detalle': {
    mes: ['cajas/page.tsx', /resolveRange\(sp, today,/],
    desde: ['cajas/page.tsx', /resolveRange\(sp, today,/],
    hasta: ['cajas/page.tsx', /resolveRange\(sp, today,/],
  },
  'caja.cuenta': {
    mes: ['cajas/[id]/page.tsx', /resolveRange\(sp, today\)/],
    desde: ['cajas/[id]/page.tsx', /resolveRange\(sp, today\)/],
    hasta: ['cajas/[id]/page.tsx', /resolveRange\(sp, today\)/],
  },
  'libros.sumas': {
    mes: ['libros/sumas-y-saldos/page.tsx', RANGE_IN_BOOKS],
    desde: ['libros/sumas-y-saldos/page.tsx', RANGE_IN_BOOKS],
    hasta: ['libros/sumas-y-saldos/page.tsx', RANGE_IN_BOOKS],
  },
  'libros.mayor': {
    cuenta: ['libros/mayor/page.tsx', /uuidParam\(sp\.cuenta\)/],
    mes: ['libros/mayor/page.tsx', RANGE_IN_BOOKS],
    desde: ['libros/mayor/page.tsx', RANGE_IN_BOOKS],
    hasta: ['libros/mayor/page.tsx', RANGE_IN_BOOKS],
  },
  'libros.diario': {
    mes: ['libros/diario/page.tsx', RANGE_IN_BOOKS],
    desde: ['libros/diario/page.tsx', RANGE_IN_BOOKS],
    hasta: ['libros/diario/page.tsx', RANGE_IN_BOOKS],
  },
  'libros.iva': { mes: ['libros/posicion-iva/page.tsx', MONTH_IN_BOOKS] },
  'libros.iva_compras': { mes: ['libros/_components/iva-book.tsx', MONTH_IN_BOOKS] },
  'libros.iva_ventas': { mes: ['libros/_components/iva-book.tsx', MONTH_IN_BOOKS] },
  'libros.subdiarios': {
    mes: ['libros/subdiarios/page.tsx', RANGE_IN_BOOKS],
    desde: ['libros/subdiarios/page.tsx', RANGE_IN_BOOKS],
    hasta: ['libros/subdiarios/page.tsx', RANGE_IN_BOOKS],
  },
  'libros.cierres': { mes: ['libros/cierres/page.tsx', MONTH_IN_BOOKS] },
  'libros.historia': {
    mes: ['libros/historia/page.tsx', RANGE_IN_BOOKS],
    desde: ['libros/historia/page.tsx', RANGE_IN_BOOKS],
    hasta: ['libros/historia/page.tsx', RANGE_IN_BOOKS],
  },
  plan_de_cuentas: { cuenta: ['plan-de-cuentas/page.tsx', /first\(sp\.cuenta\)/] },
  ajustes: { tab: ['ajustes/page.tsx', /roomOfTab\(sp\.tab\)/] },
}

describe('cada pantalla de Administración lee lo que declara', () => {
  const declared = TEX_ADMIN_SCREENS.flatMap((screen) =>
    (screen.params ?? []).filter((p) => p !== 'id').map((param) => [screen.id, param] as const),
  )

  it.each(declared)('%s lee %s', (id, param) => {
    const evidence = READS[id]?.[param]
    expect(evidence, `Falta mirar dónde lee ${param} ${id}`).toBeDefined()
    if (!evidence) return
    const [file, pattern] = evidence
    expect(source(file)).toMatch(pattern)
  })

  it('la tabla no tiene nada que ya no se declare', () => {
    for (const [id, params] of Object.entries(READS)) {
      for (const param of Object.keys(params)) {
        expect(
          declared.some(([screen, p]) => screen === id && p === param),
          `${id} ya no declara ${param}`,
        ).toBe(true)
      }
    }
  })
})

describe('cada pantalla de las otras secciones lee lo que declara', () => {
  const declared = TEX_SCREENS.filter((screen) => screen.root).flatMap((screen) =>
    (screen.params ?? [])
      .filter((param) => param !== 'id')
      .map((param) => [screen.id, param, texScreenUrlName(screen, param as never)] as const),
  )

  /**
   * Si la pantalla no lee ese nombre, Tex la abriría en otro día creyendo que es el pedido. Las que leen por un esquema
   * (`calendarParamsSchema`) lo nombran en él.
   */
  const SCHEMAS: Readonly<Record<string, string>> = {
    'eventos.calendario': 'lib/salon/segment-schemas.ts',
    'reservas.nueva': 'lib/salon/segment-schemas.ts',
  }

  it.each(declared)('%s lee %s como ?%s=', (id, _param, urlName) => {
    const screen = texScreen(id)
    if (!screen) throw new Error(id)
    const schema = SCHEMAS[id]
    const code =
      codeOf(folderOf(screen.path, true)) +
      (schema ? readFileSync(resolve(__dirname, '../..', schema), 'utf8') : '')
    expect(code).toMatch(
      new RegExp(
        `(\\bsp\\??\\.${urlName}\\b|[{ ]${urlName}\\b[^\\n]*(searchParams|sp\\b)|\\b${urlName}:|get\\('${urlName}'\\))`,
      ),
    )
  })

  it('la solapa va solo donde se dijeron cuáles', () => {
    for (const screen of TEX_SCREENS) {
      expect(screen.params?.includes('tab') ?? false, screen.id).toBe(screen.tabs !== undefined)
    }
  })
})

describe('los lectores de período entienden `mes`, `desde` y `hasta`', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' }

  it('Ventas lee ?mes=, no ?month=', () => {
    expect(resolveMonth({ mes: '2026-10' }, TODAY)).toMatchObject({ ok: true, ...range })
    expect(resolveMonth({ month: '2026-10' }, TODAY)).toMatchObject({ ok: true, month: '2026-11' })
  })

  it('Caja, Ventas y los libros de rango leen las dos formas', () => {
    expect(resolveRange({ mes: '2026-10' }, TODAY)).toMatchObject({ ok: true, ...range })
    expect(resolveRange({ desde: '2026-10-01', hasta: '2026-10-31' }, TODAY)).toMatchObject({
      ok: true,
      ...range,
    })
    expect(resolveBookRange({ mes: '2026-10' }, TODAY)).toMatchObject({ ok: true, ...range })
    expect(resolveBookRange({ desde: '2026-10-01', hasta: '2026-10-31' }, TODAY)).toMatchObject({
      ok: true,
      ...range,
    })
  })

  it('los libros mensuales leen ?mes=', () => {
    expect(resolveBookMonth({ mes: '2026-10' }, TODAY)).toMatchObject({ ok: true, ...range })
  })
})

describe('texScreenHref', () => {
  it('arma el link dentro de la sección del bar', () => {
    expect(texScreenHref('hub', 'resumen')).toMatchObject({
      ok: true,
      href: '/hub/administracion',
      label: 'Resumen',
    })
    expect(texScreenHref('hub', 'comprobante', { id: ID })).toMatchObject({
      ok: true,
      href: `/hub/administracion/comprobantes/${ID}`,
    })
  })

  it('una pantalla que no existe vuelve con su error', () => {
    expect(texScreenHref('hub', 'no.existe')).toEqual({
      ok: false,
      error: 'No existe la pantalla «no.existe».',
    })
  })

  it.each([
    '',
    'abc',
    '123',
    `${ID}/../..`,
    '../../login',
    `//evil.test/${ID}`,
    `${ID}?x=1`,
  ])('rechaza un id con mala forma: %j', (id) => {
    const link = texScreenHref('hub', 'comprobante', { id })
    expect(link.ok).toBe(false)
  })

  it('rechaza una pantalla de una sola cosa sin id', () => {
    expect(texScreenHref('hub', 'proveedor').ok).toBe(false)
    expect(texScreenHref('hub', 'proveedor', { id: null }).ok).toBe(false)
  })

  it.each([
    'octubre',
    '2026-13',
    '2026-1',
    '2026-10-01',
    '../x',
    "2026-10'; drop",
  ])('ignora un mes con mala forma: %j', (mes) => {
    expect(texScreenHref('hub', 'sueldos', { mes })).toMatchObject({
      ok: true,
      href: '/hub/administracion/sueldos',
    })
  })

  it('deja pasar un mes bueno, junto con lo fijo de la pantalla', () => {
    expect(texScreenHref('hub', 'sueldos', { mes: '2026-10' })).toMatchObject({
      href: '/hub/administracion/sueldos?mes=2026-10',
    })
    expect(texScreenHref('hub', 'ventas.llego', { mes: '2026-10' })).toMatchObject({
      href: '/hub/administracion/ventas?tab=neto-por-medio&mes=2026-10',
    })
  })

  it('un parámetro que la pantalla no lee no llega a la URL', () => {
    expect(texScreenHref('hub', 'caja', { mes: '2026-10', tab: 'cajas', id: ID })).toMatchObject({
      href: '/hub/administracion/cajas',
    })
    expect(texScreenHref('hub', 'compras.semana', { mes: '2026-10' })).toMatchObject({
      href: '/hub/administracion/compras/semana',
    })
  })

  it('el rango va entero o no va', () => {
    const href = (params: { desde?: string; hasta?: string }) => {
      const link = texScreenHref('hub', 'libros.diario', params)
      return link.ok ? link.href : null
    }
    expect(href({ desde: '2026-10-01', hasta: '2026-10-15' })).toBe(
      '/hub/administracion/libros/diario?desde=2026-10-01&hasta=2026-10-15',
    )
    // La pantalla abriría en «Elegí las dos fechas» o «El hasta no puede ser anterior».
    expect(href({ desde: '2026-10-01' })).toBe('/hub/administracion/libros/diario')
    expect(href({ hasta: '2026-10-01' })).toBe('/hub/administracion/libros/diario')
    expect(href({ desde: '2026-10-15', hasta: '2026-10-01' })).toBe(
      '/hub/administracion/libros/diario',
    )
    expect(href({ desde: '2026-02-30', hasta: '2026-03-01' })).toBe(
      '/hub/administracion/libros/diario',
    )
  })

  it('la solapa de Ajustes solo si existe', () => {
    expect(texScreenHref('hub', 'ajustes', { tab: 'impuestos' })).toMatchObject({
      href: '/hub/administracion/ajustes?tab=impuestos',
    })
    expect(texScreenHref('hub', 'ajustes', { tab: 'puntos-de-venta' })).toMatchObject({
      href: '/hub/administracion/ajustes?tab=puntos-de-venta',
    })
    expect(texScreenHref('hub', 'ajustes', { tab: 'noexiste' })).toMatchObject({
      href: '/hub/administracion/ajustes',
    })
  })

  it('el plan de cuentas y el mayor abren en una cuenta con su id', () => {
    expect(texScreenHref('hub', 'plan_de_cuentas', { cuenta: ID })).toMatchObject({
      href: `/hub/administracion/plan-de-cuentas?cuenta=${ID}`,
    })
    expect(texScreenHref('hub', 'libros.mayor', { cuenta: 'Caja' })).toMatchObject({
      href: '/hub/administracion/libros/mayor',
    })
  })

  it('cada pantalla manda el día con el nombre que ella lee', () => {
    const href = (id: string, params: Record<string, string>) => {
      const link = texScreenHref('hub', id, params)
      return link.ok ? link.href : null
    }
    expect(href('reservas.lista', { fecha: '2026-11-06' })).toBe('/hub/reservas?day=2026-11-06')
    expect(href('reservas.lista', { desde: '2026-11-02', hasta: '2026-11-08' })).toBe(
      '/hub/reservas?from=2026-11-02&to=2026-11-08',
    )
    expect(href('operativo.tablero', { fecha: '2026-11-06' })).toBe(
      '/hub/operativo?date=2026-11-06',
    )
    expect(href('eventos.calendario', { mes: '2026-12' })).toBe(
      '/hub/eventos/programados?month=2026-12',
    )
    expect(href('estadisticas.como_nos_fue', { fecha: '2026-11-01' })).toBe(
      '/hub/estadisticas/como-nos-fue?dia=2026-11-01',
    )
    expect(href('estadisticas.resenas', { estrellas: '1' })).toBe('/hub/reviews?rating=1')
    expect(href('estadisticas.resenas', { estrellas: '9' })).toBe('/hub/reviews')
    expect(href('mensajeria.inbox', { chat: ID })).toBe(`/hub/mensajeria/inbox?c=${ID}`)
    expect(href('mensajeria.inbox', { chat: 'Ana' })).toBe('/hub/mensajeria/inbox')
    expect(href('clientes.lista', { etiqueta: ID })).toBe(`/hub/clientes?tag=${ID}`)
    expect(href('senas.reporte', { mes: '2026-10' })).toBe('/hub/estadisticas/senas?month=2026-10')
  })

  describe('nunca arma un link fuera de la sección de la pantalla', () => {
    const hostile = [
      '../../../login',
      '//evil.test',
      'https://evil.test',
      'javascript:alert(1)',
      `${ID}/../../..`,
      '?x=1#y',
      '%2e%2e%2f',
      '\\\\evil.test',
      '2026-10\n',
    ]
    const cases = TEX_SCREENS.flatMap((screen) => hostile.map((v) => [screen.id, v] as const))

    it.each(cases)('%s con %j', (id, value) => {
      const screen = texScreen(id)
      const needsId = screen?.path.includes(':id') ?? false
      const link = texScreenHref('hub', id, {
        // Con el id malo la pantalla no se abre; se prueba también con el id bueno y lo demás malo.
        id: needsId ? ID : value,
        mes: value,
        desde: value,
        hasta: value,
        cuenta: value,
        semana: value,
        tab: value,
        fecha: value,
        chat: value,
        evento: value,
        etiqueta: value,
        estrellas: value,
      })
      expect(link.ok).toBe(true)
      if (!link.ok) return
      const url = new URL(link.href, 'https://hub.test')
      expect(url.origin).toBe('https://hub.test')
      const base = screen?.root ? '/hub' : '/hub/administracion'
      expect(url.pathname === base || url.pathname.startsWith(`${base}/`)).toBe(true)
      expect(link.href).not.toContain('..')
      expect(link.href).not.toContain('evil')
      // Nada de lo malo llegó: solo queda lo fijo de la pantalla.
      expect(url.search).toBe(screen?.query ? `?${screen.query}` : '')
    })

    it.each(
      TEX_SCREENS.filter((s) => s.path.includes(':id')).map((s) => s.id),
    )('%s no se abre con un id malo', (id) => {
      for (const value of hostile) expect(texScreenHref('hub', id, { id: value }).ok).toBe(false)
    })
  })
})

describe('cada uno ve sus pantallas', () => {
  const features = {}
  const admin = texScreen('resumen')
  if (!admin) throw new Error('falta resumen')
  const root = { id: 'x', label: 'x', what: 'x', path: '/menu', root: true } as const
  const reservas = { id: 'y', label: 'y', what: 'y', path: '/reservas', root: true } as const

  it('Administración, solo con su acceso', () => {
    expect(texScreenAllowed(admin, { role: 'owner', features, accounting: true })).toBe(true)
    expect(texScreenAllowed(admin, { role: 'owner', features, accounting: false })).toBe(false)
  })

  it('el dueño navega todo; los roles acotados, solo lo suyo', () => {
    const viewer = (role: 'owner' | 'editor' | 'host' | 'accountant') => ({
      role,
      features,
      accounting: role === 'accountant',
    })
    expect(texScreenAllowed(root, viewer('owner'))).toBe(true)
    expect(texScreenAllowed(root, viewer('editor'))).toBe(true)
    expect(texScreenAllowed(reservas, viewer('editor'))).toBe(false)
    expect(texScreenAllowed(reservas, viewer('host'))).toBe(true)
    expect(texScreenAllowed(root, viewer('host'))).toBe(false)
    expect(texScreenAllowed(root, viewer('accountant'))).toBe(false)
  })

  it('lo que depende de una función, solo si el bar la tiene', () => {
    const screen = { ...root, feature: 'reviews' as const }
    expect(texScreenAllowed(screen, { role: 'owner', features: {}, accounting: true })).toBe(false)
    expect(
      texScreenAllowed(screen, { role: 'owner', features: { reviews: true }, accounting: true }),
    ).toBe(true)
  })

  it('la contadora ve las de Administración', () => {
    const screens = texScreensFor({ role: 'accountant', features: {}, accounting: true })
    expect(screens.length).toBe(TEX_ADMIN_SCREENS.length)
  })
})
