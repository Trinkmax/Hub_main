import { describe, expect, it } from 'vitest'
import {
  COMP_REASONS,
  compReasonText,
  MADE_MARK,
  MADE_REASONS,
  NOT_MADE_REASONS,
  REASON_MAX,
  readVoidReason,
  reasonGroup,
  voidReasonText,
} from '@/lib/pos/unsold/reasons'
import {
  buildUnsold,
  discountAmountCents,
  isComp,
  type UnsoldBill,
  type UnsoldDiscount,
  type UnsoldLine,
  unsoldOfBranch,
} from '@/lib/pos/unsold/report'

/**
 * «Bajar de stock lo mal comandado, lo de los socios, etc.» (pedido de los socios, 16/11/2026): qué
 * salió sin venderse y por qué, armado con lo que el salón ya cargó.
 */

const pesos = (value: number) => value * 100

function bill(input: Partial<UnsoldBill> & Pick<UnsoldBill, 'sessionId'>): UnsoldBill {
  return {
    branchId: 'cerro',
    tableLabel: '12',
    subtotalCents: pesos(40_000),
    discountCents: 0,
    depositCents: 0,
    dueCents: pesos(40_000),
    closedAt: '2026-11-16T23:30:00Z',
    ...input,
  }
}

function discount(
  input: Partial<UnsoldDiscount> & Pick<UnsoldDiscount, 'sessionId'>,
): UnsoldDiscount {
  return {
    id: `d-${input.sessionId}`,
    kind: 'amount',
    value: pesos(40_000),
    reason: 'Consumo de socios',
    byName: 'Luz',
    approvedByName: null,
    createdAt: '2026-11-16T23:29:00Z',
    ...input,
  }
}

function line(input: Partial<UnsoldLine> & Pick<UnsoldLine, 'sessionId' | 'name'>): UnsoldLine {
  return {
    branchId: 'cerro',
    tableLabel: '12',
    quantity: 1,
    totalCents: pesos(10_000),
    cancelledAt: null,
    cancellationReason: null,
    started: false,
    ...input,
  }
}

describe('los motivos', () => {
  it('una baja de algo ya hecho lleva la marca; la de algo que no salió, no', () => {
    expect(voidReasonText('Mal comandado', true)).toBe(`Mal comandado${MADE_MARK}`)
    expect(voidReasonText('Mal comandado', false)).toBe('Mal comandado')
    // No se marca dos veces, y entra en lo que guarda la base.
    expect(voidReasonText(`Vino mal${MADE_MARK}`, true)).toBe(`Vino mal${MADE_MARK}`)
    expect(voidReasonText('x'.repeat(400), true)).toHaveLength(REASON_MAX)
    expect(voidReasonText('x'.repeat(400), true).endsWith(MADE_MARK)).toBe(true)
  })

  it('un motivo guardado se lee: nombre, y si ya estaba hecho', () => {
    expect(readVoidReason(`Mal comandado${MADE_MARK}`, false)).toEqual({
      label: 'Mal comandado',
      made: true,
    })
    expect(readVoidReason('Mal comandado', false)).toEqual({ label: 'Mal comandado', made: false })
    // Sin marca, vale que la cocina ya lo hubiera empezado.
    expect(readVoidReason('Se demoró', true)).toEqual({ label: 'Se demoró', made: true })
    // Los motivos de antes se leen con el nombre que usan los socios.
    expect(readVoidReason('Error de carga', false).label).toBe('Mal comandado')
    expect(readVoidReason('Cargado por error', false).label).toBe('Mal comandado')
    expect(readVoidReason(null, false)).toEqual({ label: 'Sin motivo', made: false })
  })

  it('las listas: «mal comandado» está en las dos, y nada se repite adentro de una', () => {
    expect(NOT_MADE_REASONS).toContain('Mal comandado')
    expect(MADE_REASONS).toContain('Mal comandado')
    expect(new Set(NOT_MADE_REASONS).size).toBe(NOT_MADE_REASONS.length)
    expect(new Set(MADE_REASONS).size).toBe(MADE_REASONS.length)
    expect(COMP_REASONS[0]).toBe('Consumo de socios')
  })

  it('una mesa que no se cobra dice para quién fue, y se agrupa sin el nombre', () => {
    expect(compReasonText('Consumo de socios', '  Nacho   Badra ')).toBe(
      'Consumo de socios · Nacho Badra',
    )
    expect(compReasonText('Invitación de la casa', '')).toBe('Invitación de la casa')
    expect(reasonGroup('Consumo de socios · Nacho Badra')).toBe('Consumo de socios')
    expect(reasonGroup('Consumo de socios')).toBe('Consumo de socios')
    expect(reasonGroup('Demora')).toBe('Demora')
    expect(reasonGroup('  ')).toBe('Sin motivo')
  })
})

describe('lo que salió sin venderse', () => {
  it('el porcentaje vale lo mismo que en la base: sobre el consumo, redondeado al peso', () => {
    expect(discountAmountCents({ kind: 'percent', value: 1000 }, pesos(12_345))).toBe(pesos(1235))
    expect(discountAmountCents({ kind: 'percent', value: 10_000 }, pesos(40_000))).toBe(
      pesos(40_000),
    )
    expect(discountAmountCents({ kind: 'amount', value: pesos(500) }, pesos(40_000))).toBe(
      pesos(500),
    )
  })

  it('una mesa que cerró sin que entrara plata es «no se cobró»; con seña o con cobros, no', () => {
    const full = { subtotalCents: pesos(40_000), discountCents: pesos(40_000) }
    expect(isComp({ ...full, dueCents: 0, depositCents: 0 })).toBe(true)
    // La seña cubrió todo: esa plata entró antes.
    expect(
      isComp({
        subtotalCents: pesos(40_000),
        discountCents: 0,
        dueCents: 0,
        depositCents: pesos(40_000),
      }),
    ).toBe(false)
    // Pagó una parte: es una mesa cobrada con un descuento.
    expect(
      isComp({
        subtotalCents: pesos(40_000),
        discountCents: pesos(30_000),
        dueCents: pesos(10_000),
        depositCents: 0,
      }),
    ).toBe(false)
    expect(isComp({ subtotalCents: 0, discountCents: 0, dueCents: 0, depositCents: 0 })).toBe(false)
  })

  it('consumo de socios: toda la mesa salió sin venderse, con sus productos', () => {
    const report = buildUnsold({
      bills: [bill({ sessionId: 's1', discountCents: pesos(40_000), dueCents: 0 })],
      discounts: [discount({ sessionId: 's1', reason: 'Consumo de socios · Nacho' })],
      lines: [
        line({ sessionId: 's1', name: 'Lomito', quantity: 2, totalCents: pesos(28_000) }),
        line({ sessionId: 's1', name: 'Mojito', totalCents: pesos(8000) }),
        line({ sessionId: 's1', name: 'Mojito', totalCents: pesos(4000) }),
      ],
    })
    expect(report.leftCents).toBe(pesos(40_000))
    expect(report.leftUnits).toBe(4)
    expect(report.leftByReason).toEqual([
      { reason: 'Consumo de socios', cents: pesos(40_000), units: 4, count: 1 },
    ])
    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]).toMatchObject({
      kind: 'comp',
      reason: 'Consumo de socios · Nacho',
      group: 'Consumo de socios',
      tableLabel: '12',
      byName: 'Luz',
      items: [
        { name: 'Lomito', quantity: 2, cents: pesos(28_000) },
        { name: 'Mojito', quantity: 2, cents: pesos(12_000) },
      ],
    })
    // No es un descuento más: no suma a «descuentos».
    expect(report.discountCents).toBe(0)
  })

  it('una baja de algo ya hecho salió; la de algo que no se hizo, no', () => {
    const report = buildUnsold({
      bills: [],
      discounts: [],
      lines: [
        line({
          sessionId: 's2',
          name: 'Cheese Burger',
          totalCents: pesos(14_000),
          cancelledAt: '2026-11-16T22:00:00Z',
          cancellationReason: `Mal comandado${MADE_MARK}`,
        }),
        line({
          sessionId: 's2',
          name: 'Flan',
          totalCents: pesos(6000),
          cancelledAt: '2026-11-16T22:05:00Z',
          cancellationReason: 'Mal comandado',
        }),
        // La cocina ya la había empezado: salió, aunque el motivo no lo diga.
        line({
          sessionId: 's3',
          name: 'Pizza',
          totalCents: pesos(20_000),
          cancelledAt: '2026-11-16T22:10:00Z',
          cancellationReason: 'Se demoró',
          started: true,
        }),
        // Un renglón vivo no es nada de esto.
        line({ sessionId: 's3', name: 'Agua' }),
      ],
    })
    expect(report.leftCents).toBe(pesos(34_000))
    expect(report.leftUnits).toBe(2)
    expect(report.leftByReason).toEqual([
      { reason: 'Se demoró', cents: pesos(20_000), units: 1, count: 1 },
      { reason: 'Mal comandado', cents: pesos(14_000), units: 1, count: 1 },
    ])
    expect(report.notMadeCents).toBe(pesos(6000))
    expect(report.notMadeLines).toBe(1)
    // De lo más nuevo a lo más viejo.
    expect(report.entries.map((entry) => entry.items[0]?.name)).toEqual([
      'Pizza',
      'Flan',
      'Cheese Burger',
    ])
    expect(report.entries.map((entry) => entry.kind)).toEqual([
      'void_made',
      'void_not_made',
      'void_made',
    ])
  })

  it('un descuento en una mesa que pagó es plata, no productos', () => {
    const report = buildUnsold({
      bills: [
        bill({ sessionId: 's4', discountCents: pesos(4000), dueCents: pesos(36_000) }),
        // Con seña: la plata entró antes. Su descuento es un descuento.
        bill({
          sessionId: 's5',
          discountCents: pesos(10_000),
          depositCents: pesos(30_000),
          dueCents: 0,
        }),
      ],
      discounts: [
        discount({ sessionId: 's4', kind: 'percent', value: 1000, reason: 'Demora' }),
        discount({ sessionId: 's5', value: pesos(10_000), reason: 'Cortesía de la casa' }),
      ],
      lines: [line({ sessionId: 's4', name: 'Lomito' })],
    })
    expect(report.leftCents).toBe(0)
    expect(report.discountCents).toBe(pesos(14_000))
    expect(report.discountByReason).toEqual([
      { reason: 'Cortesía de la casa', cents: pesos(10_000), units: 0, count: 1 },
      { reason: 'Demora', cents: pesos(4000), units: 0, count: 1 },
    ])
    expect(report.entries.every((entry) => entry.kind === 'discount')).toBe(true)
  })

  it('dos descuentos que juntos pasan del consumo no cuentan más que lo que la cuenta descontó', () => {
    const report = buildUnsold({
      bills: [
        bill({
          sessionId: 's6',
          subtotalCents: pesos(10_000),
          discountCents: pesos(10_000),
          depositCents: pesos(1),
          dueCents: 0,
        }),
      ],
      discounts: [
        discount({ id: 'a', sessionId: 's6', value: pesos(8000), reason: 'Promo' }),
        discount({ id: 'b', sessionId: 's6', value: pesos(8000), reason: 'Reclamo' }),
      ],
      lines: [],
    })
    expect(report.discountCents).toBe(pesos(10_000))
  })

  it('una mesa sin descuentos no aparece, aunque haya cerrado en cero por la seña', () => {
    const report = buildUnsold({
      bills: [bill({ sessionId: 's7', depositCents: pesos(40_000), dueCents: 0 })],
      discounts: [],
      lines: [line({ sessionId: 's7', name: 'Lomito' })],
    })
    expect(report.entries).toEqual([])
    expect(report.leftCents).toBe(0)
  })

  it('por sucursal: cada una ve lo suyo', () => {
    const input = {
      bills: [
        bill({ sessionId: 'a', branchId: 'cerro', discountCents: pesos(40_000), dueCents: 0 }),
        bill({ sessionId: 'b', branchId: 'alta', discountCents: pesos(40_000), dueCents: 0 }),
      ],
      discounts: [discount({ sessionId: 'a' }), discount({ sessionId: 'b' })],
      lines: [
        line({ sessionId: 'a', branchId: 'cerro', name: 'Lomito', totalCents: pesos(40_000) }),
        line({
          sessionId: 'c',
          branchId: 'alta',
          name: 'Pizza',
          cancelledAt: '2026-11-16T22:10:00Z',
          cancellationReason: `Vino mal${MADE_MARK}`,
        }),
      ],
    }
    expect(unsoldOfBranch(input, null).leftCents).toBe(pesos(90_000))
    expect(unsoldOfBranch(input, 'cerro').leftCents).toBe(pesos(40_000))
    expect(unsoldOfBranch(input, 'alta').leftCents).toBe(pesos(50_000))
    expect(unsoldOfBranch(input, 'alta').leftByReason.map((row) => row.reason)).toEqual([
      'Consumo de socios',
      'Vino mal',
    ])
  })
})
