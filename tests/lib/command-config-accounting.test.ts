import { describe, expect, it } from 'vitest'
import {
  COMMAND_GROUPS,
  type CommandAudience,
  type CommandEntry,
  commandEntries,
  groupCommandEntries,
  needsFullReload,
  resolveCommandHref,
  visibleCommandEntries,
} from '@/components/command-palette/command-config'
import { getTenantFeatures, type TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'

/**
 * ⌘K y Administración (contable §H.0): el grupo nuevo, el predicado
 * `accounting` y a dónde llevan sus acciones. Lo que importa es quién ve qué:
 * la contadora solo lee, un dueño sin acceso no ve nada, y nada de
 * Administración aparece con el flag apagado.
 */

const SLUG = 'hub'
const allOff: TenantFeatures = getTenantFeatures({ feature_flags: {} })
const accountingOn: TenantFeatures = { ...allOff, accounting: true }

const noAccess: AccountingAccess = {
  enabled: true,
  setUp: true,
  read: false,
  write: false,
  admin: false,
  canSetUp: false,
}
const readOnly: AccountingAccess = { ...noAccess, read: true }
const readWrite: AccountingAccess = { ...noAccess, read: true, write: true }
const setupOnly: AccountingAccess = { ...noAccess, setUp: false, canSetUp: true }

function audience(
  role: TenantRole,
  accounting?: AccountingAccess,
  features: TenantFeatures = accountingOn,
  isPlatformAdmin = false,
): CommandAudience {
  return { role, features, isPlatformAdmin, accounting }
}

const ids = (entries: CommandEntry[]) => entries.map((e) => e.id)
const accountingEntries = commandEntries.filter((e) => e.group === 'Administración')
const writeEntries = accountingEntries.filter((e) => e.accounting === 'write')
const readEntries = accountingEntries.filter((e) => e.accounting === 'read')

describe('el registro de ⌘K', () => {
  it('«Administración» va después de «Acciones rápidas» y todo grupo usado se dibuja', () => {
    expect(COMMAND_GROUPS).toEqual(['Acciones rápidas', 'Administración', 'Operación', 'Ir a'])
    for (const entry of commandEntries) expect(COMMAND_GROUPS).toContain(entry.group)
  })

  it('los ids son únicos', () => {
    expect(new Set(ids(commandEntries)).size).toBe(commandEntries.length)
  })

  it('las entradas de Administración llevan el flag y el predicado, y nada más lo lleva', () => {
    expect(accountingEntries.length).toBeGreaterThan(0)
    for (const entry of accountingEntries) {
      expect(entry.feature).toBe('accounting')
      expect(entry.accounting === 'read' || entry.accounting === 'write').toBe(true)
      // Se encuentran con y sin tilde.
      expect(entry.keywords).toEqual(expect.arrayContaining(['administracion', 'administración']))
    }
    for (const entry of commandEntries.filter((e) => e.group !== 'Administración')) {
      expect(entry.accounting).toBeUndefined()
      expect(entry.feature).not.toBe('accounting')
    }
  })

  it('trae las acciones y la navegación de §H.0', () => {
    expect(writeEntries.map((e) => e.label)).toEqual([
      'Nuevo gasto',
      'Cierre del día',
      'Pagar a un proveedor',
      'Registrar un cobro',
      'Mover plata',
      'Ajustar saldo de una caja',
      'Nueva factura de proveedor',
      'Gasto bancario',
      'Asiento manual',
      'Cerrar el mes',
      'Ajustes de Administración',
    ])
    expect(readEntries.map((e) => e.label)).toEqual([
      'Resumen de Administración',
      'Proveedores',
      'Clientes y plataformas',
      'Cajas y bancos',
      'Libro diario',
      'Mayor',
      'Sumas y saldos',
      'Libro IVA compras',
      'Libro IVA ventas',
      'Posición de IVA',
      'Paquete del mes',
      'Cierres de mes',
      'Plan de cuentas',
    ])
    // Todo vive bajo /administracion.
    for (const entry of accountingEntries) {
      expect(entry.href(SLUG).startsWith('/hub/administracion')).toBe(true)
    }
  })

  it('el catálogo de componentes se abre desde ⌘K y es solo del dueño (kit §6.1)', () => {
    const catalog = commandEntries.find((e) => e.id === 'component-catalog')
    expect(catalog?.href(SLUG)).toBe('/hub/docs/componentes')
    expect(ids(visibleCommandEntries(commandEntries, audience('owner')))).toContain(
      'component-catalog',
    )
    for (const role of ['accountant', 'editor', 'host'] as const) {
      expect(ids(visibleCommandEntries(commandEntries, audience(role, readOnly)))).not.toContain(
        'component-catalog',
      )
    }
  })

  it('una entrada de escritura nunca nombra a la contadora entre sus roles', () => {
    for (const entry of writeEntries) {
      expect(entry.roles ?? ['owner']).not.toContain('accountant')
    }
    for (const entry of readEntries) {
      expect(entry.roles).toEqual(expect.arrayContaining(['owner', 'accountant']))
    }
  })
})

describe('visibleCommandEntries — quién ve Administración', () => {
  it('la contadora ve SOLO la navegación de Administración', () => {
    const visible = visibleCommandEntries(commandEntries, audience('accountant', readOnly))
    expect(ids(visible)).toEqual(ids(readEntries))
    expect(groupCommandEntries(visible).map((g) => g.group)).toEqual(['Administración'])
  })

  it('la contadora nunca ve una acción, aunque llegara un `write` que la base no manda', () => {
    const visible = visibleCommandEntries(commandEntries, audience('accountant', readWrite))
    expect(visible.some((e) => e.accounting === 'write')).toBe(false)
    expect(ids(visible)).toEqual(ids(readEntries))
  })

  it('el dueño con acceso ve acciones y navegación, con Administración en segundo lugar', () => {
    const visible = visibleCommandEntries(commandEntries, audience('owner', readWrite))
    expect(ids(visible)).toEqual(expect.arrayContaining(ids(accountingEntries)))
    expect(groupCommandEntries(visible).map((g) => g.group)).toEqual([
      'Acciones rápidas',
      'Administración',
      'Operación',
      'Ir a',
    ])
  })

  it('leer sin escribir: la navegación sí, las acciones no', () => {
    const visible = visibleCommandEntries(commandEntries, audience('owner', readOnly))
    const admin = visible.filter((e) => e.group === 'Administración')
    expect(ids(admin)).toEqual(ids(readEntries))
  })

  it('un dueño sin acceso no ve nada de Administración (y el resto, igual que siempre)', () => {
    const without = visibleCommandEntries(commandEntries, audience('owner', noAccess))
    expect(without.some((e) => e.group === 'Administración')).toBe(false)
    // Sin pasar el acceso: cerrado, y el resto de la paleta no cambia.
    const missing = visibleCommandEntries(commandEntries, audience('owner'))
    expect(ids(missing)).toEqual(ids(without))
    expect(ids(missing)).toContain('new-customer')
  })

  it('la puesta en marcha sola no abre la navegación de ⌘K (es `read`)', () => {
    const visible = visibleCommandEntries(commandEntries, audience('owner', setupOnly))
    expect(visible.some((e) => e.group === 'Administración')).toBe(false)
  })

  it('con el flag apagado no aparece nada, ni para el superadmin', () => {
    for (const isPlatformAdmin of [false, true]) {
      const owner = visibleCommandEntries(
        commandEntries,
        audience('owner', readWrite, allOff, isPlatformAdmin),
      )
      expect(owner.some((e) => e.group === 'Administración')).toBe(false)
      const accountant = visibleCommandEntries(
        commandEntries,
        audience('accountant', readOnly, allOff, isPlatformAdmin),
      )
      expect(accountant).toEqual([])
    }
  })

  it('el superadmin sigue viendo los paneles apagados que no son Administración', () => {
    const visible = visibleCommandEntries(commandEntries, audience('owner', noAccess, allOff, true))
    expect(ids(visible)).toContain('kitchen')
    expect(visible.some((e) => e.group === 'Administración')).toBe(false)
  })

  it('los roles de salón, contenido y anfitrión no ven Administración', () => {
    for (const role of ['cashier', 'waiter', 'kitchen', 'editor', 'host'] as const) {
      const visible = visibleCommandEntries(commandEntries, audience(role, readWrite))
      expect(visible.some((e) => e.group === 'Administración')).toBe(false)
    }
  })
})

describe('resolveCommandHref — las hojas de Administración', () => {
  const entry = (id: string): CommandEntry => {
    const found = commandEntries.find((e) => e.id === id)
    if (!found) throw new Error(`falta la entrada ${id}`)
    return found
  }

  it('desde otra sección, abre la hoja sobre el Resumen de Administración', () => {
    expect(
      resolveCommandHref(entry('acc-new-expense'), SLUG, { pathname: '/hub/clientes', search: '' }),
    ).toBe('/hub/administracion?accion=gasto')
  })

  it('adentro de Administración, abre la hoja sobre la pantalla actual y conserva su pestaña', () => {
    expect(
      resolveCommandHref(entry('acc-pay-supplier'), SLUG, {
        pathname: '/hub/administracion/compras',
        search: '?tab=proveedores',
      }),
    ).toBe('/hub/administracion/compras?tab=proveedores&accion=pagar')
  })

  it('reemplaza la hoja abierta y no arrastra sus parámetros', () => {
    expect(
      resolveCommandHref(entry('acc-transfer'), SLUG, {
        pathname: '/hub/administracion/cajas',
        search: '?accion=pagar&proveedor=abc&tab=saldos',
      }),
    ).toBe('/hub/administracion/cajas?tab=saldos&accion=mover')
  })

  it('las páginas van a su ruta, estés donde estés', () => {
    expect(
      resolveCommandHref(entry('acc-journal'), SLUG, {
        pathname: '/hub/administracion/cajas',
        search: '?tab=saldos',
      }),
    ).toBe('/hub/administracion/libros/diario')
    expect(
      resolveCommandHref(entry('acc-sales-close'), SLUG, { pathname: '/hub', search: '' }),
    ).toBe('/hub/administracion/ventas/cierre')
  })

  it('una ruta que solo empieza parecido no cuenta como Administración', () => {
    expect(
      resolveCommandHref(entry('acc-new-expense'), SLUG, {
        pathname: '/hub/administracion-vieja',
        search: '',
      }),
    ).toBe('/hub/administracion?accion=gasto')
  })
})

describe('needsFullReload — el salón y lo público se abren recargando', () => {
  it('salón y superficies públicas: sí', () => {
    expect(needsFullReload('/hub/salon/mesas', SLUG)).toBe(true)
    expect(needsFullReload('/hub/salon', SLUG)).toBe(true)
    expect(needsFullReload('/carta/hub', SLUG)).toBe(true)
    expect(needsFullReload('/l/hub?x=1', SLUG)).toBe(true)
  })

  it('el panel: no', () => {
    expect(needsFullReload('/hub/administracion?accion=gasto', SLUG)).toBe(false)
    expect(needsFullReload('/hub/salones', SLUG)).toBe(false)
    expect(needsFullReload('/hub', SLUG)).toBe(false)
    expect(needsFullReload('/otro/salon', SLUG)).toBe(false)
  })
})
