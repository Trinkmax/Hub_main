/**
 * «Mis Comprobantes» (Recibidos) → compras (diseño §4.1).
 *
 * Una propuesta por comprobante, con la clave natural de la fila
 * (`mc:R:<cuit>:<código>:<pv>:<número>`): la misma clave en otro lote ya
 * cargado no se vuelve a contabilizar (`aipr_posted_key_uq`). Arma la entrada
 * del formulario de compra (`PurchaseValues`) y la evalúa con el motor:
 *
 * - **Código ARCA → tipo** (tabla del diseño): A/B/C/M, sus NC y ND y los tiques.
 *   Recibos (4, 9, 15, 54) y lo que no está en la tabla (FCE, liquidaciones…)
 *   quedan para revisar: no se cargan solos.
 * - **Proveedor** por CUIT. Si no existe: «proveedor nuevo» (se crean con su
 *   cuenta habitual en `createImportSuppliers`). Las imputaciones van a su
 *   cuenta habitual (`default_account_id`); si no tiene, se pide.
 * - **Importes:** con IVA discriminado, un renglón `net` por alícuota más no
 *   gravado y exento, y el IVA de la factura («el IVA de la factura»); B, C y
 *   tiques, un solo renglón `gross`. Moneda extranjera: cada columna por el tipo
 *   de cambio (mitad hacia arriba) y siempre para revisar.
 * - **Redondeo de ARCA:** si el total difiere de las partes en ≤ $ 1, la
 *   diferencia va al neto más grande; si sobra más de $ 1, a «Otros tributos»
 *   (seguramente percepciones); si falta más de $ 1, a mano.
 * - **«Otros tributos»** (un solo número): percepción de IIBB o de IVA,
 *   impuestos internos u otra cuenta, según la decisión de la persona o una
 *   regla «Recordar para este proveedor».
 * - **Lo cargado a mano:** coincidencia fuerte (mismo proveedor, tipo, PV y
 *   número) → «Ya está cargado»; débil (mismo total ±3 días) → «¿Es otro?».
 * - **Factura mensual de Mercado Pago** (CUIT de MercadoLibre): se ofrece
 *   cargarla como la factura de comisiones ya descontadas (`settlesCommissions`).
 *
 * Puro: la base la lee el servidor (`propose.ts`) y la pasa armada.
 */

import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import type { IvaCondition, VatRateBp, VoucherType } from '@/lib/accounting/types'
import {
  VOUCHER_CATALOG,
  voucherConditionCheck,
  voucherDisplay,
} from '@/lib/accounting/voucher-types'
import { convertCents } from '../../amounts'
import { CREDIT_NOTE_CODES, RECEIPT_CODES } from '../../arca/mis-comprobantes'
import { MERCADOLIBRE_CUIT } from '../../bank/rules'
import type { McItem, McRateKey, McVatRateKey } from '../../types'
import { normalizeForMatch } from '../safe-pattern'
import type { ImportNeed, NoteKey, OtherTaxesAs, ProposalDecisions } from '../types'
import {
  type DraftSummary,
  type ImportCatalog,
  type ImportParty,
  isConfirmed,
  type ProposalDraft,
  partyByCuit,
  partyLabel,
  type StagedItem,
  systemAccountId,
  systemParty,
  withDecisions,
} from './common'

// ─── Tabla de códigos ────────────────────────────────────────────────────────

/** Código de comprobante de ARCA → tipo del catálogo (diseño §4.1). */
export const MC_CODE_TO_VOUCHER: Readonly<Partial<Record<number, VoucherType>>> = {
  1: 'factura_a',
  2: 'nota_debito_a',
  3: 'nota_credito_a',
  6: 'factura_b',
  7: 'nota_debito_b',
  8: 'nota_credito_b',
  11: 'factura_c',
  12: 'nota_debito_c',
  13: 'nota_credito_c',
  51: 'factura_m',
  52: 'nota_debito_m',
  53: 'nota_credito_m',
  81: 'tique_factura_a',
  82: 'tique_factura_b',
  83: 'tique',
  111: 'tique_factura_c',
}

/** El tipo de documento de la compra (`docKind` del formulario). */
export function purchaseDocKind(
  type: VoucherType,
): 'purchase' | 'purchase_debit_note' | 'purchase_credit_note' {
  const info = VOUCHER_CATALOG[type]
  if (info.isCreditNote) return 'purchase_credit_note'
  if (info.isDebitNote) return 'purchase_debit_note'
  return 'purchase'
}

const RATE_ORDER: ReadonlyArray<readonly [McRateKey, VatRateBp]> = [
  ['r0', 0],
  ['r25', 250],
  ['r5', 500],
  ['r105', 1050],
  ['r21', 2100],
  ['r27', 2700],
]
const VAT_KEYS: readonly McVatRateKey[] = ['r25', 'r5', 'r105', 'r21', 'r27']

/** La condición que sugiere la letra para un proveedor nuevo (diseño §4.1). */
export function conditionFromLetter(type: VoucherType): IvaCondition {
  const letter = VOUCHER_CATALOG[type].letter
  if (letter === 'C') return 'monotributo'
  if (letter === 'A' || letter === 'M' || letter === 'B') return 'responsable_inscripto'
  return 'sin_datos'
}

// ─── Reglas «Recordar para este proveedor» ───────────────────────────────────

export type OtherTaxesRule = {
  readonly id: string
  readonly partyId: string
  readonly as: OtherTaxesAs
  readonly accountId: string | null
  readonly jurisdictionCode: number | null
}

/** Las filas de `acc_import_rules` (`arca_recibidos`) que dicen cómo cargar «Otros tributos». */
export function otherTaxesRulesFrom(
  rows: ReadonlyArray<{ id: string; priority: number; match: unknown; action: unknown }>,
): OtherTaxesRule[] {
  const out: OtherTaxesRule[] = []
  const sorted = [...rows].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
  for (const row of sorted) {
    const match = row.match as Record<string, unknown> | null
    const action = row.action as Record<string, unknown> | null
    if (!match || !action || typeof match.party_id !== 'string') continue
    if (action.kind !== 'other_taxes') continue
    const as = action.other_taxes_as
    if (as !== 'perc_iibb' && as !== 'perc_iva' && as !== 'internal' && as !== 'account') continue
    out.push({
      id: row.id,
      partyId: match.party_id,
      as,
      accountId: typeof action.account_id === 'string' ? action.account_id : null,
      jurisdictionCode:
        typeof action.jurisdiction_code === 'number' ? action.jurisdiction_code : null,
    })
  }
  return out
}

// ─── Lo cargado a mano (acc_import_match_purchases) ──────────────────────────

export type PurchaseMatch = {
  readonly match: 'number' | 'amount'
  readonly documentId: string
  readonly label: string
}

/** Las filas para `acc_import_match_purchases` (solo las de un proveedor conocido). */
export function purchaseMatchRows(
  items: readonly StagedItem<McItem>[],
  catalog: ImportCatalog,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const s of items) {
    const type = MC_CODE_TO_VOUCHER[s.item.code]
    if (!type) continue
    const party = partyByCuit(catalog, s.item.issuerCuit)
    if (!party) continue
    const total = toPesos(s.item.total, s.item)
    if (total === null) continue
    rows.push({
      key: s.key,
      party_id: party.id,
      voucher_type: type,
      point_of_sale: s.item.pointOfSale,
      number: s.item.number,
      total_cents: total,
      issue_date: s.item.issueDate,
      credit: CREDIT_NOTE_CODES.has(s.item.code),
    })
  }
  return rows
}

// ─── Sugerencia de cuenta para un proveedor nuevo ────────────────────────────

const ACCOUNT_HINTS: ReadonlyArray<{
  re: RegExp
  key?: SystemAccountKey
  name?: RegExp
}> = [
  {
    re: /CERVEC|BODEGA|VINOS?\b|VINICOLA|LICOR|DESTILER|FERNET|APERITIV|BEBIDAS ALCOH/,
    key: 'purchases_alcohol',
  },
  {
    re: /GASEOS|COCA.?COLA|PEPSI|AGUAS? MINERAL|BEBIDAS|JUGOS|SODERIA/,
    key: 'purchases_soft_drinks',
  },
  { re: /\bCAFE\b|TOSTADER/, key: 'purchases_coffee' },
  { re: /PANADER|PANIFIC|CONFITER|PASTELER/, key: 'purchases_bakery' },
  { re: /DESCARTABLE|PACKAGING|ENVASES|BOLSAS/, key: 'purchases_packaging' },
  {
    re: /FRIGORIF|CARNICER|CARNES|AVICOLA|VERDULER|FRUTAS|LACTEOS|FIAMBRER|ALIMENTOS/,
    key: 'purchases_food',
  },
  { re: /\bEPEC\b|EDENOR|EDESUR|ENERGIA/, name: /ENERGIA/ },
  { re: /ECOGAS|DISTRIBUIDORA DE GAS|CAMUZZI|METROGAS|NATURGY/, name: /^GAS$/ },
  { re: /AGUAS CORDOBESAS|\bAYSA\b/, name: /^AGUA$/ },
  { re: /TELECOM|FIBERTEL|INTERNET|CABLEVISION|STARLINK/, name: /INTERNET/ },
  { re: /\bCLARO\b|MOVISTAR|TELEFONICA|AMX ARGENTINA/, name: /TELEFONIA/ },
  { re: /LIMPIEZA|HIGIENE|FUMIGA/, key: 'cleaning' },
  { re: /THINKEON|SOFTWARE|MICROSOFT|SPOTIFY/, name: /SOFTWARE/ },
  { re: /META PLATFORMS|FACEBOOK/, key: 'advertising_online' },
  { re: /ESTUDIO CONTABLE|CONTADOR/, name: /HONORARIOS CONTABLES/ },
  { re: /ASEGURADORA|SEGUROS|SANCOR|LA SEGUNDA|FEDERACION PATRONAL/, name: /^SEGUROS$/ },
]

/**
 * La cuenta que se le sugiere a un proveedor nuevo por su razón social
 * («gaseosas» → Bebidas sin alcohol, «EPEC» → Energía eléctrica). Solo una
 * sugerencia: nunca se aplica sola (diseño §4.1).
 */
export function suggestPurchaseAccount(name: string, catalog: ImportCatalog): string | null {
  const text = normalizeForMatch(name)
  const selectable = [...catalog.accounts.values()].filter(
    (a) => a.postable && a.active && a.purchaseSelectable,
  )
  for (const hint of ACCOUNT_HINTS) {
    if (!hint.re.test(text)) continue
    if (hint.key) {
      const id = systemAccountId(catalog, hint.key)
      if (id && selectable.some((a) => a.id === id)) return id
    }
    if (hint.name) {
      const re = hint.name
      const found = selectable
        .filter((a) => re.test(normalizeForMatch(a.name)))
        .sort((a, b) => (a.code < b.code ? -1 : 1))[0]
      if (found) return found.id
    }
  }
  return null
}

// ─── Importes ────────────────────────────────────────────────────────────────

/** Un importe en pesos (moneda extranjera × tipo de cambio, mitad hacia arriba); `null` si no se puede. */
function toPesos(cents: number, it: Pick<McItem, 'currency' | 'fxRate'>): number | null {
  if (it.currency === 'ARS') return cents
  try {
    return convertCents(cents, it.fxRate)
  } catch {
    return null
  }
}

type Amounts = {
  net: Record<McRateKey, number>
  vat: Record<McVatRateKey, number>
  nonTaxed: number
  exempt: number
  otherTaxes: number
  total: number
}

/** Los importes del comprobante, en su moneda (copia: se ajustan sin tocar la fila). */
function amountsOf(it: McItem): Amounts {
  return {
    net: { ...it.net },
    vat: { ...it.vat },
    nonTaxed: it.nonTaxed,
    exempt: it.exempt,
    otherTaxes: it.otherTaxes,
    total: it.total,
  }
}

/** Cada columna × el tipo de cambio (mitad hacia arriba); `null` si no se puede. */
function convertAmounts(a: Amounts, fxRate: string): Amounts | null {
  try {
    const net = {} as Record<McRateKey, number>
    for (const [k] of RATE_ORDER) net[k] = convertCents(a.net[k], fxRate)
    const vat = {} as Record<McVatRateKey, number>
    for (const k of VAT_KEYS) vat[k] = convertCents(a.vat[k], fxRate)
    return {
      net,
      vat,
      nonTaxed: convertCents(a.nonTaxed, fxRate),
      exempt: convertCents(a.exempt, fxRate),
      otherTaxes: convertCents(a.otherTaxes, fxRate),
      total: convertCents(a.total, fxRate),
    }
  } catch {
    return null
  }
}

/** Lo que tendría que dar el total (comprobante con IVA discriminado). */
function componentsOf(a: Amounts): number {
  return (
    sum(RATE_ORDER.map(([k]) => a.net[k])) +
    a.nonTaxed +
    a.exempt +
    a.otherTaxes +
    sum(VAT_KEYS.map((k) => a.vat[k]))
  )
}

/**
 * Un redondeo chico: al neto más grande (a igual neto, la alícuota mayor); sin
 * neto, al exento o al no gravado. Nunca deja un balde negativo. Si sobra y no
 * hay dónde, a «Otros tributos»; si falta y no hay de dónde, `failed`.
 */
function absorbRounding(a: Amounts, diff: number): 'absorbed' | 'other' | 'failed' {
  const largest = [...RATE_ORDER]
    .filter(([k]) => a.net[k] > 0)
    .sort((x, y) => a.net[y[0]] - a.net[x[0]] || y[1] - x[1])[0]
  if (largest) {
    if (a.net[largest[0]] + diff < 0) return 'failed'
    a.net[largest[0]] += diff
    return 'absorbed'
  }
  if (a.exempt > 0 && a.exempt >= a.nonTaxed && a.exempt + diff >= 0) {
    a.exempt += diff
    return 'absorbed'
  }
  if (a.nonTaxed > 0 && a.nonTaxed + diff >= 0) {
    a.nonTaxed += diff
    return 'absorbed'
  }
  if (diff > 0) {
    a.otherTaxes += diff
    return 'other'
  }
  return 'failed'
}

const sum = (values: Iterable<number>) => {
  let s = 0
  for (const v of values) s += v
  return s
}

// ─── El armador ──────────────────────────────────────────────────────────────

export type ArcaDraftInput = {
  readonly items: readonly StagedItem<McItem>[]
  readonly catalog: ImportCatalog
  readonly rules: readonly OtherTaxesRule[]
  /** Coincidencias con lo cargado a mano, por clave de propuesta. */
  readonly matches: ReadonlyMap<string, PurchaseMatch>
  readonly decisions: (key: string) => ProposalDecisions
}

const NOTES = 'Importado de Mis Comprobantes (ARCA)'

/** Una propuesta por comprobante recibido (en el orden de la fila). */
export function buildArcaDrafts(input: ArcaDraftInput): ProposalDraft[] {
  const drafts: ProposalDraft[] = []
  const items = [...input.items].sort((a, b) => a.rowNo - b.rowNo)
  for (const s of items) drafts.push(arcaDraft(s, input))
  return drafts
}

function arcaDraft(s: StagedItem<McItem>, input: ArcaDraftInput): ProposalDraft {
  const it = s.item
  const decisions = input.decisions(s.key)
  const type = MC_CODE_TO_VOUCHER[it.code] ?? null
  const isCredit = CREDIT_NOTE_CODES.has(it.code)
  const needs: ImportNeed[] = []
  const notes: NoteKey[] = []
  const totalPesos = toPesos(it.total, it)

  const summaryBase = (counterparty: string | null): DraftSummary =>
    withDecisions(
      {
        kind: isCredit ? 'credit_note' : 'purchase',
        date: it.issueDate,
        label: type
          ? voucherDisplay(type, it.pointOfSale, it.number)
          : `Comprobante ${it.code} ${String(it.pointOfSale).padStart(5, '0')}-${String(it.number).padStart(8, '0')}`,
        counterparty,
        total_cents: totalPesos ?? it.total,
        item_count: 1,
        detail: {
          code: it.code,
          cuit: it.issuerCuit,
          currency: it.currency,
          ...(it.currency !== 'ARS' ? { fx_rate: it.fxRate, original_total_cents: it.total } : {}),
        },
        ...(notes.length > 0 ? { notes: [...notes] } : {}),
      },
      decisions,
    )
  const formOf = isCredit ? 'purchase_credit_note' : 'purchase'
  const blocked = (counterparty: string | null): ProposalDraft => ({
    key: s.key,
    form: formOf,
    values: null,
    itemIds: [s.id],
    needs,
    summary: summaryBase(counterparty),
  })

  // ── Lo que el parser marcó para revisar ──
  if (s.issues.some((i) => i.code === 'mc_receiver_mismatch')) {
    needs.push({ key: 'manual', reason: 'not_ours' })
    return blocked(it.issuerName || null)
  }
  if (s.issues.some((i) => i.code === 'mc_negative_amount' && i.level !== 'info')) {
    needs.push({ key: 'manual', reason: 'check_row' })
    return blocked(it.issuerName || null)
  }

  // ── Tipo ──
  if (RECEIPT_CODES.has(it.code)) {
    needs.push({ key: 'receipt', code: it.code })
    return blocked(it.issuerName || null)
  }
  if (!type || it.numberTo !== it.number) {
    needs.push({ key: 'unsupported_voucher', code: it.code })
    return blocked(it.issuerName || null)
  }
  const info = VOUCHER_CATALOG[type]
  const docKind = purchaseDocKind(type)

  // ── Lo cargado a mano ──
  const match = input.matches.get(s.key)
  if (match?.match === 'number') {
    // Con el nombre que tiene en tus proveedores (como las demás filas), no el de ARCA en mayúsculas.
    const known = partyByCuit(input.catalog, it.issuerCuit)
    return {
      key: s.key,
      form: formOf,
      values: null,
      itemIds: [s.id],
      needs: [],
      summary: summaryBase(known ? partyLabel(known) : it.issuerName || null),
      skip: {
        reason: 'already_loaded',
        document_id: match.documentId,
        label: match.label,
      },
    }
  }

  // ── Proveedor ──
  const mpParty = systemParty(input.catalog, 'mercado_pago')
  const isMpInvoice =
    docKind === 'purchase' &&
    (it.issuerCuit === MERCADOLIBRE_CUIT ||
      (mpParty?.taxId !== null && mpParty?.taxId !== undefined && mpParty.taxId === it.issuerCuit))
  let settles = false
  let party: ImportParty | null
  if (isMpInvoice && decisions.settles_commissions === undefined) {
    needs.push({ key: 'mp_invoice' })
    return blocked(it.issuerName || null)
  }
  if (isMpInvoice && decisions.settles_commissions === true) {
    settles = true
    party = mpParty
    if (!party) {
      needs.push({ key: 'manual', reason: 'unsupported' })
      return blocked(it.issuerName || null)
    }
  } else {
    party = partyByCuit(input.catalog, it.issuerCuit)
  }
  if (!party) {
    needs.push({
      key: 'new_supplier',
      cuit: it.issuerCuit,
      name: (it.issuerName || `CUIT ${it.issuerCuit}`).slice(0, 120),
      suggested_condition: conditionFromLetter(type),
    })
    return blocked(it.issuerName || null)
  }
  const counterparty = partyLabel(party)
  if (!party.active) {
    needs.push({ key: 'supplier_inactive', party_id: party.id })
    return blocked(counterparty)
  }
  const check = voucherConditionCheck(type, party.ivaCondition)
  if (check.status === 'rejected') {
    needs.push({
      key: 'condition_mismatch',
      party_id: party.id,
      condition: party.ivaCondition,
      suggested_condition: conditionFromLetter(type),
    })
    return blocked(counterparty)
  }
  const accountId = settles
    ? systemAccountId(input.catalog, 'fees_wallets')
    : (party.defaultAccountId ?? null)
  if (!accountId) {
    needs.push({ key: 'supplier_account', party_id: party.id })
    return blocked(counterparty)
  }

  // ── Importes ──
  const discriminated = info.purchaseVat !== 'no'
  if (discriminated) {
    // Los baldes por alícuota tienen que explicar los totales (G1/G2 sin alícuota, o ARCA que no cierra).
    const netBuckets = sum(RATE_ORDER.map(([k]) => it.net[k]))
    const vatBuckets = sum(VAT_KEYS.map((k) => it.vat[k]))
    const orphanVat = VAT_KEYS.some((k) => it.vat[k] > 0 && it.net[k] === 0)
    if (netBuckets !== it.netTotal || vatBuckets !== it.vatTotal || orphanVat) {
      needs.push({ key: 'vat_rate' })
      return blocked(counterparty)
    }
  }

  // 1. El redondeo de ARCA, en la moneda del comprobante (≤ 1 unidad: al neto más grande;
  //    más de 1 de más: a «Otros tributos»; más de 1 de menos: a mano).
  const original = amountsOf(it)
  if (discriminated) {
    const diff = original.total - componentsOf(original)
    if (diff > 100) {
      original.otherTaxes += diff
      notes.push('gap_to_other_taxes')
    } else if (diff < -100) {
      needs.push({ key: 'total_gap', cents: diff })
      return blocked(counterparty)
    } else if (diff !== 0) {
      const how = absorbRounding(original, diff)
      if (how === 'failed') {
        needs.push({ key: 'total_gap', cents: diff })
        return blocked(counterparty)
      }
      notes.push(how === 'absorbed' ? 'rounding_absorbed' : 'gap_to_other_taxes')
    }
  } else if (original.total - original.otherTaxes - original.exempt - original.nonTaxed < 0) {
    needs.push({
      key: 'total_gap',
      cents: original.total - original.otherTaxes - original.exempt - original.nonTaxed,
    })
    return blocked(counterparty)
  }

  // 2. A pesos: cada columna por el tipo de cambio (mitad hacia arriba); lo que no
  //    cierra por redondear cada una va al neto más grande. Siempre para revisar.
  const amounts = it.currency === 'ARS' ? original : convertAmounts(original, it.fxRate)
  if (!amounts || totalPesos === null) {
    needs.push({ key: 'manual', reason: 'unsupported' })
    return blocked(counterparty)
  }
  if (it.currency !== 'ARS') {
    notes.push('converted')
    if (discriminated) {
      const residual = amounts.total - componentsOf(amounts)
      if (residual !== 0 && absorbRounding(amounts, residual) === 'failed') {
        needs.push({ key: 'total_gap', cents: residual })
        return blocked(counterparty)
      }
    }
    if (!isConfirmed(decisions, 'foreign_currency')) {
      needs.push({
        key: 'foreign_currency',
        currency: it.currency,
        fx_rate: it.fxRate,
        original_total_cents: it.total,
      })
    }
  }
  const otherTaxes = amounts.otherTaxes
  const undiscriminated = amounts.total - otherTaxes - amounts.exempt - amounts.nonTaxed

  // ── Renglones ──
  const lines: Array<Record<string, unknown>> = []
  const vat: Array<Record<string, unknown>> = []
  if (discriminated) {
    for (const [k, bp] of RATE_ORDER) {
      const amount = amounts.net[k]
      if (amount <= 0) continue
      lines.push({ role: 'net', accountId, amountCents: amount, vatRateBp: bp })
      if (k !== 'r0') {
        vat.push({ vatRateBp: bp, adjustCents: 0, givenCents: amounts.vat[k as McVatRateKey] })
      }
    }
  } else if (undiscriminated > 0) {
    lines.push({ role: 'gross', accountId, amountCents: undiscriminated, vatRateBp: null })
  }
  if (amounts.nonTaxed > 0) {
    lines.push({ role: 'non_taxed', accountId, amountCents: amounts.nonTaxed, vatRateBp: null })
  }
  if (amounts.exempt > 0) {
    lines.push({ role: 'exempt', accountId, amountCents: amounts.exempt, vatRateBp: null })
  }

  // «Otros tributos»: decisión de la persona > regla del proveedor > preguntar.
  const perceptions: Array<Record<string, unknown>> = []
  const others: Array<Record<string, unknown>> = []
  if (otherTaxes > 0) {
    if (settles) {
      needs.push({ key: 'manual', reason: 'commissions_extras' })
      return blocked(counterparty)
    }
    const rule = input.rules.find((r) => r.partyId === party.id)
    const how = decisions.other_taxes_as ?? rule?.as ?? null
    if (rule && decisions.other_taxes_as === undefined) notes.push('rule_applied')
    const jurisdiction =
      decisions.jurisdiction_code ??
      rule?.jurisdictionCode ??
      input.catalog.settings.iibbJurisdictionCode
    const account = decisions.other_taxes_account_id ?? rule?.accountId ?? null
    if (how === 'perc_iibb' && jurisdiction >= 901 && jurisdiction <= 924) {
      perceptions.push({ taxKind: 'iibb', amountCents: otherTaxes, jurisdictionCode: jurisdiction })
    } else if (how === 'perc_iva') {
      perceptions.push({ taxKind: 'iva', amountCents: otherTaxes, jurisdictionCode: null })
    } else if (how === 'internal') {
      lines.push({ role: 'internal_tax', accountId, amountCents: otherTaxes, vatRateBp: null })
    } else if (how === 'account' && account) {
      others.push({ accountId: account, amountCents: otherTaxes })
    } else {
      needs.push({ key: 'other_taxes_as', party_id: party.id, amount_cents: otherTaxes })
    }
  }

  // ── Lo cargado a mano (débil) ──
  if (match?.match === 'amount' && !isConfirmed(decisions, 'possible_duplicate')) {
    needs.push({ key: 'possible_duplicate', document_id: match.documentId, label: match.label })
  }

  const values: Record<string, unknown> = {
    docKind,
    partyId: party.id,
    newParty: null,
    voucherType: type,
    pointOfSale: it.pointOfSale,
    number: it.number,
    issueDate: it.issueDate,
    accountingDate: null,
    dueDate: null,
    amountMode: 'detail',
    total: null,
    lines,
    vat,
    perceptions,
    otherTaxes: others,
    controlTotalCents: amounts.total,
    controlAccountId: null,
    relatedDocumentId: isCredit ? (decisions.credit_note_document_id ?? null) : null,
    settlesCommissions: settles,
    recurringExpenseId: null,
    payNow: null,
    notes: NOTES,
  }
  const blocking = needs.some((n) => n.key === 'other_taxes_as')
  return {
    key: s.key,
    form: formOf,
    values: blocking ? null : values,
    itemIds: [s.id],
    needs,
    summary: summaryBase(counterparty),
  }
}

// ─── Para la revisión ────────────────────────────────────────────────────────

export type NewSupplierRow = {
  cuit: string
  name: string
  suggestedCondition: IvaCondition
  /** Cuenta sugerida por la razón social (nunca se aplica sola). */
  suggestedAccountId: string | null
  /** Cuántos comprobantes del lote son de él y cuánto suman. */
  vouchers: number
  totalCents: number
}

/**
 * «Proveedores nuevos (N)»: los CUIT sin partícipe que piden las propuestas
 * del lote, agrupados, con la sugerencia de cuenta.
 */
export function newSuppliersOf(
  proposals: ReadonlyArray<{ needs: readonly ImportNeed[]; totalCents: number }>,
  catalog: ImportCatalog,
): NewSupplierRow[] {
  const byCuit = new Map<string, NewSupplierRow>()
  for (const p of proposals) {
    for (const need of p.needs) {
      if (need.key !== 'new_supplier') continue
      const row = byCuit.get(need.cuit) ?? {
        cuit: need.cuit,
        name: need.name,
        suggestedCondition: need.suggested_condition,
        suggestedAccountId: suggestPurchaseAccount(need.name, catalog),
        vouchers: 0,
        totalCents: 0,
      }
      row.vouchers += 1
      row.totalCents += p.totalCents
      byCuit.set(need.cuit, row)
    }
  }
  return [...byCuit.values()].sort(
    (a, b) => b.totalCents - a.totalCents || (a.cuit < b.cuit ? -1 : 1),
  )
}
