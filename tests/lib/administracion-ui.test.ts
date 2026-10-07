import { describe, expect, it } from 'vitest'
import {
  actionHref,
  actionHrefFrom,
  clearActionHref,
  readAction,
} from '@/components/administracion/acciones/types'
import { agingBarRows } from '@/components/administracion/aging-bar'
import {
  balanceText,
  describeBalance,
  describeSideBalance,
  signedMovement,
} from '@/components/administracion/format'
import {
  normalizeText,
  rankAccount,
  rankAndFilter,
  rankParty,
} from '@/components/administracion/search'
import { treasuryBalanceText } from '@/components/administracion/treasury-select'
import { agingBuckets } from '@/lib/accounting/aging'

const NB = ' '
const UUID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60'

describe('saldos en palabras (nunca un menos pelado)', () => {
  it('proveedor: le debés / a favor / sin deuda', () => {
    expect(balanceText(11_780_000, 'payable')).toBe(`Le debés $${NB}117.800,00`)
    expect(balanceText(-12_000_000, 'payable')).toBe(`A favor $${NB}120.000,00`)
    expect(balanceText(0, 'payable')).toBe('Sin deuda')
  })

  it('cliente: te debe / le debemos', () => {
    expect(balanceText(52_000_000, 'receivable')).toBe(`Te debe $${NB}520.000,00`)
    expect(balanceText(-11_780_000, 'receivable')).toBe(`Le debemos $${NB}117.800,00`)
  })

  it('caja: número pelado si hay plata, «Descubierto» si no', () => {
    expect(balanceText(24_530_000, 'treasury')).toBe(`$${NB}245.300,00`)
    expect(balanceText(-4_000_000, 'treasury')).toBe(`Descubierto $${NB}40.000,00`)
    expect(balanceText(0, 'treasury')).toBe(`$${NB}0,00`)
  })

  it('faltante no es cero', () => {
    expect(describeBalance(null, 'payable').state).toBe('empty')
    expect(describeBalance(undefined, 'receivable').state).toBe('empty')
    expect(describeBalance(Number.NaN, 'treasury').state).toBe('empty')
    expect(balanceText(null, 'payable')).toBe('—')
  })

  it('columna «Saldo»: palabras solo en el sentido contrario', () => {
    expect(balanceText(11_780_000, 'payable', { words: 'contrary' })).toBe(`$${NB}117.800,00`)
    expect(balanceText(-11_780_000, 'payable', { words: 'contrary' })).toBe(
      `A favor $${NB}117.800,00`,
    )
  })

  it('sin centavos para el Resumen; lo que se muestra como cero es cero', () => {
    expect(balanceText(12_345_678, 'payable', { decimals: 0 })).toBe(`Le debés $${NB}123.457`)
    expect(describeBalance(-40, 'payable', { decimals: 0 }).state).toBe('zero')
  })

  it('bigint de la base', () => {
    expect(balanceText(BigInt(11_780_000), 'payable')).toBe(`Le debés $${NB}117.800,00`)
  })

  it('saldo como en el mayor (D/A) y movimientos con signo', () => {
    expect(describeSideBalance(124_000_000)).toEqual({ amount: '1.240.000,00', side: 'D' })
    expect(describeSideBalance(-5_000)).toEqual({ amount: '50,00', side: 'A' })
    expect(describeSideBalance(null)).toBeNull()
    expect(signedMovement(150_000, true)).toBe(`+$${NB}1.500,00`)
    expect(signedMovement(150_000, false)).toBe(`−$${NB}1.500,00`)
  })

  it('tarjeta de la empresa: el saldo es la deuda', () => {
    expect(treasuryBalanceText({ kind: 'credit_card', balanceCents: 8_000_000 })).toBe(
      `Deuda $${NB}80.000,00`,
    )
    expect(treasuryBalanceText({ kind: 'bank', balanceCents: -1_200_000 })).toBe(
      `Descubierto $${NB}12.000,00`,
    )
  })
})

describe('búsqueda de los combos', () => {
  it('sin tildes ni mayúsculas', () => {
    expect(normalizeText('  Señas   ÑANDÚ ')).toBe('senas nandu')
  })

  const parties = [
    { name: 'Distribuidora Coca-Cola SA', tradeName: 'Coca-Cola', taxId: '30718765435' },
    { name: 'Cervecería Quilmes', tradeName: null, taxId: '30500000005' },
    { name: 'Panadería La Cordobesa', tradeName: null, taxId: null },
  ]

  it('proveedor por nombre, nombre de fantasía o CUIT', () => {
    expect(rankAndFilter(parties, 'coca', rankParty).map((p) => p.name)).toEqual([
      'Distribuidora Coca-Cola SA',
    ])
    expect(rankAndFilter(parties, 'cerveceria', rankParty)).toHaveLength(1)
    expect(rankAndFilter(parties, '30-7187', rankParty).map((p) => p.name)).toEqual([
      'Distribuidora Coca-Cola SA',
    ])
    expect(rankAndFilter(parties, '305', rankParty).map((p) => p.name)).toEqual([
      'Cervecería Quilmes',
    ])
    expect(rankParty({ name: 'Panadería La Cordobesa' }, 'zzz')).toBe(-1)
  })

  it('el que empieza con lo tipeado va primero', () => {
    const list = [{ name: 'Gran Panadería' }, { name: 'Panadería Sur' }]
    expect(rankAndFilter(list, 'pan', rankParty).map((p) => p.name)).toEqual([
      'Panadería Sur',
      'Gran Panadería',
    ])
  })

  const accounts = [
    { code: '1.1.01', name: 'Caja' },
    { code: '1.1.01.01', name: 'Caja chica' },
    { code: '1.1.02', name: 'Bancos' },
    { code: '5.1.01', name: 'Mercadería' },
  ]

  it('cuenta por código: «1101» encuentra 1.1.01 y «1.1» trae el rubro', () => {
    expect(rankAndFilter(accounts, '1101', rankAccount).map((a) => a.code)).toEqual([
      '1.1.01',
      '1.1.01.01',
    ])
    expect(rankAndFilter(accounts, '1.1', rankAccount).map((a) => a.code)).toEqual([
      '1.1.01',
      '1.1.01.01',
      '1.1.02',
    ])
    expect(rankAndFilter(accounts, 'mercaderia', rankAccount).map((a) => a.code)).toEqual([
      '5.1.01',
    ])
  })
})

describe('hojas de acción rápida en la URL', () => {
  it('lee la acción y descarta ids que no son UUID', () => {
    const search = new URLSearchParams(`accion=pagar&proveedor=${UUID}&caja=1;drop`)
    expect(readAction(search)).toEqual({ action: 'pagar', params: { proveedor: UUID } })
    expect(readAction(new URLSearchParams('accion=borrar-todo'))).toBeNull()
    expect(readAction(new URLSearchParams('tab=pagos'))).toBeNull()
  })

  it('abre sobre la pantalla actual conservando sus parámetros', () => {
    expect(
      actionHref('/hub/administracion/compras', '?tab=pagos', 'pagar', { proveedor: UUID }),
    ).toBe(`/hub/administracion/compras?tab=pagos&accion=pagar&proveedor=${UUID}`)
    // Una acción anterior se reemplaza entera (con sus ids).
    expect(actionHref('/hub/administracion', `?accion=pagar&proveedor=${UUID}`, 'gasto')).toBe(
      '/hub/administracion?accion=gasto',
    )
  })

  it('cerrar deja la pantalla como estaba', () => {
    expect(
      clearActionHref('/hub/administracion/compras', `?tab=pagos&accion=pagar&proveedor=${UUID}`),
    ).toBe('/hub/administracion/compras?tab=pagos')
    expect(clearActionHref('/hub/administracion', '?accion=gasto')).toBe('/hub/administracion')
  })

  it('⌘K: adentro de Administración, sobre la pantalla; afuera, sobre el Resumen', () => {
    expect(actionHrefFrom('hub', '/hub/administracion/cajas', '?tab=flujo', 'mover')).toBe(
      '/hub/administracion/cajas?tab=flujo&accion=mover',
    )
    expect(actionHrefFrom('hub', '/hub/reservas', '?dia=2026-10-07', 'gasto')).toBe(
      '/hub/administracion?accion=gasto',
    )
    // `/hub/administracionX` no es la sección.
    expect(actionHrefFrom('hub', '/hub/administracionX', '', 'gasto')).toBe(
      '/hub/administracion?accion=gasto',
    )
  })
})

describe('AgingBar', () => {
  it('junta «vence pronto» con «al día» y respeta los tramos vencidos', () => {
    const today = '2026-10-07'
    const buckets = agingBuckets(
      [
        { dueDate: '2026-10-30', openCents: 100_000 }, // al día
        { dueDate: '2026-10-10', openCents: 50_000 }, // vence en 3 días
        { dueDate: '2026-09-30', openCents: 20_000 }, // 7 días
        { dueDate: '2026-08-20', openCents: 30_000 }, // 48 días
        { dueDate: '2026-06-01', openCents: 40_000 }, // +60
        { dueDate: null, openCents: 999_999 }, // sin vencimiento: fuera de la barra
      ],
      today,
    )
    expect(agingBarRows(buckets)).toEqual([
      { tramo: 'al-dia', cents: 150_000, count: 2 },
      { tramo: '1-30', cents: 20_000, count: 1 },
      { tramo: '31-60', cents: 30_000, count: 1 },
      { tramo: '60-mas', cents: 40_000, count: 1 },
    ])
  })
})
