import { describe, expect, it } from 'vitest'
import { STANDARD_CHART } from '@/lib/accounting/chart'
import {
  AccountingContextError,
  buildPostingContext,
  documentLabel,
  missingSystemKeys,
  openAmounts,
  parsePostingCatalog,
  parseSettingsRow,
  type RawDocument,
  type RawJournalLine,
  toOpenItems,
} from '@/lib/accounting/context'
import { buildOpening } from '@/lib/accounting/posting'
import { SYSTEM_ACCOUNT_KEYS } from '@/lib/accounting/system-keys'
import { fixedUuid } from './accounting-core-context'

// La forma de `acc_posting_context` (migración #8): `to_jsonb` de cada fila, en
// snake_case, con los bigint como número o como texto.
const TENANT = fixedUuid(9000)
const TS = '2026-10-07T09:15:42.123456+00:00'

function rawCatalog() {
  let n = 0
  const id = () => fixedUuid(++n)
  const accounts: Array<Record<string, unknown>> = STANDARD_CHART.map((a) => ({
    id: id(),
    code: a.code,
    name: a.name,
    type: a.type,
    normal_side: a.normalSide,
    parent_id: null,
    level: a.code.split('.').length,
    postable: a.postable,
    active: true,
    requires_party: a.requiresParty,
    is_treasury: false,
    purchase_selectable: a.purchaseSelectable,
    manual_selectable: true,
    system_key: a.systemKey,
    description: a.description,
    sort: 0,
  }))
  const cashAccount = {
    id: id(),
    code: '1.1.01.01',
    name: 'Caja',
    type: 'asset',
    normal_side: 'debit',
    parent_id: null,
    level: 4,
    postable: true,
    active: true,
    requires_party: false,
    is_treasury: true,
    purchase_selectable: false,
    manual_selectable: true,
    system_key: null,
    description: null,
    sort: 0,
  }
  accounts.push(cashAccount)
  const sysId = (key: string) => String(accounts.find((a) => a.system_key === key)?.id)
  const treasuryId = id()
  const supplierId = id()
  return {
    raw: {
      tenant_id: TENANT,
      today: '2026-10-07',
      settings: {
        tenant_id: TENANT,
        legal_name: 'HUB SAS',
        cuit: '30718765435',
        iva_condition: 'responsable_inscripto',
        iibb_regime: 'local',
        iibb_number: null,
        iibb_jurisdiction_code: 904,
        activity_start_date: '2026-09-21',
        fiscal_address: null,
        books_start_date: '2026-10-01',
        fiscal_year_end_month: 12,
        iva_settlement_mode: 'on_close',
        iva_due_day: 20,
        iibb_due_day: 15,
        vat_tolerance_cents: 1,
        bank_tax_credit_computable_bp: 3300,
        bank_tax_debit_computable_bp: 3300,
        uninvoiced_sales_mode: 'separate_accounts',
        closed_period_void_iva_mode: 'adjustment_only',
        due_soon_days: 7,
        opening_status: 'pending',
        doc_seq: 0,
        setup_completed_at: TS,
        created_by: null,
        updated_by: null,
        created_at: TS,
        updated_at: TS,
      },
      accounts,
      parties: [
        {
          id: supplierId,
          kind: 'supplier',
          name: 'Coca-Cola (distribuidor)',
          trade_name: null,
          tax_id_type: 'cuit',
          tax_id: '30718765435',
          iva_condition: 'responsable_inscripto',
          payment_term_days: 21,
          default_account_id: null,
          default_voucher_type: 'factura_a',
          payable_account_id: sysId('payable_suppliers'),
          receivable_account_id: sysId('receivable_customers'),
          commission_vat_mode: 'none',
          commission_bp: null,
          iibb_withholding_bp: null,
          vat_withholding_bp: null,
          income_tax_withholding_bp: null,
          sircupa_bp: null,
          active: true,
          system_key: null,
          updated_at: TS,
        },
      ],
      treasuries: [
        {
          id: treasuryId,
          tenant_id: TENANT,
          account_id: cashAccount.id,
          name: 'Caja',
          kind: 'cash',
          bank_party_id: null,
          bank_name: null,
          cbu_cvu: null,
          alias: null,
          account_number: null,
          allow_negative: false,
          last_checked_on: null,
          last_checked_by: null,
          sort: 1,
          active: true,
          system_key: null,
          created_by: null,
          updated_by: null,
          created_at: TS,
          updated_at: TS,
          account_code: '1.1.01.01',
          balance_cents: '1500000',
        },
      ],
      methods: [
        {
          id: id(),
          tenant_id: TENANT,
          name: 'Efectivo',
          kind: 'treasury',
          channel: 'salon',
          treasury_account_id: treasuryId,
          party_id: null,
          settlement_days: 0,
          sort: 10,
          active: true,
          system_key: 'cash',
          created_at: TS,
          updated_at: TS,
        },
      ],
      sales_points: [
        {
          id: id(),
          tenant_id: TENANT,
          number: 3,
          label: 'Salón',
          default_channel: 'salon',
          active: true,
          created_at: TS,
          updated_at: TS,
        },
      ],
    },
    ids: { cashAccount: cashAccount.id, treasuryId, supplierId, sysId },
  }
}

describe('parsePostingCatalog', () => {
  it('lee acc_posting_context completo (bigint como texto incluido)', () => {
    const { raw, ids } = rawCatalog()
    const catalog = parsePostingCatalog(raw)
    expect(catalog).not.toBeNull()
    if (!catalog) return
    expect(catalog.tenantId).toBe(TENANT)
    expect(catalog.today).toBe('2026-10-07')
    expect(catalog.accounts).toHaveLength(STANDARD_CHART.length + 1)
    expect(catalog.settings).toMatchObject({
      legalName: 'HUB SAS',
      booksStartDate: '2026-10-01',
      vatToleranceCents: 1,
      openingStatus: 'pending',
      updatedAt: TS,
    })
    expect(catalog.treasuries[0]).toMatchObject({
      id: ids.treasuryId,
      accountId: ids.cashAccount,
      accountCode: '1.1.01.01',
      balanceCents: 1_500_000,
      kind: 'cash',
    })
    expect(catalog.parties[0]).toMatchObject({
      paymentTermDays: 21,
      defaultVoucherType: 'factura_a',
      rates: { commissionBp: null, sircupaBp: null },
    })
    expect(catalog.methods[0]).toMatchObject({ kind: 'treasury', active: true, sort: 10 })
    expect(catalog.salesPoints[0]).toMatchObject({ number: 3, label: 'Salón' })
  })

  it('sin acc_settings (sin configurar) o con otra forma, null', () => {
    const { raw } = rawCatalog()
    expect(parsePostingCatalog({ ...raw, settings: null })).toBeNull()
    expect(parsePostingCatalog(null)).toBeNull()
    expect(parsePostingCatalog([])).toBeNull()
    expect(parseSettingsRow({ legal_name: 'X' })).toBeNull()
  })
})

describe('buildPostingContext', () => {
  it('arma el contexto del motor con todas las cuentas de sistema', () => {
    const { raw, ids } = rawCatalog()
    const catalog = parsePostingCatalog(raw)
    if (!catalog) throw new Error('catálogo')
    const ctx = buildPostingContext(catalog)
    for (const key of SYSTEM_ACCOUNT_KEYS) expect(ctx.sys[key]?.systemKey).toBe(key)
    expect(ctx.sys.payable_suppliers.id).toBe(ids.sysId('payable_suppliers'))
    expect(ctx.treasuries.get(ids.treasuryId)?.balanceCents).toBe(1_500_000)
    expect(ctx.salesPoints.get(3)?.label).toBe('Salón')
    expect(ctx.settings).toEqual({
      ivaCondition: 'responsable_inscripto',
      booksStartDate: '2026-10-01',
      vatToleranceCents: 1,
      bankTaxCreditComputableBp: 3300,
      bankTaxDebitComputableBp: 3300,
      uninvoicedSalesMode: 'separate_accounts',
      ivaDueDay: 20,
      iibbDueDay: 15,
    })
    expect(missingSystemKeys([...ctx.accounts.values()])).toEqual([])
  })

  it('si al plan le falta una cuenta de sistema, corta con un error claro', () => {
    const { raw } = rawCatalog()
    const accounts = (raw.accounts as Array<Record<string, unknown>>).filter(
      (a) => a.system_key !== 'vat_credit',
    )
    const catalog = parsePostingCatalog({ ...raw, accounts })
    if (!catalog) throw new Error('catálogo')
    expect(() => buildPostingContext(catalog)).toThrow(AccountingContextError)
    try {
      buildPostingContext(catalog)
    } catch (error) {
      expect(error instanceof AccountingContextError && error.state.code).toBe('error')
    }
  })

  it('el contexto leído de la base sirve tal cual para el motor (apertura)', () => {
    const { raw, ids } = rawCatalog()
    const catalog = parsePostingCatalog(raw)
    if (!catalog) throw new Error('catálogo')
    const built = buildOpening(
      {
        treasuries: [{ treasuryAccountId: ids.treasuryId, balanceCents: 15_000_000 }],
        payables: [],
        receivables: [],
        others: [],
        shareCapitalCents: null,
        warningsAck: [],
      },
      buildPostingContext(catalog),
      { clientRef: fixedUuid(1) },
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const lines = built.bundle.documents[0]?.lines ?? []
    expect(lines.map((l) => [l.accountId, l.side, l.amountCents])).toEqual([
      [ids.cashAccount, 'debit', 15_000_000],
      [ids.sysId('opening_equity'), 'credit', 15_000_000],
    ])
  })
})

// ─── Partidas abiertas ───────────────────────────────────────────────────────

const DOC = fixedUuid(500)
const line = (over: Partial<RawJournalLine>): RawJournalLine => ({
  id: fixedUuid(600),
  document_id: DOC,
  document_line_id: fixedUuid(700),
  party_id: fixedUuid(800),
  account_id: fixedUuid(900),
  side: 'credit',
  amount_cents: 86_000_000,
  due_date: '2026-10-24',
  entry_date: '2026-10-03',
  ...over,
})
const doc = (over: Partial<RawDocument>): RawDocument => ({
  id: DOC,
  status: 'posted',
  kind: 'purchase',
  voucher_type: 'factura_a',
  point_of_sale: 3,
  number: '1290',
  description: 'Factura A 0003-00001290 · Coca-Cola',
  seq: 124,
  ...over,
})

describe('openAmounts', () => {
  it('descuenta solo las imputaciones de SU lado', () => {
    const credit = line({ id: fixedUuid(601), side: 'credit', amount_cents: 1000 })
    const debit = line({ id: fixedUuid(602), side: 'debit', amount_cents: '700' })
    const open = openAmounts(
      [credit, debit],
      [
        // pago (Debe) contra la factura (Haber)
        { debit_line_id: fixedUuid(602), credit_line_id: fixedUuid(601), amount_cents: 300 },
        // otra factura que cancela el mismo pago
        { debit_line_id: fixedUuid(602), credit_line_id: fixedUuid(699), amount_cents: '400' },
      ],
    )
    expect(open.get(fixedUuid(601))).toBe(700)
    expect(open.get(fixedUuid(602))).toBe(0)
  })
})

describe('toOpenItems', () => {
  it('arma la partida con su etiqueta, su abierto y su medio de cobro', () => {
    const items = toOpenItems({
      lines: [line({})],
      documents: [doc({})],
      allocations: [
        { debit_line_id: fixedUuid(1), credit_line_id: fixedUuid(600), amount_cents: 6_000_000 },
      ],
      methodByDocLine: new Map([[fixedUuid(700), fixedUuid(42)]]),
      onlyOpen: false,
    })
    expect(items).toEqual([
      {
        lineId: fixedUuid(600),
        documentId: DOC,
        partyId: fixedUuid(800),
        accountId: fixedUuid(900),
        side: 'credit',
        amountCents: 86_000_000,
        openCents: 80_000_000,
        entryDate: '2026-10-03',
        dueDate: '2026-10-24',
        label: 'Factura A 0003-00001290',
        salesMethodId: fixedUuid(42),
      },
    ])
  })

  it('deja afuera anuladas, líneas sin partícipe y (con onlyOpen) las canceladas', () => {
    const base = {
      allocations: [
        { debit_line_id: fixedUuid(1), credit_line_id: fixedUuid(603), amount_cents: 500 },
      ],
      methodByDocLine: new Map<string, string | null>(),
    }
    const voided = toOpenItems({
      ...base,
      lines: [line({})],
      documents: [doc({ status: 'voided' })],
      onlyOpen: false,
    })
    expect(voided).toEqual([])
    const noParty = toOpenItems({
      ...base,
      lines: [line({ party_id: null })],
      documents: [doc({})],
      onlyOpen: false,
    })
    expect(noParty).toEqual([])
    const settled = line({ id: fixedUuid(603), amount_cents: 500 })
    expect(
      toOpenItems({ ...base, lines: [settled], documents: [doc({})], onlyOpen: true }),
    ).toEqual([])
    // Pedida por id, vuelve aunque esté cancelada: el motor contesta con el abierto real.
    expect(
      toOpenItems({ ...base, lines: [settled], documents: [doc({})], onlyOpen: false })[0]
        ?.openCents,
    ).toBe(0)
  })
})

describe('documentLabel', () => {
  it('comprobante fiscal, si no la descripción, si no el número interno', () => {
    expect(documentLabel(doc({}))).toBe('Factura A 0003-00001290')
    expect(documentLabel(doc({ voucher_type: null, description: 'Cierre del día 06/10' }))).toBe(
      'Cierre del día 06/10',
    )
    expect(
      documentLabel(doc({ voucher_type: 'sin_comprobante', description: null, seq: '77' })),
    ).toBe('#77')
  })
})
