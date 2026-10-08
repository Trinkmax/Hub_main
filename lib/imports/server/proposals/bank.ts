/**
 * Extracto bancario → comprobantes (diseño §4.3.3–§4.3.4).
 *
 * | Clasificación | Comprobante |
 * |---|---|
 * | Comisiones (+ su IVA), percepción RG 2408, Ley 25.413, SIRCREB, intereses | `bank_expense`, uno por día (fuera del Libro IVA, P-C8) |
 * | Crédito o débito con Mercado Pago o con la propia CUIT | `transfer` (si ya está cargada ±3 días, se saltea) |
 * | Depósito o extracción de efectivo | `transfer` con la caja de efectivo |
 * | Pago de la tarjeta de la empresa | `transfer` a la tarjeta |
 * | Acreditación de tarjetas | `collection` del procesador con descuentos estimados («corregilos con la liquidación») |
 * | Transferencia a un proveedor, VEP de ARCA, Rentas, sueldos | `payment` (se sugiere a quién; la persona confirma) |
 * | Lo demás («a identificar», reversos, débitos automáticos) | para revisar: un movimiento contra la cuenta que elija la persona |
 *
 * **Reglas del bar** (`acc_import_rules`, `bank_statement`): van primero, por
 * prioridad. Su patrón NUNCA se corre como expresión regular en el servidor:
 * se compila al subconjunto seguro (`safe-pattern.ts`) y las que no entran se
 * saltean (y se cuentan). Las de fábrica (`DEFAULT_BANK_RULES`) son código
 * nuestro y siguen siendo `RegExp`.
 *
 * **Contra lo cargado a mano:** un gasto bancario del mismo día, la misma
 * cuenta y el mismo total ya cargado a mano → «Ya está cargado».
 *
 * Puro.
 */

import { vatFromNet } from '@/lib/accounting/iva'
import { prefillDeductions } from '@/lib/accounting/posting/collection'
import type { IsoDate, OpenItemRef } from '@/lib/accounting/types'
import { groupDailyCharges } from '../../bank/grouping'
import {
  type BankCategory,
  bankDirectionOf,
  classifyBankItem,
  MERCADOLIBRE_CUIT,
} from '../../bank/rules'
import { normalizeBankDescription } from '../../bank/statement'
import type { BankItem, ImportIssueCode } from '../../types'
import { compileSafePattern, type SafePattern, safePatternTest } from '../safe-pattern'
import type { ImportNeed, NoteKey, PartyRole, ProposalDecisions } from '../types'
import {
  batchTag,
  type DraftSummary,
  dayLabel,
  genericMovement,
  type ImportCatalog,
  type ImportParty,
  isConfirmed,
  type OpenItemPool,
  type ProposalDraft,
  partyByCuit,
  partyLabel,
  type StagedItem,
  systemAccountId,
  systemParty,
  treasuriesOfKind,
  withDecisions,
} from './common'
import { findPostedTransfer, type PostedTransfer, payableOf } from './mp'

// ─── Reglas del bar ──────────────────────────────────────────────────────────

export const BANK_EXPENSE_COMPONENTS = [
  'comisiones',
  'iva',
  'perc_iva',
  'ley25413_debito',
  'ley25413_credito',
  'sircreb',
  'intereses',
  'gastos_sin_iva',
] as const
export type BankExpenseComponent = (typeof BANK_EXPENSE_COMPONENTS)[number]

/** Lo que hace una regla del bar con la fila (`acc_import_rules.action`). */
export type BankRuleAction =
  | { kind: 'expense_component'; component: BankExpenseComponent }
  | { kind: 'transfer'; treasuryId: string }
  | { kind: 'payment'; partyId: string }
  | { kind: 'collection'; partyId: string }
  | { kind: 'movement'; accountId: string; partyId: string | null }
  | { kind: 'ignore' }
  | { kind: 'review' }

/** Una regla del bar lista para el servidor (con el patrón seguro, nunca un `RegExp`). */
export type SafeBankRule = {
  readonly id: string
  readonly priority: number
  readonly label: string
  readonly direction: 'D' | 'C' | '*'
  readonly pattern: SafePattern | null
  readonly counterpartyCuit: string | null
  readonly amountMin: number | null
  readonly amountMax: number | null
  readonly treasuryAccountId: string | null
  readonly action: BankRuleAction
}

function ruleAction(action: Record<string, unknown>): BankRuleAction | null {
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  switch (action.kind) {
    case 'expense_component': {
      const c = action.component
      return (BANK_EXPENSE_COMPONENTS as readonly unknown[]).includes(c)
        ? { kind: 'expense_component', component: c as BankExpenseComponent }
        : null
    }
    case 'transfer': {
      const id = str(action.treasury_account_id)
      return id ? { kind: 'transfer', treasuryId: id } : null
    }
    case 'payment':
    case 'collection': {
      const id = str(action.party_id)
      return id ? { kind: action.kind, partyId: id } : null
    }
    case 'movement': {
      const id = str(action.account_id)
      return id ? { kind: 'movement', accountId: id, partyId: str(action.party_id) } : null
    }
    case 'ignore':
      return { kind: 'ignore' }
    case 'review':
      return { kind: 'review' }
    default:
      return null
  }
}

/**
 * Las filas de `acc_import_rules` (`bank_statement`) listas para el servidor.
 * Un patrón que no entra en el subconjunto seguro, o una acción que no se
 * entiende, saltea la regla (`skipped`): nunca se arma un `RegExp` con él.
 */
export function bankRulesFrom(
  rows: ReadonlyArray<{
    id: string
    priority: number
    label: string
    match: unknown
    action: unknown
  }>,
): { rules: SafeBankRule[]; skipped: number } {
  const rules: SafeBankRule[] = []
  let skipped = 0
  for (const row of rows) {
    const match = (row.match ?? {}) as Record<string, unknown>
    const action = ruleAction((row.action ?? {}) as Record<string, unknown>)
    let pattern: SafePattern | null = null
    if (typeof match.pattern === 'string' && match.pattern.trim() !== '') {
      pattern = compileSafePattern(match.pattern)
      if (!pattern) {
        skipped++
        continue
      }
    }
    if (!action) {
      skipped++
      continue
    }
    const cuit =
      typeof match.counterparty_cuit === 'string' ? match.counterparty_cuit.replace(/\D/g, '') : ''
    const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
    const rule: SafeBankRule = {
      id: row.id,
      priority: row.priority,
      label: row.label,
      direction: match.direction === 'debit' ? 'D' : match.direction === 'credit' ? 'C' : '*',
      pattern,
      counterpartyCuit: cuit.length === 11 ? cuit : null,
      amountMin: num(match.amount_min),
      amountMax: num(match.amount_max),
      treasuryAccountId:
        typeof match.treasury_account_id === 'string' ? match.treasury_account_id : null,
      action,
    }
    // Una regla sin ningún criterio calzaría con todo: no se aplica.
    if (
      !rule.pattern &&
      !rule.counterpartyCuit &&
      rule.amountMin === null &&
      rule.amountMax === null
    ) {
      skipped++
      continue
    }
    rules.push(rule)
  }
  rules.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
  return { rules, skipped }
}

/** La primera regla del bar que calza con la fila (en orden de prioridad). */
export function matchBankRule(
  it: Pick<BankItem, 'description' | 'amount' | 'counterpartyCuit'>,
  rules: readonly SafeBankRule[],
  treasuryId: string,
): SafeBankRule | null {
  const direction = bankDirectionOf(it.amount)
  const abs = Math.abs(it.amount)
  for (const r of rules) {
    if (r.direction !== '*' && r.direction !== direction) continue
    if (r.treasuryAccountId && r.treasuryAccountId !== treasuryId) continue
    if (r.pattern && !safePatternTest(r.pattern, it.description)) continue
    if (r.counterpartyCuit && r.counterpartyCuit !== it.counterpartyCuit) continue
    if (r.amountMin !== null && abs < r.amountMin) continue
    if (r.amountMax !== null && abs > r.amountMax) continue
    return r
  }
  return null
}

// ─── Clasificación de cada fila ──────────────────────────────────────────────

/** Avisos del parser que dejan dudas sobre el sentido o el importe: la fila va a revisar. */
const REVIEW_CODES: ReadonlySet<ImportIssueCode> = new Set([
  'bank_both_sides',
  'bank_dc_unknown',
  'bank_direction_guess',
  'bank_foreign_currency',
])

const COMPONENT_CATEGORY: Readonly<Record<BankExpenseComponent, BankCategory | null>> = {
  comisiones: 'comisiones',
  iva: 'iva_cf',
  perc_iva: 'perc_iva',
  ley25413_debito: 'ley25413',
  ley25413_credito: 'ley25413',
  sircreb: 'sircreb',
  intereses: 'intereses',
  gastos_sin_iva: null,
}

const EXPENSE_CATEGORIES: ReadonlySet<BankCategory> = new Set([
  'ley25413',
  'sircreb',
  'perc_iva',
  'iva_cf',
  'intereses',
  'comisiones',
])

type Classified = {
  s: StagedItem<BankItem>
  index: number
  /** La categoría de fábrica (o la que dice el componente de una regla). */
  category: BankCategory | null
  rule: SafeBankRule | null
  /** Componente de gasto pedido por una regla (`expense_component`). */
  component: BankExpenseComponent | null
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

export type BankDraftInput = {
  readonly batchId: string
  /** La cuenta del extracto (`acc_import_batches.treasury_account_id`). */
  readonly treasuryId: string
  readonly items: readonly StagedItem<BankItem>[]
  readonly catalog: ImportCatalog
  readonly rules: readonly SafeBankRule[]
  readonly pool: OpenItemPool
  /** Gastos bancarios cargados a mano en esta cuenta: `<día>:<total>`. */
  readonly manualExpenses: ReadonlySet<string>
  readonly postedTransfers: readonly PostedTransfer[]
  /** La billetera de Mercado Pago (para los créditos «desde Mercado Pago»). */
  readonly mpTreasuryId: string | null
  readonly decisions: (key: string) => ProposalDecisions
  /** Propuestas ya contabilizadas: no consumen partidas del `pool`. */
  readonly frozen?: (key: string) => boolean
}

const NOTES = 'Importado del extracto bancario'

// ─── El armador ──────────────────────────────────────────────────────────────

export function buildBankDrafts(input: BankDraftInput): ProposalDraft[] {
  const { catalog } = input
  const tag = batchTag(input.batchId)
  const bank = catalog.treasuries.get(input.treasuryId) ?? null
  const ownCuit = catalog.settings.cuit
  const items = [...input.items].sort(
    (a, b) =>
      (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0) ||
      a.item.ordinal - b.item.ordinal ||
      a.rowNo - b.rowNo,
  )

  const classified: Classified[] = items.map((s, index) => {
    const rule = matchBankRule(s.item, input.rules, input.treasuryId)
    if (rule) {
      const component = rule.action.kind === 'expense_component' ? rule.action.component : null
      return {
        s,
        index,
        category: component ? COMPONENT_CATEGORY[component] : null,
        rule,
        component,
      }
    }
    const c = classifyBankItem(s.item, { ownCuit, treasuryAccountId: input.treasuryId })
    return { s, index, category: c.category, rule: null, component: null }
  })

  // Madres e hijas del mismo día (comisión → IVA → percepción; Ley 25.413 → su movimiento).
  const charges = groupDailyCharges(
    classified.map((c) => c.s.item),
    classified.map((c) => c.category),
  )
  const motherOf = new Map<number, number[]>()
  const leyBase = new Map<number, number>()
  for (const g of charges.groups) {
    for (const child of g.children) {
      if (child.kind === 'ley25413') {
        const base = g.motherIndexes[0]
        if (base !== undefined) leyBase.set(child.index, base)
      } else motherOf.set(child.index, [...g.motherIndexes])
    }
  }
  const dayGrouping: DayGrouping = {
    motherOf,
    ivaRates: new Map(Object.entries(charges.ivaRates).map(([k, v]) => [Number(k), v] as const)),
    leyBase,
    unmatched: new Set(charges.unmatched),
    amountAt: (index) => classified[index]?.s.item.amount ?? 0,
  }

  const drafts: ProposalDraft[] = []
  const expenseDays = new Map<IsoDate, Classified[]>()
  const toReview = (c: Classified) => drafts.push(reviewDraft(c, input, bank?.id ?? null))

  for (const c of classified) {
    const it = c.s.item
    if (c.s.issues.some((i) => i.level !== 'info' && REVIEW_CODES.has(i.code))) {
      toReview(c)
      continue
    }
    const debit = it.amount < 0
    const action = c.rule?.action ?? null

    // Gastos del día (solo débitos).
    if (c.component || (action === null && c.category && EXPENSE_CATEGORIES.has(c.category))) {
      if (!debit) {
        toReview(c)
        continue
      }
      const list = expenseDays.get(it.date) ?? []
      list.push(c)
      expenseDays.set(it.date, list)
      continue
    }

    if (action) {
      switch (action.kind) {
        case 'ignore':
          drafts.push({
            key: `${c.s.key}:regla`,
            form: 'cash_movement',
            values: null,
            itemIds: [c.s.id],
            needs: [],
            summary: rowSummary(c, 'bank_review', bank?.name ?? null, ['rule_applied']),
            skip: { reason: 'rule_ignore' },
          })
          continue
        case 'review':
          toReview(c)
          continue
        case 'transfer':
          drafts.push(transferDraft(c, input, bank?.id ?? null, action.treasuryId))
          continue
        case 'payment':
          drafts.push(paymentDraft(c, input, bank?.id ?? null, action.partyId, 'any'))
          continue
        case 'collection':
          drafts.push(collectionDraft(c, input, bank?.id ?? null, action.partyId))
          continue
        case 'movement':
          drafts.push(movementDraft(c, input, bank?.id ?? null, action))
          continue
        default:
          toReview(c)
          continue
      }
    }

    switch (c.category) {
      case 'propias_mp': {
        const fromMp =
          /MERCADO\s*(PAGO|LIBRE)|MERCADOLIBRE/.test(normalizeBankDescription(it.description)) ||
          it.counterpartyCuit === MERCADOLIBRE_CUIT
        drafts.push(transferDraft(c, input, bank?.id ?? null, fromMp ? input.mpTreasuryId : null))
        break
      }
      case 'efectivo_in':
      case 'efectivo_out': {
        const cash = treasuriesOfKind(catalog, 'cash')
        drafts.push(
          transferDraft(
            c,
            input,
            bank?.id ?? null,
            cash.length === 1 ? (cash[0]?.id ?? null) : null,
          ),
        )
        break
      }
      case 'tarjeta_corp': {
        const cards = treasuriesOfKind(catalog, 'credit_card')
        drafts.push(
          transferDraft(
            c,
            input,
            bank?.id ?? null,
            cards.length === 1 ? (cards[0]?.id ?? null) : null,
          ),
        )
        break
      }
      case 'tarjetas':
        if (debit) toReview(c)
        else drafts.push(collectionDraft(c, input, bank?.id ?? null, null))
        break
      case 'transf_out':
      case 'arca':
      case 'prov_munic':
      case 'sueldos':
        if (!debit) toReview(c)
        else drafts.push(paymentDraft(c, input, bank?.id ?? null, null, roleFor(c.category)))
        break
      case 'cheques':
        drafts.push({
          key: `${c.s.key}:revisar`,
          form: 'cash_movement',
          values: null,
          itemIds: [c.s.id],
          needs: [{ key: 'manual', reason: 'cheque' }],
          summary: rowSummary(c, 'bank_review', bank?.name ?? null, []),
        })
        break
      default:
        toReview(c)
    }
  }

  // ── Gastos bancarios, uno por día ──
  for (const [day, list] of [...expenseDays.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    drafts.push(expenseDraft(day, list, input, tag, bank, dayGrouping))
  }

  // Determinista: por fecha y clave (la UI lo vuelve a ordenar como quiera).
  return drafts.sort((a, b) =>
    a.summary.date === b.summary.date
      ? a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0
      : a.summary.date < b.summary.date
        ? -1
        : 1,
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function roleFor(category: BankCategory | null): PartyRole {
  if (category === 'arca' || category === 'prov_munic') return 'tax_agency'
  if (category === 'sueldos') return 'payroll'
  if (category === 'transf_out') return 'supplier'
  return 'any'
}

function rowSummary(
  c: Classified,
  kind: DraftSummary['kind'],
  counterparty: string | null,
  notes: NoteKey[],
): DraftSummary {
  const it = c.s.item
  const all: NoteKey[] = [...notes]
  if (it.balanceOk === false && !all.includes('balance_chain')) all.push('balance_chain')
  if (c.rule && !all.includes('rule_applied')) all.push('rule_applied')
  return {
    kind,
    date: it.date,
    label: it.description.slice(0, 120) || `Movimiento del ${dayLabel(it.date)}`,
    counterparty,
    total_cents: Math.abs(it.amount),
    item_count: 1,
    detail: {
      direction: it.amount < 0 ? 'debit' : 'credit',
      category: c.category,
      rule: c.rule?.label ?? null,
      voucher: it.voucher,
    },
    ...(all.length > 0 ? { notes: all } : {}),
  }
}

function reviewDraft(c: Classified, input: BankDraftInput, bankId: string | null): ProposalDraft {
  const it = c.s.item
  const key = `${c.s.key}:revisar`
  const decisions = input.decisions(key)
  return genericMovement(key, c.s.id, {
    catalog: input.catalog,
    decisions,
    treasuryId: bankId,
    direction: it.amount < 0 ? 'out' : 'in',
    amount: Math.abs(it.amount),
    date: it.date,
    detail: it.description || 'Movimiento del banco',
    summary: withDecisions(rowSummary(c, 'bank_review', null, []), decisions),
  })
}

function movementDraft(
  c: Classified,
  input: BankDraftInput,
  bankId: string | null,
  action: Extract<BankRuleAction, { kind: 'movement' }>,
): ProposalDraft {
  const it = c.s.item
  const key = `${c.s.key}:revisar`
  // La regla decide la contrapartida; una decisión puntual de la persona gana.
  const decisions: ProposalDecisions = {
    counterpart_account_id: action.accountId,
    ...(action.partyId ? { party_id: action.partyId } : {}),
    ...input.decisions(key),
  }
  return genericMovement(key, c.s.id, {
    catalog: input.catalog,
    decisions,
    treasuryId: bankId,
    direction: it.amount < 0 ? 'out' : 'in',
    amount: Math.abs(it.amount),
    date: it.date,
    detail: it.description || 'Movimiento del banco',
    summary: withDecisions(rowSummary(c, 'bank_review', null, []), input.decisions(key)),
  })
}

function transferDraft(
  c: Classified,
  input: BankDraftInput,
  bankId: string | null,
  otherSuggested: string | null,
): ProposalDraft {
  const it = c.s.item
  const { catalog } = input
  const key = `${c.s.key}:transfer`
  const decisions = input.decisions(key)
  // La regla, la billetera de Mercado Pago o la única caja del tipo; si no, que elija la persona.
  const other = decisions.treasury_id ?? otherSuggested
  const amount = Math.abs(it.amount)
  const incoming = it.amount > 0
  const summary = (counterparty: string | null) =>
    withDecisions(rowSummary(c, 'bank_transfer', counterparty, []), decisions)
  if (!other || !bankId || other === bankId) {
    return {
      key,
      form: 'transfer',
      values: null,
      itemIds: [c.s.id],
      needs: [{ key: 'pick_treasury', suggested_treasury_id: otherSuggested }],
      summary: summary(null),
    }
  }
  const from = incoming ? other : bankId
  const to = incoming ? bankId : other
  const otherName = catalog.treasuries.get(other)?.name ?? null
  const posted = findPostedTransfer(input.postedTransfers, from, to, amount, it.date)
  if (posted) {
    return {
      key,
      form: 'transfer',
      values: null,
      itemIds: [c.s.id],
      needs: [],
      summary: summary(otherName),
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
      toTreasuryId: to,
      amountCents: amount,
      date: it.date,
      reference: (it.voucher ?? it.reference)?.slice(0, 60) ?? null,
      notes: NOTES,
    },
    itemIds: [c.s.id],
    needs: [],
    summary: summary(otherName),
  }
}

/** A quién se le sugiere el pago: el CUIT de la contraparte o el partícipe de sistema. */
function suggestedPayee(c: Classified, catalog: ImportCatalog): ImportParty | null {
  const it = c.s.item
  if (it.counterpartyCuit) {
    const byCuit = partyByCuit(catalog, it.counterpartyCuit)
    if (byCuit?.active) return byCuit
  }
  const text = normalizeBankDescription(it.description)
  switch (c.category) {
    case 'arca':
      return systemParty(catalog, 'arca')
    case 'prov_munic':
      return /MUNIC/.test(text)
        ? systemParty(catalog, 'municipalidad')
        : systemParty(catalog, 'rentas')
    case 'sueldos':
      return systemParty(catalog, 'personal')
    default:
      return null
  }
}

function paymentDraft(
  c: Classified,
  input: BankDraftInput,
  bankId: string | null,
  rulePartyId: string | null,
  role: PartyRole,
): ProposalDraft {
  const it = c.s.item
  const { catalog } = input
  const key = `${c.s.key}:pago`
  const decisions = input.decisions(key)
  const partyId = decisions.party_id ?? rulePartyId
  const party = partyId ? (catalog.parties.get(partyId) ?? null) : null
  const amount = Math.abs(it.amount)
  if (!party || !bankId) {
    return {
      key,
      form: 'payment',
      values: null,
      itemIds: [c.s.id],
      needs: [
        {
          key: 'pick_party',
          role,
          suggested_party_id: suggestedPayee(c, catalog)?.id ?? null,
        },
      ],
      summary: withDecisions(rowSummary(c, 'bank_payment', null, []), decisions),
    }
  }
  const applications = input.frozen?.(key)
    ? []
    : input.pool.take(payableOf(party.id, party.payableAccountId), amount)
  return {
    key,
    form: 'payment',
    values: {
      partyId: party.id,
      date: it.date,
      applications,
      creditsUsed: [],
      methods: [
        {
          type: 'treasury',
          treasuryAccountId: bankId,
          amountCents: amount,
          reference: (it.voucher ?? it.reference)?.slice(0, 60) ?? null,
        },
      ],
      writeOffCents: 0,
      notes: NOTES,
    },
    itemIds: [c.s.id],
    needs: [],
    summary: withDecisions(rowSummary(c, 'bank_payment', partyLabel(party), []), decisions),
  }
}

/** El procesador que sugiere la descripción (Visa/Master → crédito; Maestro/débito → débito). */
function suggestedProcessor(c: Classified, catalog: ImportCatalog): string | null {
  const text = normalizeBankDescription(c.s.item.description)
  if (/MAESTRO|DEBITO|ELECTRON/.test(text)) return systemParty(catalog, 'posnet_debito')?.id ?? null
  if (/VISA|MASTER|CABAL|AMEX|NARANJA/.test(text)) {
    return systemParty(catalog, 'posnet_credito')?.id ?? null
  }
  const processors = [...catalog.parties.values()].filter(
    (p) => p.active && p.kind === 'card_processor',
  )
  return processors.length === 1 ? (processors[0]?.id ?? null) : null
}

/**
 * Lo que descuenta el procesador, estimado con sus tasas: el banco trae el
 * NETO, así que se busca el bruto que, menos sus descuentos, da ese neto
 * (`prefillDeductions`, unas pocas vueltas: converge al centavo).
 */
export function estimateDeductions(
  netCents: number,
  party: Pick<ImportParty, 'rates'>,
): { grossCents: number; deductions: Array<{ taxKind: string; amountCents: number }> } {
  let gross = netCents
  let deductions = prefillDeductions(gross, party.rates)
  for (let i = 0; i < 8; i++) {
    const total = deductions.reduce((a, d) => a + d.amountCents, 0)
    const next = netCents + total
    if (next === gross) break
    gross = next
    deductions = prefillDeductions(gross, party.rates)
  }
  // Lo que da el reparto final manda: bruto = neto + descuentos (exacto).
  const total = deductions.reduce((a, d) => a + d.amountCents, 0)
  return { grossCents: netCents + total, deductions }
}

function collectionDraft(
  c: Classified,
  input: BankDraftInput,
  bankId: string | null,
  rulePartyId: string | null,
): ProposalDraft {
  const it = c.s.item
  const { catalog } = input
  const key = `${c.s.key}:cobro`
  const decisions = input.decisions(key)
  const partyId = decisions.party_id ?? rulePartyId
  const party = partyId ? (catalog.parties.get(partyId) ?? null) : null
  const net = Math.abs(it.amount)
  if (!party || !bankId) {
    return {
      key,
      form: 'collection',
      values: null,
      itemIds: [c.s.id],
      needs: [
        {
          key: 'pick_party',
          role: 'card_processor',
          suggested_party_id: suggestedProcessor(c, catalog),
        },
      ],
      summary: withDecisions(rowSummary(c, 'bank_collection', null, []), decisions),
    }
  }
  const { grossCents, deductions } = estimateDeductions(net, party)
  const needs: ImportNeed[] = []
  if (deductions.length > 0 && !isConfirmed(decisions, 'estimated_deductions')) {
    needs.push({ key: 'estimated_deductions' })
  }
  const receivable = (i: OpenItemRef) =>
    i.partyId === party.id && i.accountId === party.receivableAccountId && i.side === 'debit'
  const applications = input.frozen?.(key) ? [] : input.pool.take(receivable, grossCents)
  const summary = withDecisions(rowSummary(c, 'bank_collection', partyLabel(party), []), decisions)
  return {
    key,
    form: 'collection',
    values: {
      partyId: party.id,
      date: it.date,
      applications,
      creditsUsed: [],
      grossCents: null,
      deductions,
      received: [{ treasuryAccountId: bankId, amountCents: net, reference: null }],
      writeOffCents: 0,
      commissionVoucher: party.commissionVatMode === 'none' ? { mode: 'none' } : { mode: 'later' },
      notes: NOTES,
    },
    itemIds: [c.s.id],
    needs,
    summary: {
      ...summary,
      total_cents: grossCents,
      detail: { ...(summary.detail ?? {}), net_cents: net, gross_cents: grossCents },
    },
  }
}

type DayGrouping = {
  /** IVA o percepción → los índices de sus madres. */
  motherOf: ReadonlyMap<number, number[]>
  /** Alícuota de cada IVA que calzó con su madre. */
  ivaRates: ReadonlyMap<number, 'iva_21' | 'iva_105'>
  /** Ley 25.413 → el movimiento que la generó. */
  leyBase: ReadonlyMap<number, number>
  /** IVA o percepciones que no calzaron con ninguna madre. */
  unmatched: ReadonlySet<number>
  /** Importe (con signo) de cualquier fila del extracto, por índice. */
  amountAt: (index: number) => number
}

function expenseDraft(
  day: IsoDate,
  list: readonly Classified[],
  input: BankDraftInput,
  tag: string,
  bank: { id: string; name: string } | null,
  grouping: DayGrouping,
): ProposalDraft {
  const { motherOf, ivaRates, leyBase, unmatched, amountAt } = grouping
  const { catalog } = input
  const key = `bank:${input.treasuryId.replace(/-/g, '').slice(0, 8)}:${day}:gastos:${tag}`
  const abs = (c: Classified) => Math.abs(c.s.item.amount)
  const byIndex = new Map(list.map((c) => [c.index, c]))
  const notes: NoteKey[] = []
  if (list.some((c) => c.s.item.balanceOk === false)) notes.push('balance_chain')
  if (list.some((c) => c.rule)) notes.push('rule_applied')

  const commissions = list.filter(
    (c) => c.category === 'comisiones' && c.component !== 'gastos_sin_iva',
  )
  const ivaRows = list.filter((c) => c.category === 'iva_cf')
  // Comisiones con su IVA al 21 %: las madres de un IVA que calzó (`groupDailyCharges`).
  // El IVA al 10,5 % es de un interés: va con el gasto del interés (fuera del Libro IVA).
  const withVat = new Set<number>()
  let vat21 = 0
  let vat105 = 0
  let vatLoose = 0
  for (const c of ivaRows) {
    const mothers = motherOf.get(c.index) ?? []
    const motherRows = mothers.map((m) => byIndex.get(m)).filter((m): m is Classified => !!m)
    const complete = mothers.length > 0 && motherRows.length === mothers.length
    const rate = complete ? ivaRates.get(c.index) : undefined
    if (rate === 'iva_21' && motherRows.every((m) => m.category === 'comisiones')) {
      vat21 += abs(c)
      for (const m of motherRows) withVat.add(m.index)
    } else if (rate === 'iva_105') vat105 += abs(c)
    else vatLoose += abs(c)
  }
  let feesNet = commissions.filter((c) => withVat.has(c.index)).reduce((a, c) => a + abs(c), 0)
  let feesNoVat =
    commissions.filter((c) => !withVat.has(c.index)).reduce((a, c) => a + abs(c), 0) +
    list.filter((c) => c.component === 'gastos_sin_iva').reduce((a, c) => a + abs(c), 0)
  let vatAdjust = feesNet > 0 ? vat21 - vatFromNet(feesNet, 2100) : 0
  if (feesNet > 0 && Math.abs(vatAdjust) > 100) {
    // No calza dentro del ajuste de $ 1: comisiones e IVA van enteros a gastos (fuera del Libro IVA igual).
    feesNoVat += feesNet
    vatLoose += vat21
    feesNet = 0
    vatAdjust = 0
  } else if (feesNet === 0) {
    vatLoose += vat21
  }
  if (vatLoose > 0 || list.some((c) => unmatched.has(c.index))) notes.push('unmatched_charges')

  const perc = list.filter((c) => c.category === 'perc_iva').reduce((a, c) => a + abs(c), 0)
  const sircreb = list.filter((c) => c.category === 'sircreb').reduce((a, c) => a + abs(c), 0)
  const interest = list.filter((c) => c.category === 'intereses').reduce((a, c) => a + abs(c), 0)
  // Ley 25.413: sobre créditos o sobre débitos. Primero lo que dice el texto
  // («IMP. CRED.» / «IMP. DEB.»); si no, el sentido del movimiento que la generó.
  let leyCredit = 0
  let leyDebit = 0
  for (const c of list.filter((x) => x.category === 'ley25413')) {
    if (c.component === 'ley25413_credito') {
      leyCredit += abs(c)
      continue
    }
    if (c.component === 'ley25413_debito') {
      leyDebit += abs(c)
      continue
    }
    const text = normalizeBankDescription(c.s.item.description)
    const onCredit = /CRED/.test(text)
    const onDebit = /DEB/.test(text)
    const base = leyBase.get(c.index)
    if (onCredit && !onDebit) leyCredit += abs(c)
    else if (onDebit && !onCredit) leyDebit += abs(c)
    else if (base !== undefined && amountAt(base) > 0) leyCredit += abs(c)
    else leyDebit += abs(c)
  }

  const bankFees = systemAccountId(catalog, 'bank_fees')
  const interestAccount = systemAccountId(catalog, 'interest_expense')
  const others: Array<{ accountId: string; amountCents: number }> = []
  if (vatLoose > 0 && bankFees) others.push({ accountId: bankFees, amountCents: vatLoose })
  if (vat105 > 0 && interestAccount)
    others.push({ accountId: interestAccount, amountCents: vat105 })
  const vatPosted = feesNet > 0 ? vatFromNet(feesNet, 2100) + vatAdjust : 0
  const total =
    feesNet +
    vatPosted +
    perc +
    feesNoVat +
    leyCredit +
    leyDebit +
    sircreb +
    interest +
    others.reduce((a, o) => a + o.amountCents, 0)

  const summary: DraftSummary = withDecisions(
    {
      kind: 'bank_expense',
      date: day,
      label: `Gastos bancarios del ${dayLabel(day)}`,
      counterparty: bank?.name ?? null,
      total_cents: total,
      item_count: list.length,
      detail: {
        fees_net_cents: feesNet,
        vat_cents: vatPosted,
        fees_no_vat_cents: feesNoVat,
        vat_perception_cents: perc,
        ley25413_credit_cents: leyCredit,
        ley25413_debit_cents: leyDebit,
        sircreb_cents: sircreb,
        interest_cents: interest,
        other_cents: others.reduce((a, o) => a + o.amountCents, 0),
      },
      ...(notes.length > 0 ? { notes } : {}),
    },
    input.decisions(key),
  )
  const itemIds = list.map((c) => c.s.id)
  if (input.manualExpenses.has(`${day}:${total}`)) {
    return {
      key,
      form: 'bank_expense',
      values: null,
      itemIds,
      needs: [],
      summary,
      skip: { reason: 'already_loaded', date: day },
    }
  }
  return {
    key,
    form: 'bank_expense',
    values:
      bank && total > 0
        ? {
            treasuryAccountId: bank.id,
            date: day,
            includeInIvaBook: false,
            voucher: null,
            feesNetCents: feesNet,
            vatRateBp: 2100,
            vatAdjustCents: vatAdjust,
            vatPerceptionCents: perc,
            feesNoVatCents: feesNoVat,
            ley25413CreditCents: leyCredit,
            ley25413DebitCents: leyDebit,
            sircrebCents: sircreb,
            interestCents: interest,
            others,
            notes: NOTES,
          }
        : null,
    itemIds,
    needs: bank ? [] : [{ key: 'manual', reason: 'unsupported' }],
    summary,
  }
}
