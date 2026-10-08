/**
 * Kit de los tests del servidor de importaciones (WP6): el contexto del motor
 * de los ejemplos de E (`accounting-core-context.ts`), el MISMO catálogo visto
 * como `PostingCatalog` (lo que devuelve `acc_posting_context`), filas
 * preparadas, la evaluación de cada propuesta con el camino de la acción de
 * guardar y una base en memoria para las piezas que hablan con Supabase.
 *
 * No es un test: lo importan `imports-proposals-*.test.ts`, `imports-stage`,
 * `imports-post` e `imports-rebuild`.
 */

import { expect } from 'vitest'
import type {
  AccSettingsRow,
  CatalogAccount,
  CatalogParty,
  CatalogSalesMethod,
  CatalogSalesPoint,
  CatalogTreasury,
  PostingCatalog,
} from '@/lib/accounting/context'
import { buildPrimary, parseDocumentForm } from '@/lib/accounting/server/document-forms'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  IvaCondition,
  OpenItemRef,
  PartyRef,
  PostingContext,
  WarningKey,
} from '@/lib/accounting/types'
import { importClientRef } from '@/lib/imports/hash'
import {
  type EvaluatedProposal,
  evaluateDraft,
  type ImportCatalog,
  importCatalogFrom,
  type ProposalDraft,
  type StagedItem,
} from '@/lib/imports/server/proposals/common'
import type { ImportIssue, ImportRow } from '@/lib/imports/types'
import { SAS_CUIT } from '@/tests/fixtures/imports/synth'
import {
  buildCoreFixture,
  type CoreFixture,
  fixedUuid,
  type PartyFixtureKey,
} from './accounting-core-context'

export const KIT_TENANT = fixedUuid(999_999)
export const KIT_BATCH = '11111111-2222-4333-8444-555555555555'

const SYSTEM_PARTY: Partial<Record<PartyFixtureKey, string>> = {
  mercadopago: 'mercado_pago',
  posnetDebito: 'posnet_debito',
  posnetCredito: 'posnet_credito',
  pedidosya: 'pedidosya',
  rappi: 'rappi',
  arca: 'arca',
  arcaSs: 'arca_ss',
  rentas: 'rentas',
  personal: 'personal',
  senas: 'senas',
}

export type KitSupplier = {
  cuit: string
  name: string
  ivaCondition?: IvaCondition
  /** La cuenta habitual (por clave de sistema); `null` = sin cuenta habitual. */
  account?: SystemAccountKey | null
  active?: boolean
  kind?: PartyRef['kind']
}

export type KitOptions = {
  booksStartDate?: string
  today?: string
  suppliers?: readonly KitSupplier[]
  /** CBU/CVU de las cajas del fixture. */
  cbu?: Partial<Record<'caja' | 'mp' | 'banco', string>>
  openItems?: readonly OpenItemRef[]
  /** Partícipes del fixture sin CUIT (para probar el alta de la CUIT de Mercado Pago). */
  withoutTaxId?: readonly PartyFixtureKey[]
  iibbJurisdictionCode?: number
}

export type Kit = {
  f: CoreFixture
  ctx: PostingContext
  catalog: PostingCatalog
  imp: ImportCatalog
  /** El partícipe de un proveedor agregado por CUIT. */
  supplier: (cuit: string) => PartyRef
  sys: (key: SystemAccountKey) => string
}

/** El contexto del motor y el mismo catálogo como lo devuelve `acc_posting_context`. */
export function makeKit(opts: KitOptions = {}): Kit {
  const f = buildCoreFixture()
  const sysId = (key: SystemAccountKey) => f.sys(key).id
  const parties = new Map(f.ctx.parties)
  const keyOf = new Map<string, PartyFixtureKey>()
  for (const key of Object.keys(SYSTEM_PARTY) as PartyFixtureKey[]) keyOf.set(f.party(key).id, key)
  for (const key of opts.withoutTaxId ?? []) {
    const p = f.party(key)
    parties.set(p.id, { ...p, taxIdType: 'none', taxId: null })
  }
  const defaults = new Map<string, string | null>()
  const bySupplierCuit = new Map<string, PartyRef>()
  let n = 0
  for (const s of opts.suppliers ?? []) {
    n++
    const ref: PartyRef = {
      id: fixedUuid(700_000 + n),
      kind: s.kind ?? 'supplier',
      name: s.name,
      tradeName: null,
      taxIdType: 'cuit',
      taxId: s.cuit,
      ivaCondition: s.ivaCondition ?? 'responsable_inscripto',
      paymentTermDays: 0,
      payableAccountId: sysId('payable_suppliers'),
      receivableAccountId: sysId('receivable_customers'),
      commissionVatMode: 'none',
      rates: {
        commissionBp: null,
        iibbWithholdingBp: null,
        vatWithholdingBp: null,
        incomeTaxWithholdingBp: null,
        sircupaBp: null,
      },
      active: s.active ?? true,
    }
    parties.set(ref.id, ref)
    bySupplierCuit.set(s.cuit, ref)
    const account = s.account === undefined ? 'purchases_soft_drinks' : s.account
    defaults.set(ref.id, account ? sysId(account) : null)
  }

  const treasuries = new Map(f.ctx.treasuries)
  const ctx: PostingContext = {
    ...f.ctx,
    today: opts.today ?? f.ctx.today,
    settings: {
      ...f.ctx.settings,
      booksStartDate: opts.booksStartDate ?? f.ctx.settings.booksStartDate,
    },
    parties,
    treasuries,
    openItems: new Map((opts.openItems ?? []).map((i) => [i.lineId, i])),
  }

  const cbuOf = new Map<string, string>()
  for (const [k, v] of Object.entries(opts.cbu ?? {})) {
    if (v) cbuOf.set(f.treasury(k as 'caja' | 'mp' | 'banco').id, v)
  }
  const settings: AccSettingsRow = {
    tenantId: KIT_TENANT,
    legalName: 'Bar de Prueba SAS',
    cuit: SAS_CUIT,
    ivaCondition: 'responsable_inscripto',
    iibbRegime: 'local',
    iibbNumber: '123456789',
    iibbJurisdictionCode: opts.iibbJurisdictionCode ?? 904,
    activityStartDate: '2020-01-01',
    fiscalAddress: 'Calle Falsa 123',
    booksStartDate: ctx.settings.booksStartDate,
    fiscalYearEndMonth: 12,
    ivaSettlementMode: 'manual',
    ivaDueDay: 20,
    iibbDueDay: 15,
    vatToleranceCents: 1,
    bankTaxCreditComputableBp: 3300,
    bankTaxDebitComputableBp: 3300,
    uninvoicedSalesMode: 'separate_accounts',
    closedPeriodVoidIvaMode: 'adjustment_only',
    dueSoonDays: 7,
    openingStatus: 'posted',
    setupCompletedAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
  }
  const catalog: PostingCatalog = {
    tenantId: KIT_TENANT,
    today: ctx.today,
    settings,
    accounts: [...ctx.accounts.values()].map(
      (a, i): CatalogAccount => ({
        ...a,
        parentId: null,
        level: 5,
        manualSelectable: true,
        sort: i,
      }),
    ),
    parties: [...parties.values()].map(
      (p): CatalogParty => ({
        ...p,
        systemKey: SYSTEM_PARTY[keyOf.get(p.id) ?? ('' as PartyFixtureKey)] ?? null,
        defaultAccountId: defaults.get(p.id) ?? null,
        defaultVoucherType: null,
        updatedAt: '2026-10-01T12:00:00.000Z',
      }),
    ),
    treasuries: [...treasuries.values()].map(
      (t, i): CatalogTreasury => ({
        ...t,
        accountCode: ctx.accounts.get(t.accountId)?.code ?? '',
        bankName: null,
        cbuCvu: cbuOf.get(t.id) ?? null,
        alias: null,
        accountNumber: null,
        lastCheckedOn: null,
        sort: i,
        systemKey: null,
        updatedAt: '2026-10-01T12:00:00.000Z',
      }),
    ),
    methods: [...ctx.methods.values()].map(
      (m): CatalogSalesMethod => ({ ...m, active: true, systemKey: null, updatedAt: null }),
    ),
    salesPoints: [...ctx.salesPoints.values()].map(
      (s, i): CatalogSalesPoint => ({
        ...s,
        id: fixedUuid(800_000 + i),
        active: true,
        updatedAt: null,
      }),
    ),
  }
  return {
    f,
    ctx,
    catalog,
    imp: importCatalogFrom(catalog),
    supplier: (cuit) => {
      const p = bySupplierCuit.get(cuit)
      if (!p) throw new Error(`Falta el proveedor ${cuit}`)
      return p
    },
    sys: sysId,
  }
}

/** Una partida «a acreditar» abierta (lo que dejó un cierre del día). */
export function openReceivable(
  kit: Kit,
  o: {
    n: number
    party: PartyFixtureKey
    method: 'qr' | 'transfer' | 'debit'
    day: string
    cents: number
  },
): OpenItemRef {
  const party = kit.f.party(o.party)
  return {
    lineId: fixedUuid(600_000 + o.n),
    documentId: fixedUuid(610_000 + o.n),
    partyId: party.id,
    accountId: party.receivableAccountId,
    side: 'debit',
    amountCents: o.cents,
    openCents: o.cents,
    entryDate: o.day,
    dueDate: o.day,
    label: `Cierre del ${o.day}`,
    salesMethodId: kit.f.method(o.method).id,
  }
}

/** Una factura abierta de un proveedor (lo que cancela un pago). */
export function openPayable(
  _kit: Kit,
  o: { n: number; partyId: string; payableAccountId: string; day: string; cents: number },
): OpenItemRef {
  return {
    lineId: fixedUuid(620_000 + o.n),
    documentId: fixedUuid(630_000 + o.n),
    partyId: o.partyId,
    accountId: o.payableAccountId,
    side: 'credit',
    amountCents: o.cents,
    openCents: o.cents,
    entryDate: o.day,
    dueDate: o.day,
    label: `Factura del ${o.day}`,
    salesMethodId: null,
  }
}

/** Filas de un parser → filas del lote (ids estables). */
export function stagedFrom<T>(rows: readonly ImportRow<T>[], start = 1): StagedItem<T>[] {
  return rows.map((r, i) => ({
    id: fixedUuid(900_000 + start + i),
    rowNo: r.row,
    key: r.key,
    status: 'new' as const,
    item: r.item,
    issues: [...r.issues] as ImportIssue[],
  }))
}

/** Cada borrador evaluado con el camino de la acción de guardar. */
export function evaluateAll(
  drafts: readonly ProposalDraft[],
  ctx: PostingContext,
  o: { firstOpenDate?: string | null; acks?: (key: string) => WarningKey[] } = {},
): EvaluatedProposal[] {
  return drafts.map((d) =>
    evaluateDraft(d, ctx, {
      firstOpenDate: o.firstOpenDate ?? null,
      warningsAck: o.acks?.(d.key) ?? [],
    }),
  )
}

/**
 * Lo que va a pasar al confirmar: zod del formulario + `build*` con su
 * `client_ref` real, el mismo hash que se mostró y el asiento que cuadra.
 */
export function expectPostable(
  e: EvaluatedProposal,
  ctx: PostingContext,
  o: { firstOpenDate?: string | null; acceptWarnings?: readonly WarningKey[] } = {},
): void {
  expect(e.status, `${e.key}: ${JSON.stringify(e.needs)}`).toBe('ready')
  expect(e.previewHash).toMatch(/^[0-9a-f]{64}$/)
  const form = parseDocumentForm(e.form, {
    ...e.formValues,
    clientRef: importClientRef(KIT_TENANT, e.key, 1),
    previewHash: e.previewHash,
    warningsAck: [...new Set([...e.warningsAck, ...(o.acceptWarnings ?? [])])],
  })
  expect(form.ok, `${e.key}: el formulario no pasa zod`).toBe(true)
  if (!form.ok) return
  const built = buildPrimary(form.value, ctx, o.firstOpenDate ?? null)
  expect(built.ok, `${e.key}: el motor no lo arma`).toBe(true)
  if (!built.ok) return
  expect(built.hash).toBe(e.previewHash)
  for (const entry of built.preview) {
    expect(entry.balanced, `${e.key}: no cuadra`).toBe(true)
    expect(entry.debitCents).toBe(entry.creditCents)
  }
}

export function byKey(list: readonly EvaluatedProposal[], key: string): EvaluatedProposal {
  const found = list.find((p) => p.key === key)
  if (!found) throw new Error(`Falta la propuesta ${key}: ${list.map((p) => p.key).join(', ')}`)
  return found
}

// ─── Una base en memoria (lo justo para las piezas que leen y escriben) ──────

export type Row = Record<string, unknown>
type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: unknown }

/**
 * Supabase de mentira: `from(tabla)` filtra filas en memoria (`eq`, `neq`,
 * `in`, `gte`, `lte`, `lt`, `contains`, `range`, `limit`, `maybeSingle`,
 * `count`) y `rpc(nombre)` llama al manejador del test. Registra todo.
 */
export class FakeDb {
  readonly tables: Record<string, Row[]> = {}
  readonly rpcs = new Map<string, RpcHandler>()
  readonly calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  readonly reads: Array<{ table: string }> = []

  table(name: string): Row[] {
    let t = this.tables[name]
    if (!t) {
      t = []
      this.tables[name] = t
    }
    return t
  }

  on(fn: string, handler: RpcHandler): this {
    this.rpcs.set(fn, handler)
    return this
  }

  client() {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        this.calls.push({ fn, args })
        const handler = this.rpcs.get(fn)
        if (!handler) return { data: null, error: { code: 'PGRST202', message: `sin ${fn}` } }
        return handler(args)
      },
    }
  }

  /** La primera fila de una tabla (falla si está vacía). */
  first(name: string): Row {
    const row = this.table(name)[0]
    if (!row) throw new Error(`La tabla ${name} está vacía`)
    return row
  }

  rpcCalls(fn: string): Array<Record<string, unknown>> {
    return this.calls.filter((c) => c.fn === fn).map((c) => c.args)
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private readonly filters: Array<(r: Row) => boolean> = []
  private from = 0
  private to = Number.POSITIVE_INFINITY
  private single = false
  private counting = false
  private head = false

  constructor(
    private readonly db: FakeDb,
    private readonly name: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.counting = opts?.count === 'exact'
    this.head = opts?.head === true
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v)
    return this
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v)
    return this
  }
  in(col: string, vs: readonly unknown[]) {
    this.filters.push((r) => vs.includes(r[col]))
    return this
  }
  gte(col: string, v: string) {
    this.filters.push((r) => String(r[col] ?? '') >= v)
    return this
  }
  lte(col: string, v: string) {
    this.filters.push((r) => String(r[col] ?? '') <= v)
    return this
  }
  lt(col: string, v: string) {
    this.filters.push((r) => String(r[col] ?? '') < v)
    return this
  }
  contains(col: string, vs: readonly unknown[]) {
    this.filters.push(
      (r) => Array.isArray(r[col]) && vs.every((v) => (r[col] as unknown[]).includes(v)),
    )
    return this
  }
  order() {
    return this
  }
  range(a: number, b: number) {
    this.from = a
    this.to = b
    return this
  }
  limit(n: number) {
    this.to = this.from + n - 1
    return this
  }
  maybeSingle() {
    this.single = true
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: imita el query builder thenable de supabase-js.
  then<A, B>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown; count?: number | null }) => A | PromiseLike<A>)
      | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    this.db.reads.push({ table: this.name })
    const all = this.db.table(this.name).filter((r) => this.filters.every((f) => f(r)))
    const page = all.slice(this.from, Number.isFinite(this.to) ? this.to + 1 : undefined)
    const value = this.single
      ? { data: page[0] ?? null, error: null }
      : { data: this.head ? null : page, error: null, count: this.counting ? all.length : null }
    return Promise.resolve(value).then(onfulfilled, onrejected)
  }
}
