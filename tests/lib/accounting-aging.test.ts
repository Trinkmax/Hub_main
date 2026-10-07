import { describe, expect, it } from 'vitest'
import {
  AGING_BUCKETS,
  AGING_TRAMOS,
  agingBuckets,
  agingSummary,
  agingTramo,
  dueBucket,
  dueLabel,
  openAmountAsOf,
  trafficLight,
} from '@/lib/accounting/aging'

const TODAY = '2026-10-20'

describe('dueBucket (DueStatus del kit)', () => {
  it('cortes alrededor de hoy y de los 7 días', () => {
    expect(dueBucket(null, TODAY)).toBe('no-due')
    expect(dueBucket('2026-10-01', TODAY, 7, true)).toBe('settled')
    expect(dueBucket('2026-10-19', TODAY)).toBe('overdue')
    expect(dueBucket('2026-10-20', TODAY)).toBe('today')
    expect(dueBucket('2026-10-21', TODAY)).toBe('soon')
    expect(dueBucket('2026-10-27', TODAY)).toBe('soon')
    expect(dueBucket('2026-10-28', TODAY)).toBe('current')
    expect(dueBucket('2026-10-23', TODAY, 2)).toBe('current')
  })

  it('cruza meses y años sin `Date`', () => {
    expect(dueBucket('2027-01-02', '2026-12-31')).toBe('soon')
    expect(dueBucket('2026-12-31', '2027-01-01')).toBe('overdue')
  })

  it('textos: punto + palabras, singular y plural', () => {
    expect(dueLabel('2026-10-20', TODAY)).toBe('Vence hoy')
    expect(dueLabel('2026-10-21', TODAY)).toBe('Vence en 1 día')
    expect(dueLabel('2026-10-27', TODAY)).toBe('Vence en 7 días')
    expect(dueLabel('2026-11-30', TODAY)).toBe('Al día')
    expect(dueLabel('2026-10-19', TODAY)).toBe('Vencida hace 1 día')
    expect(dueLabel('2026-10-17', TODAY)).toBe('Vencida hace 3 días')
    expect(dueLabel(null, TODAY)).toBe('Sin vencimiento')
    expect(dueLabel('2026-10-17', TODAY, { settled: true })).toBe('Pagada')
    expect(dueLabel('2026-10-17', TODAY, { settled: true, group: 'receivables' })).toBe('Cobrada')
  })
})

describe('agingTramo (F.7, espejo de la SQL)', () => {
  it('bordes: vence hoy, 7, 30 y 60 días', () => {
    expect(agingTramo(null, TODAY)).toBe('no_due')
    expect(agingTramo('2026-10-20', TODAY)).toBe('due_soon') // hoy
    expect(agingTramo('2026-10-27', TODAY)).toBe('due_soon') // hoy + 7
    expect(agingTramo('2026-10-28', TODAY)).toBe('not_due') // hoy + 8
    expect(agingTramo('2026-10-19', TODAY)).toBe('overdue_1_30') // 1 día
    expect(agingTramo('2026-09-20', TODAY)).toBe('overdue_1_30') // 30 días
    expect(agingTramo('2026-09-19', TODAY)).toBe('overdue_31_60') // 31 días
    expect(agingTramo('2026-08-21', TODAY)).toBe('overdue_31_60') // 60 días
    expect(agingTramo('2026-08-20', TODAY)).toBe('overdue_60_plus') // 61 días
  })

  it('S configurable (due_soon_days)', () => {
    expect(agingTramo('2026-10-23', TODAY, 3)).toBe('due_soon')
    expect(agingTramo('2026-10-24', TODAY, 3)).toBe('not_due')
  })

  it('el orden de los tramos es el de las columnas del CSV', () => {
    expect([...AGING_TRAMOS]).toEqual([
      'not_due',
      'due_soon',
      'overdue_1_30',
      'overdue_31_60',
      'overdue_60_plus',
      'no_due',
    ])
  })
})

// E7: Coca-Cola al 20/10 — F1 vence 14/10, F2 21/10, F3 (E1 después de la NC) 24/10; más un pago a cuenta.
const E7_ITEMS = [
  { dueDate: '2026-10-14', openCents: 50_000_000 },
  { dueDate: '2026-10-21', openCents: 38_000_000 },
  { dueDate: '2026-10-24', openCents: 79_950_000 },
]

describe('agingSummary y agingBuckets', () => {
  it('suma por tramo con vencido más viejo y próximo vencimiento', () => {
    const s = agingSummary([...E7_ITEMS, { dueDate: null, openCents: 1_000 }], TODAY)
    expect(s.totals).toEqual({
      not_due: 0,
      due_soon: 117_950_000,
      overdue_1_30: 50_000_000,
      overdue_31_60: 0,
      overdue_60_plus: 0,
      no_due: 1_000,
    })
    expect(s.counts.due_soon).toBe(2)
    expect(s.totalCents).toBe(167_951_000)
    expect(s.overdueCents).toBe(50_000_000)
    expect(s.oldestDueDate).toBe('2026-10-14')
    expect(s.nextDueDate).toBe('2026-10-21')
  })

  it('ignora partidas sin abierto', () => {
    const s = agingSummary([{ dueDate: '2026-10-01', openCents: 0 }], TODAY)
    expect(s.totalCents).toBe(0)
    expect(s.oldestDueDate).toBeNull()
  })

  it('AgingBar: los cinco tramos en orden, sin lo que no vence', () => {
    const buckets = agingBuckets([...E7_ITEMS, { dueDate: null, openCents: 5 }], TODAY)
    expect(buckets.map((b) => b.bucket)).toEqual([...AGING_BUCKETS])
    expect(buckets).toEqual([
      { bucket: 'current', cents: 0, count: 0 },
      { bucket: 'soon', cents: 117_950_000, count: 2 },
      { bucket: 'overdue-1-30', cents: 50_000_000, count: 1 },
      { bucket: 'overdue-31-60', cents: 0, count: 0 },
      { bucket: 'overdue-60-plus', cents: 0, count: 0 },
    ])
  })
})

describe('trafficLight (semáforo, siempre con texto)', () => {
  it('rojo: lo vencido no está cubierto por lo a favor → la más vieja', () => {
    const r = trafficLight({ items: E7_ITEMS, creditCents: 0, asOf: TODAY })
    expect(r).toEqual({ light: 'red', text: 'Vencida hace 6 días', reason: 'overdue', days: 6 })
  })

  it('amarillo: lo vencido queda cubierto por un saldo a favor sin aplicar', () => {
    const r = trafficLight({ items: E7_ITEMS, creditCents: 60_000_000, asOf: TODAY })
    expect(r.light).toBe('yellow')
    expect(r.reason).toBe('covered_by_credit')
    expect(r.text).toBe('Tenés $ 600.000 a favor sin aplicar')
  })

  it('amarillo: nada vencido y algo vence en S días', () => {
    const items = E7_ITEMS.slice(1)
    expect(trafficLight({ items, creditCents: 0, asOf: TODAY })).toEqual({
      light: 'yellow',
      text: 'Vence en 1 día',
      reason: 'due_soon',
      days: 1,
    })
    expect(trafficLight({ items, creditCents: 0, asOf: '2026-10-21' }).text).toBe('Vence hoy')
  })

  it('verde: hay deuda y nada vence en S días', () => {
    const r = trafficLight({
      items: [{ dueDate: '2026-12-01', openCents: 10 }],
      creditCents: 0,
      asOf: TODAY,
    })
    expect(r).toEqual({ light: 'green', text: 'Al día', reason: 'current', days: null })
    // Una deuda sin vencimiento también está al día.
    expect(
      trafficLight({ items: [{ dueDate: null, openCents: 10 }], creditCents: 0, asOf: TODAY })
        .light,
    ).toBe('green')
  })

  it('sin deuda: «Sin deuda», con el saldo a favor si hay', () => {
    expect(trafficLight({ items: [], creditCents: 0, asOf: TODAY }).text).toBe('Sin deuda')
    expect(trafficLight({ items: [], creditCents: 12_000_000, asOf: TODAY })).toEqual({
      light: 'none',
      text: 'Sin deuda · A favor $ 120.000',
      reason: 'no_debt',
      days: null,
    })
  })

  it('cobrables: se lee al revés', () => {
    const late = trafficLight({
      items: [{ dueDate: '2026-10-15', openCents: 15_000_000 }],
      creditCents: 0,
      asOf: TODAY,
      group: 'receivables',
      partyName: 'PedidosYa',
    })
    expect(late.text).toBe('PedidosYa está atrasada 5 días')
    const soon = trafficLight({
      items: [{ dueDate: '2026-10-23', openCents: 15_000_000 }],
      creditCents: 0,
      asOf: TODAY,
      group: 'receivables',
    })
    expect(soon.text).toBe('Se acredita en 3 días')
    const today = trafficLight({
      items: [{ dueDate: TODAY, openCents: 1 }],
      creditCents: 0,
      asOf: TODAY,
      group: 'receivables',
    })
    expect(today.text).toBe('Se acredita hoy')
  })
})

describe('openAmountAsOf: abierto «al día X» con imputaciones que valen en [applied_on, voided_on)', () => {
  // E1 (86.000.000) con la NC de E6 aplicada el 10/10 y desaplicada el 25/10.
  const allocations = [{ amountCents: 6_050_000, appliedOn: '2026-10-10', voidedOn: '2026-10-25' }]

  it('un mes cerrado da siempre lo mismo aunque después se desaplique', () => {
    expect(openAmountAsOf(86_000_000, allocations, '2026-10-09')).toBe(86_000_000)
    expect(openAmountAsOf(86_000_000, allocations, '2026-10-10')).toBe(79_950_000)
    expect(openAmountAsOf(86_000_000, allocations, '2026-10-24')).toBe(79_950_000)
    expect(openAmountAsOf(86_000_000, allocations, '2026-10-25')).toBe(86_000_000)
  })

  it('hoy (sin fecha): solo cuentan las vigentes', () => {
    expect(openAmountAsOf(86_000_000, allocations)).toBe(86_000_000)
    const both = [
      ...allocations,
      { amountCents: 2_000_000, appliedOn: '2026-10-20', voidedOn: null },
    ]
    expect(openAmountAsOf(86_000_000, both)).toBe(84_000_000)
    expect(openAmountAsOf(86_000_000, both, '2026-10-21')).toBe(77_950_000)
  })
})
