import { describe, expect, it } from 'vitest'
import {
  flowView,
  PROJECTION_SENTENCE,
  projectionView,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/flow-view'
import { walletHero } from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import type {
  CashFlowRow,
  CashProjectionRow,
  TreasuryAccountRow,
  TreasuryBalanceRow,
  TreasuryMovementRow,
  TreasuryMovementsPage,
} from '@/lib/accounting/queries/treasury'
import {
  cajasData,
  flowData,
  movementDetail,
  movementRow,
  movementsData,
  projectionData,
} from '@/lib/tex/tools/read/cajas'

const TODAY = '2026-11-05'

function balance(over: Partial<TreasuryBalanceRow> = {}): TreasuryBalanceRow {
  return {
    treasuryId: 'caja-1',
    accountId: 'cuenta-1',
    name: 'Caja',
    kind: 'cash',
    accountCode: '1.1.01',
    alias: null,
    bankName: null,
    allowNegative: false,
    active: true,
    balanceCents: 0,
    pendingWalletCents: 0,
    lastMovementDate: '2026-11-01',
    lastCheckedOn: null,
    ...over,
  }
}

describe('ver_cajas', () => {
  const rows = [
    balance({ balanceCents: 100_000_00, lastCheckedOn: '2026-11-02' }),
    balance({
      treasuryId: 'mp',
      name: 'Mercado Pago',
      kind: 'wallet',
      balanceCents: 50_000_00,
      pendingWalletCents: 20_000_00,
    }),
    balance({
      treasuryId: 'visa',
      name: 'Visa empresa',
      kind: 'credit_card',
      balanceCents: -30_000_00,
    }),
    balance({ treasuryId: 'vieja', name: 'Caja vieja', active: false, balanceCents: 9_000_00 }),
  ]
  const hero = walletHero(rows, { openingStatus: 'posted' })

  it('el total es el del Resumen: sin la tarjeta de la empresa ni las desactivadas', () => {
    const data = cajasData(rows, hero)
    expect(data.total).toBe('$ 150.000')
    expect(data.en_camino).toBe('$ 20.000')
    expect(data.deuda_de_tarjetas).toBe('$ 30.000')
    expect(data.aviso).toBeUndefined()
  })

  it('cada caja con su id, sin las desactivadas', () => {
    const { cajas } = cajasData(rows, hero)
    expect(cajas).toEqual([
      {
        id: 'caja-1',
        nombre: 'Caja',
        tipo: 'Efectivo',
        saldo: '$ 100.000',
        contada_el: '02/11/2026',
      },
      {
        id: 'mp',
        nombre: 'Mercado Pago',
        tipo: 'Billetera',
        saldo: '$ 50.000',
        en_camino: '$ 20.000',
      },
      { id: 'visa', nombre: 'Visa empresa', tipo: 'Tarjeta de la empresa', debe: '$ 30.000' },
    ])
  })

  it('una cuenta en descubierto lo dice', () => {
    const overdrawn = [balance({ balanceCents: -5_000_00 })]
    const { cajas, total } = cajasData(
      overdrawn,
      walletHero(overdrawn, { openingStatus: 'posted' }),
    )
    expect(total).toBe('-$ 5.000')
    expect(cajas?.[0]).toMatchObject({ saldo: '-$ 5.000', descubierto: true })
  })

  it('si el cero no es un dato, no hay total: dice que todavía no sabe', () => {
    const untouched = [balance({ lastMovementDate: null })]
    const data = cajasData(untouched, walletHero(untouched, { openingStatus: 'pending' }))
    expect(data.total).toBeUndefined()
    expect(data.aviso).toContain('Todavía no sé cuánta plata hay')
  })
})

function movement(over: Partial<TreasuryMovementRow> = {}): TreasuryMovementRow {
  return {
    rowKind: 'line',
    entryId: 'asiento-1',
    entryDate: '2026-11-03',
    documentId: 'doc-1',
    documentSeq: 12,
    documentKind: 'expense',
    documentLabel: 'Gasto',
    description: 'Gasto · Hielo',
    memo: null,
    counterpart: 'Mercadería',
    inCents: 0,
    outCents: 2_500_00,
    balanceCents: 97_500_00,
    ...over,
  }
}

describe('ver_movimientos_caja', () => {
  it('el detalle no repite el comprobante', () => {
    expect(movementDetail('Gasto · Hielo', 'Gasto')).toBe('Hielo')
    expect(movementDetail('Gasto', 'Gasto')).toBeNull()
    expect(movementDetail(null, 'Gasto')).toBeNull()
    expect(movementDetail('Otra cosa', 'Gasto')).toBe('Otra cosa')
    expect(movementDetail('Sin comprobante', null)).toBe('Sin comprobante')
  })

  it('una fila chica, con el id del comprobante', () => {
    expect(movementRow(movement())).toEqual({
      fecha: '03/11/2026',
      comprobante: 'Gasto',
      comprobante_id: 'doc-1',
      detalle: 'Hielo',
      contrapartida: 'Mercadería',
      salio: '$ 2.500',
      saldo: '$ 97.500',
    })
  })

  const treasury = { id: 'caja-1', name: 'Caja' } as TreasuryAccountRow

  function page(over: Partial<TreasuryMovementsPage> = {}): TreasuryMovementsPage {
    return {
      rows: [
        movement({ rowKind: 'opening', documentId: null, documentLabel: 'Saldo anterior' }),
        movement({ documentId: 'viejo' }),
        movement({ documentId: 'nuevo' }),
      ],
      nextCursor: null,
      totalRows: 2,
      treasury,
      from: '2026-11-01',
      to: '2026-11-30',
      openingCents: 100_000_00,
      inCents: 10_000_00,
      outCents: 5_000_00,
      closingCents: 105_000_00,
      ...over,
    }
  }

  it('lo último primero, sin el «Saldo anterior», con los totales de todo el período', () => {
    const data = movementsData(page(), 'Noviembre 2026')
    expect(data.filas?.map((row) => row.comprobante_id)).toEqual(['nuevo', 'viejo'])
    expect(data).toMatchObject({
      caja: { id: 'caja-1', nombre: 'Caja' },
      periodo: 'Noviembre 2026',
      saldo_al_empezar: '$ 100.000',
      entro: '$ 10.000',
      salio: '$ 5.000',
      saldo_al_terminar: '$ 105.000',
      cuantos: 2,
      hay_mas: false,
    })
    expect(data.nota).toBeUndefined()
  })

  it('con muchos, los últimos 40 y lo avisa', () => {
    const lines = Array.from({ length: 60 }, (_, i) => movement({ documentId: `doc-${i}` }))
    const data = movementsData(page({ rows: lines, totalRows: 60 }), 'Noviembre 2026')
    expect(data.filas).toHaveLength(40)
    expect(data.filas?.[0]?.comprobante_id).toBe('doc-59')
    expect(data.hay_mas).toBe(true)
  })

  it('con textos largos entra entero en el tope del ciclo', () => {
    const lines = Array.from({ length: 60 }, () =>
      movement({
        documentId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        documentLabel: 'Nota de crédito de proveedor 0003-00001234',
        description: 'Un detalle bien largo del movimiento que se repite y se repite y se repite',
        counterpart: 'Proveedores · IVA crédito fiscal · Percepciones de IIBB · Otros',
        outCents: 123_456_789_00,
        balanceCents: 987_654_321_00,
      }),
    )
    const data = movementsData(page({ rows: lines, totalRows: 60 }), 'Noviembre 2026')
    expect(data.hay_mas).toBe(true)
    expect(JSON.stringify(data).length).toBeLessThan(14_000)
  })

  it('si no se leyó hasta el final, lo dice: lo que se ve no son los últimos', () => {
    const data = movementsData(page({ nextCursor: 'x', totalRows: 900 }), 'Noviembre 2026')
    expect(data.nota).toContain('más de 500')
  })
})

function flow(over: Partial<CashFlowRow> = {}): CashFlowRow {
  return {
    month: '2026-10-01',
    category: 'sales',
    categoryLabel: 'Cobros de ventas',
    inflowCents: 0,
    outflowCents: 0,
    netCents: 0,
    ...over,
  }
}

describe('ver_flujo', () => {
  it('por categoría, con los mismos totales y palabras de la pantalla', () => {
    const data = flowData(
      flowView([
        flow({ inflowCents: 1_000_000_00 }),
        flow({
          category: 'suppliers',
          categoryLabel: 'Pagos a proveedores',
          outflowCents: 600_000_00,
        }),
        flow({ category: 'payroll', categoryLabel: 'Sueldos y cargas', outflowCents: 100_000_00 }),
      ]),
      'Octubre 2026',
    )
    expect(data).toMatchObject({
      periodo: 'Octubre 2026',
      entro: '$ 1.000.000',
      salio: '$ 700.000',
      diferencia: '$ 300.000',
      de_donde_vino: [{ categoria: 'Ventas cobradas', monto: '$ 1.000.000' }],
      en_que_se_fue: [
        { categoria: 'Proveedores', monto: '$ 600.000' },
        { categoria: 'Sueldos', monto: '$ 100.000' },
      ],
    })
    expect(data.oracion).toBe(
      'En octubre entró $ 1.000.000 y salió $ 700.000: hay $ 300.000 más en las cajas.',
    )
    // Con un solo mes, «por mes» repetiría los totales.
    expect(data.por_mes).toBeUndefined()
  })

  it('con varios meses, mes por mes', () => {
    const data = flowData(
      flowView([flow({ inflowCents: 100_00 }), flow({ month: '2026-11-01', outflowCents: 50_00 })]),
      '01/10 – 30/11/2026',
    )
    expect(data.por_mes).toEqual([
      { mes: 'Octubre', entro: '$ 100', salio: '$ 0' },
      { mes: 'Noviembre', entro: '$ 0', salio: '$ 50' },
    ])
  })

  it('sin nada, lo dice', () => {
    const data = flowData(flowView([]), 'Octubre 2026')
    expect(data.oracion).toBe('En este período no entró ni salió plata de las cajas.')
    expect(data.en_que_se_fue).toEqual([])
  })
})

describe('ver_proximas_semanas', () => {
  const week = (over: Partial<CashProjectionRow> = {}): CashProjectionRow => ({
    weekStart: '2026-11-02',
    inCents: 0,
    outCents: 0,
    projectedBalanceCents: 0,
    ...over,
  })
  const view = (rows: CashProjectionRow[], available: number, known = true) =>
    projectionView(rows, available, { today: TODAY, known })

  it('si no se sabe cuánta plata hay, no estima nada', () => {
    expect(projectionData(view([], 0, false), 4, 0)).toEqual({
      alcanza: null,
      oracion: 'Para estimar si te alcanza, primero decime cuánta plata hay.',
    })
  })

  it('sin nada que venza, alcanza y dice por cuántas semanas', () => {
    expect(projectionData(view([], 100_00), 8, 100_00)).toEqual({
      alcanza: true,
      plata_hoy: '$ 100',
      oracion: 'No hay nada que venza en las próximas 8 semanas.',
    })
    expect(projectionData(view([], 100_00), 1, 100_00).oracion).toBe(
      'No hay nada que venza esta semana.',
    )
  })

  it('si alcanza, semana por semana con la aclaración de que es una estimación', () => {
    const data = projectionData(
      view([week({ outCents: 40_00, projectedBalanceCents: 60_00 })], 100_00),
      1,
      100_00,
    )
    expect(data).toMatchObject({
      alcanza: true,
      plata_hoy: '$ 100',
      aclaracion: PROJECTION_SENTENCE,
      semanas: [{ entra: '$ 0', sale: '$ 40', queda: '$ 60' }],
    })
    expect(data.oracion).toContain('alcanza')
  })

  it('si faltaría, lo dice sin afirmar que va a faltar', () => {
    const data = projectionData(
      view(
        [
          week({ outCents: 40_00, projectedBalanceCents: 60_00 }),
          week({ weekStart: '2026-11-09', outCents: 90_00, projectedBalanceCents: -30_00 }),
        ],
        100_00,
      ),
      2,
      100_00,
    )
    expect(data.alcanza).toBe(false)
    expect(data.oracion).toBe('Sin contar lo que vendas, la semana del 09/11 faltarían $ 30')
    expect(data.semanas?.[1]).toMatchObject({ queda: '-$ 30', faltaria: true })
    expect(data.semanas?.[0]?.semana).toBe('Esta semana, hasta el dom 08/11')
  })
})
