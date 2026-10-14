import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  activeQuick,
  payHeadline,
  paymentOutcome,
  payTicketRows,
  pendingRecurring,
  quickSelections,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/pay-summary'
import {
  defaultDebtSelection,
  type PlanCredit,
  type PlanDebt,
  planPayment,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/payment-plan'
import {
  OtherThanSupplier,
  PayCover,
  PayTicket,
  TickMark,
  UrgentSuppliers,
} from '@/components/administracion/acciones/pagar-piezas'

/**
 * La hoja «Pagar», lo que se LEE: la oración que dice cómo queda la deuda
 * después del pago, contra los números de `planPayment` (la misma ecuación del
 * motor), los atajos que mueven los tildes y el ticket. La cuenta en sí la
 * prueba `administracion-compras.test.ts`.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const TODAY = '2026-10-13'
const NB = String.fromCharCode(160)

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ')
}
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const plain = (s: string) => s.replaceAll(NB, ' ')

const debt = (
  lineId: string,
  openCents: number,
  dueDate: string | null,
  patch: Partial<PlanDebt> = {},
): PlanDebt => ({
  lineId,
  label: `Factura A 0003-0000${lineId}`,
  accountId: 'cta',
  openCents,
  targetCents: openCents,
  dueDate,
  entryDate: '2026-09-10',
  ...patch,
})
const credit = (lineId: string, openCents: number): PlanCredit => ({
  lineId,
  label: 'Nota de crédito A 0003-00000015',
  accountId: 'cta',
  openCents,
  entryDate: '2026-10-03',
})

/** Tres compras: una vencida, una que vence en la semana y una más adelante. */
const DEBTS = [
  debt('1100', 121_000_000, '2026-10-01'),
  debt('1180', 135_220_000, '2026-10-18'),
  debt('1205', 77_440_000, '2026-11-20'),
]
const TOTAL = 333_660_000

describe('paymentOutcome: cómo queda la deuda, contra los números del plan', () => {
  it('pago total: no le debés más nada', () => {
    const plan = planPayment({ debts: DEBTS, credits: [], amountCents: null, writeOff: false })
    const out = paymentOutcome({ plan, debtTotalCents: TOTAL })
    expect(plan.amountCents).toBe(TOTAL)
    expect(out).toMatchObject({
      kind: 'clears',
      sentence: 'Con esto no le debés más nada.',
      coveredCents: TOTAL,
      remainingCents: 0,
      details: [],
    })
  })

  it('pago de lo tildado por defecto: le quedás debiendo lo que no se tildó', () => {
    const ids = defaultDebtSelection(DEBTS, TODAY)
    expect(ids).toEqual(['1100', '1180'])
    const selected = DEBTS.filter((d) => ids.includes(d.lineId))
    const plan = planPayment({ debts: selected, credits: [], amountCents: null, writeOff: false })
    const out = paymentOutcome({ plan, debtTotalCents: TOTAL })
    expect(out.kind).toBe('remains')
    expect(plain(out.sentence)).toBe('Le quedás debiendo $ 774.400.')
    expect(out.remainingCents).toBe(TOTAL - plan.appliedCents)
    expect(out.coveredCents).toBe(plan.appliedCents)
  })

  it('pago parcial: la compra que queda a medias se nombra', () => {
    const plan = planPayment({
      debts: [DEBTS[0] as PlanDebt],
      credits: [],
      amountCents: 38_000_000,
      writeOff: false,
    })
    const out = paymentOutcome({ plan, debtTotalCents: TOTAL })
    expect(plain(out.sentence)).toBe('Le quedás debiendo $ 2.956.600.')
    expect(out.details.map(plain)).toEqual([
      'Factura A 0003-00001100 queda con $ 830.000 sin pagar.',
    ])
    expect(out.coveredCents).toBe(38_000_000)
  })

  it('con lo que tenés a favor: cubre más de lo que sale de la caja', () => {
    const plan = planPayment({
      debts: DEBTS,
      credits: [credit('nc', 6_050_000)],
      amountCents: null,
      writeOff: false,
    })
    const out = paymentOutcome({ plan, debtTotalCents: TOTAL })
    expect(plan.amountCents).toBe(TOTAL - 6_050_000)
    expect(plan.creditUsedCents).toBe(6_050_000)
    expect(out.kind).toBe('clears')
    expect(out.coveredCents).toBe(TOTAL)
  })

  it('sobra plata: queda a tu favor', () => {
    const plan = planPayment({
      debts: DEBTS,
      credits: [],
      amountCents: TOTAL + 5_000_000,
      writeOff: false,
    })
    const out = paymentOutcome({ plan, debtTotalCents: TOTAL })
    expect(out.kind).toBe('clears')
    expect(out.details.map(plain)).toEqual([
      'Sobran $ 50.000: quedan a tu favor y se descuentan de la próxima compra.',
    ])
    expect(plan.onAccountCents).toBe(5_000_000)
  })

  it('a cuenta, sin compras para pagar', () => {
    const plan = planPayment({ debts: [], credits: [], amountCents: 10_000_000, writeOff: false })
    const out = paymentOutcome({ plan, debtTotalCents: 0 })
    expect(out.kind).toBe('on_account')
    expect(plain(out.sentence)).toBe(
      'Le dejás $ 100.000 a cuenta: se descuentan de la próxima compra.',
    )
    expect(out.details).toEqual([])
    expect(out.totalCents).toBe(0)
  })

  it('«Nada: le dejo plata a cuenta» con deuda: lo que le debés queda igual', () => {
    const plan = planPayment({ debts: [], credits: [], amountCents: 10_000_000, writeOff: false })
    const out = paymentOutcome({ plan, debtTotalCents: TOTAL })
    expect(out.kind).toBe('on_account')
    expect(out.details.map(plain)).toEqual(['Lo que le debés queda igual: $ 3.336.600.'])
    expect(out.coveredCents).toBe(0)
    expect(out.remainingCents).toBe(TOTAL)
  })

  it('redondeo: dar por pagada la diferencia chica la cuenta como cubierta', () => {
    const one = [debt('9', 10_035_000, '2026-10-01')]
    const without = planPayment({
      debts: one,
      credits: [],
      amountCents: 10_000_000,
      writeOff: false,
    })
    expect(without.canWriteOff).toBe(true)
    expect(plain(paymentOutcome({ plan: without, debtTotalCents: 10_035_000 }).sentence)).toBe(
      'Le quedás debiendo $ 350.',
    )
    const withIt = planPayment({ debts: one, credits: [], amountCents: 10_000_000, writeOff: true })
    expect(withIt.writeOffCents).toBe(35_000)
    expect(paymentOutcome({ plan: withIt, debtTotalCents: 10_035_000 })).toMatchObject({
      kind: 'clears',
      remainingCents: 0,
    })
  })

  it('todavía sin nada: dice qué hacer, no un «$ 0»', () => {
    const empty = planPayment({ debts: [], credits: [], amountCents: null, writeOff: false })
    const withDebt = paymentOutcome({ plan: empty, debtTotalCents: TOTAL })
    expect(withDebt.kind).toBe('nothing')
    expect(withDebt.sentence).toBe('Tildá lo que le pagás o escribí cuánto.')
    expect(paymentOutcome({ plan: empty, debtTotalCents: 0 }).sentence).toBe(
      'Escribí cuánto le dejás: queda a cuenta.',
    )
  })

  it('nueve cifras', () => {
    const big = [debt('1', 99_999_999_900, '2026-10-01')]
    const plan = planPayment({ debts: big, credits: [], amountCents: 100, writeOff: false })
    expect(plain(paymentOutcome({ plan, debtTotalCents: 99_999_999_900 }).sentence)).toBe(
      'Le quedás debiendo $ 999.999.998.',
    )
  })
})

describe('los atajos mueven los mismos tildes de siempre', () => {
  it('«Lo vencido» y «Todo»', () => {
    const quick = quickSelections(DEBTS, TODAY)
    expect(quick.overdue).toEqual({ ids: ['1100'], cents: 121_000_000 })
    expect(quick.all).toEqual({ ids: ['1100', '1180', '1205'], cents: TOTAL })
  })

  it('cuál queda marcado según lo tildado', () => {
    const quick = quickSelections(DEBTS, TODAY)
    expect(activeQuick(new Set(), quick)).toBe('none')
    expect(activeQuick(new Set(['1100']), quick)).toBe('overdue')
    expect(activeQuick(new Set(['1100', '1180', '1205']), quick)).toBe('all')
    // Lo que viene tildado al abrir (vencido + la semana) no es ninguno de los dos.
    expect(activeQuick(new Set(defaultDebtSelection(DEBTS, TODAY)), quick)).toBeNull()
  })

  it('si todo está vencido, se marca «Todo»; sin compras no hay nada que tildar', () => {
    const allLate = quickSelections([DEBTS[0] as PlanDebt], TODAY)
    expect(activeQuick(new Set(['1100']), allLate)).toBe('all')
    expect(quickSelections([], TODAY)).toEqual({
      overdue: { ids: [], cents: 0 },
      all: { ids: [], cents: 0 },
    })
  })

  it('una compra sin fecha no cuenta como vencida', () => {
    expect(quickSelections([debt('x', 100, null)], TODAY).overdue.ids).toEqual([])
  })
})

describe('el encabezado y el ticket', () => {
  it('cuánto se le debe y en cuántas compras', () => {
    expect(plain(payHeadline({ debtCents: TOTAL, creditCents: 0, count: 3 }))).toBe(
      'Le debés $ 3.336.600 en 3 compras.',
    )
    expect(plain(payHeadline({ debtCents: 12_000_000, creditCents: 6_050_000, count: 1 }))).toBe(
      'Le debés $ 120.000 en 1 compra y tenés $ 60.500 a favor.',
    )
    expect(payHeadline({ debtCents: 0, creditCents: 0, count: 0 })).toBe(
      'No le debés nada: lo que le des queda a cuenta.',
    )
    expect(plain(payHeadline({ debtCents: 0, creditCents: 6_050_000, count: 0 }))).toBe(
      'No le debés nada y tenés $ 60.500 a favor.',
    )
  })

  it('el ticket nombra hasta tres compras y dice cuántas quedaron afuera', () => {
    const applications = ['a', 'b', 'c', 'd', 'e'].map((lineId, i) => ({
      lineId,
      amountCents: (i + 1) * 1000,
    }))
    const out = payTicketRows(applications, (id) => (id === 'c' ? undefined : `Factura ${id}`))
    expect(out.rows).toEqual([
      { key: 'a', label: 'Factura a', cents: 1000 },
      { key: 'b', label: 'Factura b', cents: 2000 },
      { key: 'c', label: 'Compra', cents: 3000 },
    ])
    expect(out.more).toBe(2)
    expect(out.moreCents).toBe(9000)
    expect(payTicketRows([], () => undefined)).toEqual({ rows: [], more: 0, moreCents: 0 })
  })

  it('los gastos fijos del mes sin cargar, el que vence antes primero', () => {
    const list = [
      { id: '1', name: 'Luz', nextDueDate: '2026-10-20', pending: true },
      { id: '2', name: 'Alquiler', nextDueDate: '2026-10-10', pending: true },
      { id: '3', name: 'Internet', nextDueDate: '2026-10-05', pending: false },
      { id: '4', name: 'Agua', nextDueDate: '2026-10-20', pending: true },
    ]
    expect(pendingRecurring(list).map((r) => r.name)).toEqual(['Alquiler', 'Agua', 'Luz'])
    expect(pendingRecurring([])).toEqual([])
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

describe('las piezas de «Pagar» dibujadas', () => {
  it('«Lo más urgente»: el vencimiento en el margen y cuánto se le debe', () => {
    const out = html(
      createElement(UrgentSuppliers, {
        onPick: () => {},
        rows: [
          {
            partyId: 'p1',
            name: 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SA',
            rail: { label: 'vencido hace', value: 12, unit: 'días', tone: 'late' },
            debtCents: TOTAL,
          },
        ],
      }),
    )
    const read = text(out)
    expect(read).toContain('vencido hace 12 días')
    expect(read).toContain('Le debés $ 3.336.600')
    // Se toca sin navegar: es un botón, no un link.
    expect(out).toContain('<button')
    expect(out).not.toContain('<a ')
  })

  it('mientras llegan los saldos, tres renglones en esqueleto (ningún «$ 0»)', () => {
    const out = html(createElement(UrgentSuppliers, { rows: null, onPick: () => {} }))
    expect(out).toContain('aria-busy="true"')
    expect(text(out)).not.toContain('$')
  })

  const other = (patch: Partial<Parameters<typeof OtherThanSupplier>[0]> = {}) =>
    text(
      html(
        createElement(OtherThanSupplier, {
          fixedLabel: 'Un gasto fijo',
          fixedHint: 'El alquiler, la luz, internet.',
          otherLabel: 'Otro gasto',
          otherHint: 'Una compra o un gasto suelto.',
          open: true,
          onToggle: () => {},
          fixed: [],
          onPickFixed: () => {},
          onOther: () => {},
          sheetHref: '/hub/administracion/gastos-fijos',
          ...patch,
        }),
      ),
    )

  it('«Un gasto fijo» lista los del mes sin cargar, con su vencimiento y su monto', () => {
    const read = other({
      fixed: [
        { id: '1', name: 'Alquiler', nextDueDate: '2026-10-10', amountCents: 85_000_000 },
        { id: '2', name: 'Luz', nextDueDate: '2026-10-20', amountCents: null },
      ],
    })
    expect(read).toContain('Alquiler vence el 10/10 $ 850.000')
    expect(read).toContain('Luz vence el 20/10 sin monto')
    expect(read).toContain('Ver la planilla')
    expect(read).toContain('Otro gasto')
  })

  it('sin ninguno pendiente lo dice; cerrado no lista nada', () => {
    expect(other()).toContain('No hay gastos fijos sin pagar este mes.')
    expect(other({ open: false })).not.toContain('Ver la planilla')
  })

  it('lo que cubre: la oración y sus detalles', () => {
    const plan = planPayment({
      debts: [DEBTS[0] as PlanDebt],
      credits: [],
      amountCents: 38_000_000,
      writeOff: false,
    })
    const read = text(
      html(createElement(PayCover, { outcome: paymentOutcome({ plan, debtTotalCents: TOTAL }) })),
    )
    expect(read).toContain('Le quedás debiendo $ 2.956.600.')
    expect(read).toContain('queda con $ 830.000 sin pagar.')
  })

  it('el ticket: qué paga, lo que usa a favor y de dónde sale', () => {
    const read = text(
      html(
        createElement(PayTicket, {
          name: 'Barracuda',
          subtitle: 'Mar 13/10',
          rows: [{ key: 'a', label: 'Factura A 0003-00001100', cents: 121_000_000 }],
          more: 2,
          moreCents: 212_660_000,
          creditUsedCents: 6_050_000,
          writeOffCents: 0,
          totalLabel: 'Salen de Mercado Pago',
          totalCents: 327_610_000,
          note: 'Con esto no le debés más nada.',
          pending: false,
        }),
      ),
    )
    expect(read).toContain('Pago a Barracuda')
    expect(read).toContain('Factura A 0003-00001100')
    expect(read).toContain('y 2 compras más')
    expect(read).toContain('A favor que usás')
    expect(read).toContain('Salen de Mercado Pago')
    expect(read).toContain('$ 3.276.100')
    expect(read).toContain('Con esto no le debés más nada.')
  })

  it('el ticket sin importe no muestra «$ 0»', () => {
    const read = text(
      html(
        createElement(PayTicket, {
          name: 'Barracuda',
          subtitle: 'Mar 13/10',
          rows: [],
          more: 0,
          moreCents: 0,
          creditUsedCents: 0,
          writeOffCents: 0,
          totalLabel: 'Pagás',
          totalCents: null,
          note: 'Tildá lo que le pagás o escribí cuánto.',
          pending: true,
        }),
      ),
    )
    expect(read).not.toContain('$ 0')
    expect(read).toContain('Todavía sin importe')
  })

  it('el tilde es un adorno: el estado lo anuncia el renglón', () => {
    expect(html(createElement(TickMark, { on: true }))).toContain('aria-hidden="true"')
  })
})
