/**
 * Contexto de prueba del motor contable (núcleo): el plan estándar de §D más
 * las cajas, partícipes, medios y puntos de venta de los ejemplos de E (HUB
 * con libros desde el 01/10/2026). Lo usan los tests de validaciones y de la
 * vista previa. Los ids son UUID v4 válidos y deterministas; los CUIT se arman
 * con su dígito verificador (no son de nadie).
 *
 * Los golden de cada builder (E1–E21) viven aparte, en los tests del motor de
 * imputación (`posting/*`).
 */

import { STANDARD_CHART } from '@/lib/accounting/chart'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  AccountRef,
  DocLine,
  PartyKind,
  PartyRef,
  PostingContext,
  ProposedDocument,
  SalesMethodRef,
  TreasuryRef,
} from '@/lib/accounting/types'
import { cuitCheckDigit } from '@/lib/fiscal'

let counter = 0
/** UUID v4 determinista: `00000000-0000-4000-8000-<n>`. */
export function fixedUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}
function nextId(): string {
  counter += 1
  return fixedUuid(counter)
}

/** CUIT válido a partir de prefijo y 8 dígitos (calcula el verificador). */
export function makeCuit(prefix: '20' | '23' | '27' | '30' | '33', body: string): string {
  const firstTen = `${prefix}${body}`
  const check = cuitCheckDigit(firstTen)
  if (check === null) throw new Error(`Sin verificador para ${firstTen}`)
  return `${firstTen}${check}`
}

function buildAccounts(): {
  byCode: Map<string, AccountRef>
  bySys: Map<SystemAccountKey, AccountRef>
} {
  const byCode = new Map<string, AccountRef>()
  const bySys = new Map<SystemAccountKey, AccountRef>()
  for (const seed of STANDARD_CHART) {
    const ref: AccountRef = {
      id: nextId(),
      code: seed.code,
      name: seed.name,
      type: seed.type,
      normalSide: seed.normalSide,
      postable: seed.postable,
      active: true,
      requiresParty: seed.requiresParty,
      isTreasury: false,
      purchaseSelectable: seed.purchaseSelectable,
      systemKey: seed.systemKey,
      description: seed.description,
    }
    byCode.set(seed.code, ref)
    if (seed.systemKey) bySys.set(seed.systemKey, ref)
  }
  // Las hojas de «Caja y bancos» las crea el asistente.
  for (const [code, name] of [
    ['1.1.01.01.001', 'Caja'],
    ['1.1.01.01.002', 'Mercado Pago SAS'],
    ['1.1.01.01.003', 'Banco Nación'],
  ] as const) {
    byCode.set(code, {
      id: nextId(),
      code,
      name,
      type: 'asset',
      normalSide: 'debit',
      postable: true,
      active: true,
      requiresParty: false,
      isTreasury: true,
      purchaseSelectable: false,
      systemKey: null,
      description: null,
    })
  }
  return { byCode, bySys }
}

export type CoreFixture = {
  ctx: PostingContext
  acc: (code: string) => AccountRef
  sys: (key: SystemAccountKey) => AccountRef
  party: (key: PartyFixtureKey) => PartyRef
  treasury: (key: 'caja' | 'mp' | 'banco') => TreasuryRef
  method: (key: MethodFixtureKey) => SalesMethodRef
}

export type PartyFixtureKey =
  | 'cocacola'
  | 'carniceria'
  | 'plomero'
  | 'corralon'
  | 'mayorista'
  | 'mercadopago'
  | 'posnetDebito'
  | 'posnetCredito'
  | 'pedidosya'
  | 'rappi'
  | 'arca'
  | 'arcaSs'
  | 'rentas'
  | 'personal'
  | 'maximo'
  | 'empresaX'
  | 'senas'
  | 'bancoNacion'
  | 'kiosco'

export type MethodFixtureKey =
  | 'cash'
  | 'transfer'
  | 'qr'
  | 'debit'
  | 'credit'
  | 'pedidosya'
  | 'rappi'
  | 'customerAccount'

export function buildCoreFixture(): CoreFixture {
  counter = 0
  const { byCode, bySys } = buildAccounts()
  const sys = (key: SystemAccountKey): AccountRef => {
    const a = bySys.get(key)
    if (!a) throw new Error(`Falta la cuenta ${key}`)
    return a
  }
  const acc = (code: string): AccountRef => {
    const a = byCode.get(code)
    if (!a) throw new Error(`Falta la cuenta ${code}`)
    return a
  }

  const parties = new Map<string, PartyRef>()
  const partyByKey = new Map<PartyFixtureKey, PartyRef>()
  const addParty = (
    key: PartyFixtureKey,
    kind: PartyKind,
    name: string,
    opts: Partial<PartyRef> & { payable?: SystemAccountKey; receivable?: SystemAccountKey } = {},
  ) => {
    const { payable, receivable, ...rest } = opts
    const p: PartyRef = {
      id: nextId(),
      kind,
      name,
      tradeName: null,
      taxIdType: 'none',
      taxId: null,
      ivaCondition: 'sin_datos',
      paymentTermDays: 0,
      payableAccountId: sys(payable ?? 'payable_suppliers').id,
      receivableAccountId: sys(receivable ?? 'receivable_customers').id,
      commissionVatMode: 'none',
      rates: {
        commissionBp: null,
        iibbWithholdingBp: null,
        vatWithholdingBp: null,
        incomeTaxWithholdingBp: null,
        sircupaBp: null,
      },
      active: true,
      ...rest,
    }
    parties.set(p.id, p)
    partyByKey.set(key, p)
  }
  const ri = (body: string, prefix: '30' | '33' = '30') =>
    ({
      taxIdType: 'cuit',
      taxId: makeCuit(prefix, body),
      ivaCondition: 'responsable_inscripto',
    }) as const

  addParty('cocacola', 'supplier', 'Coca-Cola (distribuidor)', {
    ...ri('86091390'),
    paymentTermDays: 21,
  })
  addParty('carniceria', 'supplier', 'Carnicería Don José', { ...ri('71234567') })
  addParty('plomero', 'supplier', 'Plomero García', {
    taxIdType: 'cuit',
    taxId: makeCuit('20', '12345678'),
    ivaCondition: 'monotributo',
  })
  addParty('corralon', 'supplier', 'Corralón del Centro', { ...ri('71111111') })
  addParty('mayorista', 'supplier', 'Mayorista X', { ...ri('71222222') })
  addParty('kiosco', 'supplier', 'Kiosco de la esquina', { ivaCondition: 'consumidor_final' })
  addParty('mercadopago', 'payment_wallet', 'Mercado Pago', {
    ...ri('70308853'),
    receivable: 'receivable_wallets',
    commissionVatMode: 'monthly_invoice',
  })
  addParty('posnetDebito', 'card_processor', 'Tarjetas de débito (Posnet)', {
    ...ri('71333333'),
    receivable: 'receivable_debit_cards',
    commissionVatMode: 'per_settlement',
  })
  addParty('posnetCredito', 'card_processor', 'Tarjetas de crédito (Posnet)', {
    ...ri('71444444'),
    receivable: 'receivable_credit_cards',
    commissionVatMode: 'per_settlement',
  })
  addParty('pedidosya', 'delivery_platform', 'PedidosYa', {
    ...ri('71555555'),
    receivable: 'receivable_platforms',
    commissionVatMode: 'monthly_invoice',
  })
  addParty('rappi', 'delivery_platform', 'Rappi', {
    ...ri('71666666'),
    receivable: 'receivable_platforms',
    commissionVatMode: 'monthly_invoice',
  })
  addParty('arca', 'tax_agency', 'ARCA (ex AFIP)', { payable: 'vat_payable' })
  addParty('arcaSs', 'tax_agency', 'ARCA · seguridad social (F.931)', {
    payable: 'social_security_payable',
  })
  addParty('rentas', 'tax_agency', 'Rentas de Córdoba (IIBB)', { payable: 'iibb_payable' })
  addParty('personal', 'payroll', 'Personal (sueldos)', { payable: 'payroll_payable' })
  addParty('maximo', 'partner', 'Máximo', { payable: 'partners_current' })
  addParty('empresaX', 'customer', 'Empresa X SA', { ...ri('71777777'), paymentTermDays: 30 })
  addParty('senas', 'customer', 'Señas de clientes', {
    payable: 'customer_deposits',
    receivable: 'customer_deposits',
  })
  addParty('bancoNacion', 'bank', 'Banco de la Nación Argentina', {
    ...ri('99999017', '30'),
    commissionVatMode: 'per_settlement',
  })

  const party = (key: PartyFixtureKey): PartyRef => {
    const p = partyByKey.get(key)
    if (!p) throw new Error(`Falta el partícipe ${key}`)
    return p
  }

  const treasuries = new Map<string, TreasuryRef>()
  const treasuryByKey = new Map<string, TreasuryRef>()
  const addTreasury = (
    key: 'caja' | 'mp' | 'banco',
    code: string,
    kind: TreasuryRef['kind'],
    balance: number,
  ) => {
    const account = acc(code)
    const t: TreasuryRef = {
      id: nextId(),
      accountId: account.id,
      name: account.name,
      kind,
      allowNegative: kind === 'bank',
      bankPartyId:
        kind === 'wallet'
          ? party('mercadopago').id
          : kind === 'bank'
            ? party('bancoNacion').id
            : null,
      balanceCents: balance,
      active: true,
    }
    treasuries.set(t.id, t)
    treasuryByKey.set(key, t)
  }
  addTreasury('caja', '1.1.01.01.001', 'cash', 15_000_000)
  addTreasury('mp', '1.1.01.01.002', 'wallet', 82_000_000)
  addTreasury('banco', '1.1.01.01.003', 'bank', 100_000_000)
  const treasury = (key: 'caja' | 'mp' | 'banco'): TreasuryRef => {
    const t = treasuryByKey.get(key)
    if (!t) throw new Error(`Falta la caja ${key}`)
    return t
  }

  const methods = new Map<string, SalesMethodRef>()
  const methodByKey = new Map<MethodFixtureKey, SalesMethodRef>()
  const addMethod = (key: MethodFixtureKey, m: Omit<SalesMethodRef, 'id' | 'sort'>) => {
    const ref: SalesMethodRef = { id: nextId(), sort: methods.size, ...m }
    methods.set(ref.id, ref)
    methodByKey.set(key, ref)
  }
  addMethod('cash', {
    name: 'Efectivo',
    kind: 'treasury',
    channel: 'salon',
    treasuryAccountId: treasury('caja').id,
    partyId: null,
    settlementDays: 0,
  })
  addMethod('transfer', {
    name: 'Transferencia',
    kind: 'settled_now',
    channel: 'salon',
    treasuryAccountId: treasury('mp').id,
    partyId: party('mercadopago').id,
    settlementDays: 0,
  })
  addMethod('qr', {
    name: 'QR Mercado Pago',
    kind: 'settled_now',
    channel: 'salon',
    treasuryAccountId: treasury('mp').id,
    partyId: party('mercadopago').id,
    settlementDays: 0,
  })
  addMethod('debit', {
    name: 'Débito',
    kind: 'receivable',
    channel: 'salon',
    treasuryAccountId: null,
    partyId: party('posnetDebito').id,
    settlementDays: 1,
  })
  addMethod('credit', {
    name: 'Crédito',
    kind: 'receivable',
    channel: 'salon',
    treasuryAccountId: null,
    partyId: party('posnetCredito').id,
    settlementDays: 10,
  })
  addMethod('pedidosya', {
    name: 'PedidosYa',
    kind: 'receivable',
    channel: 'delivery',
    treasuryAccountId: null,
    partyId: party('pedidosya').id,
    settlementDays: 14,
  })
  addMethod('rappi', {
    name: 'Rappi',
    kind: 'receivable',
    channel: 'delivery',
    treasuryAccountId: null,
    partyId: party('rappi').id,
    settlementDays: 14,
  })
  addMethod('customerAccount', {
    name: 'Cuenta corriente',
    kind: 'customer_account',
    channel: 'events',
    treasuryAccountId: null,
    partyId: null,
    settlementDays: 0,
  })
  const method = (key: MethodFixtureKey): SalesMethodRef => {
    const m = methodByKey.get(key)
    if (!m) throw new Error(`Falta el medio ${key}`)
    return m
  }

  const accounts = new Map<string, AccountRef>()
  for (const a of byCode.values()) accounts.set(a.id, a)

  const sysRecord = Object.fromEntries(bySys.entries()) as Record<SystemAccountKey, AccountRef>

  const ctx: PostingContext = {
    tenantId: fixedUuid(999_999),
    today: '2026-10-31',
    settings: {
      ivaCondition: 'responsable_inscripto',
      booksStartDate: '2026-10-01',
      vatToleranceCents: 1,
      bankTaxCreditComputableBp: 3300,
      bankTaxDebitComputableBp: 3300,
      uninvoicedSalesMode: 'separate_accounts',
      ivaDueDay: 20,
      iibbDueDay: 15,
    },
    accounts,
    sys: sysRecord,
    parties,
    treasuries,
    methods,
    salesPoints: new Map([
      [3, { number: 3, label: 'Salón', defaultChannel: 'salon' }],
      [4, { number: 4, label: 'Delivery', defaultChannel: 'delivery' }],
    ]),
    openItems: new Map(),
  }
  return { ctx, acc, sys, party, treasury, method }
}

/** Un renglón con todo en `null` salvo lo que se pase. */
export function line(
  partial: Pick<DocLine, 'lineNo' | 'role' | 'accountId' | 'side' | 'amountCents'> &
    Partial<DocLine>,
): DocLine {
  return {
    partyRef: null,
    dueDate: null,
    treasuryAccountId: null,
    salesMethodId: null,
    vatRateBp: null,
    baseCents: null,
    vatComputedCents: null,
    taxKind: null,
    jurisdictionCode: null,
    channel: null,
    certificateNumber: null,
    reference: null,
    memo: '',
    ...partial,
  }
}

/** Un documento con los defaults de un comprobante simple. */
export function doc(
  partial: Pick<ProposedDocument, 'kind' | 'lines' | 'totalCents'> & Partial<ProposedDocument>,
): ProposedDocument {
  return {
    ref: 'd1',
    entryKind:
      partial.kind === 'manual' ? 'manual' : partial.kind === 'opening' ? 'opening' : 'standard',
    voucherType: null,
    afipVoucherCode: null,
    party: null,
    issueDate: '2026-10-03',
    accountingDate: '2026-10-03',
    dueDate: null,
    pointOfSale: null,
    number: null,
    shift: null,
    description: 'Comprobante de prueba',
    notes: null,
    controlAccountId: null,
    relatedDocument: null,
    replacesDocumentId: null,
    correctsDocumentId: null,
    recurringExpenseId: null,
    settlesCommissions: false,
    countedCents: null,
    expectedBookCents: null,
    warningsAck: [],
    overrideReason: null,
    fiscalVouchers: [],
    ...partial,
  }
}
