/**
 * Las herramientas de Caja de Tex: `preparar_movimiento`, `preparar_gasto_bancario` y `preparar_arqueo`.
 * Lo que se fija: que manden lo mismo que manda cada hoja (pasa su zod), que el motor arme un asiento
 * que cuadra, y que lo que no se puede deducir vuelva como una pregunta y no como un tique.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/accounting/actions/documents', () => ({ markTreasuryChecked: vi.fn() }))
vi.mock('@/lib/accounting/context', () => ({
  tryLoadPostingContext: vi.fn(),
  loadOpenItems: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('@/lib/accounting/queries/forms', () => ({ getTreasuryCheck: vi.fn() }))
vi.mock('@/lib/accounting/queries/parties', async (original) => ({
  ...(await original<typeof import('@/lib/accounting/queries/parties')>()),
  searchParties: vi.fn(),
}))
vi.mock('@/lib/accounting/queries/treasury', () => ({ listTreasuryAccounts: vi.fn() }))
vi.mock('@/lib/accounting/server/post-document', () => ({
  runPreviewDocument: vi.fn(),
  runPostDocument: vi.fn(),
}))

import { markTreasuryChecked } from '@/lib/accounting/actions/documents'
import { loadOpenItems } from '@/lib/accounting/context'
import { buildCashMovement } from '@/lib/accounting/posting'
import { getTreasuryCheck, type TreasuryCheck } from '@/lib/accounting/queries/forms'
import {
  bankExpenseSchema,
  cashMovementSchema,
  markTreasuryCheckedSchema,
  treasuryAdjustmentSchema,
  walletCheckSchema,
} from '@/lib/accounting/schemas'
import type { PostingContext, TreasuryRef } from '@/lib/accounting/types'
import {
  bankExpenseTotalCents,
  bankExpenseValues,
  bankRate,
  countDecision,
  countedBookCents,
  isCounterpartAccount,
  movementValues,
  systemBalanceText,
  treasuryAdjustmentValues,
  walletBreakdown,
  walletCheckValues,
} from '@/lib/tex/tools/actions/_caja-values'
import { cajasActionTools, cajasExecutors } from '@/lib/tex/tools/actions/cajas'
import { CLIENT_REF, E21, prepare } from './accounting-fixtures'
import {
  asError,
  asPrepared,
  documentPayload,
  entryOf,
  expectBalanced,
  expectWellFormed,
  rowValue,
  runTool,
  stubBar,
  TEX_CTX,
} from './tex-actions-kit'

const META = { clientRef: CLIENT_REF, previewHash: '0'.repeat(64) }

function setup(mutate?: (ctx: PostingContext) => PostingContext) {
  const prepared = prepare()
  const ctx = mutate ? mutate(prepared.ctx) : prepared.ctx
  stubBar(ctx)
  return { ...prepared, ctx }
}

function check(bookCents: number, patch: Partial<TreasuryCheck> = {}): TreasuryCheck {
  return {
    bookCents,
    lastAdjustmentDate: '2026-10-01',
    lastCheckedOn: '2026-10-01',
    openWalletItems: [],
    estimates: null,
    ...patch,
  }
}

function withTreasury(ctx: PostingContext, treasury: TreasuryRef): PostingContext {
  return { ...ctx, treasuries: new Map(ctx.treasuries).set(treasury.id, treasury) }
}

beforeEach(() => vi.clearAllMocks())

it('las herramientas se pueden describir para la API', () => {
  expectWellFormed(cajasActionTools, cajasExecutors)
})

describe('preparar_movimiento', () => {
  it('retiro de un socio: lo mismo que E21 y un tique que dice quién y de dónde', async () => {
    const { ctx, r, f, meta } = setup()
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_movimiento', {
        que: 'socio_saco',
        caja: 'Caja',
        quien: 'Máximo',
        monto: 100_000,
        fecha: '2026-10-15',
      }),
    )
    expect(prepared.executor).toBe('document')
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('cash_movement')
    expect(payload.values).toMatchObject({
      treasuryAccountId: r.treasury('caja'),
      direction: 'out',
      counterpartAccountId: r.account('partners_current'),
      partyId: r.party('maximo'),
      amountCents: 10_000_000,
      date: '2026-10-15',
      shortcut: 'partner_withdrawal',
      detail: null,
    })
    expectBalanced(prepared, ctx)
    // El mismo asiento del ejemplo del motor.
    const golden = buildCashMovement(E21.input(r), ctx, meta)
    expect(golden.ok && golden.hash).toBe(payload.previewHash)
    expect(prepared.ticket.title).toBe('Retiro de un socio')
    expect(rowValue(prepared.ticket, 'Quién')).toBe(f.party('maximo').name)
    expect(prepared.ticket.total).toEqual({ label: 'Salen de Caja', value: '$ 100.000' })
    expect(prepared.ticket.confirmLabel).toBe('Anotar la salida · $ 100.000')
    expect(entryOf(prepared.ticket)).toEqual([
      ['Cuentas particulares de socios · Máximo', '$ 100.000', null],
      ['Caja', null, '$ 100.000'],
    ])
  })

  it('un socio que puso plata: entra la caja y va a su cuenta particular', async () => {
    const { ctx, r } = setup()
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_movimiento', {
        que: 'socio_puso',
        caja: 'Banco Nación',
        quien: 'Máximo',
        monto: 50_000,
      }),
    )
    const { values } = documentPayload(prepared)
    expect(values).toMatchObject({
      direction: 'in',
      shortcut: 'partner_contribution',
      treasuryAccountId: r.treasury('banco'),
      date: TEX_CTX.today,
    })
    expectBalanced(prepared, ctx)
  })

  it('sin decir qué socio, pregunta; y un proveedor no es un socio', async () => {
    setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_movimiento', {
          que: 'socio_saco',
          caja: 'Caja',
          monto: 1000,
        }),
      ),
    ).toContain('qué socio')
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_movimiento', {
          que: 'socio_saco',
          caja: 'Caja',
          quien: 'Coca-Cola',
          monto: 1000,
        }),
      ),
    ).toContain('No encontré')
  })

  it('una seña va sola al partícipe de señas; sin él, no se ofrece', async () => {
    const { ctx, f } = setup((base) => {
      const parties = new Map(base.parties)
      for (const [id, party] of parties) {
        if (party.name === 'Señas de clientes') parties.set(id, { ...party, systemKey: 'senas' })
      }
      return { ...base, parties }
    })
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_movimiento', {
        que: 'sena',
        caja: 'Caja',
        monto: 20_000,
      }),
    )
    expect(documentPayload(prepared).values.partyId).toBe(f.party('senas').id)
    expectBalanced(prepared, ctx)

    setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_movimiento', {
          que: 'sena',
          caja: 'Caja',
          monto: 20_000,
        }),
      ),
    ).toContain('señas')
  })

  it('«rindió»: toma la única billetera y no acepta otra cosa', async () => {
    const { ctx, r } = setup()
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_movimiento', { que: 'rindio', monto: 350 }),
    )
    expect(documentPayload(prepared).values).toMatchObject({
      treasuryAccountId: r.treasury('mp'),
      counterpartAccountId: r.account('interest_income'),
      shortcut: 'mp_yield',
      direction: 'in',
    })
    expectBalanced(prepared, ctx)
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_movimiento', {
          que: 'rindio',
          caja: 'Caja',
          monto: 350,
        }),
      ),
    ).toContain('no es una billetera')
  })

  it('«otra salida» sin cuenta: pregunta y avisa que un gasto va por otro lado', async () => {
    setup()
    const message = asError(
      await runTool(cajasActionTools, 'preparar_movimiento', {
        que: 'otra_salida',
        caja: 'Caja',
        monto: 1000,
      }),
    )
    expect(message).toContain('¿En qué se fue?')
    expect(message).toContain('cargalo como gasto')
  })

  it('una cuenta de caja o de IVA no es contrapartida', async () => {
    const { f } = setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_movimiento', {
          que: 'otra_salida',
          caja: 'Caja',
          cuenta: f.sys('vat_credit').code,
          monto: 1000,
        }),
      ),
    ).toContain('no se puede usar')
  })

  it('la tarjeta de la empresa no es una caja con plata', async () => {
    const { f, ctx: base } = setup()
    const card: TreasuryRef = {
      ...f.treasury('banco'),
      id: '00000000-0000-4000-8000-000000000f01',
      name: 'Visa empresa',
      kind: 'credit_card',
    }
    stubBar(withTreasury(base, card))
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_movimiento', {
          que: 'socio_saco',
          caja: 'Visa empresa',
          quien: 'Máximo',
          monto: 1000,
        }),
      ),
    ).toContain('tarjeta de la empresa')
  })

  it('al salir de un banco avisa el impuesto al cheque y el motor lo suma en el mismo envío', async () => {
    const { ctx } = setup((base) => ({
      ...base,
      settings: {
        ...base.settings,
        taxSettings: {
          auto: true,
          iibbBp: 300,
          municipalBp: 70,
          bankTaxBp: 60,
          base: 'invoiced_net',
        },
      },
    }))
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_movimiento', {
        que: 'socio_saco',
        caja: 'Banco Nación',
        quien: 'Máximo',
        monto: 100_000,
      }),
    )
    expect(rowValue(prepared.ticket, 'Impuesto al cheque')).toBe('$ 600, se anota solo')
    expect(prepared.ticket.entry.length).toBeGreaterThan(2)
    expectBalanced(prepared, ctx)
  })

  it('movementValues pasa el zod del formulario y deja afuera al partícipe si la cuenta no lo pide', () => {
    const { r } = prepare()
    const values = movementValues({
      kind: 'prestamo',
      treasuryId: r.treasury('banco'),
      account: { id: r.account('bank_loans'), requiresParty: false },
      partyId: r.party('maximo'),
      cents: 500,
      date: '2026-10-31',
      note: '   ',
    })
    expect(values.partyId).toBeNull()
    expect(values.detail).toBeNull()
    expect(cashMovementSchema.safeParse({ ...values, ...META }).success).toBe(true)
  })

  it('isCounterpartAccount: imputable, activa, sin caja ni IVA', () => {
    const { f } = prepare()
    expect(isCounterpartAccount(f.sys('partners_current'))).toBe(true)
    expect(isCounterpartAccount(f.sys('vat_credit'))).toBe(false)
    expect(isCounterpartAccount(f.acc('1.1.01.01.001'))).toBe(false)
  })
})

describe('preparar_gasto_bancario', () => {
  it('depósito bancario con comisión: mover la plata y la comisión, y los dos cuadran', async () => {
    const { ctx, r } = setup()
    const deposit = asPrepared(
      await runTool(cajasActionTools, 'preparar_transferencia', {
        desde: 'Caja',
        hacia: 'Banco Nación',
        monto: 100_000,
      }),
    )
    expectBalanced(deposit, ctx)

    const fee = asPrepared(
      await runTool(cajasActionTools, 'preparar_gasto_bancario', {
        caja: 'Banco Nación',
        comisiones: 1000,
        cheque_creditos: 600,
        fecha: '2026-10-31',
      }),
    )
    expect(documentPayload(fee).form).toBe('bank_expense')
    expect(documentPayload(fee).values).toMatchObject({
      treasuryAccountId: r.treasury('banco'),
      includeInIvaBook: false,
      voucher: null,
      feesNetCents: 100_000,
      vatRateBp: 2100,
      vatAdjustCents: 0,
      ley25413CreditCents: 60_000,
    })
    expectBalanced(fee, ctx)
    // Sin comprobante el IVA va al costo: $ 1.000 + $ 210 + $ 600.
    expect(fee.ticket.total).toEqual({ label: 'Total debitado', value: '$ 1.810' })
    expect(rowValue(fee.ticket, 'Comisiones y mantenimiento')).toBe('$ 1.000')
    expect(rowValue(fee.ticket, 'IVA 21 %')).toBe('$ 210')
    expect(fee.ticket.confirmLabel).toBe('Guardar gastos del banco')
  })

  it('con el comprobante del banco, el IVA va al 21 % y al libro aunque diga otra cosa', async () => {
    const { ctx } = setup()
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_gasto_bancario', {
        caja: 'Banco Nación',
        comisiones: 1000,
        iva: '10.5',
        comprobante: { tipo: 'resumen_bancario', punto_de_venta: 1, numero: 123 },
      }),
    )
    expect(documentPayload(prepared).values).toMatchObject({
      includeInIvaBook: true,
      vatRateBp: 2100,
      voucher: { voucherType: 'resumen_bancario', pointOfSale: 1, number: 123 },
    })
    expectBalanced(prepared, ctx)
    expect(rowValue(prepared.ticket, 'IVA 21 %')).toBe('$ 210')
  })

  it('el comprobante sin comisiones o sin el CUIT del banco no se ofrece', async () => {
    setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_gasto_bancario', {
          caja: 'Banco Nación',
          intereses: 500,
          comprobante: { tipo: 'factura_a', punto_de_venta: 1, numero: 1 },
        }),
      ),
    ).toContain('no hay IVA para recuperar')

    const { ctx: base, f } = setup()
    stubBar(withTreasury(base, { ...f.treasury('banco'), bankPartyId: null }))
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_gasto_bancario', {
          caja: 'Banco Nación',
          comisiones: 500,
          comprobante: { tipo: 'factura_a', punto_de_venta: 1, numero: 1 },
        }),
      ),
    ).toContain('CUIT del banco')
  })

  it('si no coincide con el total del resumen, no arma el tique', async () => {
    setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_gasto_bancario', {
          caja: 'Banco Nación',
          comisiones: 1000,
          total_resumen: 1500,
        }),
      ),
    ).toContain('No coincide con el total del resumen')
    const ok = await runTool(cajasActionTools, 'preparar_gasto_bancario', {
      caja: 'Banco Nación',
      comisiones: 1000,
      total_resumen: 1210,
    })
    expect(ok.kind).toBe('prepared')
  })

  it('el efectivo no tiene débitos del banco; y sin importes vuelve lo que dice el formulario', async () => {
    setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_gasto_bancario', {
          caja: 'Caja',
          comisiones: 100,
        }),
      ),
    ).toContain('efectivo')
    expect(
      asError(await runTool(cajasActionTools, 'preparar_gasto_bancario', { caja: 'Banco Nación' })),
    ).toContain('Cargá al menos un importe')
  })

  it('«otro» concepto: una cuenta de imputación, con su importe', async () => {
    const { ctx, f } = setup()
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_gasto_bancario', {
        caja: 'Banco Nación',
        otros: [{ cuenta: f.sys('bank_fees').code, monto: 700 }],
      }),
    )
    expect(documentPayload(prepared).values.others).toEqual([
      { accountId: f.sys('bank_fees').id, amountCents: 70_000 },
    ])
    expectBalanced(prepared, ctx)
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_gasto_bancario', {
          caja: 'Banco Nación',
          otros: [{ cuenta: f.sys('payable_suppliers').code, monto: 700 }],
        }),
      ),
    ).toContain('no se puede usar como concepto')
  })

  it('bankExpenseValues pasa el zod del formulario y suma igual que la pantalla', () => {
    const { r } = prepare()
    const amounts = { feesNetCents: 100_000, sircrebCents: 5_000, interestCents: 1_000 }
    const values = bankExpenseValues({
      treasuryId: r.treasury('banco'),
      date: '2026-10-31',
      amounts,
      vatRateBp: 1050,
      voucher: null,
      others: [],
    })
    expect(bankExpenseSchema.safeParse({ ...values, ...META }).success).toBe(true)
    expect(bankExpenseTotalCents({ amounts, vatRateBp: 1050, others: [] })).toBe(116_500)
    expect(bankRate({ voucherType: 'factura_a', pointOfSale: 1, number: 1 }, 1050)).toBe(2100)
    expect(bankRate(null, 1050)).toBe(1050)
  })
})

describe('preparar_arqueo', () => {
  it('arqueo con faltante en la caja: el asiento de E18 y el tique lo dice en palabras', async () => {
    const { ctx, r, f } = setup()
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(45_230_000))
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', { caja: 'Caja', hay: 450_000 }),
    )
    expect(prepared.executor).toBe('document')
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('treasury_adjustment')
    expect(payload.values).toMatchObject({
      treasuryAccountId: r.treasury('caja'),
      countedCents: 45_000_000,
      expectedBookCents: 45_230_000,
      splits: [],
      date: TEX_CTX.today,
    })
    expectBalanced(prepared, ctx)
    expect(entryOf(prepared.ticket)).toEqual([
      [f.sys('cash_short').name, '$ 2.300', null],
      ['Caja', null, '$ 2.300'],
    ])
    expect(prepared.ticket.total).toEqual({ label: 'Faltan', value: '$ 2.300' })
    expect(prepared.ticket.confirmLabel).toBe('Guardar la diferencia')
    expect(prepared.ticket.warnings.map((w) => w.key)).toContain('count_note')
  })

  it('si coincide, no hay comprobante: un ejecutor propio marca la caja como contada', async () => {
    const { r } = setup()
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(45_000_000))
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Caja',
        hay: 450_000,
        fecha: '2026-10-30',
      }),
    )
    expect(prepared.executor).toBe('cajas.arqueo_coincide')
    expect(prepared.payload).toEqual({
      treasuryAccountId: r.treasury('caja'),
      countedCents: 45_000_000,
      expectedBookCents: 45_000_000,
      asOf: '2026-10-30',
    })
    expect(markTreasuryCheckedSchema.safeParse(prepared.payload).success).toBe(true)
    expect(prepared.ticket.entry).toEqual([])
    expect(prepared.ticket.warnings).toEqual([])
    expect(prepared.ticket.confirmLabel).toBe('Sí, coincide')

    vi.mocked(markTreasuryChecked).mockResolvedValue({
      ok: true,
      data: { treasuryAccountId: r.treasury('caja'), lastCheckedOn: '2026-10-30' },
      message: 'Saldo verificado: coincide con lo contado.',
    })
    const executor = cajasExecutors['cajas.arqueo_coincide']
    if (!executor) throw new Error('falta el ejecutor')
    const done = await executor.run(prepared.payload, TEX_CTX)
    expect(markTreasuryChecked).toHaveBeenCalledWith('hub', prepared.payload)
    expect(done).toMatchObject({
      ok: true,
      undoUntil: null,
      href: `/hub/administracion/cajas/${r.treasury('caja')}`,
    })
  })

  it('banco con diferencia: pregunta por qué, y los gastos del banco van por su herramienta', async () => {
    setup()
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(100_000))
    const asks = asError(
      await runTool(cajasActionTools, 'preparar_arqueo', { caja: 'Banco Nación', hay: 900 }),
    )
    expect(asks).toContain('gastos_del_banco')
    expect(asks).toContain('otra')
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_arqueo', {
          caja: 'Banco Nación',
          hay: 900,
          motivo: 'gastos_del_banco',
        }),
      ),
    ).toContain('preparar_gasto_bancario')
  })

  it('banco con plata de más por intereses: va a rendimientos; «otra», a conciliar', async () => {
    const { ctx, f } = setup()
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(100_000))
    const interest = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Banco Nación',
        hay: 1100,
        motivo: 'intereses',
      }),
    )
    expect(documentPayload(interest).values.splits).toEqual([
      {
        accountId: f.sys('interest_income').id,
        amountCents: 10_000,
        taxKind: 'rendimiento',
        partyId: null,
      },
    ])
    expectBalanced(interest, ctx)

    const other = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Banco Nación',
        hay: 1100,
        motivo: 'otra',
      }),
    )
    expect(documentPayload(other).values.splits).toEqual([])
    expectBalanced(other, ctx)
    expect(entryOf(other.ticket)[1]?.[0]).toBe(f.sys('reconciliation_differences').name)
  })

  it('la primera vez con el sistema en cero, avisa que primero van los saldos', async () => {
    setup()
    vi.mocked(getTreasuryCheck).mockResolvedValue(
      check(0, { lastAdjustmentDate: null, lastCheckedOn: null }),
    )
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', { caja: 'Caja', hay: 1000 }),
    )
    expect(prepared.ticket.warnings.map((w) => w.key)).toContain('first_count')
  })

  it('billetera sin ventas en camino: lo de más es rendimiento y va por `wallet_check`', async () => {
    const { ctx, f } = setup()
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(82_000_000))
    const prepared = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Mercado Pago SAS',
        hay: 820_500,
      }),
    )
    const payload = documentPayload(prepared)
    expect(payload.form).toBe('wallet_check')
    expect(payload.values).toMatchObject({
      items: [],
      breakdown: [],
      countedCents: 82_050_000,
      expectedBookCents: 82_000_000,
    })
    expectBalanced(prepared, ctx)
    expect(entryOf(prepared.ticket)).toContainEqual([f.sys('interest_income').name, null, '$ 500'])
  })

  it('billetera con ventas en camino: pregunta; si entraron, se acreditan con lo que se quedó', async () => {
    const prepared = prepare({ openItems: ['E8.qr'] })
    const { ctx, f } = prepared
    stubBar(ctx)
    const item = [...ctx.openItems.values()][0]
    if (!item) throw new Error('falta la partida')
    vi.mocked(getTreasuryCheck).mockResolvedValue(
      check(82_000_000, {
        openWalletItems: [
          {
            lineId: item.lineId,
            method: 'QR',
            accountingDate: item.entryDate,
            openCents: item.openCents,
          },
        ],
        estimates: { commissionCents: 1000, commissionVatCents: 210, sircupaCents: 0 },
      }),
    )
    vi.mocked(loadOpenItems).mockResolvedValue([item])

    const asks = asError(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Mercado Pago SAS',
        hay: 820_000,
      }),
    )
    expect(asks).toContain('ventas_en_camino')
    expect(asks).toContain('caja.cuenta')

    // No entró nada: es un conteo que coincide.
    const none = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Mercado Pago SAS',
        hay: 820_000,
        ventas_en_camino: 'no_entraron',
      }),
    )
    expect(none.executor).toBe('cajas.arqueo_coincide')

    // Dice que entraron, pero la plata es la misma: no se arma nada.
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_arqueo', {
          caja: 'Mercado Pago SAS',
          hay: 820_000,
          ventas_en_camino: 'entraron',
        }),
      ),
    ).toContain('no entró nada')

    // Entró la venta menos lo que se quedó: la acredita con el estimado de las tasas.
    const counted = (82_000_000 + item.openCents - 1210) / 100
    const arrived = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', {
        caja: 'Mercado Pago SAS',
        hay: counted,
        ventas_en_camino: 'entraron',
      }),
    )
    const payload = documentPayload(arrived)
    expect(payload.form).toBe('wallet_check')
    expect(payload.values.items).toEqual([{ lineId: item.lineId, amountCents: item.openCents }])
    expect(payload.values.breakdown).toEqual([
      expect.objectContaining({ taxKind: 'comision', amountCents: 1000 }),
      expect.objectContaining({ taxKind: 'iva_comision', amountCents: 210 }),
    ])
    expectBalanced(arrived, ctx)
    expect(arrived.ticket.confirmLabel).toBe('Anotar lo que entró')

    // Lo que dice el reporte manda sobre lo estimado, y no puede ser más de lo que se quedó.
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_arqueo', {
          caja: 'Mercado Pago SAS',
          hay: counted,
          ventas_en_camino: 'entraron',
          descuentos: { comision: 500 },
        }),
      ),
    ).toContain('son más de lo que se quedó')
    expect(entryOf(arrived.ticket).map((line) => line[0])).toContain(f.sys('fees_wallets').name)
  })

  it('la tarjeta de la empresa se cuenta por la deuda: Debe − Haber va en negativo', async () => {
    const { ctx: base, f } = setup()
    const card: TreasuryRef = {
      ...f.treasury('banco'),
      id: '00000000-0000-4000-8000-000000000f02',
      name: 'Visa empresa',
      kind: 'credit_card',
      bankPartyId: null,
    }
    stubBar(withTreasury(base, card))
    vi.mocked(getTreasuryCheck).mockResolvedValue(check(-50_000))
    const same = asPrepared(
      await runTool(cajasActionTools, 'preparar_arqueo', { caja: 'Visa empresa', hay: 500 }),
    )
    expect(same.executor).toBe('cajas.arqueo_coincide')
    expect(same.payload).toMatchObject({ countedCents: -50_000, expectedBookCents: -50_000 })
    expect(rowValue(same.ticket, 'El sistema dice')).toBe('Debés $ 500')
  })

  it('una fecha futura no se cuenta', async () => {
    setup()
    expect(
      asError(
        await runTool(cajasActionTools, 'preparar_arqueo', {
          caja: 'Caja',
          hay: 100,
          fecha: '2026-11-01',
        }),
      ),
    ).toContain('futura')
    expect(getTreasuryCheck).not.toHaveBeenCalled()
  })

  it('las funciones puras pasan el zod de cada formulario', () => {
    const { r, f } = prepare()
    const adjust = treasuryAdjustmentValues({
      treasuryId: r.treasury('caja'),
      date: '2026-10-31',
      countedBook: 900,
      bookCents: 1000,
      reason: 'other',
      interestAccountId: f.sys('interest_income').id,
    })
    expect(treasuryAdjustmentSchema.safeParse({ ...adjust, ...META }).success).toBe(true)

    const wallet = walletCheckValues({
      treasuryId: r.treasury('mp'),
      date: '2026-10-31',
      countedBook: 900,
      bookCents: 1000,
      items: [],
      breakdown: walletBreakdown(null, { comision: 50, otro: 25 }),
      otherFeesAccountId: f.sys('fees_other').id,
    })
    expect(walletCheckSchema.safeParse({ ...wallet, ...META }).success).toBe(true)
    expect(wallet.breakdown).toEqual([
      expect.objectContaining({ taxKind: 'comision', amountCents: 50, accountId: null }),
      expect.objectContaining({
        taxKind: 'otro',
        amountCents: 25,
        accountId: f.sys('fees_other').id,
      }),
    ])
  })

  it('countDecision elige lo mismo que la hoja', () => {
    const base = { bookCents: 1000, countedBook: 1000, ticked: 0, reason: null }
    expect(countDecision({ ...base, mode: 'cash' }).plan).toBe('check')
    expect(countDecision({ ...base, mode: 'wallet', ticked: 2 }).plan).toBe('wallet')
    expect(countDecision({ ...base, mode: 'cash', countedBook: 900 })).toMatchObject({
      plan: 'adjust',
      reason: 'other',
      diff: -100,
    })
    // En el banco hay que decir por qué.
    expect(countDecision({ ...base, mode: 'bank', countedBook: 900 })).toMatchObject({
      plan: 'adjust',
      reason: null,
    })
    expect(
      countDecision({ ...base, mode: 'bank', countedBook: 900, reason: 'bank_fees' }).plan,
    ).toBe('bank_fees')
    // «Intereses» no es una opción cuando falta plata.
    expect(
      countDecision({ ...base, mode: 'bank', countedBook: 900, reason: 'interest' }).reason,
    ).toBeNull()
    expect(countedBookCents('card', 500)).toBe(-500)
    expect(countedBookCents('cash', 500)).toBe(500)
    expect(systemBalanceText('bank', -100)).toBe('Descubierto $ 1')
    expect(systemBalanceText('card', 0)).toBe('Sin deuda')
  })
})
