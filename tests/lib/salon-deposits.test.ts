import { describe, expect, it } from 'vitest'
import {
  aggregateDepositsByDay,
  type DepositSourceRow,
  depositsExportFilename,
  depositsToCsv,
} from '@/lib/salon/deposits'

/** La DB guarda centavos; el bar habla en pesos. */
const pesos = (n: number): number => n * 100

/** Fila mínima, tal como la trae el `.select()` del reporte. */
function row(over: Partial<DepositSourceRow> = {}): DepositSourceRow {
  return {
    reservation_date: '2026-09-05',
    created_at: '2026-09-04T18:30:00Z',
    deposit_cents: pesos(10_000),
    status: 'pending',
    ...over,
  }
}

function report(over: {
  basis?: 'reservation' | 'created'
  from?: string
  to?: string
  rows?: DepositSourceRow[]
  truncated?: boolean
}) {
  return aggregateDepositsByDay({
    basis: over.basis ?? 'reservation',
    from: over.from ?? '2026-09-05',
    to: over.to ?? '2026-09-05',
    rows: over.rows ?? [],
    truncated: over.truncated,
  })
}

describe('aggregateDepositsByDay', () => {
  it('suma las señas del día por fecha de reserva', () => {
    const r = report({
      rows: [
        row({ deposit_cents: pesos(15_000) }),
        row({ deposit_cents: pesos(20_000) }),
        row({ deposit_cents: pesos(5_000) }),
      ],
    })
    expect(r.days).toHaveLength(1)
    expect(r.days[0]?.day).toBe('2026-09-05')
    expect(r.days[0]?.total_cents).toBe(pesos(40_000))
    expect(r.days[0]?.reservations).toBe(3)
    expect(r.days[0]?.with_deposit).toBe(3)
    expect(r.totals.total_cents).toBe(pesos(40_000))
  })

  it('las canceladas y las no-show suman al total pero quedan aparte', () => {
    // Decisión del dueño: la plata entró igual. Este test la fija — el resto de
    // los agregadores de salón descartan estos estados y copiarlos por inercia
    // borraría plata real del reporte.
    const r = report({
      rows: [
        row({ status: 'closed', deposit_cents: pesos(10_000) }),
        row({ status: 'cancelled', deposit_cents: pesos(15_000) }),
        row({ status: 'no_show', deposit_cents: pesos(30_000) }),
      ],
    })
    expect(r.totals.total_cents).toBe(pesos(55_000))
    expect(r.totals.active_cents).toBe(pesos(10_000))
    expect(r.totals.fallen_cents).toBe(pesos(45_000))
    expect(r.totals.cancelled_cents).toBe(pesos(15_000))
    expect(r.totals.no_show_cents).toBe(pesos(30_000))
  })

  it('devuelve el rango denso, con los días sin reservas en cero', () => {
    const r = report({
      from: '2026-06-10',
      to: '2026-06-12',
      rows: [row({ reservation_date: '2026-06-11', deposit_cents: pesos(10_000) })],
    })
    expect(r.days.map((d) => d.day)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12'])
    expect(r.days[0]?.total_cents).toBe(0)
    expect(r.days[0]?.reservations).toBe(0)
    expect(r.days[1]?.total_cents).toBe(pesos(10_000))
    expect(r.days[2]?.total_cents).toBe(0)
  })

  it('distingue un día con reservas y sin una sola seña', () => {
    // Caso real del HUB: 2026-06-11, 2026-06-21 y 2026-09-17 tuvieron reservas
    // y cero señas. No es lo mismo que un día vacío.
    const r = report({ rows: [row({ deposit_cents: 0 }), row({ deposit_cents: 0 })] })
    expect(r.days[0]?.reservations).toBe(2)
    expect(r.days[0]?.with_deposit).toBe(0)
    expect(r.days[0]?.total_cents).toBe(0)
    expect(r.totals.days_with_deposit).toBe(0)
  })

  it('agrupa por el día de Córdoba cuando el criterio es la fecha de carga', () => {
    // 00:30 UTC del 9 son las 21:30 del 8 en Córdoba — justo el horario pico
    // del bar. Agrupar en UTC pondría esta carga en el día equivocado.
    const r = report({
      basis: 'created',
      from: '2026-09-08',
      to: '2026-09-09',
      rows: [row({ created_at: '2026-09-09T00:30:00Z', deposit_cents: pesos(12_000) })],
    })
    expect(r.days[0]?.day).toBe('2026-09-08')
    expect(r.days[0]?.total_cents).toBe(pesos(12_000))
    expect(r.days[1]?.total_cents).toBe(0)
  })

  it('los dos criterios ponen la misma reserva en días distintos', () => {
    // Reserva real de Halloween: cargada el 02/09, para el 31/10 (59 días).
    const halloween = row({
      reservation_date: '2026-10-31',
      created_at: '2026-09-02T14:00:00Z',
      deposit_cents: pesos(40_000),
    })
    const porReserva = report({ from: '2026-10-31', to: '2026-10-31', rows: [halloween] })
    const porCarga = report({
      basis: 'created',
      from: '2026-09-02',
      to: '2026-09-02',
      rows: [halloween],
    })
    expect(porReserva.days[0]?.total_cents).toBe(pesos(40_000))
    expect(porCarga.days[0]?.total_cents).toBe(pesos(40_000))
    expect(porReserva.days[0]?.day).not.toBe(porCarga.days[0]?.day)
  })

  it('tolera carga retroactiva: una reserva cargada después de su fecha', () => {
    // Caso real: reserva del 17/07 cargada el 23/07. No rompe ni se descarta.
    const retro = row({
      reservation_date: '2026-07-17',
      created_at: '2026-07-23T15:00:00Z',
      deposit_cents: pesos(4_000),
    })
    expect(report({ from: '2026-07-17', to: '2026-07-17', rows: [retro] }).totals.total_cents).toBe(
      pesos(4_000),
    )
    expect(
      report({ basis: 'created', from: '2026-07-23', to: '2026-07-23', rows: [retro] }).totals
        .total_cents,
    ).toBe(pesos(4_000))
  })

  it('suma bien cuando el bigint llega como string', () => {
    // PostgREST puede serializar un bigint como string: sin coerción, `+=`
    // concatenaría en vez de sumar.
    const r = report({
      rows: [row({ deposit_cents: '1000000' }), row({ deposit_cents: pesos(5_000) })],
    })
    expect(r.totals.total_cents).toBe(1_500_000)
  })

  it('ignora un deposit_cents que no es un número', () => {
    const r = report({ rows: [row({ deposit_cents: 'no-es-plata' })] })
    expect(r.totals.total_cents).toBe(0)
    expect(r.totals.reservations).toBe(1)
    expect(r.totals.with_deposit).toBe(0)
  })

  it('la mediana diaria no es el promedio', () => {
    const r = report({
      from: '2026-09-01',
      to: '2026-09-03',
      rows: [
        row({ reservation_date: '2026-09-01', deposit_cents: pesos(4_000) }),
        row({ reservation_date: '2026-09-02', deposit_cents: pesos(10_000) }),
        row({ reservation_date: '2026-09-03', deposit_cents: pesos(499_000) }),
      ],
    })
    expect(r.totals.median_day_cents).toBe(pesos(10_000))
    expect(r.totals.avg_day_cents).toBe(pesos(171_000))
  })

  it('los días en cero no entran en el promedio ni en la mediana', () => {
    const r = report({
      from: '2026-09-01',
      to: '2026-09-05',
      rows: [
        row({ reservation_date: '2026-09-01', deposit_cents: pesos(10_000) }),
        row({ reservation_date: '2026-09-05', deposit_cents: pesos(30_000) }),
      ],
    })
    expect(r.days).toHaveLength(5)
    expect(r.totals.days_with_deposit).toBe(2)
    expect(r.totals.avg_day_cents).toBe(pesos(20_000))
    expect(r.totals.median_day_cents).toBe(pesos(20_000))
  })

  it('la mediana de un número par de días promedia los dos del medio', () => {
    const r = report({
      from: '2026-09-01',
      to: '2026-09-04',
      rows: [
        row({ reservation_date: '2026-09-01', deposit_cents: pesos(10_000) }),
        row({ reservation_date: '2026-09-02', deposit_cents: pesos(20_000) }),
        row({ reservation_date: '2026-09-03', deposit_cents: pesos(50_000) }),
        row({ reservation_date: '2026-09-04', deposit_cents: pesos(100_000) }),
      ],
    })
    expect(r.totals.median_day_cents).toBe(pesos(35_000))
  })

  it('top_day es el día más alto, y es null si no entró un peso', () => {
    const r = report({
      from: '2026-09-01',
      to: '2026-09-03',
      rows: [
        row({ reservation_date: '2026-09-01', deposit_cents: pesos(10_000) }),
        row({ reservation_date: '2026-09-03', deposit_cents: pesos(90_000) }),
      ],
    })
    expect(r.totals.top_day).toEqual({ day: '2026-09-03', total_cents: pesos(90_000) })

    const vacio = report({ rows: [row({ deposit_cents: 0 })] })
    expect(vacio.totals.top_day).toBeNull()
    expect(vacio.totals.avg_day_cents).toBe(0)
    expect(vacio.totals.median_day_cents).toBe(0)
  })

  it('una reserva de evento suma igual que una de salón', () => {
    // Regresión de un bug que ya apareció dos veces en covers y en capacidad:
    // la zona dice dónde se sienta la gente, no si su plata cuenta.
    const r = report({
      rows: [row({ deposit_cents: pesos(254_300), status: 'pending' })],
    })
    expect(r.totals.total_cents).toBe(pesos(254_300))
    expect(r.totals.active_cents).toBe(pesos(254_300))
  })

  it('descarta filas fuera del rango aunque la query traiga de más', () => {
    const r = report({
      from: '2026-09-05',
      to: '2026-09-05',
      rows: [row(), row({ reservation_date: '2026-10-01', deposit_cents: pesos(99_000) })],
    })
    expect(r.totals.reservations).toBe(1)
    expect(r.totals.total_cents).toBe(pesos(10_000))
  })

  it('no pierde plata cuando el rango es más largo que el relleno denso', () => {
    // El relleno de días con cero se corta en MAX_DENSE_DAYS. Sin crear el
    // bucket que falta, la seña de una reserva lejana desaparecía del total sin
    // ninguna señal: los totales se suman recorriendo los días, no las filas.
    const r = report({
      from: '2026-01-01',
      to: '2029-12-31',
      rows: [
        row({ reservation_date: '2026-01-01', deposit_cents: pesos(1_000) }),
        row({ reservation_date: '2029-12-31', deposit_cents: pesos(50_000) }),
      ],
    })
    expect(r.totals.total_cents).toBe(pesos(51_000))
    expect(r.totals.reservations).toBe(2)
    expect(r.totals.top_day).toEqual({ day: '2029-12-31', total_cents: pesos(50_000) })
    expect(r.days[r.days.length - 1]?.day).toBe('2029-12-31')
  })

  it('devuelve los días siempre ordenados', () => {
    const r = report({
      from: '2026-01-01',
      to: '2029-12-31',
      rows: [
        row({ reservation_date: '2029-06-15', deposit_cents: pesos(1_000) }),
        row({ reservation_date: '2028-03-02', deposit_cents: pesos(2_000) }),
      ],
    })
    const dias = r.days.map((d) => d.day)
    expect([...dias].sort()).toEqual(dias)
  })

  it('propaga truncated', () => {
    expect(report({ rows: [row()], truncated: true }).truncated).toBe(true)
    expect(report({ rows: [row()] }).truncated).toBe(false)
  })

  it('un rango de un solo día devuelve un solo bucket', () => {
    expect(report({ from: '2026-09-05', to: '2026-09-05', rows: [row()] }).days).toHaveLength(1)
  })
})

describe('depositsToCsv / depositsExportFilename', () => {
  const sample = report({
    from: '2026-09-01',
    to: '2026-09-02',
    rows: [
      row({ reservation_date: '2026-09-01', deposit_cents: pesos(72_000), status: 'closed' }),
      row({ reservation_date: '2026-09-01', deposit_cents: pesos(15_000), status: 'no_show' }),
    ],
  })

  it('emite pesos enteros, sin símbolo ni punto de miles', () => {
    const lines = depositsToCsv(sample).split('\r\n')
    expect(lines[1]).toBe('2026-09-01;2;2;72000;0;15000;87000')
  })

  it('escribe 0 en los días sin seña en vez de dejar la celda vacía', () => {
    // Al revés que el CSV de reservas: acá la planilla es una serie temporal y
    // un hueco rompe cualquier gráfico o promedio hecho en Excel.
    const lines = depositsToCsv(sample).split('\r\n')
    expect(lines[2]).toBe('2026-09-02;0;0;0;0;0;0')
  })

  it('usa punto y coma, BOM y cabeceras en castellano', () => {
    const csv = depositsToCsv(sample)
    expect(csv.startsWith('﻿')).toBe(true)
    const header = csv.split('\r\n')[0] ?? ''
    expect(header).toContain('Seña vigente ($)')
    expect(header.split(';')).toHaveLength(7)
  })

  it('el nombre del archivo lleva el criterio cuando es por fecha de carga', () => {
    expect(
      depositsExportFilename('hub', { basis: 'reservation', from: '2026-09-01', to: '2026-09-30' }),
    ).toBe('senas-hub-2026-09-01_2026-09-30.csv')
    expect(
      depositsExportFilename('hub', { basis: 'created', from: '2026-09-01', to: '2026-09-30' }),
    ).toBe('senas-hub-carga-2026-09-01_2026-09-30.csv')
  })
})
