import { describe, expect, it } from 'vitest'
import {
  COMPRAS_TABS,
  comprasHref,
  gastosFijosHref,
  isComprasTab,
  legacyComprasRedirect,
  newPurchaseHref,
  recurringHref,
  safeReturnHref,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  PAY_TARGETS,
  payAsksTarget,
  payTargetSheet,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-target'
import {
  canPickAccount,
  countUnclassified,
  isVisibleSupplier,
  nextUnclassified,
  SUPPLIER_FILTERS,
  supplierAccountOptions,
  supplierClassification,
  supplierFilterOf,
  supplierRowActions,
  supplierTotals,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/suppliers'
import { actionHref, readAction } from '@/components/administracion/acciones/types'
import { commandEntries } from '@/components/command-palette/command-config'
import { SECTION_TABS } from '@/components/shell/section-tabs-config'

// Lo que pidieron los socios de HUB el 12/10/2026 sobre la lista de
// proveedores, «Pagar» y los nombres de la sección.

const UUID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60'
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1'

describe('links: «Gastos fijos» salió de las pestañas de Compras', () => {
  it('Compras tiene tres pestañas', () => {
    expect(COMPRAS_TABS).toEqual(['proveedores', 'comprobantes', 'pagos'])
    expect(isComprasTab('pagos')).toBe(true)
    expect(isComprasTab('gastos-fijos')).toBe(false)
  })

  it('comprasHref arma las pestañas como siempre', () => {
    expect(comprasHref('hub')).toBe('/hub/administracion/compras')
    expect(comprasHref('hub', 'comprobantes')).toBe('/hub/administracion/compras?tab=comprobantes')
    expect(comprasHref('hub', 'proveedores', { filtro: 'sin-clasificar', q: null })).toBe(
      '/hub/administracion/compras?filtro=sin-clasificar',
    )
  })

  it("comprasHref(…, 'gastos-fijos') apunta a la lista nueva (quien lo llamaba no cambia)", () => {
    expect(comprasHref('hub', 'gastos-fijos')).toBe('/hub/administracion/gastos-fijos')
    expect(gastosFijosHref('hub')).toBe('/hub/administracion/gastos-fijos')
    expect(gastosFijosHref('hub', { accion: 'pagar', vacio: null })).toBe(
      '/hub/administracion/gastos-fijos?accion=pagar',
    )
  })

  it('el formulario de un gasto fijo conserva su ruta', () => {
    expect(recurringHref('hub', 'nuevo')).toBe('/hub/administracion/compras/gastos-fijos/nuevo')
    expect(recurringHref('hub', UUID)).toBe(`/hub/administracion/compras/gastos-fijos/${UUID}`)
  })

  it('la lista nueva sirve como «volver» de una carga', () => {
    const back = gastosFijosHref('hub')
    expect(safeReturnHref('hub', back)).toBe(back)
    expect(newPurchaseHref('hub', { proveedor: UUID, volver: back })).toBe(
      `/hub/administracion/compras/nueva?proveedor=${UUID}&volver=${encodeURIComponent(back)}`,
    )
  })

  it('el link viejo redirige, y conserva lo demás de la URL', () => {
    expect(legacyComprasRedirect('hub', { tab: 'gastos-fijos' })).toBe(
      '/hub/administracion/gastos-fijos',
    )
    expect(legacyComprasRedirect('hub', { tab: ['gastos-fijos', 'pagos'], accion: 'gasto' })).toBe(
      '/hub/administracion/gastos-fijos?accion=gasto',
    )
  })

  it('las demás pestañas no redirigen', () => {
    expect(legacyComprasRedirect('hub', {})).toBeNull()
    expect(legacyComprasRedirect('hub', { tab: 'pagos' })).toBeNull()
    expect(legacyComprasRedirect('hub', { tab: 'cualquiera' })).toBeNull()
  })
})

describe('proveedores: el filtro «Sin clasificar»', () => {
  it('va al final, después de los que ya estaban', () => {
    expect(SUPPLIER_FILTERS.map((f) => f.label)).toEqual([
      'Todos',
      'Con deuda',
      'Vencidos',
      'A favor',
      'Impuestos y sueldos',
      'Sin clasificar',
    ])
  })

  it('trae a todos y deja los que no tienen cuenta', () => {
    expect(supplierFilterOf('sin-clasificar')).toEqual({
      value: 'sin-clasificar',
      filter: 'all',
      unclassifiedOnly: true,
    })
    expect(supplierFilterOf('vencidos')).toEqual({
      value: 'vencidos',
      filter: 'overdue',
      unclassifiedOnly: false,
    })
  })

  it('un valor desconocido es «Todos»', () => {
    expect(supplierFilterOf('')).toEqual({ value: 'todos', filter: 'all', unclassifiedOnly: false })
    expect(supplierFilterOf('otra-cosa').value).toBe('todos')
  })
})

describe('proveedores: la clasificación', () => {
  const supplier = { kind: 'supplier', systemKey: null, defaultAccountId: null }

  it('con cuenta habitual está clasificado, sea quien sea', () => {
    expect(supplierClassification({ ...supplier, defaultAccountId: ACCOUNT })).toBe('classified')
    expect(
      supplierClassification({ kind: 'tax_agency', systemKey: 'arca', defaultAccountId: ACCOUNT }),
    ).toBe('classified')
  })

  it('un proveedor (o un «otro») que cargaron ellos, sin cuenta: sin clasificar', () => {
    expect(supplierClassification(supplier)).toBe('unclassified')
    expect(supplierClassification({ ...supplier, kind: 'other' })).toBe('unclassified')
  })

  it('a quien no se le compra no le falta nada: organismos, sueldos, socios, bancos y los del sistema', () => {
    for (const kind of ['tax_agency', 'payroll', 'partner', 'bank']) {
      expect(supplierClassification({ ...supplier, kind })).toBe('not_applicable')
    }
    // «Proveedores varios» y el sindicato los siembra la puesta en marcha.
    expect(supplierClassification({ ...supplier, systemKey: 'varios' })).toBe('not_applicable')
    expect(supplierClassification({ ...supplier, kind: 'other', systemKey: 'sindicato' })).toBe(
      'not_applicable',
    )
  })

  it('desde la lista se elige (o se cambia) la cuenta de los que aplican', () => {
    expect(canPickAccount('unclassified')).toBe(true)
    expect(canPickAccount('classified')).toBe(true)
    expect(canPickAccount('not_applicable')).toBe(false)
  })

  it('cuenta los activos sin clasificar (el número del filtro)', () => {
    expect(
      countUnclassified([
        { ...supplier, active: true },
        { ...supplier, active: true, defaultAccountId: ACCOUNT },
        { ...supplier, active: false },
        { ...supplier, active: true, kind: 'tax_agency', systemKey: 'arca' },
        { ...supplier, active: true, kind: 'other' },
      ]),
    ).toBe(2)
    expect(countUnclassified([])).toBe(0)
  })
})

describe('proveedores: «Guardar y seguir»', () => {
  const rows = [
    { partyId: 'a', accountId: null },
    { partyId: 'b', accountId: ACCOUNT },
    { partyId: 'c', accountId: null },
    { partyId: 'd', accountId: null },
  ]

  it('pasa al próximo sin cuenta, salteando los que ya tienen', () => {
    expect(nextUnclassified(rows, 'a')?.partyId).toBe('c')
    expect(nextUnclassified(rows, 'c')?.partyId).toBe('d')
  })

  it('al final de la lista no da la vuelta', () => {
    expect(nextUnclassified(rows, 'd')).toBeNull()
  })

  it('si el proveedor ya no está en la lista, no sigue', () => {
    expect(nextUnclassified(rows, 'z')).toBeNull()
    expect(nextUnclassified([], 'a')).toBeNull()
  })
})

describe('proveedores: comprar y pagar desde la fila', () => {
  it('a uno activo se le carga una compra y se le paga (aunque no se le deba: pago a cuenta)', () => {
    expect(supplierRowActions({ active: true, debtCents: 0 })).toEqual({
      canBuy: true,
      canPay: true,
    })
  })

  it('a uno desactivado solo se le paga lo que se le debe', () => {
    expect(supplierRowActions({ active: false, debtCents: 150_000 })).toEqual({
      canBuy: false,
      canPay: true,
    })
    expect(supplierRowActions({ active: false, debtCents: 0 })).toEqual({
      canBuy: false,
      canPay: false,
    })
  })
})

describe('proveedores: las cuentas de «Elegir cuenta»', () => {
  const base = {
    parentId: null,
    description: null,
    active: true,
    requiresParty: false,
    isTreasury: false,
    purchaseSelectable: true,
    systemKey: null,
  }
  const plan = [
    { ...base, id: 'g', code: '5.1', name: 'Costos', postable: false, type: 'expense' },
    { ...base, id: 'merc', code: '5.1.01', name: 'Mercadería', postable: true, type: 'expense' },
    { ...base, id: 'uso', code: '1.2.01', name: 'Bienes de uso', postable: true, type: 'asset' },
    { ...base, id: 'ventas', code: '4.1.01', name: 'Ventas', postable: true, type: 'income' },
    {
      ...base,
      id: 'caja',
      code: '1.1.01',
      name: 'Caja',
      postable: true,
      type: 'asset',
      isTreasury: true,
    },
    {
      ...base,
      id: 'prov',
      code: '2.1.01',
      name: 'Proveedores',
      postable: true,
      type: 'liability',
      requiresParty: true,
    },
  ]

  it('las mismas que la ficha: de gasto o de activo, imputables; los grupos arman la ruta', () => {
    const options = supplierAccountOptions(plan, new Set())
    expect(options.map((o) => o.id)).toEqual(['g', 'merc', 'uso'])
    expect(options.find((o) => o.id === 'g')?.postable).toBe(false)
    expect(options.filter((o) => o.postable).map((o) => o.id)).toEqual(['merc', 'uso'])
  })

  it('una cuenta que ya usa un proveedor y no sirve más se ve, pero no se elige', () => {
    const options = supplierAccountOptions(plan, new Set(['ventas']))
    const ventas = options.find((o) => o.id === 'ventas')
    expect(ventas).toBeDefined()
    expect(ventas?.postable).toBe(false)
  })
})

describe('proveedores: lo que ya hacía la lista', () => {
  it('los del sistema sin saldo no ensucian la lista, salvo en «Impuestos y sueldos»', () => {
    const arca = { systemKey: 'arca', debtCents: 0, creditCents: 0, overdueCents: 0 }
    expect(isVisibleSupplier(arca, 'all')).toBe(false)
    expect(isVisibleSupplier(arca, 'taxes_payroll')).toBe(true)
    expect(isVisibleSupplier({ ...arca, debtCents: 1 }, 'all')).toBe(true)
    expect(isVisibleSupplier({ ...arca, systemKey: null }, 'all')).toBe(true)
  })

  it('el pie suma las filas que se ven', () => {
    expect(
      supplierTotals([
        { systemKey: null, debtCents: 100, creditCents: 10, overdueCents: 40 },
        { systemKey: null, debtCents: 50, creditCents: 0, overdueCents: 0 },
      ]),
    ).toEqual({ debtCents: 150, overdueCents: 40, creditCents: 10 })
  })
})

describe('«Pagar»: ¿qué pagás?', () => {
  it('tres respuestas, en este orden', () => {
    expect(PAY_TARGETS.map((t) => t.label)).toEqual([
      'A un proveedor',
      'Un gasto fijo',
      'Otro gasto',
    ])
  })

  it('pregunta cuando se abre sin nada elegido', () => {
    expect(payAsksTarget({})).toBe(true)
    expect(payAsksTarget({ caja: UUID })).toBe(true)
  })

  it('no pregunta si vino con el proveedor o con la factura', () => {
    expect(payAsksTarget({ proveedor: UUID })).toBe(false)
    expect(payAsksTarget({ partida: UUID })).toBe(false)
  })

  it('a un proveedor sigue en «Pagar»; lo demás, en «Nuevo gasto»', () => {
    expect(payTargetSheet('proveedor')).toBe('pagar')
    expect(payTargetSheet('gasto-fijo')).toBe('gasto')
    expect(payTargetSheet('otro-gasto')).toBe('gasto')
  })

  it('pasar a «Nuevo gasto» reemplaza la hoja y deja la pantalla como estaba', () => {
    const href = actionHref('/hub/administracion/gastos-fijos', '?accion=pagar', 'gasto')
    expect(href).toBe('/hub/administracion/gastos-fijos?accion=gasto')
    expect(
      actionHref(
        '/hub/administracion/compras',
        '?tab=pagos&accion=pagar',
        payTargetSheet('otro-gasto'),
      ),
    ).toBe('/hub/administracion/compras?tab=pagos&accion=gasto')
  })

  it('el link de la fila de un proveedor abre «Pagar» con él elegido', () => {
    const href = actionHref('/hub/administracion/compras', '', 'pagar', { proveedor: UUID })
    const parsed = readAction(new URLSearchParams(href.split('?')[1]))
    expect(parsed).toEqual({ action: 'pagar', params: { proveedor: UUID } })
    expect(parsed ? payAsksTarget(parsed.params) : null).toBe(false)
  })
})

describe('nombres y accesos (12/10/2026)', () => {
  const accounting = commandEntries.filter((e) => e.group === 'Administración')

  it('nadie muestra más «Compras y proveedores»', () => {
    const labels = [
      ...commandEntries.map((e) => e.label),
      ...Object.values(SECTION_TABS).flatMap((section) => section.tabs.map((t) => t.label)),
    ]
    expect(labels).not.toContain('Compras y proveedores')
  })

  it('⌘K: «Gastos fijos» va a su pestaña, para dueños y contadora', () => {
    const entry = accounting.find((e) => e.id === 'acc-recurring')
    expect(entry?.label).toBe('Gastos fijos')
    expect(entry?.href('hub')).toBe('/hub/administracion/gastos-fijos')
    expect(entry?.roles).toEqual(['owner', 'accountant'])
    expect(entry?.accounting).toBe('read')
  })

  it('⌘K: «Pagar» abre la hoja (que pregunta qué se paga)', () => {
    const entry = accounting.find((e) => e.id === 'acc-pay')
    expect(entry?.label).toBe('Pagar')
    expect(entry?.accountingAction).toBe('pagar')
    expect(entry?.accounting).toBe('write')
  })

  it('⌘K: no hay un comando para la factura de venta suelta (se factura con el cierre del día)', () => {
    expect(commandEntries.filter((e) => e.href('hub').includes('/ventas/nueva-factura'))).toEqual(
      [],
    )
    // La de proveedor sigue estando.
    expect(accounting.find((e) => e.id === 'acc-new-purchase')?.href('hub')).toBe(
      '/hub/administracion/compras/nueva',
    )
  })

  it('las pestañas: «Gastos fijos» justo después de «Compras», con las mismas puertas', () => {
    const tabs = SECTION_TABS.administracion.tabs
    const compras = tabs.find((t) => t.value === 'compras')
    const fijos = tabs.find((t) => t.value === 'gastos-fijos')
    expect(tabs.indexOf(fijos as (typeof tabs)[number])).toBe(
      tabs.indexOf(compras as (typeof tabs)[number]) + 1,
    )
    expect(compras?.label).toBe('Compras')
    expect(fijos?.path).toBe('administracion/gastos-fijos')
    expect({ roles: fijos?.roles, feature: fijos?.feature, accounting: fijos?.accounting }).toEqual(
      {
        roles: compras?.roles,
        feature: compras?.feature,
        accounting: compras?.accounting,
      },
    )
  })
})
