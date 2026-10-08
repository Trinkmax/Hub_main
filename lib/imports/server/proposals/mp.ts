/**
 * Reporte de Liquidaciones de Mercado Pago → comprobantes (diseño §4.2.3).
 *
 * | Movimientos | Comprobante |
 * |---|---|
 * | Cobros del día por canal (QR, Point, link, transferencia de un tercero) | `collection` de Mercado Pago, una por día y por medio del cierre: aplica las partidas «a acreditar» de ese día y medio (lo que no alcanza queda a favor); descuenta la comisión (÷ 1,21), su IVA a documentar (llega con la factura mensual), SIRTAC y SIRCUPA; entra a la billetera el neto + la Ley 25.413 |
 * | Ley 25.413 del día (cobros y pagos) | `bank_expense` sobre la billetera (la deducción de un cobro no la acepta) |
 * | IIBB que Mercado Pago cobró después (`tax_withdholding`) | `cash_movement` sale, contra SIRTAC o SIRCUPA |
 * | Rendimientos (`asset_management`) | `cash_movement` entra (`mp_yield`), uno por mes |
 * | Retiro a una cuenta propia | `transfer` a esa cuenta (si ya está cargada ±3 días, se saltea) |
 * | Retiro a un tercero | `payment` (elegí a quién) |
 * | Débitos de percepciones o de la factura | `payment` a Mercado Pago |
 * | Transferencia desde la propia CUIT | `transfer` desde la cuenta propia (elegí cuál) |
 * | Reservas que se compensan | se ignoran |
 * | Devoluciones, contracargos, propinas, préstamos… o filas que no cierran | para revisar: un movimiento de la billetera contra la cuenta que elija la persona |
 *
 * **Lo cargado a mano** (diseño §4.0, capa 4): los días que ya tienen un cobro
 * o un «Ajustar saldo» de Mercado Pago cargados a mano no se proponen.
 *
 * Las claves de los agregados llevan la marca del lote (`batchTag`): dos
 * reportes que se pisan un día no comparten la clave. Las de una fila usan su
 * clave natural (un retiro no se carga dos veces aunque venga en dos lotes).
 *
 * Puro.
 */

import { netFromGross } from '@/lib/accounting/iva'
import type { IsoDate, OpenItemRef } from '@/lib/accounting/types'
import { MONTH_NAMES } from '@/lib/dates'
import type { ImportIssueCode, MpChannel, MpItem, MpTax } from '../../types'
import {
  compileSafePattern,
  normalizeForMatch,
  type SafePattern,
  safePatternTest,
} from '../safe-pattern'
import {
  type ImportNeed,
  MP_COBRO_CHANNELS,
  type MpCobroChannel,
  type NoteKey,
  type ProposalDecisions,
} from '../types'
import {
  batchTag,
  type DraftSummary,
  dayLabel,
  genericMovement,
  type ImportCatalog,
  type OpenItemPool,
  type ProposalDraft,
  partyLabel,
  type StagedItem,
  systemAccountId,
  treasuriesOfKind,
  withDecisions,
} from './common'

// ─── Entrada ─────────────────────────────────────────────────────────────────

export type MpSettings = {
  /** La billetera «Mercado Pago» (caja del reporte). */
  readonly treasuryId: string
  /** El partícipe «Mercado Pago». */
  readonly partyId: string
  /** Canal → medio del cierre del día. */
  readonly channelMethods: Readonly<Partial<Record<MpCobroChannel, string>>>
  /** Los canales cuyo medio se dedujo por el nombre (no está en la configuración). */
  readonly inferred: ReadonlySet<MpCobroChannel>
}

/** Un movimiento entre cuentas ya contabilizado (para no cargar dos veces un retiro). */
export type PostedTransfer = {
  readonly documentId: string
  readonly date: IsoDate
  readonly amountCents: number
  readonly fromTreasuryId: string
  readonly toTreasuryId: string
  readonly label: string
}

export type MpTaxComponent = 'ret_iibb' | 'sircupa' | 'ley25413' | 'otro'

/** Regla del bar para un impuesto de Mercado Pago (`acc_import_rules`, `mp_release`). */
export type MpTaxRule = {
  readonly id: string
  readonly pattern: SafePattern
  readonly component: MpTaxComponent
  readonly accountId: string | null
}

export type MpDraftInput = {
  readonly batchId: string
  readonly items: readonly StagedItem<MpItem>[]
  readonly catalog: ImportCatalog
  readonly settings: MpSettings
  /** Partidas abiertas de Mercado Pago y de los partícipes elegidos (se consumen entre propuestas). */
  readonly pool: OpenItemPool
  /** Días con cobros o ajustes de Mercado Pago cargados a mano. */
  readonly manualDays: ReadonlySet<IsoDate>
  readonly postedTransfers: readonly PostedTransfer[]
  readonly taxRules: readonly MpTaxRule[]
  readonly decisions: (key: string) => ProposalDecisions
  /**
   * Propuestas ya contabilizadas: se vuelven a armar (para los agregados) pero
   * no consumen partidas del `pool` (lo suyo ya está imputado en la base).
   */
  readonly frozen?: (key: string) => boolean
}

/** Toma partidas del `pool`, salvo que la propuesta ya esté contabilizada. */
function takeFor(
  input: Pick<MpDraftInput, 'pool' | 'frozen'>,
  key: string,
  filter: (item: OpenItemRef) => boolean,
  amount: number,
): Array<{ lineId: string; amountCents: number }> {
  return input.frozen?.(key) ? [] : input.pool.take(filter, amount)
}

// ─── Reglas del bar ──────────────────────────────────────────────────────────

/** Las filas de `acc_import_rules` (`mp_release`) con `action.kind = 'mp_tax'`. Las que no compilan se saltean. */
export function mpTaxRulesFrom(
  rows: ReadonlyArray<{ id: string; priority: number; match: unknown; action: unknown }>,
): { rules: MpTaxRule[]; skipped: number } {
  const rules: MpTaxRule[] = []
  let skipped = 0
  const sorted = [...rows].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
  for (const row of sorted) {
    const match = row.match as Record<string, unknown> | null
    const action = row.action as Record<string, unknown> | null
    if (!match || !action || action.kind !== 'mp_tax') continue
    const component = action.component
    if (
      component !== 'ret_iibb' &&
      component !== 'sircupa' &&
      component !== 'ley25413' &&
      component !== 'otro'
    ) {
      continue
    }
    const pattern = typeof match.pattern === 'string' ? compileSafePattern(match.pattern) : null
    if (!pattern) {
      skipped++
      continue
    }
    rules.push({
      id: row.id,
      pattern,
      component,
      accountId: typeof action.account_id === 'string' ? action.account_id : null,
    })
  }
  return { rules, skipped }
}

// ─── Impuestos de cada fila ──────────────────────────────────────────────────

/** El impuesto como texto estable (`DEBITOS_CREDITOS TAX_WITHHOLDING_COLLECTOR`), hasta 80. */
export function mpTaxLabel(tax: Pick<MpTax, 'entity' | 'detail'>): string {
  return normalizeForMatch(`${tax.entity} ${tax.detail}`).slice(0, 80)
}

const LEY_25413_RE = /DEBITOS?[_ ]?(Y[_ ])?CREDITOS|LEY[_ ]?25\.?413|IMPUESTO[_ ]AL[_ ]CHEQUE/
const IIBB_RE =
  /IIBB|INGRESOS[_ ]?BRUTOS|GROSS[_ ]?INCOME|RETENCION[_ ]?IB\b|CORDOBA|BUENOS[_ ]?AIRES|CABA|SANTA[_ ]?FE|MENDOZA|TUCUMAN|NEUQUEN|SALTA|ENTRE[_ ]?RIOS/

export type MpTaxClass = {
  component: MpTaxComponent | 'unknown'
  label: string
  accountId: string | null
  /** Ley 25.413 sobre lo que entra (`collector`) o sobre lo que sale. */
  side: 'credit' | 'debit'
  /** Lo decidió una regla del bar. */
  byRule: boolean
}

/**
 * Qué es un impuesto de `TAXES_DISAGGREGATED`: primero las reglas del bar; si
 * no, créditos y débitos (Ley 25.413), SIRCUPA, SIRTAC o IIBB (SIRCUPA en las
 * transferencias, SIRTAC en los cobros). Lo que no se reconoce queda
 * `unknown` (se pide la cuenta). Los nombres de Córdoba están A CONFIRMAR con
 * el primer reporte real (`mercadopago.md` §5).
 */
export function classifyMpTax(
  tax: Pick<MpTax, 'entity' | 'detail'>,
  channel: MpChannel,
  rules: readonly MpTaxRule[],
): MpTaxClass {
  const label = mpTaxLabel(tax)
  const side: 'credit' | 'debit' = /COLLECTOR/.test(label) ? 'credit' : 'debit'
  const known = (component: MpTaxComponent | 'unknown'): MpTaxClass => ({
    component,
    label,
    accountId: null,
    side,
    byRule: false,
  })
  for (const rule of rules) {
    if (safePatternTest(rule.pattern, label)) {
      // Una regla «otro» sin cuenta no decide nada: se sigue pidiendo la cuenta.
      if (rule.component === 'otro' && !rule.accountId) return known('unknown')
      return { component: rule.component, label, accountId: rule.accountId, side, byRule: true }
    }
  }
  if (LEY_25413_RE.test(label)) return known('ley25413')
  if (/SIRCUPA/.test(label)) return known('sircupa')
  if (/SIRTAC/.test(label)) return known('ret_iibb')
  if (IIBB_RE.test(label)) return known(channel === 'transfer_in' ? 'sircupa' : 'ret_iibb')
  return known('unknown')
}

// ─── Clasificación de filas ──────────────────────────────────────────────────

/** Avisos del parser que hacen que la fila no pueda entrar sola a un agregado. */
const REVIEW_CODES: ReadonlySet<ImportIssueCode> = new Set([
  'mp_row_check',
  'mp_taxes_unreadable',
  'mp_taxes_mismatch',
  'mp_currency',
  'mp_channel_unknown',
  'mp_duplicate_row',
  'mp_unknown_record_type',
  'mp_unknown_description',
  'mp_needs_review',
  'mp_payout_unknown_account',
])

function needsReview(s: StagedItem<MpItem>): boolean {
  return s.issues.some((i) => i.level !== 'info' && REVIEW_CODES.has(i.code))
}

function isCobroChannel(channel: MpChannel): channel is MpCobroChannel {
  return (MP_COBRO_CHANNELS as readonly string[]).includes(channel)
}

const CHANNEL_LABEL: Readonly<Record<MpCobroChannel, string>> = {
  qr: 'QR',
  point: 'Point',
  link: 'link de pago',
  transfer_in: 'transferencias',
}

const REVIEW_LABEL: Readonly<Partial<Record<string, string>>> = {
  refund: 'Devolución',
  chargeback: 'Contracargo',
  dispute: 'Disputa',
  restriction: 'Dinero restringido',
  tip: 'Propina',
  credit_payment: 'Cuota de un préstamo',
  fee_release_in_advance: 'Adelanto de dinero',
  digitalchange_transaction: 'Cambio digital',
  payment: 'Cobro sin canal claro',
}

const NOTES = 'Importado de Mercado Pago (reporte de Liquidaciones)'

type CobroGroup = {
  day: IsoDate
  channel: MpCobroChannel
  methodId: string | null
  rows: StagedItem<MpItem>[]
  gross: number
  fees: number
  net: number
  ley: number
  sirtac: number
  sircupa: number
  /** Impuestos que no se reconocen (o que una regla «otro» manda a una cuenta). */
  others: Map<string, { amount: number; accountId: string | null }>
  rules: boolean
  balanceChain: boolean
}

type DayAmount = { amount: number; ids: string[] }

// ─── El armador ──────────────────────────────────────────────────────────────

export function buildMpDrafts(input: MpDraftInput): ProposalDraft[] {
  const { catalog, settings } = input
  const tag = batchTag(input.batchId)
  const wallet = catalog.treasuries.get(settings.treasuryId) ?? null
  const mpParty = catalog.parties.get(settings.partyId) ?? null
  const items = [...input.items].sort(
    (a, b) =>
      (a.item.businessDate < b.item.businessDate
        ? -1
        : a.item.businessDate > b.item.businessDate
          ? 1
          : 0) || a.rowNo - b.rowNo,
  )

  const drafts: ProposalDraft[] = []
  const cobros = new Map<string, CobroGroup>()
  const ley = new Map<IsoDate, { credit: number; debit: number; ids: Set<string> }>()
  const iibb = new Map<string, DayAmount & { day: IsoDate; component: 'ret_iibb' | 'sircupa' }>()
  const yields = new Map<string, DayAmount & { last: IsoDate }>()
  const mpDebits = new Map<IsoDate, DayAmount>()
  const manual = new Map<IsoDate, string[]>()
  const reserves: string[] = []
  const review: StagedItem<MpItem>[] = []
  const ownIn: StagedItem<MpItem>[] = []
  const payouts: StagedItem<MpItem>[] = []

  const leyOf = (day: IsoDate) => {
    let v = ley.get(day)
    if (!v) {
      v = { credit: 0, debit: 0, ids: new Set() }
      ley.set(day, v)
    }
    return v
  }

  for (const s of items) {
    const it = s.item
    const day = it.businessDate
    if (input.manualDays.has(day)) {
      const list = manual.get(day) ?? []
      list.push(s.id)
      manual.set(day, list)
      continue
    }
    if (it.channel === 'reserve') {
      reserves.push(s.id)
      continue
    }
    if (needsReview(s)) {
      review.push(s)
      continue
    }
    const net = it.netCredit - it.netDebit

    if (isCobroChannel(it.channel)) {
      const fees = -(it.mpFee + it.financingFee + it.shippingFee)
      const taxSum = it.taxesDetail.reduce((acc, t) => acc + t.amount, 0)
      // Lo que no se puede repartir solo (signos raros, impuestos sin detalle) va a revisar.
      const signsOk =
        it.gross > 0 &&
        fees >= 0 &&
        net >= 0 &&
        taxSum === it.taxes &&
        it.taxesDetail.every((t) => t.amount <= 0)
      if (!signsOk) {
        review.push(s)
        continue
      }
      if (it.fromOwnCuit === true) {
        if (fees === 0 && it.taxesDetail.length === 0) ownIn.push(s)
        else review.push(s)
        continue
      }
      const methodId = input.settings.channelMethods[it.channel] ?? null
      const groupKey = `${day}|${methodId ? `m:${methodId}` : `c:${it.channel}`}`
      let g = cobros.get(groupKey)
      if (!g) {
        g = {
          day,
          channel: it.channel,
          methodId,
          rows: [],
          gross: 0,
          fees: 0,
          net: 0,
          ley: 0,
          sirtac: 0,
          sircupa: 0,
          others: new Map(),
          rules: false,
          balanceChain: false,
        }
        cobros.set(groupKey, g)
      }
      g.rows.push(s)
      g.gross += it.gross
      g.fees += fees
      g.net += net
      if (s.issues.some((i) => i.code === 'mp_balance_chain')) g.balanceChain = true
      for (const t of it.taxesDetail) {
        const cls = classifyMpTax(t, it.channel, input.taxRules)
        const amount = -t.amount
        if (cls.byRule) g.rules = true
        if (cls.component === 'ley25413') {
          g.ley += amount
          const v = leyOf(day)
          v.credit += amount
          v.ids.add(s.id)
        } else if (cls.component === 'ret_iibb') g.sirtac += amount
        else if (cls.component === 'sircupa') g.sircupa += amount
        else {
          const prev = g.others.get(cls.label)
          g.others.set(cls.label, {
            amount: (prev?.amount ?? 0) + amount,
            accountId: prev?.accountId ?? cls.accountId,
          })
        }
      }
      continue
    }

    switch (it.channel) {
      case 'payout_own':
      case 'payout_third': {
        // La Ley 25.413 del retiro va a los gastos del día; el resto del impuesto, a revisar.
        const other = it.taxesDetail.filter(
          (t) => classifyMpTax(t, it.channel, input.taxRules).component !== 'ley25413',
        )
        if (other.length > 0 || it.gross >= 0) {
          review.push(s)
          break
        }
        for (const t of it.taxesDetail) {
          const v = leyOf(it.releaseDate)
          v.debit += -t.amount
          v.ids.add(s.id)
        }
        payouts.push(s)
        break
      }
      case 'yield': {
        const month = day.slice(0, 7)
        const y = yields.get(month) ?? { amount: 0, ids: [], last: day }
        y.amount += net
        y.ids.push(s.id)
        if (day > y.last) y.last = day
        yields.set(month, y)
        break
      }
      case 'iibb_later': {
        const cls = it.taxesDetail[0]
          ? classifyMpTax(it.taxesDetail[0], it.channel, input.taxRules).component
          : 'ret_iibb'
        const component = cls === 'sircupa' ? 'sircupa' : 'ret_iibb'
        const k = `${day}|${component}`
        const v = iibb.get(k) ?? { amount: 0, ids: [], day, component }
        v.amount += -net
        v.ids.push(s.id)
        iibb.set(k, v)
        break
      }
      case 'bank_tax': {
        if (net > 0) {
          review.push(s)
          break
        }
        const v = leyOf(day)
        v.debit += -net
        v.ids.add(s.id)
        break
      }
      case 'perception': {
        if (net > 0) {
          review.push(s)
          break
        }
        const v = mpDebits.get(day) ?? { amount: 0, ids: [] }
        v.amount += -net
        v.ids.push(s.id)
        mpDebits.set(day, v)
        break
      }
      default:
        review.push(s)
    }
  }

  // ── Cobros por día y medio ──
  for (const g of cobros.values()) drafts.push(collectionDraft(g, input, tag, wallet?.id ?? null))

  // ── Ley 25.413 del día ──
  for (const [day, v] of [...ley.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const key = `mp:${day}:ley25413:${tag}`
    const total = v.credit + v.debit
    const summary: DraftSummary = {
      kind: 'mp_bank_tax',
      date: day,
      label: `Impuesto a los débitos y créditos (Ley 25.413) del ${dayLabel(day)}`,
      counterparty: wallet?.name ?? 'Mercado Pago',
      total_cents: total,
      item_count: v.ids.size,
      detail: { credit_cents: v.credit, debit_cents: v.debit },
    }
    drafts.push({
      key,
      form: 'bank_expense',
      values:
        total > 0 && wallet
          ? {
              treasuryAccountId: wallet.id,
              date: day,
              includeInIvaBook: false,
              voucher: null,
              feesNetCents: 0,
              vatRateBp: 2100,
              vatAdjustCents: 0,
              vatPerceptionCents: 0,
              feesNoVatCents: 0,
              ley25413CreditCents: v.credit,
              ley25413DebitCents: v.debit,
              sircrebCents: 0,
              interestCents: 0,
              others: [],
              notes: NOTES,
            }
          : null,
      itemIds: [...v.ids],
      needs: [],
      summary,
      ...(total > 0 ? {} : { skip: { reason: 'nothing_to_load' as const } }),
    })
  }

  // ── IIBB cobrado después ──
  for (const v of [...iibb.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    const key = `mp:${v.day}:iibb-${v.component === 'sircupa' ? 'sircupa' : 'sirtac'}:${tag}`
    const accountId = systemAccountId(
      catalog,
      v.component === 'sircupa' ? 'iibb_sircupa' : 'iibb_withholdings',
    )
    const name = v.component === 'sircupa' ? 'SIRCUPA' : 'SIRTAC'
    const summary: DraftSummary = {
      kind: 'mp_iibb',
      date: v.day,
      label: `Retención de Ingresos Brutos (${name}) del ${dayLabel(v.day)}`,
      counterparty: wallet?.name ?? 'Mercado Pago',
      total_cents: Math.abs(v.amount),
      item_count: v.ids.length,
    }
    drafts.push(
      v.amount === 0 || !wallet || !accountId
        ? {
            key,
            form: 'cash_movement',
            values: null,
            itemIds: v.ids,
            needs: [],
            summary,
            skip: { reason: 'nothing_to_load' },
          }
        : {
            key,
            form: 'cash_movement',
            values: {
              treasuryAccountId: wallet.id,
              direction: v.amount > 0 ? 'out' : 'in',
              counterpartAccountId: accountId,
              partyId: null,
              amountCents: Math.abs(v.amount),
              date: v.day,
              shortcut: 'other',
              detail: `Retención de Ingresos Brutos (${name}) de Mercado Pago`,
            },
            itemIds: v.ids,
            needs: [],
            summary,
          },
    )
  }

  // ── Rendimientos: uno por mes ──
  const interest = systemAccountId(catalog, 'interest_income')
  for (const [month, v] of [...yields.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const key = `mp:${month}:rendimientos:${tag}`
    const monthName = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month
    const summary: DraftSummary = {
      kind: 'mp_yield',
      date: v.last,
      label: `Rendimientos de Mercado Pago de ${monthName}`,
      counterparty: wallet?.name ?? 'Mercado Pago',
      total_cents: Math.abs(v.amount),
      item_count: v.ids.length,
    }
    drafts.push(
      v.amount === 0 || !wallet || !interest
        ? {
            key,
            form: 'cash_movement',
            values: null,
            itemIds: v.ids,
            needs: [],
            summary,
            skip: { reason: 'nothing_to_load' },
          }
        : {
            key,
            form: 'cash_movement',
            values: {
              treasuryAccountId: wallet.id,
              direction: v.amount > 0 ? 'in' : 'out',
              counterpartAccountId: interest,
              partyId: null,
              amountCents: Math.abs(v.amount),
              date: v.last,
              shortcut: 'mp_yield',
              detail: `Rendimientos de ${monthName}`,
            },
            itemIds: v.ids,
            needs: [],
            summary,
          },
    )
  }

  // ── Débitos de percepciones o de la factura: pago a Mercado Pago ──
  for (const [day, v] of [...mpDebits.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const key = `mp:${day}:pago-mp:${tag}`
    const summary: DraftSummary = {
      kind: 'mp_payment',
      date: day,
      label: `Débitos de Mercado Pago del ${dayLabel(day)} (percepciones o factura)`,
      counterparty: mpParty ? partyLabel(mpParty) : 'Mercado Pago',
      total_cents: v.amount,
      item_count: v.ids.length,
    }
    if (v.amount <= 0 || !wallet || !mpParty) {
      drafts.push({
        key,
        form: 'payment',
        values: null,
        itemIds: v.ids,
        needs: [],
        summary,
        skip: { reason: 'nothing_to_load' },
      })
      continue
    }
    const applications = takeFor(
      input,
      key,
      payableOf(mpParty.id, mpParty.payableAccountId),
      v.amount,
    )
    drafts.push({
      key,
      form: 'payment',
      values: {
        partyId: mpParty.id,
        date: day,
        applications,
        creditsUsed: [],
        methods: [
          {
            type: 'treasury',
            treasuryAccountId: wallet.id,
            amountCents: v.amount,
            reference: null,
          },
        ],
        writeOffCents: 0,
        notes: NOTES,
      },
      itemIds: v.ids,
      needs: [],
      summary,
    })
  }

  // ── Retiros ──
  for (const s of payouts) drafts.push(payoutDraft(s, input, wallet?.id ?? null))

  // ── Transferencias desde la propia CUIT ──
  for (const s of ownIn) drafts.push(ownInDraft(s, input, wallet?.id ?? null))

  // ── Para revisar ──
  for (const s of review) drafts.push(reviewDraft(s, input, wallet?.id ?? null))

  // ── Días cargados a mano y reservas ──
  for (const [day, ids] of [...manual.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    drafts.push({
      key: `mp:${day}:manual:${tag}`,
      form: 'collection',
      values: null,
      itemIds: ids,
      needs: [],
      summary: {
        kind: 'mp_collection',
        date: day,
        label: `Movimientos de Mercado Pago del ${dayLabel(day)}`,
        counterparty: 'Mercado Pago',
        total_cents: 0,
        item_count: ids.length,
      },
      skip: { reason: 'manual_overlap', date: day },
    })
  }
  if (reserves.length > 0) {
    const first = items.find((s) => s.item.channel === 'reserve')
    drafts.push({
      key: `mp:reservas:${tag}`,
      form: 'cash_movement',
      values: null,
      itemIds: reserves,
      needs: [],
      summary: {
        kind: 'mp_reserve',
        date: first?.item.businessDate ?? '',
        label: 'Reservas de dinero de Mercado Pago',
        counterparty: 'Mercado Pago',
        total_cents: 0,
        item_count: reserves.length,
      },
      skip: { reason: 'reserve' },
    })
  }
  return drafts
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function collectionKey(g: Pick<CobroGroup, 'day' | 'methodId' | 'channel'>, tag: string): string {
  return `mp:${g.day}:cobro:${g.methodId ?? g.channel}:${tag}`
}

/** Partidas «nos debe» de un partícipe, de un medio y de un día (lo que dejó el cierre). */
function receivableOf(
  partyId: string,
  accountId: string,
  methodId: string,
  day: IsoDate,
): (i: OpenItemRef) => boolean {
  return (i) =>
    i.partyId === partyId &&
    i.accountId === accountId &&
    i.side === 'debit' &&
    i.salesMethodId === methodId &&
    i.entryDate === day
}

/** Partidas «le debemos» de un partícipe (facturas a cancelar con un pago). */
export function payableOf(partyId: string, accountId: string): (i: OpenItemRef) => boolean {
  return (i) => i.partyId === partyId && i.accountId === accountId && i.side === 'credit'
}

function collectionDraft(
  g: CobroGroup,
  input: MpDraftInput,
  tag: string,
  walletId: string | null,
): ProposalDraft {
  const { catalog, settings } = input
  const key = collectionKey(g, tag)
  const decisions = input.decisions(key)
  const method = g.methodId ? (catalog.methods.get(g.methodId) ?? null) : null
  const partyId = method?.partyId ?? settings.partyId
  const party = catalog.parties.get(partyId) ?? null
  const needs: ImportNeed[] = []
  const notes: NoteKey[] = []
  if (g.balanceChain) notes.push('balance_chain')
  if (g.methodId && settings.inferred.has(g.channel)) notes.push('inferred_method')
  if (g.rules) notes.push('rule_applied')

  let applications: Array<{ lineId: string; amountCents: number }> = []
  let closeCents = 0
  if (!method) {
    needs.push({ key: 'channel_method', channel: g.channel })
  } else if (
    party &&
    (method.kind === 'settled_now' || method.kind === 'receivable') &&
    method.partyId === party.id
  ) {
    const filter = receivableOf(party.id, party.receivableAccountId, method.id, g.day)
    closeCents = input.pool.available(filter)
    applications = takeFor(input, key, filter, g.gross)
  }
  if (method && closeCents === 0) notes.push('missing_close')

  const deductions: Array<Record<string, unknown>> = []
  let commission = 0
  let commissionVat = 0
  const withMethod = (d: Record<string, unknown>) =>
    method ? { ...d, salesMethodId: method.id } : d
  if (g.fees > 0) {
    if (!party || party.commissionVatMode === 'none') {
      commission = g.fees
      deductions.push(withMethod({ taxKind: 'comision', amountCents: g.fees }))
    } else {
      commission = netFromGross(g.fees, 2100)
      commissionVat = g.fees - commission
      if (commission > 0)
        deductions.push(withMethod({ taxKind: 'comision', amountCents: commission }))
      if (commissionVat > 0) {
        deductions.push(withMethod({ taxKind: 'iva_comision', amountCents: commissionVat }))
      }
    }
  }
  if (g.sirtac > 0) deductions.push(withMethod({ taxKind: 'ret_iibb', amountCents: g.sirtac }))
  if (g.sircupa > 0) deductions.push(withMethod({ taxKind: 'sircupa', amountCents: g.sircupa }))
  const others = [...g.others.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  for (const [label, other] of others) {
    if (other.amount <= 0) continue
    // La decisión de la persona en esta propuesta gana sobre la regla del bar.
    const accountId = decisions.tax_accounts?.[label] ?? other.accountId
    if (accountId) {
      deductions.push(withMethod({ taxKind: 'otro', amountCents: other.amount, accountId }))
    } else {
      needs.push({ key: 'unknown_tax', tax: label, amount_cents: other.amount })
    }
  }
  const received = g.net + g.ley
  const values: Record<string, unknown> | null =
    party && walletId && !needs.some((n) => n.key === 'unknown_tax' || n.key === 'channel_method')
      ? {
          partyId: party.id,
          date: g.day,
          applications,
          creditsUsed: [],
          grossCents: null,
          deductions,
          received:
            received > 0
              ? [{ treasuryAccountId: walletId, amountCents: received, reference: null }]
              : [],
          writeOffCents: 0,
          commissionVoucher: commissionVat > 0 ? { mode: 'later' } : { mode: 'none' },
          notes: NOTES,
        }
      : null
  if (!party || !walletId) needs.push({ key: 'manual', reason: 'unsupported' })

  const summary: DraftSummary = withDecisions(
    {
      kind: 'mp_collection',
      date: g.day,
      label: `Cobros con ${CHANNEL_LABEL[g.channel]} del ${dayLabel(g.day)}`,
      counterparty: method?.name ?? (party ? partyLabel(party) : 'Mercado Pago'),
      total_cents: g.gross,
      item_count: g.rows.length,
      detail: {
        channel: g.channel,
        method_id: g.methodId,
        gross_cents: g.gross,
        commission_cents: commission,
        commission_vat_cents: commissionVat,
        sirtac_cents: g.sirtac,
        sircupa_cents: g.sircupa,
        ley25413_cents: g.ley,
        net_cents: g.net,
        close_cents: closeCents,
        applied_cents: applications.reduce((a, x) => a + x.amountCents, 0),
        difference_cents: g.gross - closeCents,
      },
      ...(notes.length > 0 ? { notes } : {}),
    },
    decisions,
  )
  return {
    key,
    form: 'collection',
    values,
    itemIds: g.rows.map((r) => r.id),
    needs,
    summary,
  }
}

/** La transferencia que ya está cargada (mismas cuentas, mismo importe, ±3 días). */
export function findPostedTransfer(
  transfers: readonly PostedTransfer[],
  from: string,
  to: string,
  amount: number,
  date: IsoDate,
): PostedTransfer | null {
  const target = Date.parse(`${date}T12:00:00Z`)
  let best: PostedTransfer | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const t of transfers) {
    if (t.fromTreasuryId !== from || t.toTreasuryId !== to || t.amountCents !== amount) continue
    const dist = Math.abs(Date.parse(`${t.date}T12:00:00Z`) - target) / 86_400_000
    if (dist <= 3 && dist < bestDist) {
      best = t
      bestDist = dist
    }
  }
  return best
}

/** La cuenta propia de un retiro: la única cuyo CBU/CVU termina en esos 4 dígitos. */
function ownTreasuryByLast4(
  catalog: ImportCatalog,
  last4: string | null,
  exclude: string | null,
): string | null {
  if (!last4) return null
  const found = [...catalog.treasuries.values()].filter(
    (t) => t.active && t.id !== exclude && (t.cbuCvu?.replace(/\D/g, '').endsWith(last4) ?? false),
  )
  return found.length === 1 ? (found[0]?.id ?? null) : null
}

function singleBank(catalog: ImportCatalog, exclude: string | null): string | null {
  const banks = treasuriesOfKind(catalog, 'bank').filter((t) => t.id !== exclude)
  return banks.length === 1 ? (banks[0]?.id ?? null) : null
}

function payoutDraft(
  s: StagedItem<MpItem>,
  input: MpDraftInput,
  walletId: string | null,
): ProposalDraft {
  const it = s.item
  const { catalog } = input
  const own = it.channel === 'payout_own'
  const key = `${s.key}:${own ? 'transfer' : 'pago'}`
  const decisions = input.decisions(key)
  const amount = -it.gross
  const date = it.releaseDate
  const needs: ImportNeed[] = []
  const summaryOf = (counterparty: string | null): DraftSummary =>
    withDecisions(
      {
        kind: own ? 'mp_transfer' : 'mp_payment',
        date,
        label: own
          ? `Retiro de Mercado Pago del ${dayLabel(date)}`
          : `Pago a un tercero desde Mercado Pago del ${dayLabel(date)}`,
        counterparty,
        total_cents: amount,
        item_count: 1,
        detail: { last4: it.payoutLast4 },
      },
      decisions,
    )

  if (own) {
    const to =
      decisions.treasury_id ?? ownTreasuryByLast4(catalog, it.payoutLast4, walletId) ?? null
    if (!to || !walletId) {
      needs.push({
        key: 'pick_treasury',
        suggested_treasury_id: singleBank(catalog, walletId),
      })
      return {
        key,
        form: 'transfer',
        values: null,
        itemIds: [s.id],
        needs,
        summary: summaryOf(null),
      }
    }
    const toName = catalog.treasuries.get(to)?.name ?? null
    const posted = findPostedTransfer(input.postedTransfers, walletId, to, amount, date)
    if (posted) {
      return {
        key,
        form: 'transfer',
        values: null,
        itemIds: [s.id],
        needs: [],
        summary: summaryOf(toName),
        skip: {
          reason: 'already_loaded',
          document_id: posted.documentId,
          label: posted.label,
          date: posted.date,
        },
      }
    }
    return {
      key,
      form: 'transfer',
      values: {
        fromTreasuryId: walletId,
        toTreasuryId: to,
        amountCents: amount,
        date,
        reference: it.externalReference?.slice(0, 60) ?? null,
        notes: NOTES,
      },
      itemIds: [s.id],
      needs,
      summary: summaryOf(toName),
    }
  }

  const partyId = decisions.party_id ?? null
  const party = partyId ? (catalog.parties.get(partyId) ?? null) : null
  if (!party || !walletId) {
    needs.push({ key: 'pick_party', role: 'supplier', suggested_party_id: null })
    return { key, form: 'payment', values: null, itemIds: [s.id], needs, summary: summaryOf(null) }
  }
  const applications = takeFor(input, key, payableOf(party.id, party.payableAccountId), amount)
  return {
    key,
    form: 'payment',
    values: {
      partyId: party.id,
      date,
      applications,
      creditsUsed: [],
      methods: [
        { type: 'treasury', treasuryAccountId: walletId, amountCents: amount, reference: null },
      ],
      writeOffCents: 0,
      notes: NOTES,
    },
    itemIds: [s.id],
    needs,
    summary: summaryOf(partyLabel(party)),
  }
}

function ownInDraft(
  s: StagedItem<MpItem>,
  input: MpDraftInput,
  walletId: string | null,
): ProposalDraft {
  const it = s.item
  const { catalog } = input
  const key = `${s.key}:transfer`
  const decisions = input.decisions(key)
  const amount = it.netCredit - it.netDebit
  const date = it.releaseDate
  const from = decisions.treasury_id ?? null
  const summary = withDecisions(
    {
      kind: 'mp_transfer' as const,
      date,
      label: `Transferencia propia a Mercado Pago del ${dayLabel(date)}`,
      counterparty: from ? (catalog.treasuries.get(from)?.name ?? null) : null,
      total_cents: amount,
      item_count: 1,
    },
    decisions,
  )
  if (!from || !walletId || from === walletId) {
    return {
      key,
      form: 'transfer',
      values: null,
      itemIds: [s.id],
      needs: [{ key: 'pick_treasury', suggested_treasury_id: singleBank(catalog, walletId) }],
      summary,
    }
  }
  const posted = findPostedTransfer(input.postedTransfers, from, walletId, amount, date)
  if (posted) {
    return {
      key,
      form: 'transfer',
      values: null,
      itemIds: [s.id],
      needs: [],
      summary,
      skip: {
        reason: 'already_loaded',
        document_id: posted.documentId,
        label: posted.label,
        date: posted.date,
      },
    }
  }
  return {
    key,
    form: 'transfer',
    values: {
      fromTreasuryId: from,
      toTreasuryId: walletId,
      amountCents: amount,
      date,
      reference: null,
      notes: NOTES,
    },
    itemIds: [s.id],
    needs: [],
    summary,
  }
}

function reviewDraft(
  s: StagedItem<MpItem>,
  input: MpDraftInput,
  walletId: string | null,
): ProposalDraft {
  const it = s.item
  const key = `${s.key}:revisar`
  const decisions = input.decisions(key)
  const net = it.netCredit - it.netDebit
  const direction = net >= 0 ? 'in' : 'out'
  const amount = Math.abs(net)
  const what = REVIEW_LABEL[it.description.toLowerCase()] ?? 'Movimiento'
  const summary = withDecisions(
    {
      kind: 'mp_review' as const,
      date: it.businessDate,
      label: `${what} de Mercado Pago del ${dayLabel(it.businessDate)}`,
      counterparty: null,
      total_cents: amount,
      item_count: 1,
      detail: { description: it.description, direction, channel: it.channel },
    },
    decisions,
  )
  if (amount === 0) {
    return {
      key,
      form: 'cash_movement',
      values: null,
      itemIds: [s.id],
      needs: [],
      summary,
      skip: { reason: 'nothing_to_load' },
    }
  }
  return genericMovement(key, s.id, {
    catalog: input.catalog,
    decisions,
    treasuryId: walletId,
    direction,
    amount,
    date: it.businessDate,
    detail: `${what} de Mercado Pago`,
    summary,
  })
}
