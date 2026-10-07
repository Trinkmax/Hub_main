/**
 * Lo puro de las acciones de puesta en marcha y cierres: cómo se arma el jsonb
 * de cada RPC y cómo se lee lo que devuelve. Fuera de los archivos
 * `'use server'` para poder probarlo (accounting-setup-payloads.test.ts) y
 * reusarlo en el navegador si hace falta (no importa nada del servidor).
 */

import { capitalizeFirst, MONTH_NAMES } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import type { PostBundleResult } from '../action-state'
import { closeWarningText, isCloseWarningKey } from '../close-warnings'
import type { BootstrapInput } from '../schemas'
import { type CloseWarningKey, TREASURY_KINDS, type TreasuryKind } from '../types'

type Rec = Record<string, unknown>

function asRecord(v: unknown): Rec | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null
}

function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function intOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^-?\d{1,16}$/.test(v.trim())) {
    const n = Number(v.trim())
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

// ─── Asistente (acc_bootstrap) ───────────────────────────────────────────────

export type BootstrapTreasury = {
  /** La clave que mandó el asistente (`cash_main`, `wallet_main`…). */
  key: string
  id: string
  accountId: string
  name: string
  kind: TreasuryKind
}

export type BootstrapResult = {
  fiscalYearId: string | null
  /** Cantidades sembradas (para el paso «Listo»). */
  periods: number
  accounts: number
  parties: number
  salesMethods: number
  salesPoints: number
  /** Las cajas creadas, con su id (el paso 3 carga sus saldos iniciales). */
  treasuries: BootstrapTreasury[]
  accessId: string | null
}

/**
 * Lo que la base rechazaría con `invalid_method_targets` sin decir bien por
 * qué (`acc_seed_defaults`): un medio de cobro prendido sin una caja adonde ir.
 * Las transferencias van al destino elegido, o a la primera billetera, o al
 * primer banco; el QR, a una billetera.
 */
export function bootstrapMethodsIssue(
  v: Pick<BootstrapInput, 'treasuries' | 'sales'>,
): { field: string; message: string } | null {
  const kinds = new Set(v.treasuries.map((t) => t.kind))
  const methods = new Set(v.sales.enabledMethods)
  if (
    methods.has('transfer') &&
    v.sales.transferDestination === null &&
    !kinds.has('wallet') &&
    !kinds.has('bank')
  ) {
    return {
      field: 'sales.enabledMethods',
      message: 'Para cobrar con transferencia, sumá la cuenta de Mercado Pago o la del banco.',
    }
  }
  if (methods.has('qr_mp') && !kinds.has('wallet')) {
    return {
      field: 'sales.enabledMethods',
      message: 'Para cobrar con QR, sumá la cuenta de Mercado Pago (tipo billetera).',
    }
  }
  return null
}

/** Payload de `acc_bootstrap` (C.2 + el contrato de `acc_seed_defaults` de la #7). */
export function bootstrapPayload(v: BootstrapInput): Record<string, unknown> {
  const s = v.settings
  const rates: Record<string, Record<string, number>> = {}
  for (const [party, r] of Object.entries(v.sales.rates)) {
    if (!r) continue
    const out: Record<string, number> = {}
    if (r.commissionBp !== undefined) out.commission_bp = r.commissionBp
    if (r.sircupaBp !== undefined) out.sircupa_bp = r.sircupaBp
    if (r.iibbWithholdingBp !== undefined) out.iibb_withholding_bp = r.iibbWithholdingBp
    if (r.vatWithholdingBp !== undefined) out.vat_withholding_bp = r.vatWithholdingBp
    if (r.incomeTaxWithholdingBp !== undefined) {
      out.income_tax_withholding_bp = r.incomeTaxWithholdingBp
    }
    if (Object.keys(out).length > 0) rates[party] = out
  }
  return {
    display_name: v.displayName,
    settings: {
      legal_name: s.legalName,
      cuit: s.cuit,
      iva_condition: s.ivaCondition,
      iibb_regime: s.iibbRegime,
      iibb_number: s.iibbNumber,
      iibb_jurisdiction_code: s.iibbJurisdictionCode,
      activity_start_date: s.activityStartDate,
      fiscal_address: s.fiscalAddress,
      books_start_date: s.booksStartDate,
      fiscal_year_end_month: s.fiscalYearEndMonth,
      iva_settlement_mode: s.ivaSettlementMode,
    },
    treasuries: v.treasuries.map((t) => ({
      key: t.key,
      name: t.name,
      kind: t.kind,
      alias: t.alias,
      bank_name: t.bankName,
      cbu_cvu: t.cbuCvu,
      create_bank_party: t.createBankParty,
    })),
    sales: {
      transfer_destination: v.sales.transferDestination,
      transfer_deducts_iibb: v.sales.transferDeductsIibb,
      enabled_methods: v.sales.enabledMethods,
      enabled_platforms: v.sales.enabledPlatforms,
      rates,
      sales_points: v.sales.salesPoints.map((p) => ({
        number: p.number,
        label: p.label,
        default_channel: p.defaultChannel,
      })),
    },
  }
}

/** Lo que devuelve `acc_bootstrap`, en camelCase. */
export function parseBootstrapResult(data: unknown): BootstrapResult {
  const r = asRecord(data) ?? {}
  const treasuries: BootstrapTreasury[] = []
  if (Array.isArray(r.treasuries)) {
    for (const item of r.treasuries) {
      const t = asRecord(item)
      const key = textOf(t?.key)
      const id = textOf(t?.id)
      const accountId = textOf(t?.account_id)
      const name = textOf(t?.name)
      const kind = TREASURY_KINDS.find((k) => k === t?.kind)
      if (key && id && accountId && name && kind)
        treasuries.push({ key, id, accountId, name, kind })
    }
  }
  return {
    fiscalYearId: textOf(r.fiscal_year_id),
    periods: intOf(r.periods) ?? 0,
    accounts: intOf(r.accounts) ?? 0,
    parties: intOf(r.parties) ?? 0,
    salesMethods: intOf(r.sales_methods) ?? 0,
    salesPoints: intOf(r.sales_points) ?? 0,
    treasuries,
    accessId: textOf(r.access_id),
  }
}

/** Lo que devuelve `acc_post_bundle` (C.3.3 paso 10), con los números como números. */
export function parsePostBundleResult(data: unknown): PostBundleResult {
  const r = asRecord(data) ?? {}
  const documents: PostBundleResult['documents'] = []
  if (Array.isArray(r.documents)) {
    for (const item of r.documents) {
      const d = asRecord(item)
      if (!d) continue
      const lines: PostBundleResult['documents'][number]['lines'] = []
      if (Array.isArray(d.lines)) {
        for (const lineItem of d.lines) {
          const l = asRecord(lineItem)
          const lineNo = intOf(l?.line_no)
          const journalLineId = textOf(l?.journal_line_id)
          if (lineNo !== null && journalLineId) {
            lines.push({ line_no: lineNo, journal_line_id: journalLineId })
          }
        }
      }
      documents.push({
        ref: textOf(d.ref) ?? '',
        id: textOf(d.id) ?? '',
        seq: intOf(d.seq) ?? 0,
        entry_id: textOf(d.entry_id) ?? '',
        provisional_number: intOf(d.provisional_number),
        lines,
      })
    }
  }
  const allocations = Array.isArray(r.allocations)
    ? r.allocations.filter((a): a is string => typeof a === 'string')
    : []
  return {
    bundle_id: textOf(r.bundle_id) ?? '',
    replayed: r.replayed === true,
    documents,
    allocations,
  }
}

// ─── Cierres (C.5) ───────────────────────────────────────────────────────────

/** Un aviso del cierre de mes (C.5.1 paso 4) con su texto. */
export type CloseWarningItem = { key: CloseWarningKey; message: string }

/** `'2026-10-01'` → «Octubre». */
export function monthLabel(month: string): string {
  const n = Number(month.slice(5, 7))
  const name = n >= 1 && n <= 12 ? MONTH_NAMES[n - 1] : undefined
  return name ? capitalizeFirst(name) : 'El mes'
}

/**
 * Los avisos de `close_warnings` desde el `detail` de `acc_close_period`
 * (`{"month", "warnings": [{key, count, …}]}`: los mismos del checklist, con
 * sus números; también vale la lista sola o la clave sola), sin repetir y con
 * su texto («Faltan los cierres del día del 03/10 y 04/10.»). Lo que no se
 * reconoce se ignora.
 */
export function closeWarningsFromDetails(details: string | null | undefined): CloseWarningItem[] {
  if (!details) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(details)
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : asRecord(parsed)?.warnings
  if (!Array.isArray(list)) return []
  const out: CloseWarningItem[] = []
  for (const item of list) {
    const rec = isCloseWarningKey(item) ? {} : (asRecord(item) ?? {})
    const key = isCloseWarningKey(item) ? item : rec.key
    if (isCloseWarningKey(key) && !out.some((w) => w.key === key)) {
      out.push({ key, message: closeWarningText(key, rec) })
    }
  }
  return out
}

export type IvaPositionExpected = {
  debitCents: number
  creditCents: number
  perceptionsCents: number
  withholdingsCents: number
  toPayCents: number
  technicalBalanceNewCents: number
  freeBalanceNewCents: number
}

/**
 * Las cifras de la posición de IVA que vio la persona, como las compara la
 * base (`private.acc_generate_iva_settlement`, #10): las 7 de la server action
 * (débito, crédito, percepciones y retenciones del mes —con signo: un mes con
 * solo notas de crédito da negativo—, a pagar y los saldos a favor nuevos).
 * Si no coinciden con las de ese momento → `preview_stale`.
 */
export function ivaExpectedJson(e: IvaPositionExpected): Record<string, number> {
  return {
    debit_cents: e.debitCents,
    credit_cents: e.creditCents,
    perceptions_cents: e.perceptionsCents,
    withholdings_cents: e.withholdingsCents,
    to_pay_cents: e.toPayCents,
    technical_balance_new_cents: e.technicalBalanceNewCents,
    free_balance_new_cents: e.freeBalanceNewCents,
  }
}

// ─── Lo que devuelven los cierres (#10 partes 2 y 3, #15) ────────────────────

function dayOf(v: unknown): string | null {
  const t = textOf(v)
  if (!t) return null
  const day = t.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function textList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

export type ClosePeriodResult = {
  /** Primer día del mes cerrado (`'2026-10-01'`). */
  month: string
  periodId: string | null
  numberFrom: number | null
  numberTo: number | null
  entriesCount: number | null
  /** Σ Debe (= Σ Haber) de los asientos del mes. */
  debitTotalCents: number | null
  /** La liquidación de IVA que quedó con el mes (la generada al cerrar o la que ya estaba). */
  ivaSettlementDocumentId: string | null
  /** De la posición del mes; 0 si la SAS no liquida IVA. */
  ivaToPayCents: number | null
  ivaInFavorCents: number | null
}

/**
 * `acc_close_period` → `{month, period_id, number_from, number_to,
 * entries_count, debit_total_cents, snapshot_hash, iva_settlement_document_id,
 * iva_to_pay_cents, iva_in_favor_cents}`.
 */
export function parseClosePeriodResult(data: unknown, month: string): ClosePeriodResult {
  const r = asRecord(data) ?? {}
  return {
    month: dayOf(r.month) ?? month,
    periodId: textOf(r.period_id),
    numberFrom: intOf(r.number_from),
    numberTo: intOf(r.number_to),
    entriesCount: intOf(r.entries_count),
    debitTotalCents: intOf(r.debit_total_cents),
    ivaSettlementDocumentId: textOf(r.iva_settlement_document_id),
    ivaToPayCents: intOf(r.iva_to_pay_cents),
    ivaInFavorCents: intOf(r.iva_in_favor_cents),
  }
}

/** «Octubre cerrado. IVA a pagar: $ 891.400,00.» (el IVA, solo si el mes quedó con su liquidación). */
export function closePeriodMessage(r: ClosePeriodResult): string {
  const name = monthLabel(r.month)
  if (r.ivaSettlementDocumentId) {
    const toPay = r.ivaToPayCents ?? 0
    const inFavor = r.ivaInFavorCents ?? 0
    if (toPay > 0) return `${name} cerrado. IVA a pagar: ${formatCents(toPay)}.`
    if (inFavor > 0) return `${name} cerrado. IVA a favor: ${formatCents(inFavor)}.`
  }
  return `${name} cerrado.`
}

export type ReopenPeriodResult = {
  /** Primer día del mes reabierto. */
  month: string
  periodId: string | null
  /** Asientos que volvieron a número provisorio. */
  numbersCleared: number | null
  /** Las liquidaciones de IVA del mes que se anularon al reabrir. */
  voidedIvaSettlementIds: string[]
}

/** `acc_reopen_period` → `{month, period_id, numbers_cleared, voided_iva_settlement_ids, voided_count}`. */
export function parseReopenPeriodResult(data: unknown, month: string): ReopenPeriodResult {
  const r = asRecord(data) ?? {}
  return {
    month: dayOf(r.month) ?? month,
    periodId: textOf(r.period_id),
    numbersCleared: intOf(r.numbers_cleared),
    voidedIvaSettlementIds: textList(r.voided_iva_settlement_ids),
  }
}

export function reopenPeriodMessage(r: ReopenPeriodResult): string {
  const name = monthLabel(r.month)
  return r.voidedIvaSettlementIds.length > 0
    ? `${name} reabierto. Se anuló su liquidación del IVA.`
    : `${name} reabierto.`
}

export type IvaSettlementResult = {
  /** Primer día del mes. */
  month: string
  /** `null` si la posición del mes dio todo en cero (no se crea nada). */
  documentId: string | null
  documentSeq: number | null
  entryId: string | null
  toPayCents: number | null
  inFavorCents: number | null
  /** Liquidaciones viejas del mes que se anularon y se reemplazaron por esta. */
  replacedCount: number
}

/**
 * `acc_generate_iva_settlement` → `{month, created, document_id,
 * document_seq, entry_id, total_cents, to_pay_cents, in_favor_cents,
 * replaced_count}`. También acepta el id solo o `iva_settlement_document_id`.
 */
export function parseIvaSettlementResult(data: unknown, month: string): IvaSettlementResult {
  if (typeof data === 'string') {
    return {
      month,
      documentId: textOf(data),
      documentSeq: null,
      entryId: null,
      toPayCents: null,
      inFavorCents: null,
      replacedCount: 0,
    }
  }
  const r = asRecord(data) ?? {}
  const documentId =
    r.created === false
      ? null
      : (textOf(r.document_id) ?? textOf(r.iva_settlement_document_id) ?? textOf(r.id))
  return {
    month: dayOf(r.month) ?? month,
    documentId,
    documentSeq: intOf(r.document_seq),
    entryId: textOf(r.entry_id),
    toPayCents: intOf(r.to_pay_cents),
    inFavorCents: intOf(r.in_favor_cents),
    replacedCount: Math.max(0, intOf(r.replaced_count) ?? 0),
  }
}

export function ivaSettlementMessage(r: IvaSettlementResult): string {
  const name = monthLabel(r.month).toLowerCase()
  if (!r.documentId) {
    return r.replacedCount > 0
      ? `Se anuló la liquidación anterior: el IVA de ${name} ahora da cero.`
      : `El IVA de ${name} dio cero: no hay nada para registrar.`
  }
  const done = r.replacedCount > 0 ? 'registrada de nuevo' : 'registrada'
  const toPay = r.toPayCents ?? 0
  const inFavor = r.inFavorCents ?? 0
  if (toPay > 0) return `Liquidación del IVA de ${name} ${done}: a pagar ${formatCents(toPay)}.`
  if (inFavor > 0)
    return `Liquidación del IVA de ${name} ${done}: quedan ${formatCents(inFavor)} a favor.`
  return `Liquidación del IVA de ${name} ${done}.`
}

export type CloseFiscalYearResult = {
  /** Ganancia (positivo) o pérdida (negativo) del ejercicio, en centavos. */
  resultCents: number | null
  fyResultNumber: number | null
  fyClosingNumber: number | null
}

/** `acc_close_fiscal_year` (C.5.5, #15) → `{result_cents, fy_result_number, fy_closing_number}`. */
export function parseCloseFiscalYearResult(data: unknown): CloseFiscalYearResult {
  const r = asRecord(data) ?? {}
  return {
    resultCents: intOf(r.result_cents),
    fyResultNumber: intOf(r.fy_result_number),
    fyClosingNumber: intOf(r.fy_closing_number),
  }
}

export function closeFiscalYearMessage(r: CloseFiscalYearResult): string {
  const cents = r.resultCents
  if (cents === null || cents === 0) return 'Ejercicio cerrado.'
  return cents > 0
    ? `Ejercicio cerrado: ganancia de ${formatCents(cents)}.`
    : `Ejercicio cerrado: pérdida de ${formatCents(-cents)}.`
}
