import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, resolveNavGroups } from '@/components/shell/nav-config'
import { type FeatureKey, getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess } from '@/lib/tenant/types'

const SLUG = 'hub'
const allOff: TenantFeatures = getTenantFeatures({ feature_flags: {} })
const withFeature = (key: FeatureKey): TenantFeatures => ({ ...allOff, [key]: true })

function labels(groups: ReturnType<typeof resolveNavGroups>): string[] {
  return groups.map((g) => g.label)
}
function group(groups: ReturnType<typeof resolveNavGroups>, label: string) {
  return groups.find((g) => g.label === label)
}
function itemLabels(groups: ReturnType<typeof resolveNavGroups>, groupLabel: string): string[] {
  return group(groups, groupLabel)?.items.map((i) => i.label) ?? []
}

describe('resolveNavGroups — rol + feature + superadmin', () => {
  it('owner sin features y sin ser admin NO ve el grupo Salón', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    expect(group(groups, 'Salón')).toBeUndefined()
    // Pero sí ve lo loyalty-first.
    expect(labels(groups)).toContain('Hoy')
    expect(itemLabels(groups, 'Hoy')).toContain('Resumen')
  })

  it('habilitar una feature revela su item en el grupo Salón', () => {
    const groups = resolveNavGroups('owner', SLUG, withFeature('kitchen'), false)
    expect(itemLabels(groups, 'Salón')).toEqual(['Cocina'])
  })

  it('un superadmin ve TODOS los items del grupo Salón aunque las features estén OFF', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, true)
    const salon = itemLabels(groups, 'Salón')
    expect(salon).toEqual(
      expect.arrayContaining(['Salón en vivo', 'Cocina', 'Plano y QRs de mesa', 'Auto-aceptación']),
    )
  })

  it('el filtro de rol sigue aplicando: un cashier no ve el workspace manager', () => {
    // El proxy rebota a cashier/waiter/kitchen hacia /salon; el sidebar del
    // manager es explícito por rol, así que a un cashier no le queda nada.
    const groups = resolveNavGroups('cashier', SLUG, allOff, false)
    expect(groups).toEqual([])
  })

  it('editor (contenido) ve SOLO la carta: editar + ver como cliente', () => {
    const groups = resolveNavGroups('editor', SLUG, allOff, false)
    expect(labels(groups)).toEqual(['Crecimiento'])
    expect(itemLabels(groups, 'Crecimiento')).toEqual(['Carta', 'Ver carta'])
    const verCarta = group(groups, 'Crecimiento')?.items.find((i) => i.label === 'Ver carta')
    expect(verCarta?.href).toBe('/carta/hub')
    expect(verCarta?.newTab).toBe(true)
    // Con tan pocos items, los grupos no colapsan.
    expect(groups.every((g) => !g.collapsible)).toBe(true)
  })

  it('host (anfitrión) ve operativo + agenda + sus números, nada del negocio del owner', () => {
    const groups = resolveNavGroups('host', SLUG, allOff, false)
    expect(labels(groups)).toEqual(['Hoy', 'Agenda', 'Negocio'])
    expect(itemLabels(groups, 'Hoy')).toEqual(['Operativo'])
    // Reservas volvió al menú (22/09) y va antes del calendario: se reserva
    // desde los dos lados.
    expect(itemLabels(groups, 'Agenda')).toEqual(['Reservas', 'Calendario'])
    expect(itemLabels(groups, 'Negocio')).toEqual(['Mis números'])
    // Con 4 items los grupos no colapsan.
    expect(groups.every((g) => !g.collapsible)).toBe(true)
    const all = groups.flatMap((g) => g.items.map((i) => i.label))
    expect(all).not.toContain('Estadísticas')
    expect(all).not.toContain('Mensajería')
    expect(all).not.toContain('Configuración')
  })

  it('el grupo Marketing es owner-only y trae el tablero, el link de la bio y las páginas', () => {
    const owner = resolveNavGroups('owner', SLUG, allOff, false)
    expect(itemLabels(owner, 'Marketing')).toEqual(['Tareas', 'Link de Instagram', 'Páginas'])
    const tareas = group(owner, 'Marketing')?.items.find((i) => i.label === 'Tareas')
    expect(tareas?.href).toBe('/hub/tareas')
    const enlaces = group(owner, 'Marketing')?.items.find((i) => i.label === 'Link de Instagram')
    expect(enlaces?.href).toBe('/hub/enlaces')
    const paginas = group(owner, 'Marketing')?.items.find((i) => i.label === 'Páginas')
    expect(paginas?.href).toBe('/hub/paginas')

    // Ningún rol acotado lo ve: es la mesa de los socios.
    for (const role of ['waiter', 'cashier', 'kitchen', 'editor', 'host', 'accountant'] as const) {
      expect(group(resolveNavGroups(role, SLUG, allOff, false), 'Marketing')).toBeUndefined()
    }
  })

  it('el owner ve Configuración anclada (pinned, grupo Sistema) y grupos colapsables', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    const sistema = group(groups, 'Sistema')
    expect(sistema?.pinned).toBe(true)
    expect(sistema?.items.map((i) => i.label)).toEqual(['Configuración'])
    expect(sistema?.items[0]?.children?.map((c) => c.label)).toEqual(['Documentación'])
    // Hoy no colapsa (cockpit diario); el resto sí.
    expect(group(groups, 'Hoy')?.collapsible).toBeFalsy()
    for (const label of ['Agenda', 'Clientes', 'Crecimiento', 'Marketing', 'Negocio']) {
      expect(group(groups, label)?.collapsible).toBe(true)
    }
  })

  it('owner: la Agenda es Reservas y después Calendario', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    expect(itemLabels(groups, 'Agenda')).toEqual(['Reservas', 'Calendario'])
    const [reservas, calendario] = group(groups, 'Agenda')?.items ?? []
    expect(reservas?.href).toBe('/hub/reservas')
    expect(calendario?.href).toBe('/hub/eventos/programados')
  })

  it('resuelve hrefs con el slug y mantiene la anidación de Personas', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    const hoy = group(groups, 'Hoy')
    expect(hoy?.items.find((i) => i.label === 'Resumen')?.href).toBe('/hub')

    const personas = group(groups, 'Clientes')?.items.find((i) => i.label === 'Personas')
    expect(personas?.href).toBe('/hub/clientes')
    // Padre puro-agrupador: al clickearlo expande y deja elegir Todos/Reservas/Walk-in.
    expect(personas?.expanderOnly).toBe(true)
    expect(personas?.children?.map((c) => c.label)).toEqual(['Todos', 'Reservas', 'Walk-in'])
    expect(personas?.children?.[0]?.href).toBe('/hub/clientes')
    expect(personas?.children?.[1]?.href).toBe('/hub/clientes?segment=reserva')
  })

  it('un padre owner-only con todos los hijos owner-only se cae para cashier', () => {
    const groups = resolveNavGroups('cashier', SLUG, allOff, false)
    // "Club de beneficios" y su subárbol son owner-only → no debería existir.
    const allItemLabels = groups.flatMap((g) =>
      g.items.flatMap((i) => [i.label, ...(i.children?.map((c) => c.label) ?? [])]),
    )
    expect(allItemLabels).not.toContain('Club de beneficios')
    // Marketing dejó de existir como item (se consolidó en Mensajería).
    expect(allItemLabels).not.toContain('Marketing')
  })

  it('consolida todo bajo un único hub "Mensajería" en Hoy (sin children; nav interna en el sub-nav)', () => {
    const groups = resolveNavGroups('owner', SLUG, allOff, false)
    const mensajeria = group(groups, 'Hoy')?.items.find((i) => i.label === 'Mensajería')
    expect(mensajeria).toBeDefined()
    expect(mensajeria?.href).toBe('/hub/mensajeria')
    expect(mensajeria?.children ?? []).toEqual([])
    // Ya NO hay items sueltos de Difusiones/Audiencias/Flows fuera de Mensajería.
    const topLevel = groups.flatMap((g) => g.items.map((i) => i.label))
    expect(topLevel).not.toContain('Difusiones')
    expect(topLevel).not.toContain('Marketing')
  })

  it('Mensajería queda owner-only en el sidebar (los roles de salón no ven el manager)', () => {
    for (const role of ['waiter', 'cashier', 'kitchen', 'editor', 'host', 'accountant'] as const) {
      const all = resolveNavGroups(role, SLUG, allOff, false).flatMap((g) =>
        g.items.map((i) => i.label),
      )
      expect(all).not.toContain('Mensajería')
    }
    const owner = resolveNavGroups('owner', SLUG, allOff, false)
    expect(itemLabels(owner, 'Hoy')).toContain('Mensajería')
  })
})

// ─── Administración (contable §H.0) ──────────────────────────────────────────

const accountingOn = withFeature('accounting')
const noAccess: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}
/** Lo que manda la base para la contadora: lee, nunca escribe. */
const readOnly: AccountingAccess = { ...noAccess, read: true }
/** Dueño con acceso vigente. */
const readWrite: AccountingAccess = { ...noAccess, read: true, write: true }
/** Módulo prendido y sin configurar: el dueño puede hacer la puesta en marcha. */
const setupOnly: AccountingAccess = { ...noAccess, setUp: false, canSetUp: true }

const ADMIN_ITEMS = [
  'Resumen',
  'Compras y proveedores',
  'Ventas y clientes',
  'Cajas y bancos',
  'Libros',
  'Plan de cuentas',
]

describe('resolveNavGroups — Administración', () => {
  it('la contadora ve SOLO Administración, con sus 6 ítems y sin colapsar', () => {
    const groups = resolveNavGroups('accountant', SLUG, accountingOn, false, readOnly)
    expect(labels(groups)).toEqual(['Administración'])
    expect(itemLabels(groups, 'Administración')).toEqual(ADMIN_ITEMS)
    // 6 ítems ≤ 8: no colapsa y conserva su título.
    expect(group(groups, 'Administración')?.collapsible).toBe(false)
    // «Sistema» (Configuración) es solo del dueño: desaparece.
    expect(group(groups, 'Sistema')).toBeUndefined()
  })

  it('las rutas son las de §H.0 y el Resumen matchea exacto', () => {
    const items = group(
      resolveNavGroups('accountant', SLUG, accountingOn, false, readOnly),
      'Administración',
    )?.items
    expect(items?.map((i) => i.href)).toEqual([
      '/hub/administracion',
      '/hub/administracion/compras',
      '/hub/administracion/ventas',
      '/hub/administracion/cajas',
      '/hub/administracion/libros',
      '/hub/administracion/plan-de-cuentas',
    ])
    expect(items?.[0]?.exact).toBe(true)
    expect(items?.slice(1).every((i) => !i.exact)).toBe(true)
    expect(items?.map((i) => i.iconKey)).toEqual([
      'Landmark',
      'Truck',
      'HandCoins',
      'Wallet',
      'BookText',
      'ListTree',
    ])
  })

  it('el dueño con acceso lo ve entre Negocio y Salón, colapsable como los demás', () => {
    const groups = resolveNavGroups(
      'owner',
      SLUG,
      { ...accountingOn, kitchen: true },
      false,
      readWrite,
    )
    const order = labels(groups)
    expect(order.indexOf('Administración')).toBe(order.indexOf('Negocio') + 1)
    expect(order.indexOf('Salón')).toBe(order.indexOf('Administración') + 1)
    expect(itemLabels(groups, 'Administración')).toEqual(ADMIN_ITEMS)
    expect(group(groups, 'Administración')?.collapsible).toBe(true)
  })

  it('un dueño sin acceso no lo ve (aunque el módulo esté prendido y configurado)', () => {
    expect(
      group(resolveNavGroups('owner', SLUG, accountingOn, false, noAccess), 'Administración'),
    ).toBeUndefined()
    // Sin el acceso (lo que pasa si alguien se olvida de pasarlo): cerrado.
    expect(
      group(resolveNavGroups('owner', SLUG, accountingOn, false), 'Administración'),
    ).toBeUndefined()
  })

  it('antes de configurar, quien puede hacer la puesta en marcha ve solo «Resumen»', () => {
    const groups = resolveNavGroups('owner', SLUG, accountingOn, false, setupOnly)
    expect(itemLabels(groups, 'Administración')).toEqual(['Resumen'])
    expect(group(groups, 'Administración')?.items[0]?.href).toBe('/hub/administracion')
  })

  it('con el flag apagado no aparece nada, ni para la contadora ni para el superadmin', () => {
    // Combinaciones que la base nunca manda (leer exige el flag): igual cerrado.
    expect(labels(resolveNavGroups('accountant', SLUG, allOff, false, readOnly))).toEqual([])
    expect(
      group(resolveNavGroups('owner', SLUG, allOff, false, readWrite), 'Administración'),
    ).toBeUndefined()
    // El superadmin ve los paneles apagados del Salón, pero no Administración.
    const admin = resolveNavGroups('owner', SLUG, allOff, true, readWrite)
    expect(group(admin, 'Salón')).toBeDefined()
    expect(group(admin, 'Administración')).toBeUndefined()
  })

  it('el superadmin sin acceso tampoco lo ve con el flag prendido', () => {
    expect(
      group(resolveNavGroups('owner', SLUG, accountingOn, true, noAccess), 'Administración'),
    ).toBeUndefined()
  })

  it('los roles que no son dueño ni contadora nunca lo ven', () => {
    for (const role of ['cashier', 'waiter', 'kitchen', 'editor', 'host'] as const) {
      expect(
        group(resolveNavGroups(role, SLUG, accountingOn, false, readWrite), 'Administración'),
      ).toBeUndefined()
    }
  })

  it('la contadora no ve nada fuera de Administración, ni con todos los flags prendidos', () => {
    const everything = getTenantFeatures({
      feature_flags: Object.fromEntries(Object.keys(allOff).map((key) => [key, true])),
    })
    const groups = resolveNavGroups('accountant', SLUG, everything, false, readOnly)
    expect(labels(groups)).toEqual(['Administración'])
    // Sin acceso, a la contadora no le queda ningún ítem.
    expect(resolveNavGroups('accountant', SLUG, everything, false, noAccess)).toEqual([])
  })
})

describe('NAV_GROUPS — claves de grupo', () => {
  it('cada grupo tiene un id estable y único (guarda el plegado en localStorage)', () => {
    const ids = NAV_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^[a-z]+$/.test(id))).toBe(true)
    const resolved = resolveNavGroups('owner', SLUG, accountingOn, true, readWrite)
    expect(resolved.every((g) => typeof g.id === 'string' && g.id.length > 0)).toBe(true)
  })
})
