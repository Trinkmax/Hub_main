/**
 * Lo que Tex manda en ventas: tiene que ser lo mismo que manda cada pantalla. Las partes puras pasan por
 * el zod del formulario y por el motor, y se comparan contra los golden del motor (el hash firma el
 * asiento entero). Abajo, las herramientas de punta a punta con la base simulada.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadDocumentContext: vi.fn(),
  loadFirstOpenDate: vi.fn(),
}))
vi.mock('@/lib/accounting/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/context')>()),
  loadPostingCatalog: vi.fn(),
  loadOpenItems: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/forms', () => ({
  getFormDefaults: vi.fn(),
  findPossibleDuplicate: vi.fn(),
  getSalesRangeDefaults: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/documents', () => ({
  listRecurringExpenses: vi.fn(),
  listDocuments: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/projection', () => ({ listSalesTargets: vi.fn() }))
vi.mock('@/lib/accounting/queries/week-plan', () => ({ getWeekPlan: vi.fn() }))
vi.mock('@/lib/accounting/queries/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('@/lib/accounting/queries/treasury', () => ({ listTreasuryAccounts: vi.fn() }))
vi.mock('@/lib/accounting/queries/parties', () => ({
  searchKey: (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim(),
  searchParties: vi.fn(),
  getParty: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({ saveParty: vi.fn() }))
vi.mock('@/lib/accounting/actions/week-plan', () => ({ saveWeekBudgets: vi.fn() }))
vi.mock('@/lib/accounting/actions/projection', () => ({ saveSalesTargets: vi.fn() }))

import { authorizeAccounting } from '@/lib/accounting/access'
import { saveSalesTargets } from '@/lib/accounting/actions/projection'
import { loadOpenItems, loadPostingCatalog } from '@/lib/accounting/context'
import { salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { listAccounts } from '@/lib/accounting/queries/accounts'
import { listDocuments } from '@/lib/accounting/queries/documents'
import { getSalesRangeDefaults } from '@/lib/accounting/queries/forms'
import { searchParties } from '@/lib/accounting/queries/parties'
import { listSalesTargets } from '@/lib/accounting/queries/projection'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { loadDocumentContext, loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { DocumentForm } from '@/lib/accounting/server/document-types'
import type { OpenItemRef, PostingContext } from '@/lib/accounting/types'
import { createClient } from '@/lib/supabase/server'
import { documentExecutor } from '@/lib/tex/document-action'
import {
  type CierreDraft,
  type CobroDraft,
  cierrePlan,
  closeMethodsOf,
  cobroPlan,
  type FacturaVentaDraft,
  facturaVentaPlan,
  objetivosCopiados,
  objetivosDeLista,
  objetivosPorDia,
  saleAliquots,
} from '@/lib/tex/tools/actions/_ventas-values'
import { ventasActionTools, ventasExecutors } from '@/lib/tex/tools/actions/ventas'
import { type TexPrepared, type TexToolContext, toInputSchema } from '@/lib/tex/tools/types'
import type { CoreFixture, PartyFixtureKey } from './accounting-core-context'
import { fixedUuid } from './accounting-core-context'
import {
  E8,
  E9,
  E16_ADVANCE,
  E16_INVOICE,
  type PreparedFixture,
  prepare,
} from './accounting-fixtures'
import { catalogOf } from './tex-actions-catalog'

function entry(form: DocumentForm, values: unknown, ctx: PostingContext) {
  const state = previewDocumentForm(form, values, ctx)
  expect(state.ok, JSON.stringify(state)).toBe(true)
  if (!state.ok) throw new Error(state.message)
  for (const doc of state.preview) expect(doc.balanced).toBe(true)
  return state
}

function ok<T extends { ok: boolean }>(plan: T | { ok: false; message: string }): T {
  if (!plan.ok) throw new Error(`Falló: ${(plan as { message?: string }).message}`)
  return plan as T
}

function failure(plan: { ok: boolean; message?: string }): string {
  expect(plan.ok).toBe(false)
  return plan.message ?? ''
}

// ─── Cierre del día ──────────────────────────────────────────────────────────

function cierre(fixture: PreparedFixture, patch: Partial<CierreDraft>): CierreDraft {
  const { f, ctx } = fixture
  return {
    date: '2026-10-05',
    methods: closeMethodsOf(catalogOf(f, ctx.tenantId)),
    sales: [],
    cashCountedCents: null,
    invoiced: [],
    salesPoints: [...ctx.salesPoints.values()],
    rangeDefaults: [],
    existing: [],
    shift: null,
    controlTotalCents: null,
    reason: null,
    ctx,
    limits: { booksStart: '2026-10-01', serviceDay: '2026-10-31', firstOpenDate: null },
    ...patch,
  }
}

const sale = (method: string, cents: number) => ({ method, cents, customers: [] })

/** El cierre del lunes 05/10 de la especificación, dicho en palabras. */
const E8_SALES = [
  sale('efectivo', 35_000_000),
  sale('Transferencia', 18_000_000),
  sale('QR Mercado Pago', 22_000_000),
  sale('Débito', 41_000_000),
  sale('credito', 33_000_000),
  sale('PedidosYa', 15_000_000),
  sale('Rappi', 6_000_000),
]

describe('preparar_cierre: lo que manda el formulario', () => {
  it('Todos los medios, el efectivo contado y lo facturado: el mismo hash que el golden', () => {
    const fixture = prepare()
    const plan = ok(
      cierrePlan(
        cierre(fixture, {
          sales: E8_SALES,
          cashCountedCents: 34_950_000,
          controlTotalCents: 170_000_000,
          invoiced: [
            {
              voucherType: 'factura_b',
              pointOfSale: 3,
              from: 14_501,
              to: 14_662,
              totalCents: 121_000_000,
              rateBp: null,
              channel: null,
              party: null,
            },
            {
              voucherType: 'factura_b',
              pointOfSale: 4,
              from: 2_101,
              to: 2_130,
              totalCents: 18_150_000,
              rateBp: null,
              channel: null,
              party: null,
            },
          ],
        }),
      ),
    )
    const preview = entry('sales_close', plan.values, fixture.ctx)
    expect(preview.hash).toBe(entry('sales_close', E8.input(fixture.r), fixture.ctx).hash)
    // Como el formulario: un renglón por cada medio activo, los que no se dijeron en cero.
    const methods = plan.values.methods as Array<{ salesMethodId: string; amountCents: number }>
    expect(methods).toHaveLength(fixture.ctx.methods.size)
    expect(methods.find((m) => m.salesMethodId === fixture.f.method('customerAccount').id)).toEqual(
      {
        salesMethodId: fixture.f.method('customerAccount').id,
        amountCents: 0,
        customers: [],
      },
    )
    expect(plan.values).toMatchObject({
      date: '2026-10-05',
      shift: null,
      cashCountedCents: 34_950_000,
      overrideReason: null,
      instantSettlements: [],
    })
    expect(plan.ticket).toMatchObject({
      title: 'Cierre del día',
      subtitle: 'Lunes 05/10',
      total: { label: 'Vendido', value: '$ 1.700.000' },
      confirmLabel: 'Cargar el cierre',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Efectivo contado', value: '$ 349.500' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Faltan en la caja', value: '$ 500' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Con factura', value: '$ 1.391.500' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Sin factura', value: '$ 308.500' })
    // Los medios sin ventas no ocupan renglones.
    expect(plan.ticket.rows.some((r) => r.label === 'Cuenta corriente')).toBe(false)
  })

  it('Dos medios y el efectivo contado: entra lo contado y la diferencia va a sobrante', () => {
    const fixture = prepare()
    const plan = ok(
      cierrePlan(
        cierre(fixture, {
          sales: [sale('Efectivo', 10_000_000), sale('Débito', 20_000_000)],
          cashCountedCents: 10_050_000,
        }),
      ),
    )
    const preview = entry('sales_close', plan.values, fixture.ctx)
    const lines = preview.preview[0]?.lines ?? []
    expect(lines.find((l) => l.role === 'treasury')?.debitCents).toBe(10_050_000)
    expect(lines.find((l) => l.role === 'cash_diff')?.creditCents).toBe(50_000)
    expect(plan.ticket.rows).toContainEqual({ label: 'Sobran en la caja', value: '$ 500' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Sin factura', value: '$ 300.000' })
  })

  it('Lo facturado sin «desde» sigue del último, y toma el canal del punto de venta', () => {
    const fixture = prepare()
    const plan = ok(
      cierrePlan(
        cierre(fixture, {
          sales: [sale('Efectivo', 12_100_000)],
          rangeDefaults: [{ voucherType: 'factura_b', pointOfSale: 4, lastNumberTo: 2_130 }],
          invoiced: [
            {
              voucherType: 'factura_b',
              pointOfSale: 4,
              from: null,
              to: 2_140,
              totalCents: 12_100_000,
              rateBp: 2100,
              channel: 'salon',
              party: null,
            },
          ],
        }),
      ),
    )
    expect(plan.values.invoiced).toEqual([
      {
        voucherType: 'factura_b',
        pointOfSale: 4,
        numberFrom: 2_131,
        numberTo: 2_140,
        channel: 'salon',
        partyId: null,
        amountMode: 'total',
        totalCents: 12_100_000,
        vatRateBp: 2100,
        aliquots: [],
        nonTaxedCents: 0,
        exemptCents: 0,
      },
    ])
    entry('sales_close', plan.values, fixture.ctx)
  })

  it('Lo que le falta a lo facturado se pregunta', () => {
    const fixture = prepare()
    const row = {
      voucherType: 'factura_b' as const,
      pointOfSale: 3,
      from: null,
      to: null,
      totalCents: 100_000,
      rateBp: null,
      channel: null,
      party: null,
    }
    const base = { sales: [sale('Efectivo', 100_000)] }
    expect(failure(cierrePlan(cierre(fixture, { ...base, invoiced: [row] })))).toContain(
      'de qué número a qué número',
    )
    expect(
      failure(
        cierrePlan(cierre(fixture, { ...base, invoiced: [{ ...row, pointOfSale: null, to: 10 }] })),
      ),
    ).toContain('de qué punto de venta')
    expect(
      failure(
        cierrePlan(
          cierre(fixture, { ...base, invoiced: [{ ...row, pointOfSale: 99, from: 1, to: 2 }] }),
        ),
      ),
    ).toContain('no está activo')
    expect(
      failure(
        cierrePlan(
          cierre(fixture, {
            ...base,
            invoiced: [{ ...row, voucherType: 'factura_a', from: 1, to: 2 }],
          }),
        ),
      ),
    ).toContain('necesita el cliente')
  })

  it('Con un solo punto de venta no pregunta cuál', () => {
    const fixture = prepare()
    const plan = ok(
      cierrePlan(
        cierre(fixture, {
          sales: [sale('Efectivo', 100_000)],
          salesPoints: [{ number: 3, label: 'Salón', defaultChannel: 'salon' }],
          invoiced: [
            {
              voucherType: 'factura_b',
              pointOfSale: null,
              from: 1,
              to: 2,
              totalCents: 100_000,
              rateBp: null,
              channel: null,
              party: null,
            },
          ],
        }),
      ),
    )
    expect((plan.values.invoiced as Array<{ pointOfSale: number }>)[0]?.pointOfSale).toBe(3)
  })

  it('Un medio que no existe o que puede ser dos: vuelve con las opciones', () => {
    const fixture = prepare()
    expect(failure(cierrePlan(cierre(fixture, { sales: [sale('Bitcoin', 100)] })))).toContain(
      'Los que hay',
    )
    expect(failure(cierrePlan(cierre(fixture, { sales: [sale('r', 100)] })))).toContain(
      'Preguntale cuál',
    )
    expect(
      failure(cierrePlan(cierre(fixture, { sales: [sale('Débito', 100), sale('débito', 100)] }))),
    ).toContain('dos veces')
    expect(failure(cierrePlan(cierre(fixture, { sales: [sale('Débito', 0)] })))).toContain(
      'cuánto se vendió',
    )
  })

  it('Cuenta corriente: lo de cada cliente, y tiene que sumar', () => {
    const fixture = prepare()
    const customer = {
      partyId: fixture.f.party('empresaX').id,
      name: 'Empresa X SA',
      cents: 5_000_000,
    }
    const plan = ok(
      cierrePlan(
        cierre(fixture, {
          sales: [{ method: 'Cuenta corriente', cents: 5_000_000, customers: [customer] }],
        }),
      ),
    )
    const methods = plan.values.methods as Array<{ salesMethodId: string; customers: unknown[] }>
    expect(
      methods.find((m) => m.salesMethodId === fixture.f.method('customerAccount').id)?.customers,
    ).toEqual([{ partyId: customer.partyId, amountCents: 5_000_000 }])
    entry('sales_close', plan.values, fixture.ctx)
    expect(
      failure(
        cierrePlan(
          cierre(fixture, { sales: [{ method: 'Cuenta corriente', cents: 5, customers: [] }] }),
        ),
      ),
    ).toContain('a qué clientes')
    expect(
      failure(
        cierrePlan(
          cierre(fixture, {
            sales: [{ method: 'Cuenta corriente', cents: 6_000_000, customers: [customer] }],
          }),
        ),
      ),
    ).toContain('suma')
  })

  it('Las fechas que la pantalla no deja cargar', () => {
    const fixture = prepare()
    const base = { sales: [sale('Efectivo', 100_000)] }
    expect(failure(cierrePlan(cierre(fixture, { ...base, date: '2026-09-30' })))).toContain(
      'arranca',
    )
    expect(failure(cierrePlan(cierre(fixture, { ...base, date: '2026-11-01' })))).toContain(
      'todavía no llegó',
    )
    expect(
      failure(
        cierrePlan(
          cierre(fixture, {
            ...base,
            limits: {
              booksStart: '2026-10-01',
              serviceDay: '2026-10-31',
              firstOpenDate: '2026-11-01',
            },
          }),
        ),
      ),
    ).toContain('está cerrado')
  })

  it('Ese día ya tiene un cierre: pide el turno, y solo entonces lo manda', () => {
    const fixture = prepare()
    const existing = [{ title: 'Cierre del día', totalCents: 1_000_000 }]
    const base = { sales: [sale('Efectivo', 100_000)] }
    expect(failure(cierrePlan(cierre(fixture, { ...base, existing })))).toContain('turno')
    const plan = ok(cierrePlan(cierre(fixture, { ...base, existing, shift: 'noche' })))
    expect(plan.values.shift).toBe('noche')
    expect(plan.ticket.subtitle).toBe('Lunes 05/10 · turno noche')
    entry('sales_close', plan.values, fixture.ctx)
    const none = ok(cierrePlan(cierre(fixture, { ...base, shift: 'noche' })))
    expect(none.values.shift).toBeNull()
  })

  it('Facturado de más: pide el motivo; con el motivo, viaja', () => {
    const fixture = prepare()
    const base = {
      sales: [sale('Efectivo', 100_000)],
      invoiced: [
        {
          voucherType: 'factura_b' as const,
          pointOfSale: 3,
          from: 1,
          to: 2,
          totalCents: 500_000,
          rateBp: null,
          channel: null,
          party: null,
        },
      ],
    }
    expect(failure(cierrePlan(cierre(fixture, base)))).toContain('motivo')
    const plan = ok(cierrePlan(cierre(fixture, { ...base, reason: 'Factura del sábado' })))
    expect(plan.values.overrideReason).toBe('Factura del sábado')
    const preview = entry('sales_close', plan.values, fixture.ctx)
    expect(preview.warnings.map((w) => w.key)).toEqual(['invoiced_exceeds_sold'])
    // Con el aviso aceptado, el motivo pasa el esquema: es lo que hace el botón del tique.
    entry('sales_close', { ...plan.values, warningsAck: ['invoiced_exceeds_sold'] }, fixture.ctx)
  })
})

// ─── «Entró plata» ───────────────────────────────────────────────────────────

const E9_DEDUCTIONS = [
  { kind: 'comision', cents: 594_000, certificate: null },
  { kind: 'iva_comision', cents: 124_740, certificate: null },
  { kind: 'ret_iibb', cents: 396_000, certificate: null },
  { kind: 'ret_ganancias', cents: 330_000, certificate: '0001-00004567' },
] as const

function cobro(
  fixture: PreparedFixture,
  key: PartyFixtureKey,
  patch: Partial<CobroDraft>,
): CobroDraft {
  const { f, ctx } = fixture
  const p = f.party(key)
  return {
    date: ctx.today,
    party: {
      id: p.id,
      name: p.tradeName ?? p.name,
      kind: p.kind,
      commissionVatMode: p.commissionVatMode,
      rates: p.rates,
    },
    items: [...ctx.openItems.values()],
    treasury: f.treasury('banco'),
    receivedCents: 0,
    reference: null,
    scope: null,
    lines: null,
    useCredits: false,
    grossCents: null,
    deductions: null,
    rest: null,
    voucher: { mode: null, type: null, pointOfSale: null, number: null },
    feesOtherAccountId: f.sys('fees_other').id,
    walletTreasuryName: null,
    ...patch,
  }
}

/** Dos facturas de un cliente, una vencida y otra no. */
function customerItems(f: CoreFixture): OpenItemRef[] {
  const base = {
    documentId: fixedUuid(930_000),
    partyId: f.party('empresaX').id,
    accountId: f.sys('receivable_customers').id,
    side: 'debit' as const,
    salesMethodId: null,
  }
  return [
    {
      ...base,
      lineId: fixedUuid(930_002),
      amountCents: 40_000_000,
      openCents: 40_000_000,
      entryDate: '2026-10-20',
      dueDate: '2026-11-19',
      label: 'Factura A 0003-00000090',
    },
    {
      ...base,
      lineId: fixedUuid(930_001),
      amountCents: 60_000_000,
      openCents: 60_000_000,
      entryDate: '2026-09-20',
      dueDate: '2026-10-20',
      label: 'Factura A 0003-00000080',
    },
  ]
}

function withItems(fixture: PreparedFixture, items: readonly OpenItemRef[]): PostingContext {
  return { ...fixture.ctx, openItems: new Map(items.map((i) => [i.lineId, i])) }
}

describe('preparar_cobro: lo que manda «Registrar un cobro»', () => {
  it('Una liquidación con sus descuentos y su número: el mismo hash que el golden', () => {
    const fixture = prepare({ openItems: ['E8.credit'] })
    const plan = ok(
      cobroPlan(
        cobro(fixture, 'posnetCredito', {
          date: '2026-10-15',
          receivedCents: 31_555_260,
          grossCents: 33_000_000,
          deductions: E9_DEDUCTIONS,
          voucher: { mode: null, type: null, pointOfSale: 0, number: 4512 },
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      grossCents: 33_000_000,
      commissionVoucher: {
        mode: 'included',
        voucherType: 'liquidacion',
        pointOfSale: 0,
        number: 4512,
      },
    })
    const preview = entry('collection', plan.values, fixture.ctx)
    expect(preview.hash).toBe(entry('collection', E9.input(fixture.r), fixture.ctx).hash)
    expect(plan.notices).toEqual([])
    expect(plan.ticket).toMatchObject({
      title: 'Entró plata',
      subtitle: 'Tarjetas de crédito (Posnet) · Liquidación de tarjeta o plataforma 0000-00004512',
      total: { label: 'Entró', value: '$ 315.552,60' },
      confirmLabel: 'Anotar el cobro',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Comisión', value: '$ 5.940' })
    expect(plan.ticket.rows.find((r) => r.label === 'Te descontaron')?.value).toContain('4,4 %')
  })

  it('Sin decir el número de una liquidación que trae la factura: lo pide u ofrece que llegue después', () => {
    const fixture = prepare({ openItems: ['E8.credit'] })
    const base = {
      date: '2026-10-15',
      receivedCents: 31_555_260,
      deductions: E9_DEDUCTIONS,
    }
    const message = failure(cobroPlan(cobro(fixture, 'posnetCredito', base)))
    expect(message).toContain('el punto de venta y el número')
    expect(message).toContain('llega_despues')
    const later = ok(
      cobroPlan(
        cobro(fixture, 'posnetCredito', {
          ...base,
          voucher: { mode: 'llega_despues', type: null, pointOfSale: null, number: null },
        }),
      ),
    )
    expect(later.values).toMatchObject({ commissionVoucher: { mode: 'later' } })
    entry('collection', later.values, fixture.ctx)
  })

  it('Sin descuentos: se estiman con sus tasas, como los precarga la hoja, y lo avisa', () => {
    const fixture = prepare({ openItems: ['E10.pya'] })
    const pya = fixture.f.party('pedidosya')
    const rates = { ...pya.rates, commissionBp: 1000 }
    const draft = cobro(fixture, 'pedidosya', {
      date: '2026-10-25',
      party: {
        id: pya.id,
        name: pya.name,
        kind: pya.kind,
        commissionVatMode: pya.commissionVatMode,
        rates,
      },
      // 1.000.000 − comisión 100.000 − IVA 21.000.
      receivedCents: 87_900_000,
    })
    const plan = ok(cobroPlan(draft))
    expect(plan.values).toMatchObject({
      grossCents: 100_000_000,
      deductions: [
        { taxKind: 'comision', amountCents: 10_000_000 },
        { taxKind: 'iva_comision', amountCents: 2_100_000 },
      ],
      commissionVoucher: { mode: 'later' },
    })
    entry('collection', plan.values, fixture.ctx)
    expect(plan.ticket.rows.some((r) => r.label === 'Comisión (estimado)')).toBe(true)
    expect(plan.notices.map((n) => n.key)).toEqual(['tex_descuentos_estimados'])
  })

  it('Lo que no cierra se pregunta, con los números; y tiene las salidas de la hoja', () => {
    const fixture = prepare({ openItems: ['E10.pya'] })
    const base = { date: '2026-10-25', receivedCents: 90_000_000 }
    const message = failure(cobroPlan(cobro(fixture, 'pedidosya', base)))
    expect(message).toContain('faltan explicar $ 100.000')
    expect(message).toContain('resto')

    const commission = ok(cobroPlan(cobro(fixture, 'pedidosya', { ...base, rest: 'comision' })))
    expect(commission.values).toMatchObject({
      deductions: [{ taxKind: 'comision', amountCents: 10_000_000 }],
    })
    entry('collection', commission.values, fixture.ctx)

    const other = ok(cobroPlan(cobro(fixture, 'pedidosya', { ...base, rest: 'otro' })))
    expect(other.values).toMatchObject({
      deductions: [{ taxKind: 'otro', accountId: fixture.f.sys('fees_other').id }],
    })
    entry('collection', other.values, fixture.ctx)

    const pending = ok(cobroPlan(cobro(fixture, 'pedidosya', { ...base, rest: 'queda_pendiente' })))
    expect(pending.values).toMatchObject({
      grossCents: 90_000_000,
      applications: [{ amountCents: 90_000_000 }],
      deductions: [],
    })
    entry('collection', pending.values, fixture.ctx)
    expect(pending.ticket.rows).toContainEqual({ label: 'Te sigue debiendo', value: '$ 100.000' })
  })

  it('Entró de más: solo puede quedar a cuenta', () => {
    const fixture = prepare({ openItems: ['E10.pya'] })
    const base = { date: '2026-10-25', receivedCents: 110_000_000 }
    expect(failure(cobroPlan(cobro(fixture, 'pedidosya', base)))).toContain('de más')
    expect(
      failure(cobroPlan(cobro(fixture, 'pedidosya', { ...base, rest: 'comision' }))),
    ).toContain('a_cuenta')
    const plan = ok(cobroPlan(cobro(fixture, 'pedidosya', { ...base, rest: 'a_cuenta' })))
    expect(plan.values).toMatchObject({
      grossCents: 110_000_000,
      applications: [{ amountCents: 100_000_000 }],
    })
    entry('collection', plan.values, fixture.ctx)
    expect(plan.ticket.rows).toContainEqual({ label: 'Queda a cuenta', value: '$ 100.000' })
  })

  it('Una tarjeta sin nada atrasado: pregunta de qué es', () => {
    const fixture = prepare({ openItems: ['E10.pya'] })
    const base = { date: '2026-10-10', receivedCents: 100_000_000 }
    const message = failure(cobroPlan(cobro(fixture, 'pedidosya', base)))
    expect(message).toContain('no hay ventas atrasadas')
    const plan = ok(cobroPlan(cobro(fixture, 'pedidosya', { ...base, scope: 'todas' })))
    expect(plan.values).toMatchObject({ grossCents: 100_000_000 })
    entry('collection', plan.values, fixture.ctx)
  })

  it('Un cliente que paga una parte: cancela lo más viejo, sin pedir explicación', () => {
    const fixture = prepare()
    const items = customerItems(fixture.f)
    const plan = ok(cobroPlan(cobro(fixture, 'empresaX', { items, receivedCents: 70_000_000 })))
    expect(plan.values).toMatchObject({
      applications: [
        { lineId: fixedUuid(930_001), amountCents: 60_000_000 },
        { lineId: fixedUuid(930_002), amountCents: 10_000_000 },
      ],
      grossCents: 70_000_000,
      deductions: [],
      commissionVoucher: { mode: 'none' },
    })
    entry('collection', plan.values, withItems(fixture, items))
    expect(plan.ticket.rows).toContainEqual({ label: 'Paga 2 ventas', value: '$ 700.000' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Te sigue debiendo', value: '$ 300.000' })
  })

  it('Un cliente que paga de más: lo que sobra queda a cuenta', () => {
    const fixture = prepare()
    const items = customerItems(fixture.f)
    const plan = ok(cobroPlan(cobro(fixture, 'empresaX', { items, receivedCents: 120_000_000 })))
    entry('collection', plan.values, withItems(fixture, items))
    expect(plan.ticket.rows).toContainEqual({ label: 'Queda a cuenta', value: '$ 200.000' })
  })

  it('Un cliente sin partidas: un anticipo, igual al golden', () => {
    const fixture = prepare()
    const plan = ok(
      cobroPlan(cobro(fixture, 'empresaX', { date: '2026-10-07', receivedCents: 50_000_000 })),
    )
    expect(plan.values).toMatchObject({ applications: [], grossCents: 50_000_000 })
    const preview = entry('collection', plan.values, fixture.ctx)
    expect(preview.hash).toBe(entry('collection', E16_ADVANCE.input(fixture.r), fixture.ctx).hash)
  })

  it('Una venta puntual, por su número', () => {
    const fixture = prepare()
    const items = customerItems(fixture.f)
    const plan = ok(
      cobroPlan(
        cobro(fixture, 'empresaX', { items, receivedCents: 40_000_000, lines: ['00000090'] }),
      ),
    )
    expect(plan.values).toMatchObject({
      applications: [{ lineId: fixedUuid(930_002), amountCents: 40_000_000 }],
    })
    entry('collection', plan.values, withItems(fixture, items))
    expect(
      failure(cobroPlan(cobro(fixture, 'empresaX', { items, receivedCents: 1, lines: ['777'] }))),
    ).toContain('Los que hay')
  })

  it('Una retención de un cliente: se suma a lo que entró', () => {
    const fixture = prepare()
    const items = customerItems(fixture.f)
    const plan = ok(
      cobroPlan(
        cobro(fixture, 'empresaX', {
          items,
          receivedCents: 59_000_000,
          deductions: [{ kind: 'ret_iibb', cents: 1_000_000, certificate: null }],
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      grossCents: 60_000_000,
      applications: [{ lineId: fixedUuid(930_001), amountCents: 60_000_000 }],
      deductions: [{ taxKind: 'ret_iibb', amountCents: 1_000_000 }],
    })
    entry('collection', plan.values, withItems(fixture, items))
  })

  it('Usar lo que tiene a favor', () => {
    const fixture = prepare()
    const items = customerItems(fixture.f)
    const credit: OpenItemRef = {
      ...(items[0] as OpenItemRef),
      lineId: fixedUuid(930_003),
      side: 'credit',
      openCents: 10_000_000,
      amountCents: 10_000_000,
      entryDate: '2026-09-01',
      dueDate: null,
      label: 'Cobro a cuenta',
    }
    const all = [...items, credit]
    const plan = ok(
      cobroPlan(
        cobro(fixture, 'empresaX', { items: all, receivedCents: 50_000_000, useCredits: true }),
      ),
    )
    expect(plan.values).toMatchObject({
      applications: [{ lineId: fixedUuid(930_001), amountCents: 60_000_000 }],
      creditsUsed: [{ lineId: credit.lineId, amountCents: 10_000_000 }],
      grossCents: 50_000_000,
    })
    entry('collection', plan.values, withItems(fixture, all))
    expect(
      failure(
        cobroPlan(
          cobro(fixture, 'empresaX', {
            items: all,
            receivedCents: 1_000,
            useCredits: true,
            scope: 'a_cuenta',
          }),
        ),
      ),
    ).toContain('a favor')
  })

  it('Mercado Pago: se puede, y avisa que es más fácil contar la caja', () => {
    const fixture = prepare({ openItems: ['E8.qr'] })
    const plan = ok(
      cobroPlan(
        cobro(fixture, 'mercadopago', {
          date: '2026-10-10',
          receivedCents: 22_000_000,
          treasury: fixture.f.treasury('mp'),
          walletTreasuryName: 'Mercado Pago SAS',
        }),
      ),
    )
    expect(plan.notices.map((n) => n.key)).toEqual(['tex_contar_billetera'])
    entry('collection', plan.values, fixture.ctx)
  })
})

// ─── Factura de venta ────────────────────────────────────────────────────────

function factura(fixture: PreparedFixture, patch: Partial<FacturaVentaDraft>): FacturaVentaDraft {
  const { f, ctx } = fixture
  const p = f.party('empresaX')
  return {
    customer: {
      id: p.id,
      name: p.tradeName ?? p.name,
      ivaCondition: p.ivaCondition,
      taxId: p.taxId,
      paymentTermDays: p.paymentTermDays,
    },
    paper: null,
    pointOfSale: null,
    number: 88,
    issueDate: '2026-10-20',
    dueDate: null,
    channel: null,
    salesPoints: [...ctx.salesPoints.values()],
    totalCents: 72_600_000,
    rateBp: null,
    nets: [],
    nonTaxedCents: null,
    exemptCents: null,
    collect: null,
    notes: null,
    ...patch,
  }
}

describe('preparar_factura_venta: lo que manda «Factura aparte»', () => {
  it('Por total: la letra del cliente, eventos y su plazo; el mismo hash que el golden', () => {
    const fixture = prepare()
    const plan = ok(facturaVentaPlan(factura(fixture, {})))
    expect(plan.values).toMatchObject({
      docKind: 'sales_invoice',
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 88,
      dueDate: null,
      channel: 'events',
      aliquots: [{ vatRateBp: 2100, netCents: 60_000_000, vatAdjustCents: 0 }],
      nonTaxedCents: 0,
      exemptCents: 0,
      collectNow: null,
    })
    const preview = entry('sales_invoice', plan.values, fixture.ctx)
    expect(preview.hash).toBe(
      entry('sales_invoice', E16_INVOICE.input(fixture.r), fixture.ctx).hash,
    )
    expect(plan.ticket).toMatchObject({
      title: 'Factura de venta',
      subtitle: 'Empresa X SA · Factura A 0003-00000088',
      total: { label: 'Total', value: '$ 726.000' },
      confirmLabel: 'Cargar la factura',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Vence', value: '19/11/2026' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Canal', value: 'Eventos' })
  })

  it('El ajuste de IVA sale de la resta: el total queda exacto, al centavo', () => {
    for (const total of [1, 99, 1_210_001, 72_600_037]) {
      const [row] = saleAliquots(total, 2100)
      if (!row) throw new Error('falta la alícuota')
      const vat = Math.round((row.netCents * 2100) / 10_000) + row.vatAdjustCents
      expect(row.netCents + vat).toBe(total)
    }
    expect(saleAliquots(50_000, 0)).toEqual([{ vatRateBp: 0, netCents: 50_000, vatAdjustCents: 0 }])
  })

  it('Un consumidor final recibe B; el número y el total se preguntan', () => {
    const fixture = prepare()
    const customer = { ...factura(fixture, {}).customer, ivaCondition: 'consumidor_final' as const }
    const plan = ok(facturaVentaPlan(factura(fixture, { customer })))
    expect(plan.values.voucherType).toBe('factura_b')
    entry('sales_invoice', plan.values, fixture.ctx)
    const message = failure(facturaVentaPlan(factura(fixture, { number: null })))
    expect(message).toContain('el número')
    expect(message).toContain('ventas.nueva_factura')
    expect(failure(facturaVentaPlan(factura(fixture, { totalCents: null })))).toContain('total')
  })

  it('Una Factura A a un cliente sin CUIT: lo pide', () => {
    const fixture = prepare()
    const customer = { ...factura(fixture, {}).customer, taxId: null }
    expect(failure(facturaVentaPlan(factura(fixture, { customer })))).toContain('CUIT')
  })

  it('El punto de venta: el que dijo, o el de eventos', () => {
    const fixture = prepare()
    const salesPoints = [
      { number: 3, label: 'Salón', defaultChannel: 'salon' as const },
      { number: 9, label: 'Eventos', defaultChannel: 'events' as const },
    ]
    const plan = ok(facturaVentaPlan(factura(fixture, { salesPoints })))
    expect(plan.values.pointOfSale).toBe(9)
    expect(failure(facturaVentaPlan(factura(fixture, { salesPoints, pointOfSale: 7 })))).toContain(
      'no está activo',
    )
    expect(failure(facturaVentaPlan(factura(fixture, { salesPoints: [] })))).toContain(
      'puntos de venta',
    )
  })

  it('Con netos, no gravado y exento: el detalle, controlado contra el total', () => {
    const fixture = prepare()
    const plan = ok(
      facturaVentaPlan(
        factura(fixture, {
          totalCents: 1_420_500,
          nets: [
            { rateBp: 2100, netCents: 1_000_000 },
            { rateBp: 1050, netCents: 100_000 },
          ],
          nonTaxedCents: 100_000,
          exemptCents: 0,
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      aliquots: [
        { vatRateBp: 2100, netCents: 1_000_000, vatAdjustCents: 0 },
        { vatRateBp: 1050, netCents: 100_000, vatAdjustCents: 0 },
      ],
      nonTaxedCents: 100_000,
    })
    entry('sales_invoice', plan.values, fixture.ctx)
    expect(plan.ticket.total?.value).toBe('$ 14.205')
    expect(
      failure(
        facturaVentaPlan(
          factura(fixture, {
            totalCents: 999,
            nets: [{ rateBp: 2100, netCents: 1_000_000 }],
          }),
        ),
      ),
    ).toContain('suma')
  })

  it('Ya cobrada: la factura y el cobro en el mismo envío', () => {
    const fixture = prepare()
    const banco = fixture.f.treasury('banco')
    const plan = ok(
      facturaVentaPlan(factura(fixture, { collect: { treasury: banco, amountCents: null } })),
    )
    expect(plan.values).toMatchObject({
      collectNow: {
        treasuryAccountId: banco.id,
        amountCents: null,
        date: '2026-10-20',
        reference: null,
      },
    })
    expect(entry('sales_invoice', plan.values, fixture.ctx).preview).toHaveLength(2)
    expect(plan.ticket.confirmLabel).toBe('Cargar factura y cobro')
    expect(plan.ticket.rows.some((r) => r.label === 'Vence')).toBe(false)
  })
})

// ─── Objetivos ───────────────────────────────────────────────────────────────

describe('preparar_objetivos', () => {
  it('Por día: viaja solo lo que dijo, y un cero saca el objetivo', () => {
    const plan = ok(
      objetivosPorDia({
        days: [
          { day: '2026-11-02', targetCents: 50_000_000, note: null },
          { day: '2026-11-03', targetCents: 0, note: null },
          { day: '2026-11-04', targetCents: undefined, note: '2x1 burger' },
        ],
        current: [{ day: '2026-11-03', targetCents: 10_000_000 }],
      }),
    )
    expect(plan.values.items).toEqual([
      { day: '2026-11-02', targetCents: 50_000_000 },
      { day: '2026-11-03', targetCents: null },
      { day: '2026-11-04', note: '2x1 burger' },
    ])
    expect(salesTargetsSchema.safeParse(plan.values).success).toBe(true)
    expect(plan.month).toBe('2026-11')
    expect(plan.ticket).toMatchObject({
      title: 'Objetivos',
      subtitle: 'Noviembre 2026',
      total: { label: 'Suman', value: '$ 500.000' },
      confirmLabel: 'Guardar los objetivos',
      entry: [],
      warnings: [],
    })
    expect(plan.ticket.rows).toContainEqual({
      label: 'mar 03/11',
      value: '$ 100.000 → Sin objetivo',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'mié 04/11', value: 'Nota: 2x1 burger' })
  })

  it('Un día dos veces lo frena el esquema', () => {
    const message = failure(
      objetivosPorDia({
        days: [
          { day: '2026-11-02', targetCents: 1, note: null },
          { day: '2026-11-02', targetCents: 2, note: null },
        ],
        current: [],
      }),
    )
    expect(message).toContain('repetido')
  })

  it('Copiar un mes: por día de la semana, sin tocar lo que ya está igual, y avisa qué pisa', () => {
    const plan = ok(
      objetivosCopiados({
        month: '2026-11',
        fromMonth: '2026-10',
        // El primer lunes de octubre es el 5; el de noviembre, el 2.
        targets: [
          { day: '2026-10-05', targetCents: 50_000_000 },
          { day: '2026-10-06', targetCents: 60_000_000 },
        ],
        current: [
          { day: '2026-11-02', targetCents: 40_000_000 },
          { day: '2026-11-03', targetCents: 60_000_000 },
        ],
      }),
    )
    expect(plan.values.items).toEqual([{ day: '2026-11-02', targetCents: 50_000_000 }])
    expect(plan.ticket.rows.find((r) => r.label === 'Ojo')?.value).toContain('1 día')
    expect(salesTargetsSchema.safeParse(plan.values).success).toBe(true)
  })

  it('Copiar sin nada de dónde, o ya igual: lo dice', () => {
    expect(
      failure(
        objetivosCopiados({ month: '2026-11', fromMonth: '2026-10', targets: [], current: [] }),
      ),
    ).toContain('no tiene objetivos')
    expect(
      failure(
        objetivosCopiados({
          month: '2026-11',
          fromMonth: '2026-10',
          targets: [{ day: '2026-10-05', targetCents: 50_000_000 }],
          current: [{ day: '2026-11-02', targetCents: 50_000_000 }],
        }),
      ),
    ).toContain('Ya estaba así')
  })

  it('Pegar una lista: un monto por renglón; lo que no se entiende se pregunta', () => {
    const plan = ok(
      objetivosDeLista({
        month: '2026-11',
        text: 'Objetivo\n500.000\n\n1.200.000,50',
        fromDay: null,
        current: [],
      }),
    )
    expect(plan.values.items).toEqual([
      { day: '2026-11-01', targetCents: 50_000_000 },
      { day: '2026-11-02', targetCents: null },
      { day: '2026-11-03', targetCents: 120_000_050 },
    ])
    expect(salesTargetsSchema.safeParse(plan.values).success).toBe(true)
    expect(
      failure(
        objetivosDeLista({ month: '2026-11', text: '100\nabc\n300', fromDay: null, current: [] }),
      ),
    ).toContain('renglón 2')
    expect(
      failure(objetivosDeLista({ month: '2026-11', text: '100\n200', fromDay: 30, current: [] })),
    ).toContain('Sobra 1 renglón')
    expect(
      failure(objetivosDeLista({ month: '2026-11', text: '', fromDay: null, current: [] })),
    ).toContain('ningún monto')
  })

  it('Con muchos días, el tique nombra los primeros y resume el resto', () => {
    const days = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-11-${String(i + 1).padStart(2, '0')}`,
      targetCents: 1_000_000,
      note: null,
    }))
    const plan = ok(objetivosPorDia({ days, current: [] }))
    expect(plan.ticket.rows).toHaveLength(8)
    expect(plan.ticket.rows.at(-1)).toEqual({ label: 'Y 3 días más', value: '$ 30.000' })
    expect(plan.ticket.total?.value).toBe('$ 100.000')
  })
})

// ─── De punta a punta, con la base simulada ──────────────────────────────────

const SLUG = 'hub'
const TENANT = '00000000-0000-4000-8000-0000000000aa'

function toolCtx(today: string): TexToolContext {
  return {
    slug: SLUG,
    tenantId: TENANT,
    tenantName: 'HUB',
    userId: '00000000-0000-4000-8000-0000000000cc',
    role: 'owner',
    features: {} as never,
    isAccountant: false,
    access: { read: true, write: true, admin: false },
    today,
  }
}

function tool(name: string) {
  const found = ventasActionTools.find((t) => t.name === name)
  if (!found) throw new Error(`Falta la herramienta ${name}`)
  return found
}

function prepared(result: Awaited<ReturnType<ReturnType<typeof tool>['run']>>): TexPrepared {
  if (result.kind !== 'prepared') {
    throw new Error(result.kind === 'error' ? result.message : 'No armó un tique')
  }
  return result.prepared
}

const rpc = vi.fn()

function wire(fixture: PreparedFixture) {
  const { f, ctx } = fixture
  const catalog = catalogOf(f, TENANT)
  vi.mocked(authorizeAccounting).mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: '00000000-0000-4000-8000-0000000000cc',
    slug: SLUG,
    access: {} as never,
  })
  vi.mocked(loadDocumentContext).mockResolvedValue({ ok: true, ctx, firstOpenDate: null })
  vi.mocked(loadFirstOpenDate).mockResolvedValue(null)
  vi.mocked(loadPostingCatalog).mockResolvedValue(catalog)
  vi.mocked(loadOpenItems).mockResolvedValue([...ctx.openItems.values()])
  vi.mocked(createClient).mockResolvedValue({ rpc } as never)
  vi.mocked(getSalesRangeDefaults).mockResolvedValue([])
  vi.mocked(listDocuments).mockResolvedValue({
    rows: [],
    nextCursor: null,
    totalRows: 0,
    truncated: false,
  } as never)
  vi.mocked(listSalesTargets).mockResolvedValue([])
  vi.mocked(listAccounts).mockResolvedValue(
    [...ctx.accounts.values()].filter((a) => a.postable) as never,
  )
  vi.mocked(listTreasuryAccounts).mockResolvedValue([...ctx.treasuries.values()] as never)
  vi.mocked(searchParties).mockImplementation(async (_tenant, params = {}) => {
    const q = (params.q ?? '').toLowerCase()
    return catalog.parties
      .filter((p) => !params.kinds || params.kinds.includes(p.kind))
      .filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({
        id: p.id,
        name: p.name,
        tradeName: p.tradeName,
        kind: p.kind,
        taxId: p.taxId,
        ivaCondition: p.ivaCondition,
        active: p.active,
        systemKey: p.systemKey,
        paymentTermDays: p.paymentTermDays,
        defaultAccountId: p.defaultAccountId,
      }))
  })
}

describe('las herramientas de ventas, de punta a punta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockReset()
    // `serviceDayInCordoba()`: el 31/10 a la tarde, como el «hoy» del contexto de prueba.
    vi.useFakeTimers({ now: new Date('2026-10-31T18:00:00.000Z'), toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Son las cuatro, para quien carga, y sus esquemas se pueden mandar a la API', () => {
    expect(ventasActionTools.map((t) => t.name)).toEqual([
      'preparar_cierre',
      'preparar_cobro',
      'preparar_factura_venta',
      'preparar_objetivos',
    ])
    for (const t of ventasActionTools) {
      expect(t.need).toBe('write')
      expect(t.mood).toBe('working')
      expect(t.description).toContain('No guarda nada')
      expect(toInputSchema(t.input).type).toBe('object')
    }
  })

  it('El cierre, por nombre de medio: del pedido al tique y del tique a la base', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    const out = prepared(
      await tool('preparar_cierre').run(
        {
          fecha: '2026-10-05',
          ventas: [
            { medio: 'efectivo', monto: 350_000 },
            { medio: 'debito', monto: 410_000 },
          ],
          efectivo_contado: 349_500,
        },
        ctx,
      ),
    )
    expect(out.executor).toBe('document')
    expect(out.ticket.title).toBe('Cierre del día')
    expect(out.ticket.total).toEqual({ label: 'Vendido', value: '$ 760.000' })
    expect(out.ticket.entry.length).toBeGreaterThan(2)

    rpc.mockResolvedValue({
      data: {
        bundle_id: 'b1',
        replayed: false,
        documents: [
          {
            ref: 'd1',
            id: '00000000-0000-4000-8000-0000000000d1',
            seq: '12',
            entry_id: 'e1',
            provisional_number: 1,
            lines: [],
          },
        ],
        allocations: [],
      },
      error: null,
    })
    // El payload se guarda como JSON hasta que la persona toca el botón.
    const stored: unknown = JSON.parse(JSON.stringify(out.payload))
    const done = await documentExecutor.run(stored, ctx)
    expect(done.ok, JSON.stringify(done)).toBe(true)
    const [fn, args] = rpc.mock.calls[0] ?? []
    expect(fn).toBe('acc_post_bundle')
    expect(args.p_bundle.preview_hash).toBe((out.payload as { previewHash: string }).previewHash)
  })

  it('Sin fecha: la noche de hoy, como abre la pantalla', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = prepared(
      await tool('preparar_cierre').run(
        { ventas: [{ medio: 'efectivo', monto: 1000 }] },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect((out.payload as { values: { date: string } }).values.date).toBe('2026-10-31')
  })

  it('Antes de las 5 de la mañana, la noche de ayer', async () => {
    vi.setSystemTime(new Date('2026-10-31T05:00:00.000Z')) // 02:00 en Córdoba.
    const fixture = prepare()
    wire(fixture)
    const out = prepared(
      await tool('preparar_cierre').run(
        { ventas: [{ medio: 'efectivo', monto: 1000 }] },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect((out.payload as { values: { date: string } }).values.date).toBe('2026-10-30')
  })

  it('Ese día ya tiene cierre: lo mira en la base y pide el turno', async () => {
    const fixture = prepare()
    wire(fixture)
    vi.mocked(listDocuments).mockResolvedValue({
      rows: [{ id: 'x', description: 'Cierre del día lunes', title: 'Cierre', totalCents: 500 }],
      nextCursor: null,
      totalRows: 1,
      truncated: false,
    } as never)
    const out = await tool('preparar_cierre').run(
      { fecha: '2026-10-05', ventas: [{ medio: 'efectivo', monto: 1000 }] },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toContain('turno')
    expect(listDocuments).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ from: '2026-10-05', to: '2026-10-05', kinds: ['sales_close'] }),
    )
  })

  it('El «desde» de lo facturado sale de los rangos de la base', async () => {
    const fixture = prepare()
    wire(fixture)
    vi.mocked(getSalesRangeDefaults).mockResolvedValue([
      { voucherType: 'factura_b', pointOfSale: 3, channel: 'salon', lastNumberTo: 100 },
    ])
    const out = prepared(
      await tool('preparar_cierre').run(
        {
          fecha: '2026-10-05',
          ventas: [{ medio: 'efectivo', monto: 1000 }],
          facturado: [{ punto_de_venta: 3, hasta: 110, total: 1000 }],
        },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(
      (out.payload as { values: { invoiced: Array<{ numberFrom: number }> } }).values.invoiced[0]
        ?.numberFrom,
    ).toBe(101)
  })

  it('El cobro: solo las cuentas «nos debe», y sin caja, el banco', async () => {
    const fixture = prepare({ openItems: ['E10.pya', 'E10.pending'] })
    wire(fixture)
    const out = prepared(
      await tool('preparar_cobro').run(
        {
          quien: 'pedidosya',
          entro: 900_000,
          fecha: '2026-10-25',
          descuentos: [{ tipo: 'comision', monto: 100_000 }],
          factura_comision: { modo: 'no_factura' },
        },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(out.ticket.title).toBe('Entró plata')
    expect(out.ticket.rows).toContainEqual({ label: 'Entra a', value: 'Banco Nación' })
    const values = (out.payload as { values: { applications: Array<{ lineId: string }> } }).values
    // «IVA a documentar» no es plata a cobrar.
    expect(values.applications.map((a) => a.lineId)).toEqual([fixture.r.item('E10.pya')])
  })

  it('El cobro a una caja que no puede recibir plata, o a alguien que no debe: lo dice', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = await tool('preparar_cobro').run(
      { quien: 'plomero', entro: 100 },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
  })

  it('La factura de venta, por el nombre del cliente', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = prepared(
      await tool('preparar_factura_venta').run(
        {
          cliente: 'empresa x',
          numero: 88,
          total: 726_000,
          fecha: '2026-10-20',
          cobrada: {},
        },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(out.ticket.subtitle).toBe('Empresa X SA · Factura A 0003-00000088')
    expect(out.ticket.rows).toContainEqual({ label: 'Cobrada en', value: 'Banco Nación' })
  })

  it('Los objetivos se guardan con `saveSalesTargets`, y llevan a ese mes', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    vi.mocked(listSalesTargets).mockImplementation(async (_tenant, range) =>
      range.from === '2026-10-01' ? [{ day: '2026-10-05', targetCents: 50_000_000 }] : [],
    )
    const out = prepared(await tool('preparar_objetivos').run({ copiar: { mes: '2026-11' } }, ctx))
    expect(out.executor).toBe('ventas.objetivos')
    expect(out.payload).toEqual({ items: [{ day: '2026-11-02', targetCents: 50_000_000 }] })
    vi.mocked(saveSalesTargets).mockResolvedValue({
      ok: true,
      data: { saved: 1, deleted: 0 },
      message: 'Listo: quedó guardado.',
    })
    const executor = ventasExecutors[out.executor]
    if (!executor) throw new Error('Falta el ejecutor')
    const done = await executor.run(out.payload, ctx)
    expect(saveSalesTargets).toHaveBeenCalledWith(SLUG, {
      items: [{ day: '2026-11-02', targetCents: 50_000_000 }],
    })
    expect(done).toMatchObject({
      ok: true,
      href: '/hub/administracion/ventas?mes=2026-11',
      undoUntil: null,
    })
  })

  it('Los objetivos: uno de los tres, ni dos ni ninguno', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    const none = await tool('preparar_objetivos').run({}, ctx)
    expect(none.kind).toBe('error')
    const both = await tool('preparar_objetivos').run(
      { copiar: { mes: '2026-11' }, dias: [{ fecha: '2026-11-02', objetivo: 1 }] },
      ctx,
    )
    expect(both.kind).toBe('error')
  })
})
