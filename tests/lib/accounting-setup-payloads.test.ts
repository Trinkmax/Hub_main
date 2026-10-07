import { describe, expect, it } from 'vitest'
import {
  bootstrapMethodsIssue,
  bootstrapPayload,
  closeWarningsFromDetails,
  ivaExpectedJson,
  monthLabel,
  parseBootstrapResult,
  parsePostBundleResult,
} from '@/lib/accounting/actions/payloads'
import { bootstrapSchemaAt, salesPointSchema } from '@/lib/accounting/schemas'

// Lo que el asistente manda (en camelCase, como el formulario) para el ejemplo
// de C.2. El CUIT es ilustrativo (dígito verificador bien armado).
const WIZARD = {
  displayName: 'Franco',
  settings: {
    legalName: 'HUB SAS',
    cuit: '30-71876543-5',
    ivaCondition: 'responsable_inscripto',
    iibbRegime: 'local',
    iibbNumber: '280123456',
    iibbJurisdictionCode: 904,
    activityStartDate: '2026-09-21',
    fiscalAddress: 'Av. Ejemplo 123, Córdoba',
    booksStartDate: '2026-10-01',
    fiscalYearEndMonth: 12,
    ivaSettlementMode: 'on_close',
  },
  treasuries: [
    { key: 'cash_main', name: 'Caja', kind: 'cash' },
    { key: 'wallet_main', name: 'Mercado Pago SAS', kind: 'wallet', alias: 'hub.sas.mp' },
    {
      key: 'bank_main',
      name: 'Banco Nación · cuenta corriente',
      kind: 'bank',
      bankName: 'Banco de la Nación Argentina',
      createBankParty: true,
    },
  ],
  sales: {
    transferDestination: 'wallet_main',
    transferDeductsIibb: true,
    enabledMethods: ['cash', 'transfer', 'qr_mp', 'debit', 'credit', 'customer_account'],
    enabledPlatforms: ['pedidosya', 'rappi'],
    rates: {
      mercado_pago: { commissionBp: 150, sircupaBp: 350 },
      posnet_debito: { commissionBp: 80 },
      posnet_credito: { commissionBp: 180, iibbWithholdingBp: 120 },
      pedidosya: { commissionBp: 2500 },
    },
    salesPoints: [
      { number: 3, label: 'Salón', defaultChannel: 'salon' },
      { number: 4, label: 'Delivery', defaultChannel: 'delivery' },
    ],
  },
}

/** Las claves que acepta `private.acc_settings_apply` (cualquier otra: invalid_payload). */
const SETTINGS_KEYS = new Set([
  'legal_name',
  'iibb_number',
  'fiscal_address',
  'cuit',
  'iva_condition',
  'iibb_regime',
  'iva_settlement_mode',
  'uninvoiced_sales_mode',
  'closed_period_void_iva_mode',
  'iibb_jurisdiction_code',
  'fiscal_year_end_month',
  'iva_due_day',
  'iibb_due_day',
  'vat_tolerance_cents',
  'bank_tax_credit_computable_bp',
  'bank_tax_debit_computable_bp',
  'due_soon_days',
  'activity_start_date',
  'books_start_date',
])

describe('bootstrapPayload (acc_bootstrap)', () => {
  it('arma exactamente el payload de C.2 / acc_seed_defaults', () => {
    const parsed = bootstrapSchemaAt('2026-10-07').safeParse(WIZARD)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const payload = bootstrapPayload(parsed.data)
    expect(payload).toEqual({
      display_name: 'Franco',
      settings: {
        legal_name: 'HUB SAS',
        cuit: '30718765435',
        iva_condition: 'responsable_inscripto',
        iibb_regime: 'local',
        iibb_number: '280123456',
        iibb_jurisdiction_code: 904,
        activity_start_date: '2026-09-21',
        fiscal_address: 'Av. Ejemplo 123, Córdoba',
        books_start_date: '2026-10-01',
        fiscal_year_end_month: 12,
        iva_settlement_mode: 'on_close',
      },
      treasuries: [
        {
          key: 'cash_main',
          name: 'Caja',
          kind: 'cash',
          alias: null,
          bank_name: null,
          cbu_cvu: null,
          create_bank_party: false,
        },
        {
          key: 'wallet_main',
          name: 'Mercado Pago SAS',
          kind: 'wallet',
          alias: 'hub.sas.mp',
          bank_name: null,
          cbu_cvu: null,
          create_bank_party: false,
        },
        {
          key: 'bank_main',
          name: 'Banco Nación · cuenta corriente',
          kind: 'bank',
          alias: null,
          bank_name: 'Banco de la Nación Argentina',
          cbu_cvu: null,
          create_bank_party: true,
        },
      ],
      sales: {
        transfer_destination: 'wallet_main',
        transfer_deducts_iibb: true,
        enabled_methods: ['cash', 'transfer', 'qr_mp', 'debit', 'credit', 'customer_account'],
        enabled_platforms: ['pedidosya', 'rappi'],
        rates: {
          mercado_pago: { commission_bp: 150, sircupa_bp: 350 },
          posnet_debito: { commission_bp: 80 },
          posnet_credito: { commission_bp: 180, iibb_withholding_bp: 120 },
          pedidosya: { commission_bp: 2500 },
        },
        sales_points: [
          { number: 3, label: 'Salón', default_channel: 'salon' },
          { number: 4, label: 'Delivery', default_channel: 'delivery' },
        ],
      },
    })
    for (const key of Object.keys(payload.settings as object)) {
      expect(SETTINGS_KEYS.has(key)).toBe(true)
    }
  })

  it('el alias con otro formato se rechaza en el formulario, no en la base', () => {
    const bad = {
      ...WIZARD,
      treasuries: [WIZARD.treasuries[0], { ...WIZARD.treasuries[1], alias: 'hub mp' }],
    }
    const parsed = bootstrapSchemaAt('2026-10-07').safeParse(bad)
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]?.path).toEqual(['treasuries', 1, 'alias'])
  })
})

describe('bootstrapMethodsIssue', () => {
  const sales = (enabledMethods: Array<'cash' | 'transfer' | 'qr_mp'>) => ({
    transferDestination: null,
    transferDeductsIibb: true,
    enabledMethods,
    enabledPlatforms: [],
    rates: {},
    salesPoints: [],
  })
  const treasury = (kind: 'cash' | 'wallet' | 'bank') => ({
    key: `${kind}_main`,
    name: kind,
    kind,
    alias: null,
    bankName: null,
    cbuCvu: null,
    createBankParty: false,
  })

  it('transferencias o QR sin adónde ir: avisa en el campo de los medios', () => {
    const noWallet = { treasuries: [treasury('cash')], sales: sales(['cash', 'transfer']) }
    expect(bootstrapMethodsIssue(noWallet)?.field).toBe('sales.enabledMethods')
    const qrWithBank = {
      treasuries: [treasury('cash'), treasury('bank')],
      sales: sales(['cash', 'qr_mp']),
    }
    expect(bootstrapMethodsIssue(qrWithBank)?.message).toMatch(/QR/)
  })

  it('con billetera o banco, nada que decir', () => {
    expect(
      bootstrapMethodsIssue({
        treasuries: [treasury('cash'), treasury('bank')],
        sales: sales(['cash', 'transfer']),
      }),
    ).toBeNull()
    expect(
      bootstrapMethodsIssue({
        treasuries: [treasury('cash'), treasury('wallet')],
        sales: sales(['cash', 'transfer', 'qr_mp']),
      }),
    ).toBeNull()
  })
})

describe('lo que devuelven las RPC', () => {
  it('acc_bootstrap', () => {
    expect(
      parseBootstrapResult({
        fiscal_year_id: 'fy',
        periods: 5,
        accounts: '167',
        parties: 17,
        sales_methods: 12,
        sales_points: 2,
        access_id: 'acc',
        treasuries: [
          { key: 'cash_main', id: 't1', account_id: 'a1', name: 'Caja', kind: 'cash' },
          { key: 'x', id: 't2', account_id: 'a2', name: 'Rara', kind: 'cofre' },
        ],
      }),
    ).toEqual({
      fiscalYearId: 'fy',
      periods: 5,
      accounts: 167,
      parties: 17,
      salesMethods: 12,
      salesPoints: 2,
      accessId: 'acc',
      treasuries: [{ key: 'cash_main', id: 't1', accountId: 'a1', name: 'Caja', kind: 'cash' }],
    })
  })

  it('acc_post_bundle (bigint como texto)', () => {
    expect(
      parsePostBundleResult({
        bundle_id: 'b1',
        replayed: true,
        documents: [
          {
            ref: 'd1',
            id: 'doc',
            seq: '124',
            entry_id: 'e1',
            provisional_number: null,
            lines: [{ line_no: 1, journal_line_id: 'l1' }],
          },
        ],
        allocations: ['al1', 3],
      }),
    ).toEqual({
      bundle_id: 'b1',
      replayed: true,
      documents: [
        {
          ref: 'd1',
          id: 'doc',
          seq: 124,
          entry_id: 'e1',
          provisional_number: null,
          lines: [{ line_no: 1, journal_line_id: 'l1' }],
        },
      ],
      allocations: ['al1'],
    })
  })
})

describe('cierres', () => {
  it('avisos del cierre: con o sin envoltorio, sin repetir y con su texto', () => {
    const items = closeWarningsFromDetails(
      JSON.stringify({
        warnings: [
          'missing_daily_closes',
          { key: 'treasury_negative', treasury_name: 'Caja' },
          'missing_daily_closes',
          'algo_nuevo',
        ],
      }),
    )
    expect(items.map((w) => w.key)).toEqual(['missing_daily_closes', 'treasury_negative'])
    expect(items[0]?.message).toBe('Faltan cierres del día en el mes.')
    expect(closeWarningsFromDetails('["sas_cuit_missing"]').map((w) => w.key)).toEqual([
      'sas_cuit_missing',
    ])
    expect(closeWarningsFromDetails('no es json')).toEqual([])
    expect(closeWarningsFromDetails(null)).toEqual([])
  })

  it('las cifras del IVA que vio la persona, en centavos y snake_case', () => {
    expect(
      ivaExpectedJson({
        debitCents: 131_040_000,
        creditCents: 41_000_000,
        perceptionsCents: 600_000,
        withholdingsCents: 300_000,
        toPayCents: 89_140_000,
        technicalBalanceNewCents: 0,
        freeBalanceNewCents: 0,
      }),
    ).toEqual({
      debit_cents: 131_040_000,
      credit_cents: 41_000_000,
      perceptions_cents: 600_000,
      withholdings_cents: 300_000,
      to_pay_cents: 89_140_000,
      technical_balance_new_cents: 0,
      free_balance_new_cents: 0,
    })
  })

  it('nombre del mes', () => {
    expect(monthLabel('2026-10-01')).toBe('Octubre')
    expect(monthLabel('2026-01-01')).toBe('Enero')
    expect(monthLabel('raro')).toBe('El mes')
  })
})

describe('salesPointSchema', () => {
  it('lleva el token de concurrencia de la edición (vacío en un alta)', () => {
    const create = salesPointSchema.safeParse({
      number: '3',
      label: 'Salón',
      defaultChannel: 'salon',
    })
    expect(create.success && create.data.expectedUpdatedAt).toBeNull()
    const edit = salesPointSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-10-07T09:15:42.123456+00:00',
      number: 3,
      label: 'Salón',
      defaultChannel: 'salon',
    })
    expect(edit.success && edit.data.expectedUpdatedAt).toBe('2026-10-07T09:15:42.123456+00:00')
  })
})
