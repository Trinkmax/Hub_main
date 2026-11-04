import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  activeQuick,
  bankTaxNote,
  payHeadline,
  paymentBankTax,
  paymentOutcome,
  payTicketRows,
  pendingRecurring,
  quickSelections,
  weekBudgetNote,
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
import { PaymentForm } from '@/components/administracion/acciones/pagar-sheet'
import { Sheet } from '@/components/ui/sheet'
import { DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import type { PostingContext } from '@/lib/accounting/types'
import { E7, prepare } from './accounting-fixtures'

/**
 * La hoja «Pago», lo que se LEE: la oración que dice cómo queda la deuda
 * después del pago, contra los números de `planPayment` (la misma ecuación del
 * motor), los atajos que mueven los tildes y el ticket. La cuenta en sí la
 * prueba `administracion-compras.test.ts`.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
// Dibujar la hoja no llama a la base: lo que lee, lo lee cuando se monta en el navegador.
vi.mock('@/lib/accounting/actions/documents', () => ({
  allocateItems: vi.fn(),
  postPayment: vi.fn(),
  undoDocument: vi.fn(),
}))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions', () => ({
  loadPartyDefaults: vi.fn(),
  loadPartyItems: vi.fn(),
  loadPartyWeekPlan: vi.fn(),
  loadSheetData: vi.fn(),
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

describe('lo que se dice en chico: el plan de la semana y el impuesto al cheque', () => {
  const settings = { auto: true, iibbBp: 300, municipalBp: 70, bankTaxBp: 60, base: 'invoiced_net' }
  const ctxOf = (taxSettings: typeof settings | undefined = settings) =>
    ({
      settings: { taxSettings },
      treasuries: new Map([
        ['caja', { id: 'caja', kind: 'cash', chargesBankTax: null }],
        ['bbva', { id: 'bbva', kind: 'bank', chargesBankTax: null }],
        ['mp', { id: 'mp', kind: 'wallet', chargesBankTax: null }],
        ['apagado', { id: 'apagado', kind: 'bank', chargesBankTax: false }],
        ['encendida', { id: 'encendida', kind: 'cash', chargesBankTax: true }],
      ]),
    }) as unknown as Parameters<typeof paymentBankTax>[1]
  const from = (treasuryAccountId: string, amountCents: number) => ({
    treasuryAccountId,
    amountCents,
  })

  it('el 0,6 % de lo que sale de un banco o una billetera; del efectivo, nada', () => {
    expect(paymentBankTax([from('bbva', 61_660_000)], ctxOf())).toEqual({ cents: 369_960, bp: 60 })
    expect(paymentBankTax([from('mp', 100_000)], ctxOf())).toEqual({ cents: 600, bp: 60 })
    expect(paymentBankTax([from('caja', 100_000)], ctxOf())).toBeNull()
  })

  it('manda lo que se decidió en la cuenta', () => {
    expect(paymentBankTax([from('apagado', 100_000)], ctxOf())).toBeNull()
    expect(paymentBankTax([from('encendida', 100_000)], ctxOf())).toEqual({ cents: 600, bp: 60 })
  })

  it('con dos medios, sobre la cuenta que puso más (la misma regla del motor)', () => {
    expect(paymentBankTax([from('mp', 100_000), from('bbva', 300_000)], ctxOf())?.cents).toBe(1_800)
    // El efectivo no cuenta, aunque haya puesto más.
    expect(paymentBankTax([from('caja', 900_000), from('mp', 100_000)], ctxOf())?.cents).toBe(600)
  })

  it('con los impuestos apagados o sin dato, no dice nada', () => {
    expect(paymentBankTax([from('bbva', 100_000)], ctxOf({ ...settings, auto: false }))).toBeNull()
    expect(paymentBankTax([from('bbva', 100_000)], ctxOf({ ...settings, bankTaxBp: 0 }))).toBeNull()
    expect(
      paymentBankTax([from('bbva', 100_000)], {
        settings: {},
        treasuries: new Map(),
      } as unknown as Parameters<typeof paymentBankTax>[1]),
    ).toBeNull()
    expect(paymentBankTax([], ctxOf())).toBeNull()
  })

  it('las palabras, en pesos y con centavos', () => {
    expect(plain(bankTaxNote({ cents: 369_960, bp: 60 }))).toBe(
      'Impuesto al cheque 0,6 %: $ 3.699,60, se anota solo.',
    )
    expect(plain(weekBudgetNote({ budgetCents: 45_000_000, paidCents: 41_000_000 }) ?? '')).toBe(
      'Presupuesto de la semana $ 450.000, ya pagaste $ 410.000.',
    )
    expect(weekBudgetNote({ budgetCents: 0, paidCents: 100 })).toBeNull()
    expect(weekBudgetNote(null)).toBeNull()
  })
})

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

describe('la hoja «Pago» dibujada', () => {
  /** Las tres facturas del proveedor del caso E7, con los impuestos prendidos. */
  const form = (treasuryKinds: readonly string[] = ['bank', 'wallet', 'cash']) => {
    const { ctx: base } = prepare(E7)
    const ctx: PostingContext = {
      ...base,
      settings: { ...base.settings, taxSettings: DEFAULT_TAX_SETTINGS },
    }
    const items = [...ctx.openItems.values()]
    const first = items[0]
    if (!first) throw new Error('Sin partidas')
    const party = ctx.parties.get(first.partyId)
    if (!party) throw new Error('Sin proveedor')
    const treasuries = [...ctx.treasuries.values()]
      .filter((t) => treasuryKinds.includes(t.kind))
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        balanceCents: t.balanceCents,
        active: true,
        allowNegative: true,
      }))
    return html(
      createElement(
        Sheet,
        { open: true },
        createElement(PaymentForm, {
          tenantSlug: 'hub',
          data: {
            ctx,
            firstOpenDate: null,
            booksStartDate: '2026-01-01',
            today: ctx.today,
            treasuries,
            parties: [],
            accounts: [],
            suggestions: [],
            recurring: [],
            balances: null,
            iibbJurisdictionCode: 904,
          },
          party: {
            id: party.id,
            name: party.name,
            tradeName: party.tradeName,
            kind: party.kind,
            taxIdType: 'cuit',
            taxId: null,
            ivaCondition: 'responsable_inscripto',
            paymentTermDays: 0,
            active: true,
            systemKey: null,
            defaultAccountId: null,
            defaultVoucherType: null,
            commissionVatMode: 'none',
            updatedAt: null,
          },
          partyItems: { partyId: party.id, items },
          focusLine: first.lineId,
          onChangeParty: () => {},
          close: () => {},
          setDirty: () => {},
        }),
      ),
    )
  }

  it('el título es «Pago», con lo que manda: las facturas, Importe, Salió de y Fecha', () => {
    const out = form()
    const read = text(out)
    expect(read).toContain('Pago a ')
    expect(read).not.toContain('Pagar a ')
    expect(read).toContain('¿Qué le pagás?')
    expect(read).toContain('Factura A 0003-00001180')
    for (const label of ['Vence', 'Saldo', 'Importe', 'Salió de', 'Fecha']) {
      expect(read).toContain(label)
    }
    expect(read).toContain('Cargar pago · $ ')
    // Cada factura se tilda: `?partida=` llega con esa sola marcada.
    expect(out.split('role="checkbox"').length - 1).toBeGreaterThan(1)
    expect(out).toContain('aria-checked="true"')
    expect(out).toContain('aria-checked="false"')
  })

  it('lo de cada tanto no se borró: queda plegado, y el asiento también', () => {
    const out = form()
    const read = text(out)
    expect(out).toContain('<details')
    expect(read).toContain('Más opciones')
    expect(read).toContain('Agregar n.º de transferencia')
    expect(read).toContain('Pagar con dos medios')
    expect(read).toContain('Agregar una nota')
    expect(read).toContain('Ver el asiento')
    expect(read).toContain('Nada: le dejo plata a cuenta')
    expect(read).toContain('Pagar solo una parte')
  })

  it('suma la foto del comprobante', () => {
    expect(form()).toContain('aria-label="Foto del comprobante"')
  })

  it('saliendo de un banco avisa el impuesto al cheque; del efectivo, no', () => {
    const bank = text(form(['bank']))
    expect(bank).toContain('Impuesto al cheque 0,6 %:')
    expect(bank).toContain('se anota solo')
    expect(text(form(['cash']))).not.toContain('Impuesto al cheque')
  })
})
