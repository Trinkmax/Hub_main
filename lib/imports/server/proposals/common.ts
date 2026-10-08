/**
 * Piezas comunes de las propuestas de importación (diseño §4.0): el catálogo
 * del bar visto por el importador, las partidas abiertas que se van
 * consumiendo entre propuestas del mismo armado, y la evaluación de cada
 * borrador con el MISMO camino que la acción de guardar (zod del formulario →
 * `build*` → vista previa → hash), así «lo que se ve es lo que se guarda» (E.7).
 *
 * Puro (sin `server-only`): lo usan los tres armadores, el servidor y los tests.
 */

import type { PostingCatalog } from '@/lib/accounting/context'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type {
  Channel,
  CommissionVatMode,
  IsoDate,
  IvaCondition,
  OpenItemRef,
  PartyKind,
  PartyRates,
  PostingContext,
  SalesMethodKind,
  SasIvaCondition,
  TreasuryKind,
  WarningKey,
} from '@/lib/accounting/types'
import type { ImportIssue, ProposalForm } from '../../types'
import {
  CONFIRMABLE_NEEDS,
  type ConfirmableNeed,
  type ImportItemStatus,
  type ImportNeed,
  isBatchAcceptable,
  type ProposalDecisions,
  type ProposalError,
  type ProposalStatus,
  type ProposalSummary,
} from '../types'

// ─── Filas del lote ──────────────────────────────────────────────────────────

/** Una fila de `acc_import_items` ya validada contra el esquema de su origen. */
export type StagedItem<T> = {
  readonly id: string
  readonly rowNo: number
  readonly key: string
  readonly status: ImportItemStatus
  readonly item: T
  readonly issues: readonly ImportIssue[]
}

/** Las filas que arman propuestas: las vivas (las cargadas también, para los agregados del día). */
export function isBuildable(status: ImportItemStatus): boolean {
  return status === 'new' || status === 'review' || status === 'posted'
}

// ─── El catálogo del bar, visto por el importador ────────────────────────────

export type ImportParty = {
  readonly id: string
  readonly kind: PartyKind
  readonly name: string
  readonly tradeName: string | null
  readonly taxId: string | null
  readonly ivaCondition: IvaCondition
  readonly active: boolean
  readonly systemKey: string | null
  readonly defaultAccountId: string | null
  readonly payableAccountId: string
  readonly receivableAccountId: string
  readonly commissionVatMode: CommissionVatMode
  readonly rates: PartyRates
  readonly updatedAt: string | null
}

export type ImportTreasury = {
  readonly id: string
  readonly accountId: string
  readonly name: string
  readonly kind: TreasuryKind
  readonly active: boolean
  readonly cbuCvu: string | null
  readonly bankPartyId: string | null
}

export type ImportMethod = {
  readonly id: string
  readonly name: string
  readonly kind: SalesMethodKind
  readonly channel: Channel
  readonly partyId: string | null
  readonly treasuryAccountId: string | null
  readonly active: boolean
}

export type ImportAccount = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly systemKey: SystemAccountKey | null
  readonly postable: boolean
  readonly active: boolean
  readonly purchaseSelectable: boolean
  readonly isTreasury: boolean
  readonly requiresParty: boolean
}

export type ImportSettings = {
  readonly cuit: string | null
  readonly legalName: string
  readonly ivaCondition: SasIvaCondition
  /** Jurisdicción de IIBB de la SAS (904 = Córdoba): la de una percepción de IIBB por defecto. */
  readonly iibbJurisdictionCode: number
}

export type ImportCatalog = {
  readonly parties: ReadonlyMap<string, ImportParty>
  readonly treasuries: ReadonlyMap<string, ImportTreasury>
  readonly methods: ReadonlyMap<string, ImportMethod>
  readonly accounts: ReadonlyMap<string, ImportAccount>
  readonly settings: ImportSettings
}

/** `acc_posting_context` normalizado → lo que necesitan los armadores. */
export function importCatalogFrom(catalog: PostingCatalog): ImportCatalog {
  return {
    parties: new Map(
      catalog.parties.map((p) => [
        p.id,
        {
          id: p.id,
          kind: p.kind,
          name: p.name,
          tradeName: p.tradeName,
          taxId: p.taxId,
          ivaCondition: p.ivaCondition,
          active: p.active,
          systemKey: p.systemKey,
          defaultAccountId: p.defaultAccountId,
          payableAccountId: p.payableAccountId,
          receivableAccountId: p.receivableAccountId,
          commissionVatMode: p.commissionVatMode,
          rates: p.rates,
          updatedAt: p.updatedAt,
        },
      ]),
    ),
    treasuries: new Map(
      catalog.treasuries.map((t) => [
        t.id,
        {
          id: t.id,
          accountId: t.accountId,
          name: t.name,
          kind: t.kind,
          active: t.active,
          cbuCvu: t.cbuCvu,
          bankPartyId: t.bankPartyId,
        },
      ]),
    ),
    methods: new Map(
      catalog.methods.map((m) => [
        m.id,
        {
          id: m.id,
          name: m.name,
          kind: m.kind,
          channel: m.channel,
          partyId: m.partyId,
          treasuryAccountId: m.treasuryAccountId,
          active: m.active,
        },
      ]),
    ),
    accounts: new Map(
      catalog.accounts.map((a) => [
        a.id,
        {
          id: a.id,
          code: a.code,
          name: a.name,
          systemKey: a.systemKey,
          postable: a.postable,
          active: a.active,
          purchaseSelectable: a.purchaseSelectable,
          isTreasury: a.isTreasury,
          requiresParty: a.requiresParty,
        },
      ]),
    ),
    settings: {
      cuit: catalog.settings.cuit,
      legalName: catalog.settings.legalName,
      ivaCondition: catalog.settings.ivaCondition,
      iibbJurisdictionCode: catalog.settings.iibbJurisdictionCode,
    },
  }
}

/** El nombre que se muestra («nombre de fantasía» si tiene). */
export function partyLabel(p: Pick<ImportParty, 'name' | 'tradeName'>): string {
  return p.tradeName ?? p.name
}

/** El partícipe de un CUIT: el activo primero; a igual estado, el de nombre menor (determinista). */
export function partyByCuit(catalog: ImportCatalog, cuit: string): ImportParty | null {
  let best: ImportParty | null = null
  for (const p of catalog.parties.values()) {
    if (p.taxId !== cuit) continue
    if (
      !best ||
      (p.active && !best.active) ||
      (p.active === best.active && (p.name < best.name || (p.name === best.name && p.id < best.id)))
    ) {
      best = p
    }
  }
  return best
}

export function systemParty(catalog: ImportCatalog, key: string): ImportParty | null {
  for (const p of catalog.parties.values()) if (p.systemKey === key) return p
  return null
}

export function systemAccountId(catalog: ImportCatalog, key: SystemAccountKey): string | null {
  for (const a of catalog.accounts.values()) if (a.systemKey === key) return a.id
  return null
}

/** Las cajas activas de un tipo, en un orden estable (nombre, id). */
export function treasuriesOfKind(catalog: ImportCatalog, kind: TreasuryKind): ImportTreasury[] {
  return [...catalog.treasuries.values()]
    .filter((t) => t.active && t.kind === kind)
    .sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1))
}

// ─── Partidas abiertas que se consumen entre propuestas ──────────────────────

function byAge(a: OpenItemRef, b: OpenItemRef): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1
  const da = a.dueDate ?? '9999-12-31'
  const db = b.dueDate ?? '9999-12-31'
  if (da !== db) return da < db ? -1 : 1
  return a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0
}

/**
 * Las partidas abiertas del contexto, con lo que les queda: dos propuestas del
 * mismo armado nunca aplican el mismo peso (dos pagos al mismo proveedor, dos
 * cobros del mismo día). Siempre la más vieja primero.
 */
export class OpenItemPool {
  private readonly items: OpenItemRef[]
  private readonly left = new Map<string, number>()

  constructor(items: Iterable<OpenItemRef>) {
    this.items = [...items].filter((i) => i.openCents > 0).sort(byAge)
    for (const i of this.items) this.left.set(i.lineId, i.openCents)
  }

  /** Lo que queda abierto de las partidas que pasan el filtro. */
  available(filter: (item: OpenItemRef) => boolean): number {
    let sum = 0
    for (const item of this.items) if (filter(item)) sum += this.left.get(item.lineId) ?? 0
    return sum
  }

  /** Toma hasta `amount` (la más vieja primero) y lo descuenta para las próximas propuestas. */
  take(
    filter: (item: OpenItemRef) => boolean,
    amount: number,
  ): Array<{ lineId: string; amountCents: number }> {
    const out: Array<{ lineId: string; amountCents: number }> = []
    let rest = amount
    for (const item of this.items) {
      if (rest <= 0) break
      if (!filter(item)) continue
      const left = this.left.get(item.lineId) ?? 0
      if (left <= 0) continue
      const take = Math.min(left, rest)
      out.push({ lineId: item.lineId, amountCents: take })
      this.left.set(item.lineId, left - take)
      rest -= take
    }
    return out
  }
}

// ─── Borradores y su evaluación ──────────────────────────────────────────────

/** El resumen que arma cada origen; el mes del libro y los avisos los agrega la evaluación. */
export type DraftSummary = Omit<ProposalSummary, 'month' | 'warnings'>

/** Una propuesta antes de pasar por el motor. */
export type ProposalDraft = {
  readonly key: string
  readonly form: ProposalForm
  /**
   * La entrada del formulario (`*Values`) sin `clientRef`, `previewHash` ni
   * `warningsAck`; `null` si todavía no se puede armar (falta algo).
   */
  readonly values: Record<string, unknown> | null
  readonly itemIds: readonly string[]
  readonly needs: readonly ImportNeed[]
  readonly summary: DraftSummary
  /** Si viene, la propuesta queda `skipped` con este motivo. */
  readonly skip?: ProposalError
}

/** Lo que se escribe con `acc_import_put_proposals` (sin `client_ref`/`attempt`). */
export type EvaluatedProposal = {
  readonly key: string
  readonly form: ProposalForm
  readonly formValues: Record<string, unknown>
  readonly summary: ProposalSummary
  readonly status: ProposalStatus
  readonly previewHash: string | null
  readonly needs: ImportNeed[]
  readonly warningsAck: WarningKey[]
  readonly itemIds: readonly string[]
  readonly error: ProposalError | null
}

export type EvaluateOptions = {
  firstOpenDate: IsoDate | null
  /** Avisos ya aceptados en esta propuesta (`warnings_ack`). */
  warningsAck: readonly WarningKey[]
}

function firstField(fieldErrors: Record<string, string> | undefined): string | null {
  if (!fieldErrors) return null
  const keys = Object.keys(fieldErrors)
  return keys.length > 0 ? (keys[0] ?? null) : null
}

/**
 * Pasa el borrador por el mismo camino que la acción de guardar
 * (`previewDocumentForm`): zod del formulario → `build*` → vista previa → hash.
 *
 * - Se armó y no falta nada → `ready` con su `preview_hash`.
 * - Avisos del motor: los que se aceptan por lote quedan en `summary.warnings`
 *   (siguen `ready`); los demás piden `accept_warning`.
 * - El motor no lo pudo armar → `needs_input` con `engine_error` (el texto del
 *   catálogo) y sin hash.
 */
export function evaluateDraft(
  draft: ProposalDraft,
  ctx: PostingContext,
  opts: EvaluateOptions,
): EvaluatedProposal {
  const base = {
    key: draft.key,
    form: draft.form,
    formValues: draft.values ?? {},
    itemIds: draft.itemIds,
    warningsAck: [...opts.warningsAck],
  }
  if (draft.skip) {
    return {
      ...base,
      summary: { ...draft.summary, month: null },
      status: 'skipped',
      previewHash: null,
      needs: [],
      error: draft.skip,
    }
  }

  const needs: ImportNeed[] = [...draft.needs]
  let previewHash: string | null = null
  let month: string | null = null
  let warnings: WarningKey[] = []
  if (draft.values) {
    const res = previewDocumentForm(
      draft.form,
      { ...draft.values, warningsAck: [...opts.warningsAck] },
      ctx,
      { firstOpenDate: opts.firstOpenDate },
    )
    if (!res.ok) {
      const key = typeof res.detail?.key === 'string' ? res.detail.key : null
      needs.push({
        key: 'engine_error',
        error_key: key,
        message: res.message,
        field: firstField(res.fieldErrors),
      })
    } else if (!res.preview.every((p) => p.balanced)) {
      needs.push({
        key: 'engine_error',
        error_key: 'entry_not_balanced',
        message: 'El asiento no cuadra.',
        field: null,
      })
    } else {
      previewHash = res.hash
      month = res.preview[0]?.date.slice(0, 7) ?? null
      const pending = res.warnings.map((w) => w.key).filter((k) => !opts.warningsAck.includes(k))
      warnings = [...new Set(pending.filter(isBatchAcceptable))]
      const blocking = [...new Set(pending.filter((k) => !isBatchAcceptable(k)))]
      if (blocking.length > 0) needs.push({ key: 'accept_warning', warnings: blocking })
    }
  } else if (needs.length === 0) {
    needs.push({ key: 'manual', reason: 'unsupported' })
  }

  const summary: ProposalSummary = {
    ...draft.summary,
    month,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
  return {
    ...base,
    summary,
    status: needs.length > 0 ? 'needs_input' : 'ready',
    previewHash,
    needs,
    error: null,
  }
}

// ─── Decisiones ──────────────────────────────────────────────────────────────

export function isConfirmed(decisions: ProposalDecisions, need: ConfirmableNeed): boolean {
  return decisions.confirmed?.includes(need) ?? false
}

/** Junta decisiones: lo nuevo pisa lo viejo; `confirmed` se une. */
export function mergeDecisions(
  base: ProposalDecisions,
  patch: ProposalDecisions,
): ProposalDecisions {
  const out: ProposalDecisions = { ...base, ...patch }
  if (base.tax_accounts || patch.tax_accounts) {
    out.tax_accounts = { ...(base.tax_accounts ?? {}), ...(patch.tax_accounts ?? {}) }
  }
  const confirmed = [...(base.confirmed ?? []), ...(patch.confirmed ?? [])].filter(
    (n): n is ConfirmableNeed => (CONFIRMABLE_NEEDS as readonly string[]).includes(n),
  )
  if (confirmed.length > 0) out.confirmed = [...new Set(confirmed)].sort()
  else delete out.confirmed
  return out
}

/** Las decisiones guardadas en un `summary` (lo que no se reconoce se descarta). */
export function decisionsFromSummary(summary: unknown): ProposalDecisions {
  if (typeof summary !== 'object' || summary === null) return {}
  const raw = (summary as { decisions?: unknown }).decisions
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const d = raw as Record<string, unknown>
  const out: ProposalDecisions = {}
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
  const asOf = d.other_taxes_as
  if (asOf === 'perc_iibb' || asOf === 'perc_iva' || asOf === 'internal' || asOf === 'account') {
    out.other_taxes_as = asOf
  }
  const ids = [
    'other_taxes_account_id',
    'party_id',
    'treasury_id',
    'counterpart_account_id',
  ] as const
  for (const k of ids) {
    const v = str(d[k])
    if (v) out[k] = v
  }
  if (typeof d.jurisdiction_code === 'number' && Number.isInteger(d.jurisdiction_code)) {
    out.jurisdiction_code = d.jurisdiction_code
  }
  if (d.credit_note_document_id === null) out.credit_note_document_id = null
  else if (str(d.credit_note_document_id))
    out.credit_note_document_id = d.credit_note_document_id as string
  if (typeof d.settles_commissions === 'boolean') out.settles_commissions = d.settles_commissions
  if (
    typeof d.tax_accounts === 'object' &&
    d.tax_accounts !== null &&
    !Array.isArray(d.tax_accounts)
  ) {
    const taxes: Record<string, string> = {}
    for (const [k, v] of Object.entries(d.tax_accounts as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== '' && k.length <= 80) taxes[k] = v
    }
    if (Object.keys(taxes).length > 0) out.tax_accounts = taxes
  }
  if (Array.isArray(d.confirmed)) {
    const confirmed = d.confirmed.filter((n): n is ConfirmableNeed =>
      (CONFIRMABLE_NEEDS as readonly unknown[]).includes(n),
    )
    if (confirmed.length > 0) out.confirmed = [...new Set(confirmed)].sort()
  }
  return out
}

/** El `summary` con sus decisiones (solo si hay alguna). */
export function withDecisions(summary: DraftSummary, decisions: ProposalDecisions): DraftSummary {
  return Object.keys(decisions).length > 0 ? { ...summary, decisions } : summary
}

// ─── Claves y textos ─────────────────────────────────────────────────────────

/**
 * Marca del lote para las claves de los agregados (cobros del día, gastos del
 * día, rendimientos del mes): así dos reportes que se pisan en un día no
 * comparten la clave (`aipr_posted_key_uq` salteaba la segunda tanda).
 */
export function batchTag(batchId: string): string {
  return `b${batchId.replace(/-/g, '').slice(0, 8).toLowerCase()}`
}

/** «05/10». */
export function dayLabel(iso: IsoDate): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** JSON con las claves ordenadas (para comparar lo que ya está guardado). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key]
      }
      return sorted
    }
    return v
  })
}

// ─── Tamaños (los CHECK de la base miden `pg_column_size` del jsonb) ─────────

function utf8Length(text: string): number {
  let n = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return n
}

/**
 * Cota superior del tamaño de un valor como `jsonb` (lo que mide
 * `pg_column_size`). Calibrada contra Postgres (los casos medidos están en
 * `tests/lib/imports-stage.test.ts`): siempre da de más, nunca de menos, así
 * sirve para recortar antes de mandar y que la base no rechace la tanda.
 */
export function estimateJsonbSize(value: unknown): number {
  const walk = (v: unknown): number => {
    if (v === null || v === undefined || typeof v === 'boolean') return 0
    if (typeof v === 'number') return 12
    if (typeof v === 'string') return utf8Length(v) + 1
    if (Array.isArray(v)) return 8 + v.reduce<number>((acc, x) => acc + 4 + walk(x) + 3, 0)
    if (typeof v === 'object') {
      let sum = 8
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x === undefined) continue
        sum += 8 + utf8Length(k) + walk(x) + 3
      }
      return sum
    }
    return 16
  }
  return 4 + walk(value)
}

// ─── Movimiento genérico (lo que no se sabe clasificar solo) ────────────────

/**
 * Un movimiento de una caja contra la cuenta que elija la persona (lo que el
 * importador no sabe clasificar solo): `cash_movement` con la contrapartida de
 * la decisión; sin decisión, `counterpart_account`. Si la cuenta pide
 * partícipe, también hay que elegirlo.
 */
export function genericMovement(
  key: string,
  itemId: string,
  o: {
    catalog: ImportCatalog
    decisions: ProposalDecisions
    treasuryId: string | null
    direction: 'in' | 'out'
    amount: number
    date: IsoDate
    detail: string
    summary: DraftSummary
  },
): ProposalDraft {
  const needs: ImportNeed[] = []
  const accountId = o.decisions.counterpart_account_id ?? null
  const account = accountId ? (o.catalog.accounts.get(accountId) ?? null) : null
  const partyId = o.decisions.party_id ?? null
  if (!account) needs.push({ key: 'counterpart_account', direction: o.direction })
  else if (account.requiresParty && !partyId) {
    needs.push({ key: 'pick_party', role: 'any', suggested_party_id: null })
  }
  if (!o.treasuryId) needs.push({ key: 'manual', reason: 'unsupported' })
  const ok = needs.length === 0 && account && o.treasuryId
  return {
    key,
    form: 'cash_movement',
    values: ok
      ? {
          treasuryAccountId: o.treasuryId,
          direction: o.direction,
          counterpartAccountId: account.id,
          partyId: account.requiresParty ? partyId : null,
          amountCents: o.amount,
          date: o.date,
          shortcut: 'other',
          detail: o.detail.slice(0, 280),
        }
      : null,
    itemIds: [itemId],
    needs,
    summary: o.summary,
  }
}
