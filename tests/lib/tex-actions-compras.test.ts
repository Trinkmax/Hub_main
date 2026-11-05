/**
 * Lo que Tex manda en compras: tiene que ser lo mismo que manda el formulario. Las partes puras pasan
 * por el zod del formulario y por el motor (`previewDocumentForm`), y se comparan contra los golden del
 * motor. Abajo, las herramientas de punta a punta con la base simulada: del pedido en palabras al tique
 * y del tique a `acc_post_bundle`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
}))
vi.mock('@/lib/accounting/queries/documents', () => ({ listRecurringExpenses: vi.fn() }))
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

import { authorizeAccounting } from '@/lib/accounting/access'
import { saveParty } from '@/lib/accounting/actions/master'
import { saveWeekBudgets } from '@/lib/accounting/actions/week-plan'
import { loadOpenItems, loadPostingCatalog } from '@/lib/accounting/context'
import { listAccounts } from '@/lib/accounting/queries/accounts'
import { listRecurringExpenses } from '@/lib/accounting/queries/documents'
import { findPossibleDuplicate, getFormDefaults } from '@/lib/accounting/queries/forms'
import { getParty, searchParties } from '@/lib/accounting/queries/parties'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { getWeekPlan } from '@/lib/accounting/queries/week-plan'
import { partySchema } from '@/lib/accounting/schemas'
import { loadDocumentContext, loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { DocumentForm } from '@/lib/accounting/server/document-types'
import type { PostingContext } from '@/lib/accounting/types'
import { saveWeekBudgetsSchema } from '@/lib/accounting/week-plan'
import { createClient } from '@/lib/supabase/server'
import { documentExecutor } from '@/lib/tex/document-action'
import {
  type CompraDraft,
  compraPlan,
  type DraftSupplier,
  type GastoDraft,
  gastoPlan,
  imputableAccounts,
  NO_EXTRAS,
  type PagoDraft,
  type ProveedorChanges,
  pagoPlan,
  planSemanaPlan,
  proveedorPlan,
} from '@/lib/tex/tools/actions/_compras-values'
import { comprasActionTools, comprasExecutors } from '@/lib/tex/tools/actions/compras'
import { type TexPrepared, type TexToolContext, toInputSchema } from '@/lib/tex/tools/types'
import type { CoreFixture, PartyFixtureKey } from './accounting-core-context'
import { makeCuit } from './accounting-core-context'
import {
  E1_TOTAL,
  E3,
  E3B,
  E4_QUICK,
  E7,
  E7_OVERPAY,
  E7_WITH_CREDIT,
  E7_WRITE_OFF,
  type ItemKey,
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

/** Lo que devuelve un armado que tiene que salir bien. */
function ok<T extends { ok: boolean }>(plan: T | { ok: false; message: string }): T {
  if (!plan.ok) throw new Error(`Falló: ${(plan as { message?: string }).message}`)
  return plan as T
}

function failure(plan: { ok: boolean; message?: string }): string {
  expect(plan.ok).toBe(false)
  return plan.message ?? ''
}

function fixtureOf(f: CoreFixture, key: PartyFixtureKey, memory = null): DraftSupplier {
  const p = f.party(key)
  return {
    kind: 'existing',
    facts: {
      id: p.id,
      name: p.tradeName ?? p.name,
      kind: p.kind,
      ivaCondition: p.ivaCondition,
      taxId: p.taxId,
      paymentTermDays: p.paymentTermDays,
      defaultAccountId: null,
      defaultVoucherType: null,
    },
    memory,
  }
}

function compra(f: CoreFixture, patch: Partial<CompraDraft>): CompraDraft {
  return {
    today: f.ctx.today,
    supplier: null,
    paper: null,
    pointOfSale: null,
    number: null,
    remito: null,
    issueDate: null,
    dueDate: null,
    termDays: null,
    totalCents: null,
    vatRateBp: null,
    vatCents: null,
    nets: [],
    extras: NO_EXTRAS,
    iibbJurisdictionCode: 904,
    otherTaxesAccountId: f.sys('other_taxes_expense').id,
    account: null,
    imputable: imputableAccounts(f.ctx.accounts.values()),
    pay: null,
    recurring: null,
    notes: null,
    firstOpenDate: null,
    ...patch,
  }
}

const softDrinks = (f: CoreFixture) => ({
  id: f.sys('purchases_soft_drinks').id,
  name: f.sys('purchases_soft_drinks').name,
})

describe('preparar_compra: lo que manda el formulario', () => {
  it('Factura A por total al 21 %: el mismo asiento y el mismo hash que el golden', () => {
    const { f, r, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'cocacola'),
          paper: 'factura_a',
          pointOfSale: 3,
          number: 1290,
          issueDate: '2026-10-03',
          totalCents: 86_000_000,
          account: softDrinks(f),
        }),
      ),
    )
    expect(plan.form).toBe('purchase')
    expect(plan.values).toMatchObject({
      docKind: 'purchase',
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 1290,
      // Fecha más los 21 días de su ficha, como el formulario.
      dueDate: '2026-10-24',
      amountMode: 'total',
      total: { totalCents: 86_000_000, vatRateBp: 2100, vatAdjustCents: 0 },
      payNow: null,
    })
    const preview = entry('purchase', plan.values, ctx)
    const golden = entry('purchase', E1_TOTAL.input(r), ctx)
    expect(preview.hash).toBe(golden.hash)
    expect(plan.ticket).toMatchObject({
      title: 'Compra',
      subtitle: 'Coca-Cola (distribuidor) · Factura A 0003-00001290',
      total: { label: 'Total', value: '$ 860.000' },
      confirmLabel: 'Cargar la compra',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Vence', value: '24/10/2026' })
    expect(plan.ticket.rows).toContainEqual({ label: 'Neto', value: '$ 710.743,80' })
  })

  it('Factura B de un responsable inscripto: el IVA va al costo y queda el aviso del motor', () => {
    const { f, r, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'corralon'),
          paper: 'factura_b',
          pointOfSale: 7,
          number: 3301,
          issueDate: '2026-10-08',
          totalCents: 2_420_000,
          account: { id: f.sys('maintenance').id, name: 'Mantenimiento' },
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      total: { totalCents: 2_420_000, vatRateBp: null, vatAdjustCents: 0 },
    })
    const preview = entry('purchase', plan.values, ctx)
    expect(preview.warnings.map((w) => w.key)).toEqual(['voucher_condition'])
    expect(preview.hash).toBe(entry('purchase', E3B.input(r), ctx).hash)
  })

  it('Factura C de un monotributista', () => {
    const { f, r, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'plomero'),
          paper: 'factura_c',
          pointOfSale: 2,
          number: 45,
          issueDate: '2026-10-03',
          totalCents: 4_500_000,
          account: { id: f.sys('maintenance').id, name: 'Mantenimiento' },
        }),
      ),
    )
    expect(entry('purchase', plan.values, ctx).hash).toBe(entry('purchase', E3.input(r), ctx).hash)
  })

  it('Un tique sin número se guarda igual y no entra al Libro IVA', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'tique',
          totalCents: 500_000,
          account: softDrinks(f),
        }),
      ),
    )
    expect(plan.form).toBe('purchase')
    expect(plan.values).toMatchObject({
      voucherType: 'tique',
      pointOfSale: null,
      number: null,
      total: { vatRateBp: null },
    })
    expect(plan.ticket.subtitle).toBe('Mayorista X · Tique')
    entry('purchase', plan.values, ctx)
  })

  it('Un tique con punto de venta recordado pero sin número va sin los dos', () => {
    const { f, ctx } = prepare()
    const supplier = fixtureOf(f, 'mayorista')
    if (supplier.kind !== 'existing') throw new Error('falta el proveedor')
    supplier.memory = {
      accountId: null,
      voucherType: null,
      vatRateBp: null,
      pointOfSale: 9,
      treasuryAccountId: null,
      medianTotalCents: null,
    }
    const plan = ok(
      compraPlan(
        compra(f, { supplier, paper: 'tique', totalCents: 500_000, account: softDrinks(f) }),
      ),
    )
    expect(plan.values).toMatchObject({ pointOfSale: null, number: null })
    entry('purchase', plan.values, ctx)
  })

  it('Sin comprobante y a deber: una compra con remito, sin número', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'kiosco'),
          paper: 'sin_comprobante',
          remito: '0001-00001234',
          notes: 'Hielo para el evento',
          totalCents: 1_200_000,
          account: softDrinks(f),
        }),
      ),
    )
    expect(plan.form).toBe('purchase')
    expect(plan.values).toMatchObject({
      voucherType: 'sin_comprobante',
      notes: 'Remito 0001-00001234 · Hielo para el evento',
    })
    entry('purchase', plan.values, ctx)
  })

  it('Compra y pago con factura: la compra y su pago en el mismo envío', () => {
    const { f, ctx } = prepare()
    const mp = f.treasury('mp')
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'factura_a',
          pointOfSale: 3,
          number: 4521,
          issueDate: '2026-10-03',
          totalCents: 1_210_000,
          account: { id: f.sys('cleaning').id, name: 'Limpieza' },
          pay: { treasury: mp, amountCents: null, date: null, reference: null },
        }),
      ),
    )
    expect(plan.form).toBe('purchase')
    expect(plan.values).toMatchObject({
      payNow: { treasuryAccountId: mp.id, amountCents: null, date: ctx.today, reference: null },
    })
    const preview = entry('purchase', plan.values, ctx)
    expect(preview.preview).toHaveLength(2)
    expect(plan.ticket).toMatchObject({
      title: 'Compra y pago',
      confirmLabel: 'Cargar compra y pago',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Pagada con', value: 'Mercado Pago SAS' })
    expect(plan.ticket.rows.some((r) => r.label === 'Vence')).toBe(false)
  })

  it('Compra y pago parcial: lo que falta queda debiendo', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'factura_a',
          pointOfSale: 3,
          number: 4522,
          totalCents: 1_210_000,
          account: softDrinks(f),
          pay: {
            treasury: f.treasury('caja'),
            amountCents: 500_000,
            date: null,
            reference: 'T-77',
          },
        }),
      ),
    )
    expect(plan.values).toMatchObject({ payNow: { amountCents: 500_000, reference: 'T-77' } })
    expect(plan.ticket.rows).toContainEqual({ label: 'Queda debiendo', value: '$ 7.100' })
    entry('purchase', plan.values, ctx)
  })

  it('Compra y pago sin factura con proveedor: va por el mismo camino que «Nuevo gasto»', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'kiosco'),
          paper: 'sin_comprobante',
          totalCents: 450_000,
          account: softDrinks(f),
          pay: { treasury: f.treasury('caja'), amountCents: null, date: null, reference: null },
        }),
      ),
    )
    expect(plan.form).toBe('quick_expense')
    expect(plan.values).toMatchObject({
      amountCents: 450_000,
      voucher: 'none',
      treasuryAccountId: f.treasury('caja').id,
      target: { type: 'party', partyId: f.party('kiosco').id },
    })
    entry('quick_expense', plan.values, ctx)
  })

  it('Sin proveedor y ya pagado: un gasto de contado, igual al golden', () => {
    const { f, r, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          issueDate: '2026-10-03',
          totalCents: 450_000,
          account: softDrinks(f),
          pay: { treasury: f.treasury('caja'), amountCents: null, date: null, reference: null },
        }),
      ),
    )
    expect(plan.form).toBe('quick_expense')
    expect(plan.ticket.subtitle).toBe('Remito u otro comprobante (sin factura)')
    const preview = entry('quick_expense', plan.values, ctx)
    expect(preview.hash).toBe(entry('quick_expense', E4_QUICK.input(r), ctx).hash)
  })

  it('Sin proveedor y a deber: le dice a Tex que falta o que es un gasto', () => {
    const { f } = prepare()
    const message = failure(compraPlan(compra(f, { totalCents: 450_000, account: softDrinks(f) })))
    expect(message).toContain('Falta el proveedor')
    expect(message).toContain('preparar_gasto')
  })

  it('Una factura sin proveedor: la pide', () => {
    const { f } = prepare()
    const message = failure(
      compraPlan(
        compra(f, {
          paper: 'factura_a',
          pointOfSale: 1,
          number: 1,
          totalCents: 100_000,
          account: softDrinks(f),
          pay: { treasury: f.treasury('caja'), amountCents: null, date: null, reference: null },
        }),
      ),
    )
    expect(message).toContain('necesita proveedor')
  })

  it('Proveedor nuevo con CUIT: viaja en la compra, con su cuenta y la condición de su papel', () => {
    const { f, ctx } = prepare()
    const cuit = makeCuit('20', '30111222')
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: { kind: 'new', name: 'Hielo Cristal', ivaCondition: null, taxId: cuit },
          paper: 'factura_c',
          pointOfSale: 2,
          number: 99,
          totalCents: 1_500_000,
          account: softDrinks(f),
          termDays: 15,
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      partyId: null,
      newParty: {
        name: 'Hielo Cristal',
        kind: 'supplier',
        ivaCondition: 'monotributo',
        taxId: cuit,
        paymentTermDays: 15,
        defaultAccountId: softDrinks(f).id,
      },
    })
    entry('purchase', plan.values, ctx)
    expect(plan.ticket.rows[0]?.label).toBe('Proveedor nuevo')
  })

  it('Proveedor nuevo pagado en el momento: el plazo no queda en su ficha', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: {
            kind: 'new',
            name: 'Hielo Cristal',
            ivaCondition: 'responsable_inscripto',
            taxId: makeCuit('30', '71999888'),
          },
          paper: 'factura_a',
          pointOfSale: 2,
          number: 100,
          totalCents: 1_210_000,
          termDays: 30,
          account: softDrinks(f),
          pay: { treasury: f.treasury('caja'), amountCents: null, date: null, reference: null },
        }),
      ),
    )
    expect(plan.values).toMatchObject({ newParty: { paymentTermDays: 0 } })
    entry('purchase', plan.values, ctx)
  })

  it('Proveedor nuevo con factura y sin CUIT: lo pide antes de que lo frene el Libro IVA', () => {
    const { f } = prepare()
    const message = failure(
      compraPlan(
        compra(f, {
          supplier: { kind: 'new', name: 'Hielo Cristal', ivaCondition: null, taxId: null },
          paper: 'factura_a',
          pointOfSale: 2,
          number: 99,
          totalCents: 1_500_000,
          account: softDrinks(f),
        }),
      ),
    )
    expect(message).toContain('CUIT')
    expect(message).toContain('Hielo Cristal')
  })

  it('Un proveedor sin CUIT con un papel que va al Libro IVA', () => {
    const { f } = prepare()
    const supplier = fixtureOf(f, 'plomero')
    if (supplier.kind !== 'existing') throw new Error('falta el proveedor')
    supplier.facts = { ...supplier.facts, taxId: null }
    const message = failure(
      compraPlan(
        compra(f, {
          supplier,
          paper: 'factura_c',
          pointOfSale: 2,
          number: 45,
          totalCents: 100_000,
          account: softDrinks(f),
        }),
      ),
    )
    expect(message).toContain('no tiene CUIT')
    expect(message).toContain('preparar_proveedor')
  })

  it('Un papel que no entra con cómo factura: pregunta, no lo fuerza', () => {
    const { f } = prepare()
    const base = { pointOfSale: 2, number: 45, totalCents: 100_000, account: softDrinks(f) }
    expect(
      failure(
        compraPlan(compra(f, { ...base, supplier: fixtureOf(f, 'plomero'), paper: 'factura_a' })),
      ),
    ).toContain('monotributista')
    const sinDatos = fixtureOf(f, 'plomero')
    if (sinDatos.kind !== 'existing') throw new Error('falta el proveedor')
    sinDatos.facts = { ...sinDatos.facts, ivaCondition: 'sin_datos' }
    expect(
      failure(compraPlan(compra(f, { ...base, supplier: sinDatos, paper: 'factura_a' }))),
    ).toContain('Todavía no sabemos cómo factura')
  })

  it('Sin decir el papel: el habitual de la ficha manda sobre el último cargado', () => {
    const { f, ctx } = prepare()
    const supplier = fixtureOf(f, 'mayorista')
    if (supplier.kind !== 'existing') throw new Error('falta el proveedor')
    supplier.facts = { ...supplier.facts, defaultVoucherType: 'tique' }
    supplier.memory = {
      accountId: null,
      voucherType: 'factura_a',
      vatRateBp: null,
      pointOfSale: null,
      treasuryAccountId: null,
      medianTotalCents: null,
    }
    const plan = ok(
      compraPlan(compra(f, { supplier, totalCents: 200_000, account: softDrinks(f) })),
    )
    expect(plan.voucherType).toBe('tique')
    entry('purchase', plan.values, ctx)
  })

  it('Sin decir el papel, con un responsable inscripto: Factura A, y pide el número', () => {
    const { f } = prepare()
    const message = failure(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          totalCents: 200_000,
          account: softDrinks(f),
        }),
      ),
    )
    expect(message).toContain('Factura A')
    expect(message).toContain('punto de venta')
  })

  it('La cuenta, el punto de venta y la alícuota salen de lo que recuerda el sistema', () => {
    const { f, ctx } = prepare()
    const supplier = fixtureOf(f, 'mayorista')
    if (supplier.kind !== 'existing') throw new Error('falta el proveedor')
    const cleaning = f.sys('cleaning').id
    supplier.memory = {
      accountId: cleaning,
      voucherType: 'factura_a',
      vatRateBp: 1050,
      pointOfSale: 8,
      treasuryAccountId: null,
      medianTotalCents: null,
    }
    const plan = ok(compraPlan(compra(f, { supplier, number: 321, totalCents: 1_105_000 })))
    expect(plan.values).toMatchObject({
      pointOfSale: 8,
      number: 321,
      total: { accountId: cleaning, vatRateBp: 1050 },
    })
    entry('purchase', plan.values, ctx)
    expect(plan.ticket.subtitle).toContain('0008-00000321')
  })

  it('Una cuenta de la ficha que ya no se puede imputar no se usa: pregunta en qué', () => {
    const { f } = prepare()
    const supplier = fixtureOf(f, 'plomero')
    if (supplier.kind !== 'existing') throw new Error('falta el proveedor')
    supplier.facts = { ...supplier.facts, defaultAccountId: f.sys('payable_suppliers').id }
    const message = failure(
      compraPlan(
        compra(f, {
          supplier,
          paper: 'factura_c',
          pointOfSale: 2,
          number: 45,
          totalCents: 100_000,
        }),
      ),
    )
    expect(message).toContain('en qué es')
  })

  it('Con neto e IVA: modo detalle, dos alícuotas y control contra el total', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'factura_a',
          pointOfSale: 3,
          number: 11,
          account: softDrinks(f),
          totalCents: 3_420_001,
          nets: [
            { rateBp: 2100, netCents: 1_000_000, vatCents: 210_001 },
            { rateBp: 1050, netCents: 2_000_000, vatCents: null },
          ],
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      amountMode: 'detail',
      total: null,
      controlTotalCents: 3_420_001,
      vat: [{ vatRateBp: 2100, adjustCents: 1 }],
    })
    entry('purchase', plan.values, ctx)
    expect(plan.ticket.total?.value).toBe('$ 34.200,01')
  })

  it('Con neto e IVA que no cierran contra el total: lo frena el motor, con el texto', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'factura_a',
          pointOfSale: 3,
          number: 12,
          account: softDrinks(f),
          totalCents: 999_999,
          nets: [{ rateBp: 2100, netCents: 1_000_000, vatCents: null }],
        }),
      ),
    )
    const state = previewDocumentForm('purchase', plan.values, ctx)
    expect(state.ok).toBe(false)
  })

  it('Un IVA que no es de esa alícuota: pregunta', () => {
    const { f } = prepare()
    const base = {
      supplier: fixtureOf(f, 'mayorista'),
      paper: 'factura_a' as const,
      pointOfSale: 3,
      number: 13,
      account: softDrinks(f),
    }
    expect(
      failure(
        compraPlan(
          compra(f, {
            ...base,
            nets: [{ rateBp: 2100, netCents: 1_000_000, vatCents: 105_000 }],
          }),
        ),
      ),
    ).toContain('no coincide')
    expect(
      failure(compraPlan(compra(f, { ...base, totalCents: 1_210_000, vatCents: 105_000 }))),
    ).toContain('más de una alícuota')
  })

  it('Un total con el IVA impreso a un centavo: lo respeta con el ajuste', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'factura_a',
          pointOfSale: 3,
          number: 14,
          account: softDrinks(f),
          totalCents: 1_210_000,
          vatCents: 210_001,
        }),
      ),
    )
    expect(plan.values).toMatchObject({ total: { vatAdjustCents: 1 } })
    entry('purchase', plan.values, ctx)
  })

  it('Una Factura B con neto: «no discrimina IVA», igual que el esquema', () => {
    const { f } = prepare()
    expect(
      failure(
        compraPlan(
          compra(f, {
            supplier: fixtureOf(f, 'corralon'),
            paper: 'factura_b',
            pointOfSale: 7,
            number: 1,
            account: softDrinks(f),
            nets: [{ rateBp: 2100, netCents: 100_000, vatCents: null }],
          }),
        ),
      ),
    ).toContain('no discrimina IVA')
  })

  it('Percepciones por total: el neto sale de lo que queda sin ellas', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'carniceria'),
          paper: 'factura_a',
          pointOfSale: 5,
          number: 777,
          issueDate: '2026-10-03',
          totalCents: 23_100_000,
          vatRateBp: 1050,
          account: { id: f.sys('purchases_food').id, name: 'Alimentos' },
          extras: { ...NO_EXTRAS, percIibbCents: 400_000, percIvaCents: 600_000 },
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      perceptions: [
        { taxKind: 'iva', amountCents: 600_000, jurisdictionCode: null },
        { taxKind: 'iibb', amountCents: 400_000, jurisdictionCode: 904 },
      ],
    })
    entry('purchase', plan.values, ctx)
    expect(plan.ticket.rows).toContainEqual({ label: 'Neto', value: '$ 200.000' })
  })

  it('Las fechas: vence el que dijo; con plazo, la fecha más el plazo', () => {
    const { f, ctx } = prepare()
    const base = {
      supplier: fixtureOf(f, 'mayorista'),
      paper: 'tique' as const,
      totalCents: 100_000,
      account: softDrinks(f),
      issueDate: '2026-10-10',
    }
    const fixed = ok(compraPlan(compra(f, { ...base, dueDate: '2026-10-20' })))
    expect(fixed.values).toMatchObject({ issueDate: '2026-10-10', dueDate: '2026-10-20' })
    const term = ok(compraPlan(compra(f, { ...base, termDays: 7 })))
    expect(term.values).toMatchObject({ dueDate: '2026-10-17' })
    entry('purchase', term.values, ctx)
    const none = ok(compraPlan(compra(f, { ...base })))
    expect(none.values).toMatchObject({ dueDate: '2026-10-10' })
  })

  it('Un gasto fijo: trae su cuenta, su monto y queda marcado', () => {
    const { f, ctx } = prepare()
    const recurring = {
      id: '00000000-0000-4000-8000-000000000abc',
      name: 'Alquiler',
      partyId: f.party('corralon').id,
      accountId: f.sys('maintenance').id,
      voucherType: 'factura_b',
      vatRateBp: null,
      amountCents: 2_420_000,
      treasuryAccountId: null,
    }
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'corralon'),
          pointOfSale: 7,
          number: 8,
          recurring,
        }),
      ),
    )
    expect(plan.values).toMatchObject({
      voucherType: 'factura_b',
      recurringExpenseId: recurring.id,
      total: { totalCents: 2_420_000, accountId: f.sys('maintenance').id },
    })
    entry('purchase', plan.values, ctx)
    expect(
      failure(compraPlan(compra(f, { supplier: fixtureOf(f, 'mayorista'), recurring }))),
    ).toContain('de otro proveedor')
  })

  it('Una fecha de un mes cerrado: lo avisa, como la pantalla', () => {
    const { f } = prepare()
    const plan = ok(
      compraPlan(
        compra(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'tique',
          totalCents: 100_000,
          account: softDrinks(f),
          issueDate: '2026-10-03',
          firstOpenDate: '2026-10-10',
        }),
      ),
    )
    expect(plan.notices[0]?.title).toContain('Octubre de 2026 está cerrado')
    expect(plan.notices[0]?.title).toContain('10/10/2026')
    const gastado = ok(gastoPlan(gasto(f, { firstOpenDate: '2026-10-10' })))
    expect(gastado.notices.map((n) => n.key)).toEqual(['tex_mes_cerrado'])
    expect(ok(gastoPlan(gasto(f, {}))).notices).toEqual([])
  })

  it('¿Un cero de más?: lo avisa en el tique, sin frenar', () => {
    const { f } = prepare()
    const supplier = fixtureOf(f, 'mayorista')
    if (supplier.kind !== 'existing') throw new Error('falta el proveedor')
    supplier.memory = {
      accountId: null,
      voucherType: null,
      vatRateBp: null,
      pointOfSale: null,
      treasuryAccountId: null,
      medianTotalCents: 100_000,
    }
    const plan = ok(
      compraPlan(
        compra(f, { supplier, paper: 'tique', totalCents: 5_000_000, account: softDrinks(f) }),
      ),
    )
    expect(plan.notices[0]?.title).toContain('solés gastar')
  })
})

// ─── El gasto ────────────────────────────────────────────────────────────────

function gasto(f: CoreFixture, patch: Partial<GastoDraft>): GastoDraft {
  return {
    supplier: null,
    paper: null,
    pointOfSale: null,
    number: null,
    remito: null,
    amountCents: 450_000,
    account: softDrinks(f),
    imputable: imputableAccounts(f.ctx.accounts.values()),
    treasury: f.treasury('caja'),
    date: '2026-10-03',
    detail: null,
    recurring: null,
    firstOpenDate: null,
    ...patch,
  }
}

describe('preparar_gasto: lo que manda «Nuevo gasto»', () => {
  it('Sin proveedor: el mismo asiento y el mismo hash que el golden', () => {
    const { f, r, ctx } = prepare()
    const plan = ok(gastoPlan(gasto(f, {})))
    expect(plan.values).toMatchObject({
      amountCents: 450_000,
      voucher: 'none',
      target: { type: 'account', accountId: softDrinks(f).id },
      treasuryAccountId: f.treasury('caja').id,
      date: '2026-10-03',
    })
    const preview = entry('quick_expense', plan.values, ctx)
    expect(preview.hash).toBe(entry('quick_expense', E4_QUICK.input(r), ctx).hash)
    expect(plan.ticket).toMatchObject({
      title: 'Gasto',
      total: { label: 'Salen de Caja', value: '$ 4.500' },
      confirmLabel: 'Cargar el gasto',
    })
  })

  it('El remito va adelante del detalle', () => {
    const { f, ctx } = prepare()
    const plan = ok(gastoPlan(gasto(f, { remito: '0001-55', detail: 'Hielo' })))
    expect(plan.values).toMatchObject({ detail: 'Remito 0001-55 · Hielo', pointOfSale: null })
    entry('quick_expense', plan.values, ctx)
  })

  it('Con un proveedor y sin factura: gasto con ese proveedor', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      gastoPlan(gasto(f, { supplier: fixtureOf(f, 'mayorista'), paper: 'sin_comprobante' })),
    )
    expect(plan.values).toMatchObject({
      target: { type: 'party', partyId: f.party('mayorista').id },
      voucher: 'none',
    })
    entry('quick_expense', plan.values, ctx)
  })

  it('Un tique con proveedor y número: entra al Libro IVA, con su pago', () => {
    const { f, ctx } = prepare()
    const plan = ok(
      gastoPlan(
        gasto(f, {
          supplier: fixtureOf(f, 'mayorista'),
          paper: 'tique',
          pointOfSale: 3,
          number: 77,
        }),
      ),
    )
    expect(plan.values).toMatchObject({ voucher: 'ticket', pointOfSale: 3, number: 77 })
    expect(entry('quick_expense', plan.values, ctx).preview).toHaveLength(2)
  })

  it('Un proveedor que da factura y no dijo el papel: es una compra', () => {
    const { f } = prepare()
    const message = failure(gastoPlan(gasto(f, { supplier: fixtureOf(f, 'mayorista') })))
    expect(message).toContain('preparar_compra')
    expect(message).toContain('sin_comprobante')
  })

  it('Lo que falta se pregunta', () => {
    const { f } = prepare()
    expect(failure(gastoPlan(gasto(f, { account: null })))).toContain('en qué se gastó')
    expect(failure(gastoPlan(gasto(f, { amountCents: null })))).toContain('cuánto gastó')
  })

  it('Un gasto fijo con factura y sin proveedor: no se propone la factura', () => {
    const { f, ctx } = prepare()
    const recurring = {
      id: '00000000-0000-4000-8000-000000000abf',
      name: 'Luz',
      partyId: null,
      accountId: f.sys('cleaning').id,
      voucherType: 'factura_a',
      vatRateBp: null,
      amountCents: 900_000,
      treasuryAccountId: null,
    }
    const plan = ok(gastoPlan(gasto(f, { amountCents: null, account: null, recurring })))
    expect(plan.values).toMatchObject({ voucher: 'none' })
    entry('quick_expense', plan.values, ctx)
    const withParty = failure(
      gastoPlan(
        gasto(f, {
          amountCents: null,
          account: null,
          supplier: fixtureOf(f, 'mayorista'),
          recurring,
        }),
      ),
    )
    expect(withParty).toContain('preparar_compra')
  })

  it('Un gasto fijo: su monto, su cuenta y queda marcado', () => {
    const { f, ctx } = prepare()
    const recurring = {
      id: '00000000-0000-4000-8000-000000000abd',
      name: 'Hielo de la semana',
      partyId: null,
      accountId: f.sys('cleaning').id,
      voucherType: 'sin_comprobante',
      vatRateBp: null,
      amountCents: 900_000,
      treasuryAccountId: null,
    }
    const plan = ok(gastoPlan(gasto(f, { amountCents: null, account: null, recurring })))
    expect(plan.values).toMatchObject({
      amountCents: 900_000,
      target: { type: 'account', accountId: recurring.accountId },
      recurringExpenseId: recurring.id,
    })
    entry('quick_expense', plan.values, ctx)
  })
})

// ─── El pago ─────────────────────────────────────────────────────────────────

function pago(
  fixture: { f: CoreFixture; ctx: PostingContext },
  party: PartyFixtureKey,
  patch: Partial<PagoDraft>,
): PagoDraft {
  const { f, ctx } = fixture
  const p = f.party(party)
  return {
    today: ctx.today,
    date: ctx.today,
    party: { id: p.id, name: p.tradeName ?? p.name, legalName: p.name, tradeName: p.tradeName },
    items: [...ctx.openItems.values()],
    account: null,
    accountNames: new Map([...ctx.accounts.values()].map((a) => [a.id, a.name])),
    amountCents: null,
    scope: null,
    lines: null,
    writeOff: false,
    treasury: f.treasury('banco'),
    reference: null,
    notes: null,
    recurring: null,
    taxes: ctx,
    week: null,
    ...patch,
  }
}

const open = (...items: ItemKey[]) => prepare({ openItems: items })

describe('preparar_pago: la cuenta de la hoja', () => {
  it('Un pago parcial cancela los más viejos y deja a medias el que no alcanza', () => {
    const fixture = open('E7.F3', 'E7.F1', 'E7.F2')
    const plan = ok(pagoPlan(pago(fixture, 'cocacola', { amountCents: 90_000_000 })))
    const golden = E7.input(fixture.r)
    expect(plan.values.applications).toEqual(golden.applications)
    expect(plan.values).toMatchObject({
      methods: [
        {
          type: 'treasury',
          treasuryAccountId: fixture.f.treasury('banco').id,
          amountCents: 90_000_000,
          reference: null,
        },
      ],
      creditsUsed: [],
      writeOffCents: 0,
      recurringExpenseId: null,
    })
    entry('payment', plan.values, fixture.ctx)
    expect(plan.ticket).toMatchObject({
      title: 'Pago',
      subtitle: 'Coca-Cola (distribuidor)',
      total: { label: 'Salen de Banco Nación', value: '$ 900.000' },
      confirmLabel: 'Pagar',
    })
    expect(plan.ticket.rows.find((r) => r.label === 'Cómo queda')?.value).toContain(
      'Le quedás debiendo',
    )
  })

  it('Más que lo que le debe: lo que sobra queda a cuenta', () => {
    const fixture = open('E7.F1', 'E7.F2')
    const plan = ok(pagoPlan(pago(fixture, 'cocacola', { amountCents: 100_000_000 })))
    expect(plan.values.applications).toEqual(E7_OVERPAY.input(fixture.r).applications)
    entry('payment', plan.values, fixture.ctx)
    expect(plan.ticket.rows.some((r) => r.value.includes('quedan a tu favor'))).toBe(true)
  })

  it('A cuenta: no aplica nada, aunque le deba', () => {
    const fixture = open('E7.F1')
    const plan = ok(
      pagoPlan(pago(fixture, 'cocacola', { amountCents: 10_000_000, scope: 'a_cuenta' })),
    )
    expect(plan.values).toMatchObject({ applications: [], creditsUsed: [] })
    entry('payment', plan.values, fixture.ctx)
    expect(plan.ticket.rows.find((r) => r.label === 'Cómo queda')?.value).toContain('a cuenta')
    expect(failure(pagoPlan(pago(fixture, 'cocacola', { scope: 'a_cuenta' })))).toContain('cuánto')
  })

  it('Sin nada que deba: lo que le deja queda a cuenta', () => {
    const fixture = prepare()
    const plan = ok(pagoPlan(pago(fixture, 'cocacola', { amountCents: 500_000 })))
    expect(plan.values).toMatchObject({ applications: [] })
    entry('payment', plan.values, fixture.ctx)
    expect(failure(pagoPlan(pago(fixture, 'cocacola', {})))).toContain('No le debés nada')
  })

  it('Sin monto: lo vencido y lo de esta semana, como vienen tildados en la hoja', () => {
    const fixture = open('E7.F1', 'E7.F2', 'E7.F3')
    const plan = ok(
      pagoPlan(pago(fixture, 'cocacola', { today: '2026-10-15', date: '2026-10-15' })),
    )
    // Vence dentro de 7 días: F1 (14/10) y F2 (21/10). F3 (24/10) queda para después.
    expect(plan.values.applications).toEqual([
      { lineId: fixture.r.item('E7.F1'), amountCents: 50_000_000 },
      { lineId: fixture.r.item('E7.F2'), amountCents: 38_000_000 },
    ])
    expect(plan.ticket.total?.value).toBe('$ 880.000')
  })

  it('Sin monto y sin nada que venza esta semana: pregunta', () => {
    const fixture = open('E7.F3')
    const message = failure(
      pagoPlan(pago(fixture, 'cocacola', { today: '2026-10-05', date: '2026-10-05' })),
    )
    expect(message).toContain('no se le vence nada')
  })

  it('Lo vencido, y todo', () => {
    const fixture = open('E7.F1', 'E7.F2', 'E7.F3')
    const vencido = ok(
      pagoPlan(
        pago(fixture, 'cocacola', { today: '2026-10-15', date: '2026-10-15', scope: 'lo_vencido' }),
      ),
    )
    expect(vencido.values.applications).toEqual([
      { lineId: fixture.r.item('E7.F1'), amountCents: 50_000_000 },
    ])
    const todo = ok(pagoPlan(pago(fixture, 'cocacola', { scope: 'todo' })))
    expect(todo.ticket.total?.value).toBe('$ 1.679.500')
    expect(todo.ticket.rows.find((r) => r.label === 'Cómo queda')?.value).toBe(
      'Con esto no le debés más nada.',
    )
    expect(
      failure(
        pagoPlan(
          pago(fixture, 'cocacola', {
            today: '2026-10-01',
            date: '2026-10-01',
            scope: 'lo_vencido',
          }),
        ),
      ),
    ).toContain('no tiene nada vencido')
  })

  it('Comprobantes puntuales, por su número o por el id de la partida', () => {
    const fixture = open('E7.F1', 'E7.F2', 'E7.F3')
    const byNumber = ok(pagoPlan(pago(fixture, 'cocacola', { lines: ['1234'] })))
    expect(byNumber.values.applications).toEqual([
      { lineId: fixture.r.item('E7.F2'), amountCents: 38_000_000 },
    ])
    const byId = ok(pagoPlan(pago(fixture, 'cocacola', { lines: [fixture.r.item('E7.F3')] })))
    expect(byId.ticket.total?.value).toBe('$ 799.500')
    expect(failure(pagoPlan(pago(fixture, 'cocacola', { lines: ['9999'] })))).toContain(
      'Los que hay',
    )
    expect(failure(pagoPlan(pago(fixture, 'cocacola', { lines: ['Factura A'] })))).toContain(
      'Preguntale cuál',
    )
  })

  it('El saldo a favor se usa primero, como viene tildado en la hoja', () => {
    const fixture = open('E7.F2', 'E7.NC')
    const plan = ok(pagoPlan(pago(fixture, 'cocacola', { lines: ['1234'] })))
    const golden = E7_WITH_CREDIT.input(fixture.r)
    expect(plan.values.applications).toEqual(golden.applications)
    expect(plan.values.creditsUsed).toEqual(golden.creditsUsed)
    entry('payment', plan.values, fixture.ctx)
    expect(plan.ticket.total?.value).toBe('$ 319.500')
    expect(plan.ticket.rows).toContainEqual({
      label: 'Usa lo que tenés a favor',
      value: '$ 60.500',
    })
  })

  it('Si lo que tiene a favor ya cubre lo elegido, no arma un pago en cero', () => {
    const fixture = open('E7.F1', 'E7.NC')
    const items = [...fixture.ctx.openItems.values()].map((i) =>
      i.lineId === fixture.r.item('E7.NC') ? { ...i, openCents: 90_000_000 } : i,
    )
    expect(failure(pagoPlan(pago(fixture, 'cocacola', { items, lines: ['1180'] })))).toContain(
      'ya cubre',
    )
  })

  it('Una diferencia chica se da por cancelada solo si lo dijo y hasta $ 1.000', () => {
    const fixture = open('E7.FW')
    const plan = ok(
      pagoPlan(pago(fixture, 'cocacola', { amountCents: 85_999_700, writeOff: true })),
    )
    const golden = E7_WRITE_OFF.input(fixture.r)
    expect(plan.values).toMatchObject({
      applications: golden.applications,
      writeOffCents: 300,
    })
    const preview = entry('payment', plan.values, fixture.ctx)
    expect(preview.warnings.map((w) => w.key)).toEqual(['write_off'])
    expect(
      failure(pagoPlan(pago(fixture, 'cocacola', { amountCents: 50_000_000, writeOff: true }))),
    ).toContain('hasta $ 1.000')
  })

  it('Se le debe en dos cuentas: de a una por vez, y pregunta cuál', () => {
    const fixture = open('E7.IIBB')
    const [iibb] = [...fixture.ctx.openItems.values()]
    if (!iibb) throw new Error('falta la partida')
    const other = {
      ...iibb,
      lineId: '00000000-0000-4000-8000-000000000f01',
      accountId: fixture.f.sys('vat_payable').id,
      openCents: 1_000_000,
      amountCents: 1_000_000,
      label: 'DDJJ IVA octubre',
    }
    const items = [iibb, other]
    const ctx: PostingContext = {
      ...fixture.ctx,
      openItems: new Map(items.map((i) => [i.lineId, i])),
    }
    const message = failure(pagoPlan(pago({ ...fixture, ctx }, 'rentas', { items })))
    expect(message).toContain('más de una cuenta')
    expect(message).toContain('de_cuenta')
    const plan = ok(
      pagoPlan(
        pago({ ...fixture, ctx }, 'rentas', {
          items,
          account: fixture.f.sys('vat_payable').name,
          amountCents: 1_000_000,
        }),
      ),
    )
    expect(plan.values.applications).toEqual([{ lineId: other.lineId, amountCents: 1_000_000 }])
    entry('payment', plan.values, ctx)
  })

  it('El gasto fijo que paga y lo que dice el plan de la semana', () => {
    const fixture = open('E7.IIBB')
    const recurring = { id: '00000000-0000-4000-8000-000000000abe', name: 'Ingresos Brutos' }
    const plan = ok(
      pagoPlan(
        pago(fixture, 'rentas', {
          amountCents: 380_000_000,
          treasury: fixture.f.treasury('banco'),
          recurring,
          week: { budgetCents: 400_000_000, paidCents: 0 },
          date: '2026-10-31',
        }),
      ),
    )
    expect(plan.values).toMatchObject({ recurringExpenseId: recurring.id })
    entry('payment', plan.values, fixture.ctx)
    expect(plan.ticket.rows).toContainEqual({ label: 'Gasto fijo', value: 'Ingresos Brutos' })
    expect(plan.ticket.rows.find((r) => r.label === 'Plan de la semana')?.value).toContain(
      'Presupuesto de la semana',
    )
  })
})

// ─── El proveedor ────────────────────────────────────────────────────────────

const NO_CHANGES: ProveedorChanges = {
  name: null,
  tradeName: null,
  cuit: null,
  condition: null,
  termDays: null,
  account: null,
  voucherType: null,
  email: null,
  phone: null,
  address: null,
  notes: null,
  active: null,
}

/** Un CUIT con el último número cambiado. */
const GOOD_CUIT = makeCuit('30', '71555111')
const BAD_CUIT = `${GOOD_CUIT.slice(0, 10)}${(Number(GOOD_CUIT.slice(10)) + 1) % 10}`

const EXISTING = {
  id: '00000000-0000-4000-8000-000000000123',
  updatedAt: '2026-10-01T12:00:00+00:00',
  kind: 'supplier' as const,
  name: 'Hielo Cristal SRL',
  tradeName: 'Hielo Cristal',
  taxId: null,
  ivaCondition: 'sin_datos' as const,
  paymentTermDays: 0,
  defaultAccountName: null,
  defaultVoucherType: null,
  email: null,
  phone: null,
  address: null,
  notes: null,
  active: true,
}

describe('preparar_proveedor', () => {
  it('Un alta con CUIT: lo que manda «Crear proveedor», y pasa el esquema', () => {
    const cuit = makeCuit('30', '71555111')
    const plan = ok(
      proveedorPlan({
        kind: 'supplier',
        existing: null,
        changes: {
          ...NO_CHANGES,
          name: 'Hielo Cristal',
          cuit,
          termDays: 30,
          account: { id: '00000000-0000-4000-8000-000000000999', name: 'Compras: bebidas' },
          voucherType: 'factura_a',
        },
      }),
    )
    expect(plan.values).toEqual({
      kind: 'supplier',
      name: 'Hielo Cristal',
      ivaCondition: 'responsable_inscripto',
      taxIdType: 'cuit',
      taxId: cuit,
      paymentTermDays: 30,
      defaultAccountId: '00000000-0000-4000-8000-000000000999',
      defaultVoucherType: 'factura_a',
    })
    expect(partySchema.safeParse(plan.values).success).toBe(true)
    expect(plan.ticket).toMatchObject({
      title: 'Proveedor nuevo',
      subtitle: 'Hielo Cristal',
      confirmLabel: 'Crear el proveedor',
      entry: [],
      warnings: [],
      total: null,
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Se le paga', value: 'A 30 días' })
  })

  it('Sin nombre o con un CUIT que no da: dice qué falta', () => {
    expect(
      failure(proveedorPlan({ kind: 'supplier', existing: null, changes: NO_CHANGES })),
    ).toContain('el nombre')
    expect(
      failure(
        proveedorPlan({
          kind: 'supplier',
          existing: null,
          changes: { ...NO_CHANGES, name: 'Hielo', cuit: BAD_CUIT },
        }),
      ),
    ).toContain('CUIT')
  })

  it('Una edición manda solo lo que cambia, para no pisar lo demás', () => {
    const cuit = makeCuit('30', '71555111')
    const plan = ok(
      proveedorPlan({
        kind: 'supplier',
        existing: EXISTING,
        changes: { ...NO_CHANGES, cuit, condition: 'responsable_inscripto', termDays: 21 },
      }),
    )
    expect(plan.values).toEqual({
      id: EXISTING.id,
      expectedUpdatedAt: EXISTING.updatedAt,
      kind: 'supplier',
      name: EXISTING.name,
      ivaCondition: 'responsable_inscripto',
      taxIdType: 'cuit',
      taxId: cuit,
      paymentTermDays: 21,
    })
    expect(partySchema.safeParse(plan.values).success).toBe(true)
    expect(plan.ticket).toMatchObject({
      title: 'Cambios en el proveedor',
      subtitle: 'Hielo Cristal',
      confirmLabel: 'Guardar los cambios',
    })
    expect(plan.ticket.rows).toContainEqual({
      label: 'Cómo factura',
      value: 'No se sabe → Responsable inscripto',
    })
    expect(plan.ticket.rows).toContainEqual({ label: 'Se le paga', value: 'Sin plazo → A 21 días' })
  })

  it('Una edición sin cambios: pregunta qué cambiar', () => {
    expect(
      failure(proveedorPlan({ kind: 'supplier', existing: EXISTING, changes: NO_CHANGES })),
    ).toContain('qué cambiar')
  })

  it('Un cliente nuevo arranca como consumidor final', () => {
    const plan = ok(
      proveedorPlan({
        kind: 'customer',
        existing: null,
        changes: { ...NO_CHANGES, name: 'Empresa X' },
      }),
    )
    expect(plan.values).toMatchObject({ kind: 'customer', ivaCondition: 'consumidor_final' })
    expect(plan.ticket.title).toBe('Cliente nuevo')
    expect(plan.ticket.confirmLabel).toBe('Crear el cliente')
  })
})

// ─── El plan de la semana ────────────────────────────────────────────────────

describe('preparar_plan_semana', () => {
  const A = '00000000-0000-4000-8000-00000000000a'
  const B = '00000000-0000-4000-8000-00000000000b'

  it('Manda lo mismo que las celdas de la planilla y dice cómo queda el total', () => {
    const plan = ok(
      planSemanaPlan({
        weekStart: '2026-11-02',
        items: [
          { partyId: A, name: 'Hielo Cristal', cents: 45_000_000 },
          { partyId: B, name: 'Coca-Cola', cents: 0 },
        ],
        current: [
          { partyId: B, budgetCents: 10_000_000 },
          { partyId: '00000000-0000-4000-8000-00000000000c', budgetCents: 5_000_000 },
        ],
      }),
    )
    expect(saveWeekBudgetsSchema.safeParse(plan.values).success).toBe(true)
    expect(plan.values.items).toEqual([
      { partyId: A, amountCents: 45_000_000 },
      { partyId: B, amountCents: 0 },
    ])
    expect(plan.ticket).toMatchObject({
      title: 'Plan de la semana',
      subtitle: 'Semana del 02/11 al 08/11',
      total: { label: 'Total de la semana', value: '$ 500.000' },
      confirmLabel: 'Guardar el plan',
    })
    expect(plan.ticket.rows).toContainEqual({
      label: 'Coca-Cola',
      value: '$ 100.000 → Sin presupuesto',
    })
  })

  it('Un proveedor dos veces o una lista vacía: pregunta', () => {
    expect(
      failure(
        planSemanaPlan({
          weekStart: '2026-11-02',
          items: [
            { partyId: A, name: 'Hielo', cents: 1 },
            { partyId: A, name: 'Hielo', cents: 2 },
          ],
          current: [],
        }),
      ),
    ).toContain('dos veces')
    expect(failure(planSemanaPlan({ weekStart: '2026-11-02', items: [], current: [] }))).toContain(
      'cuánto',
    )
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
  const found = comprasActionTools.find((t) => t.name === name)
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

function wire(fixture: { f: CoreFixture; ctx: PostingContext }) {
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
  vi.mocked(getFormDefaults).mockRejectedValue(new Error('sin datos'))
  vi.mocked(findPossibleDuplicate).mockResolvedValue(null)
  vi.mocked(listRecurringExpenses).mockResolvedValue([])
  vi.mocked(getWeekPlan).mockResolvedValue([])
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

describe('las herramientas de compras, de punta a punta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockReset()
  })

  it('Son las cinco, para quien carga, y sus esquemas se pueden mandar a la API', () => {
    expect(comprasActionTools.map((t) => t.name)).toEqual([
      'preparar_compra',
      'preparar_gasto',
      'preparar_pago',
      'preparar_proveedor',
      'preparar_plan_semana',
    ])
    for (const t of comprasActionTools) {
      expect(t.need).toBe('write')
      expect(t.mood).toBe('working')
      expect(t.description).toContain('No guarda nada')
      expect(toInputSchema(t.input).type).toBe('object')
    }
  })

  it('De «Coca» y un total al tique, y del tique a `acc_post_bundle` con el mismo hash', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    const out = prepared(
      await tool('preparar_compra').run(
        {
          proveedor: 'coca',
          papel: 'factura_a',
          punto_de_venta: 3,
          numero: 1290,
          fecha: '2026-10-03',
          total: 860_000,
          cuenta: 'bebidas sin alcohol',
        },
        ctx,
      ),
    )
    expect(out.executor).toBe('document')
    expect(out.ticket.title).toBe('Compra')
    expect(out.ticket.entry.length).toBeGreaterThan(2)
    expect(out.ticket.warnings).toEqual([])

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
    if (done.ok) {
      expect(done.href).toBe(
        '/hub/administracion/comprobantes/00000000-0000-4000-8000-0000000000d1',
      )
    }
  })

  it('Lo que no se carga por charla: le dice a Tex a qué pantalla llevarla', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    const cases = [
      ['nota_de_credito', 'compras.nueva'],
      ['nota_de_debito', 'compras.nueva'],
      ['ddjj', 'compras.nueva'],
      ['factura_de_comisiones', 'importar'],
    ] as const
    for (const [papel, screen] of cases) {
      const out = await tool('preparar_compra').run({ papel }, ctx)
      expect(out.kind).toBe('error')
      if (out.kind === 'error') expect(out.message).toContain(`ir_a a ${screen}`)
    }
    expect(loadPostingCatalog).not.toHaveBeenCalled()
  })

  it('Una compra a una tarjeta o una app: no es un proveedor, y dice qué hacer', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = await tool('preparar_compra').run(
      { proveedor: 'pedidosya', total: 1000, papel: 'factura_a', punto_de_venta: 1, numero: 1 },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.message).toContain('PedidosYa no es un proveedor')
      expect(out.message).toContain('importar')
    }
  })

  it('Dos proveedores que coinciden: vuelve con las opciones, sin elegir', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = await tool('preparar_compra').run(
      { proveedor: 'c', total: 100, papel: 'tique', cuenta: 'bebidas sin alcohol' },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toContain('Preguntale cuál')
  })

  it('El proveedor por su id, aunque esté más allá de los primeros de la lista', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = prepared(
      await tool('preparar_compra').run(
        {
          proveedor: fixture.f.party('plomero').id,
          papel: 'factura_c',
          punto_de_venta: 2,
          numero: 45,
          total: 45_000,
          cuenta: 'bebidas sin alcohol',
          fecha: '2026-10-03',
        },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(out.ticket.subtitle).toContain('Plomero García')
    expect(searchParties).not.toHaveBeenCalled()
  })

  it('Una cuenta que no se puede imputar: lo dice', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = await tool('preparar_compra').run(
      {
        proveedor: 'plomero',
        papel: 'factura_c',
        punto_de_venta: 2,
        numero: 45,
        total: 45_000,
        cuenta: fixture.f.sys('payable_suppliers').name,
      },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toContain('no sirve para una compra')
  })

  it('Un proveedor nuevo con el CUIT de otro: avisa que ya está', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = await tool('preparar_compra').run(
      {
        proveedor_nuevo: { nombre: 'Otro', cuit: fixture.f.party('plomero').taxId ?? '' },
        papel: 'factura_c',
        punto_de_venta: 2,
        numero: 45,
        total: 45_000,
        cuenta: 'bebidas sin alcohol',
      },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toContain('Ya está cargado')
  })

  it('¿Ya está cargada?: lo avisa en el tique, y lo que recuerda el sistema propone la caja', async () => {
    const fixture = prepare()
    wire(fixture)
    vi.mocked(getFormDefaults).mockResolvedValue({
      accountId: fixture.f.sys('cleaning').id,
      voucherType: 'factura_a',
      vatRateBp: 2100,
      pointOfSale: 3,
      lastNumber: 10,
      treasuryAccountId: fixture.f.treasury('mp').id,
      paymentTermDays: 0,
      suggestedTermDays: null,
      medianTotalCents: null,
      lastTotalCents: null,
      cuitMissing: false,
    })
    vi.mocked(findPossibleDuplicate).mockResolvedValue({
      documentId: '00000000-0000-4000-8000-0000000000d2',
      label: 'Factura A 0003-00004521',
      accountingDate: '2026-10-03',
      issueDate: '2026-10-03',
      totalCents: 1_210_000,
      partyName: 'Mayorista X',
      match: 'number',
    })
    const out = prepared(
      await tool('preparar_compra').run(
        { proveedor: 'mayorista', numero: 4521, total: 12_100, pagada: {}, fecha: '2026-10-03' },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(out.ticket.warnings.map((w) => w.key)).toEqual(['tex_posible_duplicado'])
    expect(out.ticket.rows).toContainEqual({ label: 'Pagada con', value: 'Mercado Pago SAS' })
    expect(findPossibleDuplicate).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ pointOfSale: 3, number: 4521, voucherType: 'factura_a' }),
    )
  })

  it('Un gasto fijo con el proveedor en la ficha: lo trae, y si no se puede, va sin él', async () => {
    const fixture = prepare()
    wire(fixture)
    const row = {
      id: '00000000-0000-4000-8000-000000000ac0',
      name: 'Alquiler',
      partyId: fixture.f.party('corralon').id,
      accountId: fixture.f.sys('maintenance').id,
      voucherType: 'sin_comprobante',
      vatRateBp: null,
      amountCents: 2_420_000,
      treasuryAccountId: fixture.f.treasury('banco').id,
    }
    vi.mocked(listRecurringExpenses).mockResolvedValue([row] as never)
    const ctx = toolCtx(fixture.ctx.today)
    const out = prepared(await tool('preparar_gasto').run({ gasto_fijo: 'alquiler' }, ctx))
    expect(out.ticket.subtitle).toContain('Corralón del Centro')
    expect(out.ticket.total).toEqual({ label: 'Salen de Banco Nación', value: '$ 24.200' })

    vi.mocked(listRecurringExpenses).mockResolvedValue([
      { ...row, partyId: fixture.f.party('rentas').id },
    ] as never)
    const noParty = prepared(await tool('preparar_gasto').run({ gasto_fijo: 'alquiler' }, ctx))
    expect(noParty.ticket.subtitle).not.toContain('Rentas')

    const missing = await tool('preparar_gasto').run({ gasto_fijo: 'luz', monto: 100 }, ctx)
    expect(missing.kind).toBe('error')
    if (missing.kind === 'error') expect(missing.message).toContain('No hay un gasto fijo')
  })

  it('El gasto: sin caja, la primera de efectivo', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = prepared(
      await tool('preparar_gasto').run(
        { monto: 4500, cuenta: 'bebidas sin alcohol', fecha: '2026-10-03' },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(out.ticket.total).toEqual({ label: 'Salen de Caja', value: '$ 4.500' })
    expect((out.payload as { form: string }).form).toBe('quick_expense')
  })

  it('El pago: lee sus partidas y arma el tique', async () => {
    const fixture = open('E7.F1', 'E7.F2', 'E7.F3')
    wire(fixture)
    const out = prepared(
      await tool('preparar_pago').run(
        { proveedor: 'coca', monto: 900_000, caja: 'Banco Nación' },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(loadOpenItems).toHaveBeenCalledWith(TENANT, {
      openItemsOf: [{ partyId: fixture.f.party('cocacola').id }],
    })
    expect(out.ticket.title).toBe('Pago')
    expect(out.ticket.entry.length).toBeGreaterThan(0)
    expect(out.ticket.total?.value).toBe('$ 900.000')
  })

  it('El alta de un proveedor se guarda con `saveParty`, y lleva a su ficha', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    const out = prepared(
      await tool('preparar_proveedor').run(
        { nombre: 'Hielo Cristal', cuit: makeCuit('30', '71555111'), plazo_dias: 30 },
        ctx,
      ),
    )
    expect(out.executor).toBe('compras.proveedor')
    const saved = {
      id: '00000000-0000-4000-8000-000000000444',
      kind: 'supplier',
      name: 'Hielo Cristal',
    }
    vi.mocked(saveParty).mockResolvedValue({
      ok: true,
      data: saved as never,
      message: 'Hielo Cristal quedó cargado.',
    })
    const executor = comprasExecutors[out.executor]
    if (!executor) throw new Error('Falta el ejecutor')
    const done = await executor.run(out.payload, ctx)
    expect(saveParty).toHaveBeenCalledWith(
      SLUG,
      expect.objectContaining({ kind: 'supplier', name: 'Hielo Cristal', paymentTermDays: 30 }),
    )
    expect(done).toMatchObject({
      ok: true,
      message: 'Hielo Cristal quedó cargado.',
      href: `/hub/administracion/compras/proveedores/${saved.id}`,
      undoUntil: null,
    })
  })

  it('Un alta de alguien que ya está: lo dice', async () => {
    const fixture = prepare()
    wire(fixture)
    const out = await tool('preparar_proveedor').run(
      { nombre: 'Plomero García' },
      toolCtx(fixture.ctx.today),
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toContain('Ya está cargado')
  })

  it('Un proveedor con el nombre de un cliente no choca; con su CUIT, sí', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx(fixture.ctx.today)
    prepared(await tool('preparar_proveedor').run({ nombre: 'Empresa X SA' }, ctx))
    const out = await tool('preparar_proveedor').run(
      { nombre: 'Otra', cuit: fixture.f.party('empresaX').taxId ?? '' },
      ctx,
    )
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toContain('Ya está cargado')
  })

  it('Los cambios de un proveedor leen su ficha y mandan solo lo que cambia', async () => {
    const fixture = prepare()
    wire(fixture)
    vi.mocked(getParty).mockResolvedValue({
      ...EXISTING,
      id: fixture.f.party('plomero').id,
      name: 'Plomero García',
      tradeName: null,
    } as never)
    const out = prepared(
      await tool('preparar_proveedor').run(
        { proveedor: 'plomero', plazo_dias: 7 },
        toolCtx(fixture.ctx.today),
      ),
    )
    expect(out.payload).toEqual({
      values: {
        id: fixture.f.party('plomero').id,
        expectedUpdatedAt: EXISTING.updatedAt,
        kind: 'supplier',
        name: 'Plomero García',
        paymentTermDays: 7,
      },
    })
  })

  it('El plan de la semana: el lunes de esa semana, y guarda con `saveWeekBudgets`', async () => {
    const fixture = prepare()
    wire(fixture)
    const ctx = toolCtx('2026-11-05')
    const out = prepared(
      await tool('preparar_plan_semana').run(
        { pagos: [{ proveedor: 'coca', monto: 450_000 }] },
        ctx,
      ),
    )
    expect(out.executor).toBe('compras.plan_semana')
    expect(out.payload).toEqual({
      weekStart: '2026-11-02',
      items: [{ partyId: fixture.f.party('cocacola').id, amountCents: 45_000_000 }],
    })
    vi.mocked(saveWeekBudgets).mockResolvedValue({
      ok: true,
      data: { saved: 1 },
      message: 'Listo: quedó guardado.',
    })
    const executor = comprasExecutors[out.executor]
    if (!executor) throw new Error('Falta el ejecutor')
    const done = await executor.run(out.payload, ctx)
    expect(done).toMatchObject({
      ok: true,
      href: '/hub/administracion/compras/semana?semana=2026-11-02',
    })
  })
})
