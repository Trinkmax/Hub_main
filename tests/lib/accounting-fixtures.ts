/**
 * Los ejemplos de E (E1–E21) como golden de los builders del motor de
 * imputación (`lib/accounting/posting/*`).
 *
 * Están escritos con CLAVES, nunca con ids: cuentas por `system_key` (o la caja
 * por su clave), partícipes, cajas, medios y partidas por su clave de fixture.
 * Un `FixtureResolver` las traduce a ids: `memoryResolver` usa el contexto en
 * memoria de `accounting-core-context.ts` (tests unitarios); las pruebas de
 * base (`tests/rls/acc-posting.test.ts`) arman el suyo con los ids que
 * devuelve el bar de prueba y comparan el diario guardado con estos mismos
 * golden (paridad TS ↔ SQL).
 *
 * Las entradas pasan por el zod de cada formulario (`schemas.ts`): un ejemplo
 * que el formulario no aceptaría no puede ser golden. Los importes son los de
 * la especificación, en centavos; las leyendas (`memo`) y descripciones no se
 * comparan (son texto derivado, no entran al hash).
 */

import { expect } from 'vitest'
import { sumSides } from '@/lib/accounting/balance'
import type {
  ReversalInput,
  TreasuryAdjustmentBuildInput,
} from '@/lib/accounting/posting/adjustment'
import type {
  CollectionBuildInput,
  WalletCheckBuildInput,
} from '@/lib/accounting/posting/collection'
import type { BuildMeta } from '@/lib/accounting/posting/common'
import type { ExpenseInput } from '@/lib/accounting/posting/expense'
import type { IvaSettlementInput } from '@/lib/accounting/posting/iva-settlement'
import type {
  ManualEntryBuildInput,
  PayrollTemplateBuildInput,
} from '@/lib/accounting/posting/manual'
import type { OpeningBuildInput } from '@/lib/accounting/posting/opening'
import type { PaymentBuildInput } from '@/lib/accounting/posting/payment'
import type { PurchaseBuildInput } from '@/lib/accounting/posting/purchase'
import type { QuickExpenseBuildInput } from '@/lib/accounting/posting/quick-expense'
import type { SalesCloseBuildInput } from '@/lib/accounting/posting/sales-close'
import type { SalesInvoiceBuildInput } from '@/lib/accounting/posting/sales-invoice'
import type {
  BankExpenseBuildInput,
  CashMovementBuildInput,
  TransferBuildInput,
} from '@/lib/accounting/posting/treasury'
import type { FiscalYearCloseInput } from '@/lib/accounting/posting/year-end'
import {
  bankExpenseSchema,
  cashMovementSchema,
  collectionSchema,
  manualEntrySchema,
  openingSchema,
  paymentSchema,
  payrollTemplateSchema,
  purchaseSchema,
  quickExpenseSchema,
  salesCloseSchema,
  salesInvoiceSchema,
  transferSchema,
  treasuryAdjustmentSchema,
  walletCheckSchema,
} from '@/lib/accounting/schemas'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  Cents,
  Channel,
  DocLine,
  DocumentKind,
  EntryKind,
  FiscalAmounts,
  FiscalBook,
  FiscalCounterparty,
  FiscalVoucher,
  FiscalVoucherType,
  IsoDate,
  LineKey,
  LineRole,
  OpenItemRef,
  PartyKey,
  PostingContext,
  PostingResult,
  ProposedAllocation,
  ProposedDocument,
  Side,
  TaxKind,
  VatRateBp,
  VoucherType,
  WarningKey,
} from '@/lib/accounting/types'
import type { ValidateOptions } from '@/lib/accounting/validate'
import { afipDocType, afipVoucherCode } from '@/lib/accounting/voucher-types'
import {
  buildCoreFixture,
  type CoreFixture,
  fixedUuid,
  type MethodFixtureKey,
  type PartyFixtureKey,
} from './accounting-core-context'

// ─── Claves y resolvedor ─────────────────────────────────────────────────────

export type TreasuryKey = 'caja' | 'mp' | 'banco'

/** Partidas abiertas que algunos ejemplos aplican (las dejó un ejemplo anterior). */
export type ItemKey =
  | 'E7.F1'
  | 'E7.F2'
  | 'E7.F3'
  | 'E7.FW'
  | 'E7.NC'
  | 'E7.IIBB'
  | 'E8.transfer'
  | 'E8.qr'
  | 'E8.credit'
  | 'E10.pya'
  | 'E10.pending'
  | 'E10b.pya'

/** Comprobantes ya guardados a los que se refiere un ejemplo (NC → factura, anulación → original). */
export type DocumentKey = 'E1' | 'E1.copy'

export type FixtureResolver = {
  account: (key: SystemAccountKey) => string
  /** Id de la caja (`acc_treasury_accounts`). */
  treasury: (key: TreasuryKey) => string
  /** Id de la cuenta contable de la caja (`1.1.01.NN`). */
  treasuryAccount: (key: TreasuryKey) => string
  party: (key: PartyFixtureKey) => string
  method: (key: MethodFixtureKey) => string
  item: (key: ItemKey) => string
  document: (key: DocumentKey) => string
  /** La foto fiscal del partícipe (lo que la RPC toma de la base). */
  counterparty: (key: PartyFixtureKey) => FiscalCounterparty
}

const ITEM_IDS: Readonly<Record<ItemKey, string>> = {
  'E7.F1': fixedUuid(900_001),
  'E7.F2': fixedUuid(900_002),
  'E7.F3': fixedUuid(900_003),
  'E7.FW': fixedUuid(900_004),
  'E7.NC': fixedUuid(900_005),
  'E7.IIBB': fixedUuid(900_006),
  'E8.transfer': fixedUuid(900_011),
  'E8.qr': fixedUuid(900_012),
  'E8.credit': fixedUuid(900_013),
  'E10.pya': fixedUuid(900_021),
  'E10.pending': fixedUuid(900_022),
  'E10b.pya': fixedUuid(900_023),
}

const DOCUMENT_IDS: Readonly<Record<DocumentKey, string>> = {
  E1: fixedUuid(910_001),
  'E1.copy': fixedUuid(910_002),
}

/** El resolvedor de los tests unitarios: el contexto en memoria de `accounting-core-context.ts`. */
export function memoryResolver(f: CoreFixture): FixtureResolver {
  return {
    account: (key) => f.sys(key).id,
    treasury: (key) => f.treasury(key).id,
    treasuryAccount: (key) => f.treasury(key).accountId,
    party: (key) => f.party(key).id,
    method: (key) => f.method(key).id,
    item: (key) => ITEM_IDS[key],
    document: (key) => DOCUMENT_IDS[key],
    counterparty: (key) => {
      const p = f.party(key)
      const docType = afipDocType(p.taxIdType)
      return {
        party: { id: p.id },
        name: p.name,
        docType,
        docNumber: docType === 99 ? '0' : (p.taxId ?? '0'),
        ivaCondition: p.ivaCondition,
      }
    },
  }
}

// ─── Golden ──────────────────────────────────────────────────────────────────

export type GoldenAccount = { sys: SystemAccountKey } | { treasury: TreasuryKey }
export type GoldenParty = PartyFixtureKey | { ref: string }

export type GoldenLine = {
  account: GoldenAccount
  side: 'D' | 'H'
  cents: Cents
  role: LineRole
  party?: GoldenParty
  due?: IsoDate
  /** La caja del renglón `treasury`. */
  treasury?: TreasuryKey
  method?: MethodFixtureKey
  rate?: VatRateBp
  base?: Cents
  computed?: Cents
  tax?: TaxKind
  jurisdiction?: number
  channel?: Channel
  certificate?: string
  reference?: string
}

export type GoldenFiscal = {
  book: FiscalBook
  voucherType: FiscalVoucherType
  isCreditNote?: boolean
  date: IsoDate
  pointOfSale: number
  numberFrom: number
  numberTo?: number | null
  channel?: Channel | null
  counterparty: PartyFixtureKey | 'final_consumer'
  amounts: FiscalAmounts
}

export type GoldenDocument = {
  ref: string
  kind: DocumentKind
  entryKind?: EntryKind
  voucherType?: VoucherType | null
  party?: GoldenParty | null
  /** Fecha contable (y de emisión, salvo `issueDate`). */
  date: IsoDate
  issueDate?: IsoDate
  dueDate?: IsoDate | null
  pointOfSale?: number | null
  number?: number | null
  totalCents: Cents
  countedCents?: Cents | null
  expectedBookCents?: Cents | null
  related?: DocumentKey | null
  settlesCommissions?: boolean
  overrideReason?: string | null
  lines: GoldenLine[]
  fiscal?: GoldenFiscal[]
}

export type GoldenLineKey = { item: ItemKey } | { doc: string; lineNo: number }
export type GoldenAllocation = {
  debit: GoldenLineKey
  credit: GoldenLineKey
  cents: Cents
  kind: ProposedAllocation['kind']
}

export type PostingFixture<I> = {
  id: string
  title: string
  input: (r: FixtureResolver) => I
  /** Partidas que el formulario referencia (las carga `loadPostingContext`). */
  openItems?: readonly ItemKey[]
  /** «Hoy» del contexto si no es el 31/10/2026 (el cierre de ejercicio se carga en febrero). */
  today?: IsoDate
  validate?: ValidateOptions
  expect: {
    documents: GoldenDocument[]
    allocations?: GoldenAllocation[]
    warnings?: WarningKey[]
    newParties?: Array<{ ref: string; name: string }>
  }
}

const D = (
  account: GoldenAccount,
  cents: Cents,
  role: LineRole,
  extra: Partial<GoldenLine> = {},
): GoldenLine => ({
  account,
  side: 'D',
  cents,
  role,
  ...extra,
})
const H = (
  account: GoldenAccount,
  cents: Cents,
  role: LineRole,
  extra: Partial<GoldenLine> = {},
): GoldenLine => ({
  account,
  side: 'H',
  cents,
  role,
  ...extra,
})
const sys = (key: SystemAccountKey): GoldenAccount => ({ sys: key })
const box = (key: TreasuryKey): GoldenAccount => ({ treasury: key })

// ─── Partidas abiertas ───────────────────────────────────────────────────────

export type ItemFixture = {
  party: PartyFixtureKey
  account: GoldenAccount
  side: Side
  amountCents: Cents
  openCents: Cents
  entryDate: IsoDate
  dueDate: IsoDate | null
  label: string
  method?: MethodFixtureKey
}

export const OPEN_ITEMS: Readonly<Record<ItemKey, ItemFixture>> = {
  // E7: las tres facturas de Coca-Cola (F3 = E1 después de la NC de E6).
  'E7.F1': {
    party: 'cocacola',
    account: sys('payable_suppliers'),
    side: 'credit',
    amountCents: 50_000_000,
    openCents: 50_000_000,
    entryDate: '2026-10-01',
    dueDate: '2026-10-14',
    label: 'Factura A 0003-00001180',
  },
  'E7.F2': {
    party: 'cocacola',
    account: sys('payable_suppliers'),
    side: 'credit',
    amountCents: 38_000_000,
    openCents: 38_000_000,
    entryDate: '2026-10-01',
    dueDate: '2026-10-21',
    label: 'Factura A 0003-00001234',
  },
  'E7.F3': {
    party: 'cocacola',
    account: sys('payable_suppliers'),
    side: 'credit',
    amountCents: 86_000_000,
    openCents: 79_950_000,
    entryDate: '2026-10-03',
    dueDate: '2026-10-24',
    label: 'Factura A 0003-00001290',
  },
  'E7.FW': {
    party: 'cocacola',
    account: sys('payable_suppliers'),
    side: 'credit',
    amountCents: 86_000_000,
    openCents: 86_000_000,
    entryDate: '2026-10-03',
    dueDate: '2026-10-24',
    label: 'Factura A 0003-00001300',
  },
  'E7.NC': {
    party: 'cocacola',
    account: sys('payable_suppliers'),
    side: 'debit',
    amountCents: 6_050_000,
    openCents: 6_050_000,
    entryDate: '2026-10-10',
    dueDate: null,
    label: 'Nota de crédito A 0003-00000077',
  },
  'E7.IIBB': {
    party: 'rentas',
    account: sys('iibb_payable'),
    side: 'credit',
    amountCents: 380_000_000,
    openCents: 380_000_000,
    entryDate: '2026-10-31',
    dueDate: '2026-11-15',
    label: 'DDJJ IIBB octubre',
  },
  // E8: las partidas de Mercado Pago y de crédito del cierre del lunes 05/10.
  'E8.transfer': {
    party: 'mercadopago',
    account: sys('receivable_wallets'),
    side: 'debit',
    amountCents: 18_000_000,
    openCents: 18_000_000,
    entryDate: '2026-10-05',
    dueDate: '2026-10-05',
    label: 'Transferencia · 05/10',
    method: 'transfer',
  },
  'E8.qr': {
    party: 'mercadopago',
    account: sys('receivable_wallets'),
    side: 'debit',
    amountCents: 22_000_000,
    openCents: 22_000_000,
    entryDate: '2026-10-05',
    dueDate: '2026-10-05',
    label: 'QR Mercado Pago · 05/10',
    method: 'qr',
  },
  'E8.credit': {
    party: 'posnetCredito',
    account: sys('receivable_credit_cards'),
    side: 'debit',
    amountCents: 33_000_000,
    openCents: 33_000_000,
    entryDate: '2026-10-05',
    dueDate: '2026-10-15',
    label: 'Crédito · 05/10',
    method: 'credit',
  },
  // E10: lo que la liquidación semanal de PedidosYa aplica y el IVA que queda «a documentar».
  'E10.pya': {
    party: 'pedidosya',
    account: sys('receivable_platforms'),
    side: 'debit',
    amountCents: 100_000_000,
    openCents: 100_000_000,
    entryDate: '2026-10-06',
    dueDate: '2026-10-20',
    label: 'PedidosYa · semana del 06/10',
    method: 'pedidosya',
  },
  'E10.pending': {
    party: 'pedidosya',
    account: sys('vat_credit_pending'),
    side: 'debit',
    amountCents: 5_250_000,
    openCents: 5_250_000,
    entryDate: '2026-10-20',
    dueDate: null,
    label: 'IVA de comisiones a documentar · 20/10',
  },
  'E10b.pya': {
    party: 'pedidosya',
    account: sys('receivable_platforms'),
    side: 'debit',
    amountCents: 10_000_000,
    openCents: 10_000_000,
    entryDate: '2026-10-13',
    dueDate: '2026-10-27',
    label: 'PedidosYa · semana del 13/10',
    method: 'pedidosya',
  },
}

function accountIdOf(account: GoldenAccount, r: FixtureResolver): string {
  return 'sys' in account ? r.account(account.sys) : r.treasuryAccount(account.treasury)
}

function partyKeyOf(party: GoldenParty, r: FixtureResolver): PartyKey {
  return typeof party === 'string' ? { id: r.party(party) } : { ref: party.ref }
}

export function openItemRef(key: ItemKey, r: FixtureResolver): OpenItemRef {
  const item = OPEN_ITEMS[key]
  return {
    lineId: r.item(key),
    documentId: fixedUuid(920_000 + Object.keys(ITEM_IDS).indexOf(key)),
    partyId: r.party(item.party),
    accountId: accountIdOf(item.account, r),
    side: item.side,
    amountCents: item.amountCents,
    openCents: item.openCents,
    entryDate: item.entryDate,
    dueDate: item.dueDate,
    label: item.label,
    salesMethodId: item.method ? r.method(item.method) : null,
  }
}

// ─── Preparación y comparación ───────────────────────────────────────────────

export const CLIENT_REF = fixedUuid(777_777)

export type PreparedFixture = {
  f: CoreFixture
  r: FixtureResolver
  ctx: PostingContext
  meta: BuildMeta
}

/** Contexto en memoria con las partidas del ejemplo (y su «hoy», si lo cambia). */
export function prepare(
  fixture: Pick<PostingFixture<unknown>, 'openItems' | 'today' | 'validate'> = {},
): PreparedFixture {
  const f = buildCoreFixture()
  const r = memoryResolver(f)
  const items = (fixture.openItems ?? []).map((key) => openItemRef(key, r))
  const ctx: PostingContext = {
    ...f.ctx,
    today: fixture.today ?? f.ctx.today,
    openItems: new Map(items.map((i) => [i.lineId, i])),
  }
  const meta: BuildMeta = { clientRef: CLIENT_REF }
  if (fixture.validate) meta.validate = fixture.validate
  return { f, r, ctx, meta }
}

/** Los renglones golden como `DocLine` (con `line_no` 1..n en el orden del ejemplo y sin leyenda). */
export function goldenLines(lines: readonly GoldenLine[], r: FixtureResolver): DocLine[] {
  return lines.map((g, i) => ({
    lineNo: i + 1,
    role: g.role,
    accountId: accountIdOf(g.account, r),
    side: g.side === 'D' ? 'debit' : 'credit',
    amountCents: g.cents,
    partyRef: g.party ? partyKeyOf(g.party, r) : null,
    dueDate: g.due ?? null,
    treasuryAccountId: g.treasury ? r.treasury(g.treasury) : null,
    salesMethodId: g.method ? r.method(g.method) : null,
    vatRateBp: g.rate ?? null,
    baseCents: g.base ?? null,
    vatComputedCents: g.computed ?? null,
    taxKind: g.tax ?? null,
    jurisdictionCode: g.jurisdiction ?? null,
    channel: g.channel ?? null,
    certificateNumber: g.certificate ?? null,
    reference: g.reference ?? null,
    memo: '',
  }))
}

/** Las leyendas son texto derivado: se blanquean para comparar. */
export function withoutMemos(lines: readonly DocLine[]): DocLine[] {
  return lines.map((l) => ({ ...l, memo: '' }))
}

export function goldenFiscal(g: GoldenFiscal, r: FixtureResolver): FiscalVoucher {
  return {
    book: g.book,
    voucherType: g.voucherType,
    afipVoucherCode: afipVoucherCode(g.voucherType),
    isCreditNote: g.isCreditNote ?? false,
    voucherDate: g.date,
    pointOfSale: g.pointOfSale,
    numberFrom: g.numberFrom,
    numberTo: g.numberTo ?? null,
    channel: g.channel ?? null,
    counterparty:
      g.counterparty === 'final_consumer'
        ? {
            party: null,
            name: 'Consumidor final',
            docType: 99,
            docNumber: '0',
            ivaCondition: 'consumidor_final',
          }
        : r.counterparty(g.counterparty),
    amounts: g.amounts,
  }
}

function lineKeyOf(key: GoldenLineKey, r: FixtureResolver): LineKey {
  return 'item' in key ? { lineId: r.item(key.item) } : { doc: key.doc, lineNo: key.lineNo }
}

export function goldenAllocations(
  list: readonly GoldenAllocation[],
  r: FixtureResolver,
): ProposedAllocation[] {
  return list.map((a) => ({
    debit: lineKeyOf(a.debit, r),
    credit: lineKeyOf(a.credit, r),
    amountCents: a.cents,
    kind: a.kind,
  }))
}

/** Lo que se compara de la cabecera (los textos derivados no). */
export function goldenHeader(g: GoldenDocument, r: FixtureResolver): Partial<ProposedDocument> {
  const header: Partial<ProposedDocument> = {
    ref: g.ref,
    kind: g.kind,
    accountingDate: g.date,
    issueDate: g.issueDate ?? g.date,
    totalCents: g.totalCents,
  }
  if (g.entryKind !== undefined) header.entryKind = g.entryKind
  if (g.voucherType !== undefined) header.voucherType = g.voucherType
  if (g.voucherType) header.afipVoucherCode = afipVoucherCode(g.voucherType)
  if (g.party !== undefined) header.party = g.party === null ? null : partyKeyOf(g.party, r)
  if (g.dueDate !== undefined) header.dueDate = g.dueDate
  if (g.pointOfSale !== undefined) header.pointOfSale = g.pointOfSale
  if (g.number !== undefined) header.number = g.number
  if (g.countedCents !== undefined) header.countedCents = g.countedCents
  if (g.expectedBookCents !== undefined) header.expectedBookCents = g.expectedBookCents
  if (g.related !== undefined)
    header.relatedDocument = g.related ? { id: r.document(g.related) } : null
  if (g.settlesCommissions !== undefined) header.settlesCommissions = g.settlesCommissions
  if (g.overrideReason !== undefined) header.overrideReason = g.overrideReason
  return header
}

function describeErrors(result: PostingResult): string {
  return result.ok ? '' : JSON.stringify(result.errors)
}

/**
 * El resultado de un builder contra su golden, renglón por renglón: cuentas,
 * lados, centavos, partícipes, vencimientos, metadatos, `line_no` 1..n, cuadre,
 * ningún renglón en cero; comprobantes fiscales e imputaciones; avisos.
 */
export function assertGolden<I>(
  result: PostingResult,
  fixture: PostingFixture<I>,
  r: FixtureResolver,
): asserts result is Extract<PostingResult, { ok: true }> {
  expect(result.ok, describeErrors(result)).toBe(true)
  if (!result.ok) return
  const { bundle } = result
  expect(bundle.clientRef).toBe(CLIENT_REF)
  expect(bundle.documents.map((d) => d.ref)).toEqual(fixture.expect.documents.map((d) => d.ref))
  fixture.expect.documents.forEach((g, i) => {
    const doc = bundle.documents[i]
    expect(doc, `${fixture.id} ${g.ref}`).toBeDefined()
    if (!doc) return
    expect(doc).toMatchObject(goldenHeader(g, r))
    expect(withoutMemos(doc.lines)).toEqual(goldenLines(g.lines, r))
    expect(doc.lines.map((l) => l.lineNo)).toEqual(doc.lines.map((_, n) => n + 1))
    expect(doc.lines.every((l) => l.amountCents > 0)).toBe(true)
    const sums = sumSides(doc.lines)
    expect(sums.diff).toBe(0n)
    expect(doc.fiscalVouchers).toEqual((g.fiscal ?? []).map((fv) => goldenFiscal(fv, r)))
  })
  expect(bundle.allocations).toEqual(goldenAllocations(fixture.expect.allocations ?? [], r))
  if (fixture.expect.warnings) {
    expect([...new Set(result.warnings.map((w) => w.key))].sort()).toEqual(
      [...fixture.expect.warnings].sort(),
    )
  }
  if (fixture.expect.newParties) {
    expect(bundle.newParties.map((p) => ({ ref: p.ref, name: p.name }))).toEqual(
      fixture.expect.newParties,
    )
  } else {
    expect(bundle.newParties).toEqual([])
  }
  // La vista previa es la del bundle (un asiento por documento, cuadrado).
  expect(result.preview.map((p) => p.documentRef)).toEqual(bundle.documents.map((d) => d.ref))
  expect(result.preview.every((p) => p.balanced)).toBe(true)
  expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
}

// ─── Entradas (pasan por el zod del formulario) ──────────────────────────────

const FORM_META = { clientRef: CLIENT_REF, previewHash: '0'.repeat(64) }

function strip<T extends { clientRef: string; previewHash: string }>(
  value: T,
): Omit<T, 'clientRef' | 'previewHash'> {
  const { clientRef: _clientRef, previewHash: _previewHash, ...rest } = value
  return rest
}

export const purchaseInput = (raw: Record<string, unknown>): PurchaseBuildInput =>
  strip(purchaseSchema.parse({ ...FORM_META, ...raw }))
export const quickExpenseInput = (raw: Record<string, unknown>): QuickExpenseBuildInput =>
  strip(quickExpenseSchema.parse({ ...FORM_META, ...raw }))
export const paymentInput = (raw: Record<string, unknown>): PaymentBuildInput =>
  strip(paymentSchema.parse({ ...FORM_META, ...raw }))
export const collectionInput = (raw: Record<string, unknown>): CollectionBuildInput =>
  strip(collectionSchema.parse({ ...FORM_META, ...raw }))
export const walletCheckInput = (raw: Record<string, unknown>): WalletCheckBuildInput =>
  strip(walletCheckSchema.parse({ ...FORM_META, ...raw }))
export const salesCloseInput = (raw: Record<string, unknown>): SalesCloseBuildInput =>
  strip(salesCloseSchema.parse({ ...FORM_META, ...raw }))
export const salesInvoiceInput = (raw: Record<string, unknown>): SalesInvoiceBuildInput =>
  strip(salesInvoiceSchema.parse({ ...FORM_META, ...raw }))
export const transferInput = (raw: Record<string, unknown>): TransferBuildInput =>
  strip(transferSchema.parse({ ...FORM_META, ...raw }))
export const bankExpenseInput = (raw: Record<string, unknown>): BankExpenseBuildInput =>
  strip(bankExpenseSchema.parse({ ...FORM_META, ...raw }))
export const cashMovementInput = (raw: Record<string, unknown>): CashMovementBuildInput =>
  strip(cashMovementSchema.parse({ ...FORM_META, ...raw }))
export const treasuryAdjustmentInput = (
  raw: Record<string, unknown>,
): TreasuryAdjustmentBuildInput => strip(treasuryAdjustmentSchema.parse({ ...FORM_META, ...raw }))
export const manualEntryInput = (raw: Record<string, unknown>): ManualEntryBuildInput =>
  strip(manualEntrySchema.parse({ ...FORM_META, ...raw }))
export const openingInput = (raw: Record<string, unknown>): OpeningBuildInput =>
  strip(openingSchema.parse({ ...FORM_META, ...raw }))
export const payrollInput = (raw: Record<string, unknown>): PayrollTemplateBuildInput =>
  payrollTemplateSchema.parse(raw)

// ─── E.5.1 · Compras ─────────────────────────────────────────────────────────

const E1_LINES: GoldenLine[] = [
  D(sys('purchases_soft_drinks'), 71_074_380, 'net', { rate: 2100, base: 71_074_380 }),
  D(sys('vat_credit'), 14_925_620, 'vat', {
    rate: 2100,
    base: 71_074_380,
    computed: 14_925_620,
    tax: 'iva',
  }),
  H(sys('payable_suppliers'), 86_000_000, 'control', { party: 'cocacola', due: '2026-10-24' }),
]

const E1_EXPECT: PostingFixture<PurchaseBuildInput>['expect'] = {
  documents: [
    {
      ref: 'd1',
      kind: 'purchase',
      entryKind: 'standard',
      voucherType: 'factura_a',
      party: 'cocacola',
      date: '2026-10-03',
      dueDate: '2026-10-24',
      pointOfSale: 3,
      number: 1290,
      totalCents: 86_000_000,
      lines: E1_LINES,
      fiscal: [
        {
          book: 'purchases',
          voucherType: 'factura_a',
          date: '2026-10-03',
          pointOfSale: 3,
          numberFrom: 1290,
          counterparty: 'cocacola',
          amounts: {
            net_21_cents: 71_074_380,
            vat_21_cents: 14_925_620,
            total_cents: 86_000_000,
            vat_computable_cents: 14_925_620,
          },
        },
      ],
    },
  ],
  warnings: [],
}

/** E1 · Factura A 0003-00001290 de Coca-Cola, cargada con el detalle (neto 21 %). */
export const E1: PostingFixture<PurchaseBuildInput> = {
  id: 'E1',
  title: 'Factura A 0003-00001290 de Coca-Cola (detalle)',
  input: (r) =>
    purchaseInput({
      partyId: r.party('cocacola'),
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 1290,
      issueDate: '2026-10-03',
      amountMode: 'detail',
      lines: [
        {
          role: 'net',
          accountId: r.account('purchases_soft_drinks'),
          amountCents: 71_074_380,
          vatRateBp: 2100,
        },
      ],
    }),
  expect: E1_EXPECT,
}

/** E1 · la misma factura cargada con el total ($ 860.000 al 21 %): mismo asiento. */
export const E1_TOTAL: PostingFixture<PurchaseBuildInput> = {
  id: 'E1-total',
  title: 'Factura A 0003-00001290 de Coca-Cola (total)',
  input: (r) =>
    purchaseInput({
      partyId: r.party('cocacola'),
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 1290,
      issueDate: '2026-10-03',
      amountMode: 'total',
      total: {
        totalCents: 86_000_000,
        vatRateBp: 2100,
        accountId: r.account('purchases_soft_drinks'),
      },
      controlTotalCents: 86_000_000,
    }),
  expect: E1_EXPECT,
}

/** E2 · Factura A de la carnicería, 10,5 % con percepciones de IIBB (Córdoba) e IVA. */
export const E2: PostingFixture<PurchaseBuildInput> = {
  id: 'E2',
  title: 'Factura A de la carnicería con percepciones',
  input: (r) =>
    purchaseInput({
      partyId: r.party('carniceria'),
      voucherType: 'factura_a',
      pointOfSale: 5,
      number: 777,
      issueDate: '2026-10-03',
      amountMode: 'detail',
      lines: [
        {
          role: 'net',
          accountId: r.account('purchases_food'),
          amountCents: 20_000_000,
          vatRateBp: 1050,
        },
      ],
      perceptions: [
        { taxKind: 'iibb', amountCents: 400_000, jurisdictionCode: 904 },
        { taxKind: 'iva', amountCents: 600_000 },
      ],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_a',
        party: 'carniceria',
        date: '2026-10-03',
        dueDate: '2026-10-03',
        pointOfSale: 5,
        number: 777,
        totalCents: 23_100_000,
        lines: [
          D(sys('purchases_food'), 20_000_000, 'net', { rate: 1050, base: 20_000_000 }),
          D(sys('vat_credit'), 2_100_000, 'vat', {
            rate: 1050,
            base: 20_000_000,
            computed: 2_100_000,
            tax: 'iva',
          }),
          D(sys('iibb_perceptions'), 400_000, 'perception', { tax: 'iibb', jurisdiction: 904 }),
          D(sys('vat_perceptions'), 600_000, 'perception', { tax: 'iva' }),
          H(sys('payable_suppliers'), 23_100_000, 'control', {
            party: 'carniceria',
            due: '2026-10-03',
          }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'factura_a',
            date: '2026-10-03',
            pointOfSale: 5,
            numberFrom: 777,
            counterparty: 'carniceria',
            amounts: {
              net_105_cents: 20_000_000,
              vat_105_cents: 2_100_000,
              perc_iva_cents: 600_000,
              perc_iibb_cents: 400_000,
              total_cents: 23_100_000,
              vat_computable_cents: 2_100_000,
            },
          },
        ],
      },
    ],
    warnings: [],
  },
}

/** E3 · Factura C de un plomero monotributista: todo al gasto, «IVA no discriminado» en el libro. */
export const E3: PostingFixture<PurchaseBuildInput> = {
  id: 'E3',
  title: 'Factura C de un plomero monotributista',
  input: (r) =>
    purchaseInput({
      partyId: r.party('plomero'),
      voucherType: 'factura_c',
      pointOfSale: 2,
      number: 45,
      issueDate: '2026-10-03',
      amountMode: 'total',
      total: { totalCents: 4_500_000, vatRateBp: null, accountId: r.account('maintenance') },
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_c',
        party: 'plomero',
        date: '2026-10-03',
        totalCents: 4_500_000,
        lines: [
          D(sys('maintenance'), 4_500_000, 'gross'),
          H(sys('payable_suppliers'), 4_500_000, 'control', {
            party: 'plomero',
            due: '2026-10-03',
          }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'factura_c',
            date: '2026-10-03',
            pointOfSale: 2,
            numberFrom: 45,
            counterparty: 'plomero',
            amounts: { undiscriminated_cents: 4_500_000, total_cents: 4_500_000 },
          },
        ],
      },
    ],
    warnings: [],
  },
}

/** E3b · Factura B de un responsable inscripto (el corralón), con el aviso aceptado: el IVA va al costo. */
export const E3B: PostingFixture<PurchaseBuildInput> = {
  id: 'E3b',
  title: 'Factura B de un responsable inscripto',
  input: (r) =>
    purchaseInput({
      warningsAck: ['voucher_condition'],
      partyId: r.party('corralon'),
      voucherType: 'factura_b',
      pointOfSale: 7,
      number: 3301,
      issueDate: '2026-10-08',
      amountMode: 'total',
      total: { totalCents: 2_420_000, vatRateBp: null, accountId: r.account('maintenance') },
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_b',
        party: 'corralon',
        date: '2026-10-08',
        totalCents: 2_420_000,
        lines: [
          D(sys('maintenance'), 2_420_000, 'gross'),
          H(sys('payable_suppliers'), 2_420_000, 'control', {
            party: 'corralon',
            due: '2026-10-08',
          }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'factura_b',
            date: '2026-10-08',
            pointOfSale: 7,
            numberFrom: 3301,
            counterparty: 'corralon',
            amounts: { undiscriminated_cents: 2_420_000, total_cents: 2_420_000 },
          },
        ],
      },
    ],
    warnings: ['voucher_condition'],
  },
}

/** DDJJ de IIBB de octubre ($ 3.800.000): sin libro IVA, vence el día de IIBB del mes siguiente. */
export const DDJJ_IIBB: PostingFixture<PurchaseBuildInput> = {
  id: 'DDJJ',
  title: 'DDJJ de IIBB de octubre',
  input: (r) =>
    purchaseInput({
      partyId: r.party('rentas'),
      voucherType: 'ddjj_impuesto',
      issueDate: '2026-10-31',
      amountMode: 'total',
      total: { totalCents: 380_000_000, vatRateBp: null, accountId: r.account('iibb_expense') },
      controlAccountId: r.account('iibb_payable'),
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'ddjj_impuesto',
        party: 'rentas',
        date: '2026-10-31',
        dueDate: '2026-11-15',
        pointOfSale: null,
        number: null,
        totalCents: 380_000_000,
        lines: [
          D(sys('iibb_expense'), 380_000_000, 'gross'),
          H(sys('iibb_payable'), 380_000_000, 'control', { party: 'rentas', due: '2026-11-15' }),
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.2 · Nota de crédito de proveedor ────────────────────────────────────

/** E6 · NC A por bonificación sobre E1: lados invertidos, el proveedor primero; la RPC la imputa a E1. */
export const E6: PostingFixture<PurchaseBuildInput> = {
  id: 'E6',
  title: 'NC A por bonificación sobre E1',
  input: (r) =>
    purchaseInput({
      docKind: 'purchase_credit_note',
      partyId: r.party('cocacola'),
      voucherType: 'nota_credito_a',
      pointOfSale: 3,
      number: 77,
      issueDate: '2026-10-10',
      amountMode: 'detail',
      lines: [
        {
          role: 'net',
          accountId: r.account('purchases_soft_drinks'),
          amountCents: 5_000_000,
          vatRateBp: 2100,
        },
      ],
      relatedDocumentId: r.document('E1'),
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase_credit_note',
        voucherType: 'nota_credito_a',
        party: 'cocacola',
        date: '2026-10-10',
        dueDate: null,
        related: 'E1',
        totalCents: 6_050_000,
        lines: [
          D(sys('payable_suppliers'), 6_050_000, 'control', { party: 'cocacola' }),
          H(sys('purchases_soft_drinks'), 5_000_000, 'net', { rate: 2100, base: 5_000_000 }),
          H(sys('vat_credit'), 1_050_000, 'vat', {
            rate: 2100,
            base: 5_000_000,
            computed: 1_050_000,
            tax: 'iva',
          }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'nota_credito_a',
            isCreditNote: true,
            date: '2026-10-10',
            pointOfSale: 3,
            numberFrom: 77,
            counterparty: 'cocacola',
            amounts: {
              net_21_cents: 5_000_000,
              vat_21_cents: 1_050_000,
              total_cents: 6_050_000,
              vat_computable_cents: 1_050_000,
            },
          },
        ],
      },
    ],
    // La imputación NC ↔ factura la hace sola la RPC (`credit_note`): el bundle no la trae.
    allocations: [],
    warnings: [],
  },
}

// ─── E.5.3 · Gasto de contado ────────────────────────────────────────────────

const E4_DOC: GoldenDocument = {
  ref: 'd1',
  kind: 'expense',
  voucherType: 'sin_comprobante',
  party: null,
  date: '2026-10-03',
  totalCents: 450_000,
  lines: [
    D(sys('purchases_soft_drinks'), 450_000, 'gross'),
    H(box('caja'), 450_000, 'treasury', { treasury: 'caja' }),
  ],
}

/** E4 · $ 4.500 en efectivo sin comprobante (el builder del gasto). */
export const E4: PostingFixture<ExpenseInput> = {
  id: 'E4',
  title: '$ 4.500 en efectivo, sin comprobante',
  input: (r) => ({
    date: '2026-10-03',
    treasuryAccountId: r.treasury('caja'),
    voucherType: 'sin_comprobante',
    partyId: null,
    newParty: null,
    lines: [{ accountId: r.account('purchases_soft_drinks'), amountCents: 450_000 }],
    notes: null,
    warningsAck: [],
  }),
  expect: { documents: [E4_DOC], warnings: [] },
}

/** E4 · lo mismo desde «Nuevo gasto» (sin comprobante → un solo `expense`). */
export const E4_QUICK: PostingFixture<QuickExpenseBuildInput> = {
  id: 'E4-nuevo-gasto',
  title: '$ 4.500 en efectivo desde «Nuevo gasto»',
  input: (r) =>
    quickExpenseInput({
      amountCents: 450_000,
      target: { type: 'account', accountId: r.account('purchases_soft_drinks') },
      treasuryAccountId: r.treasury('caja'),
      voucher: 'none',
      date: '2026-10-03',
    }),
  expect: { documents: [E4_DOC], warnings: [] },
}

// ─── E.5.4 · «Nuevo gasto» con factura ───────────────────────────────────────

/** E5 · artículos de limpieza con Factura A, $ 12.100 pagados con Mercado Pago: `[purchase, payment]`. */
export const E5: PostingFixture<QuickExpenseBuildInput> = {
  id: 'E5',
  title: 'Limpieza con Factura A pagada con Mercado Pago',
  input: (r) =>
    quickExpenseInput({
      amountCents: 1_210_000,
      target: { type: 'party', partyId: r.party('mayorista'), accountId: r.account('cleaning') },
      treasuryAccountId: r.treasury('mp'),
      voucher: 'a',
      vatRateBp: 2100,
      pointOfSale: 3,
      number: 4521,
      date: '2026-10-03',
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_a',
        party: 'mayorista',
        date: '2026-10-03',
        dueDate: '2026-10-03',
        pointOfSale: 3,
        number: 4521,
        totalCents: 1_210_000,
        lines: [
          D(sys('cleaning'), 1_000_000, 'net', { rate: 2100, base: 1_000_000 }),
          D(sys('vat_credit'), 210_000, 'vat', {
            rate: 2100,
            base: 1_000_000,
            computed: 210_000,
            tax: 'iva',
          }),
          H(sys('payable_suppliers'), 1_210_000, 'control', {
            party: 'mayorista',
            due: '2026-10-03',
          }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'factura_a',
            date: '2026-10-03',
            pointOfSale: 3,
            numberFrom: 4521,
            counterparty: 'mayorista',
            amounts: {
              net_21_cents: 1_000_000,
              vat_21_cents: 210_000,
              total_cents: 1_210_000,
              vat_computable_cents: 210_000,
            },
          },
        ],
      },
      {
        ref: 'd2',
        kind: 'payment',
        party: 'mayorista',
        date: '2026-10-03',
        totalCents: 1_210_000,
        lines: [
          D(sys('payable_suppliers'), 1_210_000, 'control', { party: 'mayorista' }),
          H(box('mp'), 1_210_000, 'treasury', { treasury: 'mp' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { doc: 'd2', lineNo: 1 },
        credit: { doc: 'd1', lineNo: 3 },
        cents: 1_210_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

// ─── E.5.5 · Orden de pago ───────────────────────────────────────────────────

/** E7 · pago a Coca-Cola de $ 900.000 (Banco Nación + Mercado Pago) a tres facturas; F3 queda parcial. */
export const E7: PostingFixture<PaymentBuildInput> = {
  id: 'E7',
  title: 'Pago a Coca-Cola con dos medios a tres facturas',
  openItems: ['E7.F1', 'E7.F2', 'E7.F3'],
  input: (r) =>
    paymentInput({
      partyId: r.party('cocacola'),
      date: '2026-10-20',
      applications: [
        { lineId: r.item('E7.F1'), amountCents: 50_000_000 },
        { lineId: r.item('E7.F2'), amountCents: 38_000_000 },
        { lineId: r.item('E7.F3'), amountCents: 2_000_000 },
      ],
      methods: [
        { type: 'treasury', treasuryAccountId: r.treasury('banco'), amountCents: 50_000_000 },
        { type: 'treasury', treasuryAccountId: r.treasury('mp'), amountCents: 40_000_000 },
      ],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'payment',
        party: 'cocacola',
        date: '2026-10-20',
        totalCents: 90_000_000,
        lines: [
          D(sys('payable_suppliers'), 90_000_000, 'control', { party: 'cocacola' }),
          H(box('banco'), 50_000_000, 'treasury', { treasury: 'banco' }),
          H(box('mp'), 40_000_000, 'treasury', { treasury: 'mp' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.F1' },
        cents: 50_000_000,
        kind: 'payment',
      },
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.F2' },
        cents: 38_000_000,
        kind: 'payment',
      },
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.F3' },
        cents: 2_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

/** E7 · pago en exceso: $ 1.000.000 aplicados a F1 y F2 → la partida del pago queda con 12.000.000 abiertos. */
export const E7_OVERPAY: PostingFixture<PaymentBuildInput> = {
  id: 'E7-exceso',
  title: 'Pago en exceso: queda a favor nuestro',
  openItems: ['E7.F1', 'E7.F2'],
  input: (r) =>
    paymentInput({
      partyId: r.party('cocacola'),
      date: '2026-10-20',
      applications: [
        { lineId: r.item('E7.F1'), amountCents: 50_000_000 },
        { lineId: r.item('E7.F2'), amountCents: 38_000_000 },
      ],
      methods: [
        { type: 'treasury', treasuryAccountId: r.treasury('banco'), amountCents: 100_000_000 },
      ],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'payment',
        party: 'cocacola',
        date: '2026-10-20',
        totalCents: 100_000_000,
        lines: [
          D(sys('payable_suppliers'), 100_000_000, 'control', { party: 'cocacola' }),
          H(box('banco'), 100_000_000, 'treasury', { treasury: 'banco' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.F1' },
        cents: 50_000_000,
        kind: 'payment',
      },
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.F2' },
        cents: 38_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

/** E7 · IIBB de octubre a Rentas compensando SIRCUPA y retenciones, el resto con el banco. */
export const E7_IIBB: PostingFixture<PaymentBuildInput> = {
  id: 'E7-iibb',
  title: 'IIBB de octubre compensando saldos a favor',
  openItems: ['E7.IIBB'],
  input: (r) =>
    paymentInput({
      partyId: r.party('rentas'),
      date: '2026-10-31',
      applications: [{ lineId: r.item('E7.IIBB'), amountCents: 380_000_000 }],
      methods: [
        { type: 'compensation', accountId: r.account('iibb_sircupa'), amountCents: 140_000_000 },
        {
          type: 'compensation',
          accountId: r.account('iibb_withholdings'),
          amountCents: 60_000_000,
        },
        { type: 'treasury', treasuryAccountId: r.treasury('banco'), amountCents: 180_000_000 },
      ],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'payment',
        party: 'rentas',
        date: '2026-10-31',
        totalCents: 380_000_000,
        lines: [
          D(sys('iibb_payable'), 380_000_000, 'control', { party: 'rentas' }),
          H(sys('iibb_sircupa'), 140_000_000, 'compensation', { tax: 'sircupa' }),
          H(sys('iibb_withholdings'), 60_000_000, 'compensation', { tax: 'ret_iibb' }),
          H(box('banco'), 180_000_000, 'treasury', { treasury: 'banco' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.IIBB' },
        cents: 380_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

/** E7 · diferencia chica: factura de $ 860.000 pagada con $ 859.997 → 300 a descuentos obtenidos. */
export const E7_WRITE_OFF: PostingFixture<PaymentBuildInput> = {
  id: 'E7-diferencia',
  title: 'Diferencia chica dada por cancelada',
  openItems: ['E7.FW'],
  input: (r) =>
    paymentInput({
      warningsAck: ['write_off'],
      partyId: r.party('cocacola'),
      date: '2026-10-24',
      applications: [{ lineId: r.item('E7.FW'), amountCents: 86_000_000 }],
      methods: [
        { type: 'treasury', treasuryAccountId: r.treasury('banco'), amountCents: 85_999_700 },
      ],
      writeOffCents: 300,
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'payment',
        party: 'cocacola',
        date: '2026-10-24',
        totalCents: 86_000_000,
        lines: [
          D(sys('payable_suppliers'), 86_000_000, 'control', { party: 'cocacola' }),
          H(box('banco'), 85_999_700, 'treasury', { treasury: 'banco' }),
          H(sys('discounts_obtained'), 300, 'write_off'),
        ],
      },
    ],
    allocations: [
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.FW' },
        cents: 86_000_000,
        kind: 'payment',
      },
    ],
    warnings: ['write_off'],
  },
}

/** Pago que usa primero la NC de E6 (saldo a favor) y después la plata: imputación FIFO. */
export const E7_WITH_CREDIT: PostingFixture<PaymentBuildInput> = {
  id: 'E7-con-nc',
  title: 'Pago que consume primero la nota de crédito',
  openItems: ['E7.F2', 'E7.NC'],
  input: (r) =>
    paymentInput({
      partyId: r.party('cocacola'),
      date: '2026-10-21',
      applications: [{ lineId: r.item('E7.F2'), amountCents: 38_000_000 }],
      creditsUsed: [{ lineId: r.item('E7.NC'), amountCents: 6_050_000 }],
      methods: [{ type: 'treasury', treasuryAccountId: r.treasury('mp'), amountCents: 31_950_000 }],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'payment',
        party: 'cocacola',
        date: '2026-10-21',
        totalCents: 31_950_000,
        lines: [
          D(sys('payable_suppliers'), 31_950_000, 'control', { party: 'cocacola' }),
          H(box('mp'), 31_950_000, 'treasury', { treasury: 'mp' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E7.NC' },
        credit: { item: 'E7.F2' },
        cents: 6_050_000,
        kind: 'credit_note',
      },
      {
        debit: { doc: 'd1', lineNo: 1 },
        credit: { item: 'E7.F2' },
        cents: 31_950_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

// ─── E.5.6 · Cierre del día ──────────────────────────────────────────────────

/** E8 · cierre del lunes 05/10/2026 con efectivo contado (faltan $ 500). */
export const E8: PostingFixture<SalesCloseBuildInput> = {
  id: 'E8',
  title: 'Cierre del lunes 05/10',
  input: (r) =>
    salesCloseInput({
      date: '2026-10-05',
      methods: [
        { salesMethodId: r.method('cash'), amountCents: 35_000_000 },
        { salesMethodId: r.method('transfer'), amountCents: 18_000_000 },
        { salesMethodId: r.method('qr'), amountCents: 22_000_000 },
        { salesMethodId: r.method('debit'), amountCents: 41_000_000 },
        { salesMethodId: r.method('credit'), amountCents: 33_000_000 },
        { salesMethodId: r.method('pedidosya'), amountCents: 15_000_000 },
        { salesMethodId: r.method('rappi'), amountCents: 6_000_000 },
      ],
      invoiced: [
        {
          voucherType: 'factura_b',
          pointOfSale: 3,
          numberFrom: 14_501,
          numberTo: 14_662,
          channel: 'salon',
          totalCents: 121_000_000,
        },
        {
          voucherType: 'factura_b',
          pointOfSale: 4,
          numberFrom: 2_101,
          numberTo: 2_130,
          channel: 'delivery',
          totalCents: 18_150_000,
        },
      ],
      cashCountedCents: 34_950_000,
      controlTotalCents: 170_000_000,
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'sales_close',
        voucherType: null,
        party: null,
        date: '2026-10-05',
        totalCents: 170_000_000,
        lines: [
          D(box('caja'), 34_950_000, 'treasury', { treasury: 'caja', method: 'cash' }),
          D(sys('cash_short'), 50_000, 'cash_diff'),
          D(sys('receivable_wallets'), 18_000_000, 'receivable', {
            party: 'mercadopago',
            method: 'transfer',
            due: '2026-10-05',
          }),
          D(sys('receivable_wallets'), 22_000_000, 'receivable', {
            party: 'mercadopago',
            method: 'qr',
            due: '2026-10-05',
          }),
          D(sys('receivable_debit_cards'), 41_000_000, 'receivable', {
            party: 'posnetDebito',
            method: 'debit',
            due: '2026-10-06',
          }),
          D(sys('receivable_credit_cards'), 33_000_000, 'receivable', {
            party: 'posnetCredito',
            method: 'credit',
            due: '2026-10-15',
          }),
          D(sys('receivable_platforms'), 15_000_000, 'receivable', {
            party: 'pedidosya',
            method: 'pedidosya',
            due: '2026-10-19',
          }),
          D(sys('receivable_platforms'), 6_000_000, 'receivable', {
            party: 'rappi',
            method: 'rappi',
            due: '2026-10-19',
          }),
          H(sys('sales_salon_invoiced'), 100_000_000, 'sales_invoiced', { channel: 'salon' }),
          H(sys('sales_salon_uninvoiced'), 28_000_000, 'sales_uninvoiced', { channel: 'salon' }),
          H(sys('sales_delivery_invoiced'), 15_000_000, 'sales_invoiced', { channel: 'delivery' }),
          H(sys('sales_delivery_uninvoiced'), 2_850_000, 'sales_uninvoiced', {
            channel: 'delivery',
          }),
          H(sys('vat_debit'), 24_150_000, 'vat', {
            rate: 2100,
            base: 115_000_000,
            computed: 24_150_000,
            tax: 'iva',
          }),
        ],
        fiscal: [
          {
            book: 'sales',
            voucherType: 'factura_b',
            date: '2026-10-05',
            pointOfSale: 3,
            numberFrom: 14_501,
            numberTo: 14_662,
            channel: 'salon',
            counterparty: 'final_consumer',
            amounts: {
              net_21_cents: 100_000_000,
              vat_21_cents: 21_000_000,
              total_cents: 121_000_000,
            },
          },
          {
            book: 'sales',
            voucherType: 'factura_b',
            date: '2026-10-05',
            pointOfSale: 4,
            numberFrom: 2_101,
            numberTo: 2_130,
            channel: 'delivery',
            counterparty: 'final_consumer',
            amounts: { net_21_cents: 15_000_000, vat_21_cents: 3_150_000, total_cents: 18_150_000 },
          },
        ],
      },
    ],
    warnings: [],
  },
}

const E8B_METHODS = (r: FixtureResolver) => [
  { salesMethodId: r.method('cash'), amountCents: 20_000_000 },
  { salesMethodId: r.method('transfer'), amountCents: 10_000_000 },
  { salesMethodId: r.method('qr'), amountCents: 5_000_000 },
  { salesMethodId: r.method('debit'), amountCents: 15_000_000 },
  { salesMethodId: r.method('pedidosya'), amountCents: 8_000_000 },
  {
    salesMethodId: r.method('customerAccount'),
    amountCents: 12_100_000,
    customers: [{ partyId: r.party('empresaX'), amountCents: 12_100_000 }],
  },
]

const E8B_INVOICED = (r: FixtureResolver, deliveryTotal: Cents) => [
  {
    voucherType: 'factura_b',
    pointOfSale: 3,
    numberFrom: 14_663,
    numberTo: 14_720,
    channel: 'salon',
    totalCents: 36_300_000,
  },
  {
    voucherType: 'nota_credito_b',
    pointOfSale: 3,
    numberFrom: 45,
    numberTo: 45,
    channel: 'salon',
    totalCents: 1_210_000,
  },
  {
    voucherType: 'factura_a',
    pointOfSale: 3,
    numberFrom: 89,
    numberTo: 89,
    channel: 'events',
    partyId: r.party('empresaX'),
    totalCents: 12_100_000,
  },
  {
    voucherType: 'factura_b',
    pointOfSale: 4,
    numberFrom: 2_131,
    numberTo: 2_140,
    channel: 'delivery',
    totalCents: deliveryTotal,
  },
]

const E8B_DEBITS: GoldenLine[] = [
  D(box('caja'), 20_000_000, 'treasury', { treasury: 'caja', method: 'cash' }),
  D(sys('receivable_wallets'), 10_000_000, 'receivable', {
    party: 'mercadopago',
    method: 'transfer',
    due: '2026-10-06',
  }),
  D(sys('receivable_wallets'), 5_000_000, 'receivable', {
    party: 'mercadopago',
    method: 'qr',
    due: '2026-10-06',
  }),
  D(sys('receivable_debit_cards'), 15_000_000, 'receivable', {
    party: 'posnetDebito',
    method: 'debit',
    due: '2026-10-07',
  }),
  D(sys('receivable_platforms'), 8_000_000, 'receivable', {
    party: 'pedidosya',
    method: 'pedidosya',
    due: '2026-10-20',
  }),
  D(sys('receivable_customers'), 12_100_000, 'receivable', {
    party: 'empresaX',
    method: 'customerAccount',
    due: '2026-11-05',
  }),
]

const e8bFiscal = (deliveryNet: Cents, deliveryVat: Cents): GoldenFiscal[] => [
  {
    book: 'sales',
    voucherType: 'factura_b',
    date: '2026-10-06',
    pointOfSale: 3,
    numberFrom: 14_663,
    numberTo: 14_720,
    channel: 'salon',
    counterparty: 'final_consumer',
    amounts: { net_21_cents: 30_000_000, vat_21_cents: 6_300_000, total_cents: 36_300_000 },
  },
  {
    book: 'sales',
    voucherType: 'nota_credito_b',
    isCreditNote: true,
    date: '2026-10-06',
    pointOfSale: 3,
    numberFrom: 45,
    numberTo: 45,
    channel: 'salon',
    counterparty: 'final_consumer',
    amounts: { net_21_cents: 1_000_000, vat_21_cents: 210_000, total_cents: 1_210_000 },
  },
  {
    book: 'sales',
    voucherType: 'factura_a',
    date: '2026-10-06',
    pointOfSale: 3,
    numberFrom: 89,
    numberTo: 89,
    channel: 'events',
    counterparty: 'empresaX',
    amounts: { net_21_cents: 10_000_000, vat_21_cents: 2_100_000, total_cents: 12_100_000 },
  },
  {
    book: 'sales',
    voucherType: 'factura_b',
    date: '2026-10-06',
    pointOfSale: 4,
    numberFrom: 2_131,
    numberTo: 2_140,
    channel: 'delivery',
    counterparty: 'final_consumer',
    amounts: {
      net_21_cents: deliveryNet,
      vat_21_cents: deliveryVat,
      total_cents: deliveryNet + deliveryVat,
    },
  },
]

/** E8b · cierre del martes 06/10 con NC B, Factura A en cuenta corriente y tres canales. */
export const E8B: PostingFixture<SalesCloseBuildInput> = {
  id: 'E8b',
  title: 'Cierre del martes 06/10 con NC, A y tres canales',
  input: (r) =>
    salesCloseInput({
      date: '2026-10-06',
      methods: E8B_METHODS(r),
      invoiced: E8B_INVOICED(r, 6_050_000),
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'sales_close',
        date: '2026-10-06',
        totalCents: 70_100_000,
        lines: [
          ...E8B_DEBITS,
          H(sys('sales_salon_invoiced'), 29_000_000, 'sales_invoiced', { channel: 'salon' }),
          H(sys('sales_salon_uninvoiced'), 14_910_000, 'sales_uninvoiced', { channel: 'salon' }),
          H(sys('sales_delivery_invoiced'), 5_000_000, 'sales_invoiced', { channel: 'delivery' }),
          H(sys('sales_delivery_uninvoiced'), 1_950_000, 'sales_uninvoiced', {
            channel: 'delivery',
          }),
          H(sys('sales_events_invoiced'), 10_000_000, 'sales_invoiced', { channel: 'events' }),
          H(sys('vat_debit'), 9_240_000, 'vat', {
            rate: 2100,
            base: 44_000_000,
            computed: 9_240_000,
            tax: 'iva',
          }),
        ],
        fiscal: e8bFiscal(5_000_000, 1_050_000),
      },
    ],
    warnings: [],
  },
}

/**
 * E8b con override: delivery facturó 9.680.000 contra 8.000.000 vendidos (una
 * factura de una venta sin factura del día anterior), aceptado con motivo →
 * D Ventas delivery: sin factura 1.680.000.
 */
export const E8B_OVERRIDE: PostingFixture<SalesCloseBuildInput> = {
  id: 'E8b-override',
  title: 'Facturado de más en delivery, confirmado con motivo',
  input: (r) =>
    salesCloseInput({
      warningsAck: ['invoiced_exceeds_sold'],
      overrideReason: 'Factura de una venta del lunes',
      date: '2026-10-06',
      methods: E8B_METHODS(r),
      invoiced: E8B_INVOICED(r, 9_680_000),
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'sales_close',
        date: '2026-10-06',
        totalCents: 70_100_000,
        overrideReason: 'Factura de una venta del lunes',
        lines: [
          ...E8B_DEBITS,
          H(sys('sales_salon_invoiced'), 29_000_000, 'sales_invoiced', { channel: 'salon' }),
          H(sys('sales_salon_uninvoiced'), 14_910_000, 'sales_uninvoiced', { channel: 'salon' }),
          H(sys('sales_delivery_invoiced'), 8_000_000, 'sales_invoiced', { channel: 'delivery' }),
          D(sys('sales_delivery_uninvoiced'), 1_680_000, 'sales_uninvoiced', {
            channel: 'delivery',
          }),
          H(sys('sales_events_invoiced'), 10_000_000, 'sales_invoiced', { channel: 'events' }),
          H(sys('vat_debit'), 9_870_000, 'vat', {
            rate: 2100,
            base: 47_000_000,
            computed: 9_870_000,
            tax: 'iva',
          }),
        ],
        fiscal: e8bFiscal(8_000_000, 1_680_000),
      },
    ],
    warnings: ['invoiced_exceeds_sold'],
  },
}

// ─── E.5.7 · Cobranzas ───────────────────────────────────────────────────────

/** E9 · acreditación de crédito del 05/10 con la liquidación Posnet N° 004512 (en el libro IVA). */
export const E9: PostingFixture<CollectionBuildInput> = {
  id: 'E9',
  title: 'Acreditación de crédito con liquidación',
  openItems: ['E8.credit'],
  input: (r) =>
    collectionInput({
      partyId: r.party('posnetCredito'),
      date: '2026-10-15',
      applications: [{ lineId: r.item('E8.credit'), amountCents: 33_000_000 }],
      grossCents: 33_000_000,
      received: [{ treasuryAccountId: r.treasury('banco'), amountCents: 31_555_260 }],
      deductions: [
        { taxKind: 'comision', amountCents: 594_000 },
        { taxKind: 'iva_comision', amountCents: 124_740 },
        { taxKind: 'ret_iibb', amountCents: 396_000 },
        { taxKind: 'ret_ganancias', amountCents: 330_000, certificateNumber: '0001-00004567' },
      ],
      commissionVoucher: {
        mode: 'included',
        voucherType: 'liquidacion',
        pointOfSale: 0,
        number: 4512,
        issueDate: '2026-10-15',
      },
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'collection',
        voucherType: 'liquidacion',
        party: 'posnetCredito',
        date: '2026-10-15',
        pointOfSale: 0,
        number: 4512,
        totalCents: 33_000_000,
        lines: [
          D(box('banco'), 31_555_260, 'treasury', { treasury: 'banco' }),
          D(sys('fees_cards'), 594_000, 'deduction', { tax: 'comision' }),
          D(sys('vat_credit'), 124_740, 'deduction', { tax: 'iva_comision' }),
          D(sys('iibb_withholdings'), 396_000, 'deduction', { tax: 'ret_iibb' }),
          D(sys('income_tax_withholdings'), 330_000, 'deduction', {
            tax: 'ret_ganancias',
            certificate: '0001-00004567',
          }),
          H(sys('receivable_credit_cards'), 33_000_000, 'control', { party: 'posnetCredito' }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'liquidacion',
            date: '2026-10-15',
            pointOfSale: 0,
            numberFrom: 4512,
            counterparty: 'posnetCredito',
            amounts: {
              net_21_cents: 594_000,
              vat_21_cents: 124_740,
              total_cents: 718_740,
              vat_computable_cents: 124_740,
            },
          },
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E8.credit' },
        credit: { doc: 'd1', lineNo: 6 },
        cents: 33_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

const E10_INPUT = (r: FixtureResolver, commissionVoucher: Record<string, unknown>) =>
  collectionInput({
    partyId: r.party('pedidosya'),
    date: '2026-10-20',
    applications: [{ lineId: r.item('E10.pya'), amountCents: 100_000_000 }],
    received: [{ treasuryAccountId: r.treasury('banco'), amountCents: 69_750_000 }],
    deductions: [
      { taxKind: 'comision', amountCents: 25_000_000 },
      { taxKind: 'iva_comision', amountCents: 5_250_000 },
    ],
    commissionVoucher,
  })

/** E10 · liquidación semanal de PedidosYa con la factura de comisiones «llega después» → IVA a documentar. */
export const E10: PostingFixture<CollectionBuildInput> = {
  id: 'E10',
  title: 'Liquidación de PedidosYa con factura mensual',
  openItems: ['E10.pya'],
  input: (r) => E10_INPUT(r, { mode: 'later' }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'collection',
        voucherType: null,
        party: 'pedidosya',
        date: '2026-10-20',
        totalCents: 100_000_000,
        lines: [
          D(box('banco'), 69_750_000, 'treasury', { treasury: 'banco' }),
          D(sys('fees_platforms'), 25_000_000, 'deduction', { tax: 'comision' }),
          D(sys('vat_credit_pending'), 5_250_000, 'deduction', {
            tax: 'iva_comision',
            party: 'pedidosya',
          }),
          H(sys('receivable_platforms'), 100_000_000, 'control', { party: 'pedidosya' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E10.pya' },
        credit: { doc: 'd1', lineNo: 4 },
        cents: 100_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

/** E10c · la misma liquidación con la factura de comisiones en la mano: crédito fiscal y libro IVA. */
export const E10C: PostingFixture<CollectionBuildInput> = {
  id: 'E10c',
  title: 'Liquidación de PedidosYa con la factura en mano',
  openItems: ['E10.pya'],
  input: (r) =>
    E10_INPUT(r, {
      mode: 'included',
      voucherType: 'factura_a',
      pointOfSale: 12,
      number: 45_678,
      issueDate: '2026-10-20',
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'collection',
        voucherType: 'factura_a',
        party: 'pedidosya',
        date: '2026-10-20',
        pointOfSale: 12,
        number: 45_678,
        totalCents: 100_000_000,
        lines: [
          D(box('banco'), 69_750_000, 'treasury', { treasury: 'banco' }),
          D(sys('fees_platforms'), 25_000_000, 'deduction', { tax: 'comision' }),
          D(sys('vat_credit'), 5_250_000, 'deduction', { tax: 'iva_comision' }),
          H(sys('receivable_platforms'), 100_000_000, 'control', { party: 'pedidosya' }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'factura_a',
            date: '2026-10-20',
            pointOfSale: 12,
            numberFrom: 45_678,
            counterparty: 'pedidosya',
            amounts: {
              net_21_cents: 25_000_000,
              vat_21_cents: 5_250_000,
              total_cents: 30_250_000,
              vat_computable_cents: 5_250_000,
            },
          },
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E10.pya' },
        credit: { doc: 'd1', lineNo: 4 },
        cents: 100_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

/** E10b · liquidación con neto negativo: no entra plata y queda una partida Haber (le debemos a PedidosYa). */
export const E10B: PostingFixture<CollectionBuildInput> = {
  id: 'E10b',
  title: 'Liquidación de PedidosYa con neto negativo',
  openItems: ['E10b.pya'],
  input: (r) =>
    collectionInput({
      partyId: r.party('pedidosya'),
      date: '2026-10-20',
      applications: [{ lineId: r.item('E10b.pya'), amountCents: 10_000_000 }],
      deductions: [
        { taxKind: 'comision', amountCents: 18_000_000 },
        { taxKind: 'iva_comision', amountCents: 3_780_000 },
      ],
      commissionVoucher: { mode: 'later' },
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'collection',
        party: 'pedidosya',
        date: '2026-10-20',
        totalCents: 21_780_000,
        lines: [
          D(sys('fees_platforms'), 18_000_000, 'deduction', { tax: 'comision' }),
          D(sys('vat_credit_pending'), 3_780_000, 'deduction', {
            tax: 'iva_comision',
            party: 'pedidosya',
          }),
          H(sys('receivable_platforms'), 21_780_000, 'control', { party: 'pedidosya' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E10b.pya' },
        credit: { doc: 'd1', lineNo: 3 },
        cents: 10_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

/** E10 (31/10) · la Factura A 0012-00045678 de comisiones: solo pasa el IVA a crédito fiscal (FIFO). */
export const E10_INVOICE: PostingFixture<PurchaseBuildInput> = {
  id: 'E10-factura',
  title: 'Factura mensual de comisiones de PedidosYa',
  openItems: ['E10.pending'],
  input: (r) =>
    purchaseInput({
      partyId: r.party('pedidosya'),
      voucherType: 'factura_a',
      pointOfSale: 12,
      number: 45_678,
      issueDate: '2026-10-31',
      amountMode: 'detail',
      lines: [
        {
          role: 'net',
          accountId: r.account('fees_platforms'),
          amountCents: 25_000_000,
          vatRateBp: 2100,
        },
      ],
      settlesCommissions: true,
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'purchase',
        voucherType: 'factura_a',
        party: 'pedidosya',
        date: '2026-10-31',
        dueDate: null,
        settlesCommissions: true,
        totalCents: 30_250_000,
        lines: [
          D(sys('vat_credit'), 5_250_000, 'vat', {
            rate: 2100,
            base: 25_000_000,
            computed: 5_250_000,
            tax: 'iva',
          }),
          H(sys('vat_credit_pending'), 5_250_000, 'vat_pending_release', { party: 'pedidosya' }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'factura_a',
            date: '2026-10-31',
            pointOfSale: 12,
            numberFrom: 45_678,
            counterparty: 'pedidosya',
            amounts: {
              net_21_cents: 25_000_000,
              vat_21_cents: 5_250_000,
              total_cents: 30_250_000,
              vat_computable_cents: 5_250_000,
            },
          },
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E10.pending' },
        credit: { doc: 'd1', lineNo: 2 },
        cents: 5_250_000,
        kind: 'manual',
      },
    ],
    warnings: [],
  },
}

/** E16 · anticipo de una empresa para un evento: cobro a cuenta (partida Haber sin vencimiento). */
export const E16_ADVANCE: PostingFixture<CollectionBuildInput> = {
  id: 'E16-anticipo',
  title: 'Anticipo de Empresa X para un evento',
  input: (r) =>
    collectionInput({
      partyId: r.party('empresaX'),
      date: '2026-10-07',
      received: [{ treasuryAccountId: r.treasury('banco'), amountCents: 50_000_000 }],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'collection',
        party: 'empresaX',
        date: '2026-10-07',
        totalCents: 50_000_000,
        lines: [
          D(box('banco'), 50_000_000, 'treasury', { treasury: 'banco' }),
          H(sys('receivable_customers'), 50_000_000, 'control', { party: 'empresaX' }),
        ],
      },
    ],
    allocations: [],
    warnings: [],
  },
}

// ─── E.5.8 · «Ajustar saldo de Mercado Pago» ─────────────────────────────────

/** E17 · el 12/10: libro 50.000.000, la app dice $ 882.000 → entró 38.200.000; 700 sin explicar. */
export const E17: PostingFixture<WalletCheckBuildInput> = {
  id: 'E17',
  title: 'Ajustar saldo de Mercado Pago con desglose',
  openItems: ['E8.transfer', 'E8.qr'],
  input: (r) =>
    walletCheckInput({
      treasuryAccountId: r.treasury('mp'),
      partyId: r.party('mercadopago'),
      date: '2026-10-12',
      countedCents: 88_200_000,
      expectedBookCents: 50_000_000,
      items: [
        { lineId: r.item('E8.transfer'), amountCents: 18_000_000 },
        { lineId: r.item('E8.qr'), amountCents: 22_000_000 },
      ],
      breakdown: [
        { taxKind: 'comision', amountCents: 330_000, salesMethodId: r.method('qr') },
        { taxKind: 'iva_comision', amountCents: 69_300, salesMethodId: r.method('qr') },
        { taxKind: 'sircupa', amountCents: 630_000, salesMethodId: r.method('transfer') },
        { taxKind: 'sircupa', amountCents: 770_000, salesMethodId: r.method('qr') },
      ],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'collection',
        party: 'mercadopago',
        date: '2026-10-12',
        countedCents: 88_200_000,
        expectedBookCents: 50_000_000,
        totalCents: 40_000_000,
        lines: [
          D(box('mp'), 38_200_000, 'treasury', { treasury: 'mp' }),
          D(sys('fees_wallets'), 330_000, 'deduction', { tax: 'comision', method: 'qr' }),
          D(sys('vat_credit_pending'), 69_300, 'deduction', {
            tax: 'iva_comision',
            method: 'qr',
            party: 'mercadopago',
          }),
          D(sys('iibb_sircupa'), 630_000, 'deduction', { tax: 'sircupa', method: 'transfer' }),
          D(sys('iibb_sircupa'), 770_000, 'deduction', { tax: 'sircupa', method: 'qr' }),
          D(sys('reconciliation_differences'), 700, 'deduction', { tax: 'diferencia' }),
          H(sys('receivable_wallets'), 40_000_000, 'control', { party: 'mercadopago' }),
        ],
      },
    ],
    allocations: [
      {
        debit: { item: 'E8.transfer' },
        credit: { doc: 'd1', lineNo: 7 },
        cents: 18_000_000,
        kind: 'payment',
      },
      {
        debit: { item: 'E8.qr' },
        credit: { doc: 'd1', lineNo: 7 },
        cents: 22_000_000,
        kind: 'payment',
      },
    ],
    warnings: [],
  },
}

// ─── E.5.9 · Factura de venta suelta ─────────────────────────────────────────

/** E16 (cont.) · Factura A 0003-00000088 a Empresa X por el evento (neto 60.000.000 + IVA). */
export const E16_INVOICE: PostingFixture<SalesInvoiceBuildInput> = {
  id: 'E16-factura',
  title: 'Factura A de venta a Empresa X',
  input: (r) =>
    salesInvoiceInput({
      partyId: r.party('empresaX'),
      voucherType: 'factura_a',
      pointOfSale: 3,
      number: 88,
      issueDate: '2026-10-20',
      aliquots: [{ vatRateBp: 2100, netCents: 60_000_000 }],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'sales_invoice',
        voucherType: 'factura_a',
        party: 'empresaX',
        date: '2026-10-20',
        dueDate: '2026-11-19',
        pointOfSale: 3,
        number: 88,
        totalCents: 72_600_000,
        lines: [
          D(sys('receivable_customers'), 72_600_000, 'control', {
            party: 'empresaX',
            due: '2026-11-19',
          }),
          H(sys('sales_events_invoiced'), 60_000_000, 'sales_invoiced', { channel: 'events' }),
          H(sys('vat_debit'), 12_600_000, 'vat', {
            rate: 2100,
            base: 60_000_000,
            computed: 12_600_000,
            tax: 'iva',
          }),
        ],
        fiscal: [
          {
            book: 'sales',
            voucherType: 'factura_a',
            date: '2026-10-20',
            pointOfSale: 3,
            numberFrom: 88,
            numberTo: 88,
            channel: 'events',
            counterparty: 'empresaX',
            amounts: {
              net_21_cents: 60_000_000,
              vat_21_cents: 12_600_000,
              total_cents: 72_600_000,
            },
          },
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.10–E.5.12 · Cajas y bancos ──────────────────────────────────────────

/** E11 · depósito del efectivo: Caja → Banco Nación. */
export const E11: PostingFixture<TransferBuildInput> = {
  id: 'E11',
  title: 'Depósito del efectivo en el banco',
  input: (r) =>
    transferInput({
      fromTreasuryId: r.treasury('caja'),
      toTreasuryId: r.treasury('banco'),
      amountCents: 50_000_000,
      date: '2026-10-06',
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'transfer',
        date: '2026-10-06',
        totalCents: 50_000_000,
        lines: [
          D(box('banco'), 50_000_000, 'treasury', { treasury: 'banco' }),
          H(box('caja'), 50_000_000, 'treasury', { treasury: 'caja' }),
        ],
      },
    ],
    // Sin `warnings`: con la caja del contexto de prueba ($ 150.000) el depósito la deja en
    // negativo y avisa `treasury_negative`; eso depende del saldo, no del ejemplo.
  },
}

/** E12 · resumen del Banco Nación de octubre con Ley 25.413 (33 % computable) y SIRCREB, en el libro IVA. */
export const E12: PostingFixture<BankExpenseBuildInput> = {
  id: 'E12',
  title: 'Resumen del Banco Nación de octubre',
  input: (r) =>
    bankExpenseInput({
      treasuryAccountId: r.treasury('banco'),
      date: '2026-10-31',
      includeInIvaBook: true,
      voucher: { voucherType: 'resumen_bancario', pointOfSale: 1, number: 202_610 },
      feesNetCents: 800_000,
      vatRateBp: 2100,
      ley25413CreditCents: 180_000,
      ley25413DebitCents: 120_000,
      sircrebCents: 250_000,
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'bank_expense',
        voucherType: 'resumen_bancario',
        party: 'bancoNacion',
        date: '2026-10-31',
        pointOfSale: 1,
        number: 202_610,
        totalCents: 1_518_000,
        lines: [
          D(sys('bank_fees'), 800_000, 'net', { rate: 2100, base: 800_000 }),
          D(sys('vat_credit'), 168_000, 'vat', {
            rate: 2100,
            base: 800_000,
            computed: 168_000,
            tax: 'iva',
          }),
          D(sys('bank_tax_credit'), 59_400, 'other_tax', { tax: 'ley_25413_credito' }),
          D(sys('bank_tax_expense'), 120_600, 'other_tax', { tax: 'ley_25413_credito' }),
          D(sys('bank_tax_credit'), 39_600, 'other_tax', { tax: 'ley_25413_debito' }),
          D(sys('bank_tax_expense'), 80_400, 'other_tax', { tax: 'ley_25413_debito' }),
          D(sys('iibb_sircreb'), 250_000, 'other_tax', { tax: 'sircreb' }),
          H(box('banco'), 1_518_000, 'treasury', { treasury: 'banco' }),
        ],
        fiscal: [
          {
            book: 'purchases',
            voucherType: 'resumen_bancario',
            date: '2026-10-31',
            pointOfSale: 1,
            numberFrom: 202_610,
            counterparty: 'bancoNacion',
            amounts: {
              net_21_cents: 800_000,
              vat_21_cents: 168_000,
              total_cents: 968_000,
              vat_computable_cents: 168_000,
            },
          },
        ],
      },
    ],
    warnings: [],
  },
}

/** E21 · Máximo retira $ 100.000 de la caja. */
export const E21: PostingFixture<CashMovementBuildInput> = {
  id: 'E21',
  title: 'Retiro de un socio de la caja',
  input: (r) =>
    cashMovementInput({
      treasuryAccountId: r.treasury('caja'),
      direction: 'out',
      counterpartAccountId: r.account('partners_current'),
      partyId: r.party('maximo'),
      amountCents: 10_000_000,
      date: '2026-10-15',
      shortcut: 'partner_withdrawal',
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'cash_movement',
        party: 'maximo',
        date: '2026-10-15',
        totalCents: 10_000_000,
        lines: [
          D(sys('partners_current'), 10_000_000, 'counterpart', { party: 'maximo' }),
          H(box('caja'), 10_000_000, 'treasury', { treasury: 'caja' }),
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.13 · Arqueo ─────────────────────────────────────────────────────────

/** E18 · caja el 31/10: libro 45.230.000, contado 45.000.000 → faltan 230.000. */
export const E18: PostingFixture<TreasuryAdjustmentBuildInput> = {
  id: 'E18',
  title: 'Arqueo de caja con faltante',
  input: (r) =>
    treasuryAdjustmentInput({
      treasuryAccountId: r.treasury('caja'),
      date: '2026-10-31',
      countedCents: 45_000_000,
      expectedBookCents: 45_230_000,
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'treasury_adjustment',
        date: '2026-10-31',
        countedCents: 45_000_000,
        expectedBookCents: 45_230_000,
        totalCents: 230_000,
        lines: [
          D(sys('cash_short'), 230_000, 'adjustment_split', { tax: 'diferencia' }),
          H(box('caja'), 230_000, 'treasury', { treasury: 'caja' }),
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.14 · Asiento manual y sueldos ───────────────────────────────────────

const E13_DOC: GoldenDocument = {
  ref: 'd1',
  kind: 'manual',
  entryKind: 'payroll',
  date: '2026-10-31',
  totalCents: 558_000_000,
  lines: [
    D(sys('salaries'), 450_000_000, 'manual'),
    D(sys('employer_contributions'), 108_000_000, 'manual'),
    H(sys('payroll_payable'), 373_500_000, 'manual', { party: 'personal', due: '2026-11-05' }),
    H(sys('social_security_payable'), 184_500_000, 'manual', {
      party: 'arcaSs',
      due: '2026-11-09',
    }),
  ],
}

/** E13 · sueldos de octubre con la plantilla (brutos 4.500.000, contribuciones 1.080.000, aportes 765.000). */
export const E13: PostingFixture<PayrollTemplateBuildInput> = {
  id: 'E13',
  title: 'Sueldos del mes con la plantilla',
  input: () =>
    payrollInput({
      grossSalariesCents: 450_000_000,
      employerContributionsCents: 108_000_000,
      withheldContributionsCents: 76_500_000,
      date: '2026-10-31',
      salariesDueDate: '2026-11-05',
      socialSecurityDueDate: '2026-11-09',
    }),
  expect: { documents: [E13_DOC], warnings: [] },
}

/** E13 · el mismo asiento cargado a mano en la grilla. */
export const E13_MANUAL: PostingFixture<ManualEntryBuildInput> = {
  id: 'E13-manual',
  title: 'Sueldos del mes cargados a mano',
  input: (r) =>
    manualEntryInput({
      entryKind: 'payroll',
      date: '2026-10-31',
      description: 'Sueldos de octubre',
      lines: [
        { accountId: r.account('salaries'), debitCents: 450_000_000 },
        { accountId: r.account('employer_contributions'), debitCents: 108_000_000 },
        {
          accountId: r.account('payroll_payable'),
          creditCents: 373_500_000,
          partyId: r.party('personal'),
          dueDate: '2026-11-05',
        },
        {
          accountId: r.account('social_security_payable'),
          creditCents: 184_500_000,
          partyId: r.party('arcaSs'),
          dueDate: '2026-11-09',
        },
      ],
    }),
  expect: { documents: [E13_DOC], warnings: [] },
}

/** E20 · la amortización del año como ajuste de cierre (31/12/2026), cargada en febrero. */
export const E20_ADJUSTMENT: PostingFixture<ManualEntryBuildInput> = {
  id: 'E20-ajuste',
  title: 'Amortización del año como ajuste de cierre',
  today: '2027-02-15',
  validate: { fiscalYearEndDate: '2026-12-31' },
  input: (r) =>
    manualEntryInput({
      entryKind: 'fy_adjustment',
      date: '2026-12-31',
      description: 'Amortización de bienes de uso 2026',
      lines: [
        { accountId: r.account('depreciation'), debitCents: 2_500_000 },
        { accountId: r.account('accumulated_depreciation'), creditCents: 2_500_000 },
      ],
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'manual',
        entryKind: 'fy_adjustment',
        date: '2026-12-31',
        totalCents: 2_500_000,
        lines: [
          D(sys('depreciation'), 2_500_000, 'manual'),
          H(sys('accumulated_depreciation'), 2_500_000, 'manual'),
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.15 · Liquidación de IVA ─────────────────────────────────────────────

/** E15a · octubre, a pagar 89.140.000 (vence el 20/11). */
export const E15A: PostingFixture<IvaSettlementInput> = {
  id: 'E15a',
  title: 'Liquidación de IVA de octubre (a pagar)',
  input: () => ({
    month: '2026-10',
    figures: { df: 131_040_000, cf: 41_000_000, perc: 600_000, ret: 300_000, st0: 0, ld0: 0 },
  }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'iva_settlement',
        entryKind: 'iva_settlement',
        party: 'arca',
        date: '2026-10-31',
        dueDate: '2026-11-20',
        totalCents: 131_040_000,
        lines: [
          D(sys('vat_debit'), 131_040_000, 'settlement'),
          H(sys('vat_credit'), 41_000_000, 'settlement'),
          H(sys('vat_perceptions'), 600_000, 'settlement'),
          H(sys('vat_withholdings'), 300_000, 'settlement'),
          H(sys('vat_payable'), 89_140_000, 'settlement', { party: 'arca', due: '2026-11-20' }),
        ],
      },
    ],
    warnings: [],
  },
}

/** E15b · mes de compra de equipamiento: saldo técnico y libre disponibilidad a favor. */
export const E15B: PostingFixture<IvaSettlementInput> = {
  id: 'E15b',
  title: 'Liquidación de IVA a favor',
  input: () => ({
    month: '2026-11',
    figures: { df: 20_000_000, cf: 35_000_000, perc: 500_000, ret: 0, st0: 0, ld0: 0 },
  }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'iva_settlement',
        party: 'arca',
        date: '2026-11-30',
        dueDate: null,
        totalCents: 35_500_000,
        lines: [
          D(sys('vat_debit'), 20_000_000, 'settlement'),
          H(sys('vat_credit'), 35_000_000, 'settlement'),
          D(sys('vat_technical_balance'), 15_000_000, 'settlement'),
          H(sys('vat_perceptions'), 500_000, 'settlement'),
          D(sys('vat_free_balance'), 500_000, 'settlement'),
        ],
      },
    ],
    warnings: [],
  },
}

/** E15c · el mes siguiente a E15b: consume los saldos a favor y paga 14.300.000. */
export const E15C: PostingFixture<IvaSettlementInput> = {
  id: 'E15c',
  title: 'Liquidación de IVA que usa los saldos a favor',
  input: () => ({
    month: '2026-12',
    figures: {
      df: 60_000_000,
      cf: 30_000_000,
      perc: 200_000,
      ret: 0,
      st0: 15_000_000,
      ld0: 500_000,
    },
  }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'iva_settlement',
        party: 'arca',
        date: '2026-12-31',
        dueDate: '2027-01-20',
        totalCents: 60_000_000,
        lines: [
          D(sys('vat_debit'), 60_000_000, 'settlement'),
          H(sys('vat_credit'), 30_000_000, 'settlement'),
          H(sys('vat_technical_balance'), 15_000_000, 'settlement'),
          H(sys('vat_perceptions'), 200_000, 'settlement'),
          H(sys('vat_free_balance'), 500_000, 'settlement'),
          H(sys('vat_payable'), 14_300_000, 'settlement', { party: 'arca', due: '2027-01-20' }),
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.16 · Apertura ───────────────────────────────────────────────────────

/** E14 · apertura del 01/10/2026: la diferencia (71.000.000) a «Saldo de apertura a asignar». */
export const E14: PostingFixture<OpeningBuildInput> = {
  id: 'E14',
  title: 'Asiento de apertura',
  input: (r) =>
    openingInput({
      treasuries: [
        { treasuryAccountId: r.treasury('caja'), balanceCents: 15_000_000 },
        { treasuryAccountId: r.treasury('mp'), balanceCents: 82_000_000 },
        { treasuryAccountId: r.treasury('banco'), balanceCents: 100_000_000 },
      ],
      receivables: [
        { partyId: r.party('posnetCredito'), amountCents: 12_000_000, dueDate: '2026-10-05' },
      ],
      payables: [
        {
          partyId: r.party('cocacola'),
          amountCents: 38_000_000,
          dueDate: '2026-10-21',
          reference: 'Factura A 0003-00001234',
        },
      ],
      shareCapitalCents: 100_000_000,
    }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'opening',
        entryKind: 'opening',
        date: '2026-10-01',
        totalCents: 209_000_000,
        lines: [
          D(box('caja'), 15_000_000, 'opening'),
          D(box('mp'), 82_000_000, 'opening'),
          D(box('banco'), 100_000_000, 'opening'),
          D(sys('receivable_credit_cards'), 12_000_000, 'opening', {
            party: 'posnetCredito',
            due: '2026-10-05',
          }),
          H(sys('payable_suppliers'), 38_000_000, 'opening', {
            party: 'cocacola',
            due: '2026-10-21',
            reference: 'Factura A 0003-00001234',
          }),
          H(sys('share_capital'), 100_000_000, 'opening'),
          H(sys('opening_equity'), 71_000_000, 'opening'),
        ],
      },
    ],
    warnings: [],
  },
}

// ─── E.5.17 · Anulación de un comprobante de un mes cerrado ──────────────────

/**
 * E19 · la Factura A de E1 se cargó dos veces en octubre (ya cerrado); el 12/11
 * se anula la copia «con fecha de hoy»: el espejo exacto de sus renglones.
 */
export const E19: PostingFixture<ReversalInput> = {
  id: 'E19',
  title: 'Anulación con fecha de hoy de la copia de E1',
  input: (r) => ({
    original: {
      id: r.document('E1.copy'),
      kind: 'purchase',
      description: 'Factura A 0003-00001290 · Coca-Cola (distribuidor)',
      party: { id: r.party('cocacola') },
      accountingDate: '2026-10-03',
      totalCents: 86_000_000,
      lines: goldenLines(E1_LINES, r),
    },
    reversalDate: '2026-11-12',
    reason: 'Error de carga: la factura estaba duplicada',
  }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'reversal',
        entryKind: 'reversal',
        party: 'cocacola',
        date: '2026-11-12',
        totalCents: 86_000_000,
        lines: [
          H(sys('purchases_soft_drinks'), 71_074_380, 'reversal', { rate: 2100, base: 71_074_380 }),
          H(sys('vat_credit'), 14_925_620, 'reversal', {
            rate: 2100,
            base: 71_074_380,
            computed: 14_925_620,
          }),
          D(sys('payable_suppliers'), 86_000_000, 'reversal', {
            party: 'cocacola',
            due: '2026-10-24',
          }),
        ],
      },
    ],
    allocations: [],
    warnings: [],
  },
}

// ─── E.5.18 · Cierre de ejercicio ────────────────────────────────────────────

/**
 * E20 · ejercicio 2026: los saldos de resultados de la especificación más un
 * patrimonio que los balancea (Caja y la amortización acumulada del ajuste).
 */
export const E20_CLOSE: PostingFixture<FiscalYearCloseInput> = {
  id: 'E20',
  title: 'Refundición, cierre patrimonial y apertura del ejercicio 2026',
  today: '2027-03-01',
  input: (r) => ({
    endDate: '2026-12-31',
    label: '2026',
    balances: [
      { accountId: r.account('sales_salon_invoiced'), balanceCents: -105_665_245 },
      { accountId: r.account('purchases_soft_drinks'), balanceCents: 71_074_380 },
      { accountId: r.account('depreciation'), balanceCents: 2_500_000 },
      { accountId: r.treasuryAccount('caja'), balanceCents: 34_590_865 },
      { accountId: r.account('accumulated_depreciation'), balanceCents: -2_500_000 },
    ],
  }),
  expect: {
    documents: [
      {
        ref: 'd1',
        kind: 'fy_result',
        entryKind: 'fy_result',
        date: '2026-12-31',
        totalCents: 105_665_245,
        lines: [
          // En orden de código del plan (#16): ventas 4.1, amortizaciones 4.2, compras 5.1.
          D(sys('sales_salon_invoiced'), 105_665_245, 'fy_result'),
          H(sys('depreciation'), 2_500_000, 'fy_result'),
          H(sys('purchases_soft_drinks'), 71_074_380, 'fy_result'),
          H(sys('current_year_result'), 32_090_865, 'fy_result'),
        ],
      },
      {
        ref: 'd2',
        kind: 'fy_closing',
        entryKind: 'fy_closing',
        date: '2026-12-31',
        totalCents: 34_590_865,
        lines: [
          H(box('caja'), 34_590_865, 'mirror'),
          D(sys('accumulated_depreciation'), 2_500_000, 'mirror'),
          D(sys('current_year_result'), 32_090_865, 'mirror'),
        ],
      },
      {
        ref: 'd3',
        kind: 'fy_opening',
        entryKind: 'fy_opening',
        date: '2027-01-01',
        totalCents: 34_590_865,
        lines: [
          D(box('caja'), 34_590_865, 'mirror'),
          H(sys('accumulated_depreciation'), 2_500_000, 'mirror'),
          H(sys('current_year_result'), 32_090_865, 'mirror'),
        ],
      },
    ],
    warnings: [],
  },
}

/** Todos los golden, para recorrerlos (la prueba de base los postea uno por uno). */
export const ALL_FIXTURES = {
  E1,
  E1_TOTAL,
  E2,
  E3,
  E3B,
  DDJJ_IIBB,
  E4,
  E4_QUICK,
  E5,
  E6,
  E7,
  E7_OVERPAY,
  E7_IIBB,
  E7_WRITE_OFF,
  E7_WITH_CREDIT,
  E8,
  E8B,
  E8B_OVERRIDE,
  E9,
  E10,
  E10C,
  E10B,
  E10_INVOICE,
  E11,
  E12,
  E13,
  E13_MANUAL,
  E14,
  E15A,
  E15B,
  E15C,
  E16_ADVANCE,
  E16_INVOICE,
  E17,
  E18,
  E19,
  E20_ADJUSTMENT,
  E20_CLOSE,
  E21,
} as const
