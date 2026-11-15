import { describe, expect, it } from 'vitest'
import {
  clamp,
  dockGeometry,
  holeEdges,
  lensScale,
  MAX_STRETCH,
  magnifierTransform,
  nearestIndex,
  rubberBand,
  smoothstep,
  stretchFromVelocity,
} from '@/components/shell/dock/dock-geometry'
import {
  DOCK_PINNED,
  dockActiveKey,
  dockCookieName,
  flattenedSections,
  MORE_KEY,
  parseDockCookie,
  planDock,
  serializeDockCookie,
} from '@/components/shell/dock/dock-items'
import { createSpring, snapSpring, springSettled, stepSpring } from '@/components/shell/dock/spring'
import { NO_ACCOUNTING as NO_ACC, resolveNavGroups } from '@/components/shell/nav-config'
import { resolveSection } from '@/components/shell/section-tabs-config'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

const SLUG = 'hub'
/** Lo que tiene prendido HUB hoy (reviews, administración, compras, puerta). */
const HUB: TenantFeatures = getTenantFeatures({
  feature_flags: { reviews: true, accounting: true, purchasing: true, ticket_door: true },
})
const OWNER_ACCESS: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: true,
  write: true,
  admin: true,
  canSetUp: false,
}
const ACCOUNTANT_ACCESS: AccountingAccess = { ...OWNER_ACCESS, write: false, admin: false }

/** Una barra de cinco pestañas en un celular de 390 px (la fila mide 290 × 54). */
const geo = dockGeometry({ rowLeft: 4, rowTop: 4, rowWidth: 290, rowHeight: 54, count: 5 })

describe('la geometría de la barra', () => {
  it('reparte la fila en pestañas iguales y ubica sus centros', () => {
    expect(geo.itemWidth).toBe(58)
    expect(geo.centers).toEqual([33, 91, 149, 207, 265])
    expect(geo.centerY).toBe(31)
  })

  it('la lente es más ancha que la pestaña y más alta que la barra (se sale arriba y abajo)', () => {
    expect(geo.lens.width).toBeGreaterThan(geo.itemWidth)
    expect(geo.lens.height).toBeGreaterThan(geo.rowHeight + 8)
    expect(geo.pill.width).toBeLessThan(geo.itemWidth)
  })

  it('elige la pestaña más cercana al dedo', () => {
    expect(nearestIndex(0, geo.centers)).toBe(0)
    expect(nearestIndex(119, geo.centers)).toBe(1)
    expect(nearestIndex(121, geo.centers)).toBe(2)
    expect(nearestIndex(999, geo.centers)).toBe(4)
  })

  it('más allá de los bordes la lente cede cada vez menos (banda elástica)', () => {
    expect(rubberBand(100, 33, 265)).toBe(100)
    expect(rubberBand(13, 33, 265)).toBeCloseTo(33 - 20 * 0.28)
    expect(rubberBand(305, 33, 265)).toBeCloseTo(265 + 40 * 0.28)
  })

  it('se estira con la velocidad y tiene un tope', () => {
    expect(stretchFromVelocity(0)).toBe(0)
    expect(stretchFromVelocity(-260)).toBeCloseTo(0.1)
    expect(stretchFromVelocity(99999)).toBe(MAX_STRETCH)
  })

  it('apoyada mide lo que la píldora; levantada, lo que la lente', () => {
    const resting = lensScale(geo, 0, 0)
    expect(resting.sx * geo.lens.width).toBeCloseTo(geo.pill.width)
    expect(resting.sy * geo.lens.height).toBeCloseTo(geo.pill.height)
    expect(lensScale(geo, 1, 0)).toEqual({ sx: 1, sy: 1 })
    // Estirada: más ancha y más finita.
    const fast = lensScale(geo, 1, 0.2)
    expect(fast.sx).toBeGreaterThan(1)
    expect(fast.sy).toBeLessThan(1)
  })

  it('la lupa lleva el punto de la fila que está bajo la lente al centro de la lente', () => {
    const x = geo.centers[2] ?? 0
    const transform = magnifierTransform(geo, x, { sx: 1, sy: 1 }, 1.25)
    const [tx, ty, zx, zy, cx, cy] = (transform.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    // translate(centro de la lente) scale(zoom) translate(-punto bajo la lente, en coords de la fila)
    expect(tx).toBeCloseTo(geo.lens.width / 2)
    expect(ty).toBeCloseTo(geo.lens.height / 2)
    expect(zx).toBeCloseTo(1.25)
    expect(zy).toBeCloseTo(1.25)
    expect(cx).toBeCloseTo(-(x - geo.rowLeft))
    expect(cy).toBeCloseTo(-(geo.rowHeight / 2))
  })

  it('lo de adentro no se deforma cuando la lente se estira', () => {
    const transform = magnifierTransform(geo, 100, { sx: 1.2, sy: 0.9 }, 1.2)
    const [, , zx, zy] = (transform.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    expect(zx).toBeCloseTo(1)
    expect(zy).toBeCloseTo(1.3333, 3)
  })

  it('el agujero en la fila es lo que tapa la lente', () => {
    const { left, right } = holeEdges(geo, 149, 1)
    expect(right - left).toBeCloseTo(geo.lens.width)
    expect((left + right) / 2).toBeCloseTo(149 - geo.rowLeft)
  })

  it('las curvas auxiliares', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5)
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
  })
})

describe('los resortes', () => {
  it('llegan al destino y se quedan quietos', () => {
    const spring = createSpring(0, { stiffness: 520, damping: 38, precision: 0.05 })
    spring.target = 100
    let frames = 0
    while (!springSettled(spring) && frames < 600) {
      stepSpring(spring, 1 / 60)
      frames++
    }
    expect(springSettled(spring)).toBe(true)
    expect(spring.value).toBeCloseTo(100, 0)
    // Medio segundo, más o menos: ni lento ni de golpe.
    expect(frames).toBeGreaterThan(10)
    expect(frames).toBeLessThan(90)
  })

  it('con poca amortiguación rebota (se pasa del destino y vuelve)', () => {
    const spring = createSpring(0, { stiffness: 600, damping: 18, precision: 0.002 })
    spring.target = 1
    let max = 0
    for (let i = 0; i < 120; i++) {
      stepSpring(spring, 1 / 60)
      max = Math.max(max, spring.value)
    }
    expect(max).toBeGreaterThan(1.05)
    expect(spring.value).toBeCloseTo(1, 1)
  })

  it('un cuadro larguísimo (la pestaña volvió del fondo) no lo desboca', () => {
    const spring = createSpring(0, { stiffness: 900, damping: 55 })
    spring.target = 50
    stepSpring(spring, 5)
    expect(Math.abs(spring.value)).toBeLessThan(80)
  })

  it('se lo puede clavar sin animar', () => {
    const spring = createSpring(0, { stiffness: 520, damping: 38 })
    spring.velocity = 300
    snapSpring(spring, 42)
    expect(spring).toMatchObject({ value: 42, target: 42, velocity: 0 })
    expect(springSettled(spring)).toBe(true)
  })
})

describe('qué va en la barra del panel', () => {
  const owner = resolveNavGroups('owner', SLUG, HUB, false, OWNER_ACCESS)

  it('el dueño: Resumen, Reservas, Clientes, Estadísticas y «Más» con todo lo demás', () => {
    const plan = planDock(owner, 'owner', null)
    expect(plan?.bar.map((item) => item.key)).toEqual([
      'resumen',
      'reservas',
      'clientes',
      'estadisticas',
    ])
    const more = plan?.more.map((item) => item.key) ?? []
    expect(more).toContain('administracion')
    expect(more).toContain('configuracion')
    expect(more).not.toContain('reservas')
  })

  it('cada socio elige sus cuatro (en su orden) y lo que no puede ver se ignora', () => {
    // «operativo» ya no es una sección (es una pestaña de Reservas): se ignora como cualquier otra.
    const plan = planDock(owner, 'owner', ['carta', 'reservas', 'operativo', 'administracion'])
    expect(plan?.bar.map((item) => item.key)).toEqual([
      'carta',
      'reservas',
      'administracion',
      'resumen',
    ])
  })

  it('nunca más de cuatro con «Más», aunque la cookie traiga más', () => {
    const plan = planDock(owner, 'owner', [
      'carta',
      'mensajeria',
      'marketing',
      'estadisticas',
      'compras',
    ])
    expect(plan?.bar).toHaveLength(DOCK_PINNED)
  })

  it('lo que abre en otra pestaña del navegador nunca va en la barra', () => {
    const withSalon = resolveNavGroups(
      'owner',
      SLUG,
      { ...HUB, table_service: true },
      false,
      OWNER_ACCESS,
    )
    const plan = planDock(withSalon, 'owner', ['salon-en-vivo', 'reservas'])
    expect(plan?.bar.map((item) => item.key)).not.toContain('salon-en-vivo')
    expect(plan?.more.map((item) => item.key)).toContain('salon-en-vivo')
  })

  it('la anfitriona: las pestañas de Reservas van sueltas, más sus números, y no hay «Más»', () => {
    const host = resolveNavGroups('host', SLUG, HUB, false)
    const viewer = {
      role: 'host' as const,
      features: HUB,
      isPlatformAdmin: false,
      accounting: NO_ACC,
    }
    const plan = planDock(host, 'host', null, {
      reservas: resolveSection('reservas', SLUG, viewer),
    })
    expect(plan?.bar.map((item) => item.label)).toEqual([
      'Reservas',
      'Operativo',
      'Calendario',
      'Ventas online',
      'Mis números',
    ])
    expect(plan?.bar.map((item) => item.short ?? item.label)[3]).toBe('Ventas')
    expect(plan?.more).toEqual([])
    if (!plan) throw new Error('sin barra')
    // Cada pestaña suelta se marca en su página; la lista solo en la lista (el alta no es «Reservas»).
    expect(dockActiveKey(plan, '/hub/reservas', '/hub/operativo')).toBe('reservas-operativo')
    expect(dockActiveKey(plan, '/hub/reservas', '/hub/reservas')).toBe('reservas-reservas')
    expect(dockActiveKey(plan, '/hub/reservas', '/hub/eventos/programados/nuevo')).toBe(
      'reservas-calendario',
    )
    expect(dockActiveKey(plan, '/hub/mis-numeros', '/hub/mis-numeros')).toBe('mis-numeros')
    expect(flattenedSections(plan)).toEqual(['reservas'])
  })

  it('sin las pestañas a mano, la anfitriona igual tiene su barra (Reservas y sus números)', () => {
    const host = resolveNavGroups('host', SLUG, HUB, false)
    const plan = planDock(host, 'host', null)
    expect(plan?.bar.map((item) => item.label)).toEqual(['Reservas', 'Mis números'])
    expect(flattenedSections(plan)).toEqual([])
  })

  it('con una sola sección (contadora, contenido) no hay barra', () => {
    expect(planDock(resolveNavGroups('editor', SLUG, HUB, false), 'editor', null)).toBeNull()
    expect(
      planDock(
        resolveNavGroups('accountant', SLUG, HUB, false, ACCOUNTANT_ACCESS),
        'accountant',
        null,
      ),
    ).toBeNull()
  })

  it('marca la pestaña de la página, o «Más» si la sección vive ahí', () => {
    const plan = planDock(owner, 'owner', null)
    if (!plan) throw new Error('sin barra')
    expect(dockActiveKey(plan, '/hub/reservas')).toBe('reservas')
    expect(dockActiveKey(plan, '/hub/carta')).toBeNull()
    expect(dockActiveKey(plan, '/hub/tareas')).toBe(MORE_KEY)
    expect(dockActiveKey(plan, null)).toBeNull()
    expect(dockActiveKey(plan, '/hub/no-es-una-seccion')).toBeNull()
  })

  it('la cookie: una por bar, y lo raro se descarta', () => {
    expect(dockCookieName('hub')).toBe('hub_dock_hub')
    expect(parseDockCookie('resumen.reservas.calendario.clientes')).toEqual([
      'resumen',
      'reservas',
      'calendario',
      'clientes',
    ])
    expect(parseDockCookie('reservas.reservas.<script>.CLIENTES')).toEqual(['reservas'])
    expect(parseDockCookie('')).toBeNull()
    expect(parseDockCookie(undefined)).toBeNull()
    expect(serializeDockCookie(['resumen', 'mal valor', 'clientes'])).toBe('resumen.clientes')
  })
})
