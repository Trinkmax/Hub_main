/**
 * La cuenta de «Registrar un cobro», sin pantalla: lo que se manda al guardar,
 * las tarjetas de «¿Quién te pagó?» y el número que importa («Te descontaron
 * $ X»). Puro: lo prueba `administracion-ventas-cobrar.test.ts`. Lo que se VE
 * está en `cobrar-piezas.tsx` (el mismo reparto que `gasto-papel.ts` /
 * `gasto-piezas.tsx`).
 *
 * `buildCollectionValues` es el `useMemo` de `values` que tenía la hoja,
 * sacado tal cual a una función: mismas claves y mismos valores. La vista
 * previa y su hash salen de ese mismo objeto, así que si alguna vez cambia una
 * clave, el servidor lo delata (`preview_stale`).
 */

import { DEDUCTION_KINDS } from '@/lib/accounting/schemas'
import type { OpenItemRef, PartyKind } from '@/lib/accounting/types'
import { formatDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import type { ReceivableSummary, SheetParty } from '../cajas-ventas/types'

export type DeductionKind = (typeof DEDUCTION_KINDS)[number]
export type VoucherMode = 'included' | 'later' | 'none'
export type CommissionVoucherType = 'liquidacion' | 'factura_a' | 'factura_b' | 'otro_comprobante'
export type DeductionRow = { amount: number | null; cert: string }
export type Deductions = Readonly<Record<DeductionKind, DeductionRow>>

/** Las que llevan número de certificado (en Ganancias es obligatorio). */
export const CERT_KINDS: ReadonlySet<DeductionKind> = new Set([
  'ret_iva',
  'ret_iibb',
  'sircupa',
  'ret_ganancias',
])

const EMPTY_ROW: DeductionRow = { amount: null, cert: '' }

export function emptyDeductions(): Record<DeductionKind, DeductionRow> {
  const out = {} as Record<DeductionKind, DeductionRow>
  for (const kind of DEDUCTION_KINDS) out[kind] = EMPTY_ROW
  return out
}

// ─── Lo que se guarda ────────────────────────────────────────────────────────

export type CollectionFormState = {
  partyId: string | null
  date: string | null
  /** Ventas tildadas y cuánto se cobra de cada una. */
  apps: ReadonlyMap<string, number | null>
  /** Los saldos a favor (o «le debemos») del pagador, y cuáles se tildaron. */
  creditItems: readonly Pick<OpenItemRef, 'lineId' | 'openCents'>[]
  credits: ReadonlySet<string>
  /** El total de la liquidación (lo de las ventas elegidas, o lo que se escribió). */
  grossValue: number | null
  /** Los descuentos que se ven en pantalla (estimados o ya tocados). */
  rows: Deductions
  /** La cuenta de «Otros cargos» (`ctx.sys.fees_other.id`). */
  feesOtherAccountId: string
  received: number | null
  treasuryId: string | null
  reference: string
  voucherMode: VoucherMode
  voucherType: CommissionVoucherType
  voucherPos: string
  voucherNumber: string
}

/** Los valores de `postCollection`, armados con el estado de la hoja. */
export function buildCollectionValues(state: CollectionFormState) {
  const deductionList = DEDUCTION_KINDS.flatMap((kind) => {
    const row = state.rows[kind]
    if (row.amount === null || row.amount <= 0) return []
    return [
      {
        taxKind: kind,
        amountCents: row.amount,
        accountId: kind === 'otro' ? state.feesOtherAccountId : null,
        certificateNumber: CERT_KINDS.has(kind) && row.cert.trim() !== '' ? row.cert.trim() : null,
        salesMethodId: null,
      },
    ]
  })
  const pos = state.voucherPos.trim() === '' ? Number.NaN : Number(state.voucherPos)
  const number = state.voucherNumber.trim() === '' ? Number.NaN : Number(state.voucherNumber)
  return {
    partyId: state.partyId ?? '',
    date: state.date ?? '',
    applications: [...state.apps].map(([lineId, amount]) => ({ lineId, amountCents: amount })),
    creditsUsed: state.creditItems
      .filter((i) => state.credits.has(i.lineId))
      .map((i) => ({ lineId: i.lineId, amountCents: i.openCents })),
    grossCents: state.grossValue,
    deductions: deductionList,
    received:
      state.received !== null && state.received > 0
        ? [
            {
              treasuryAccountId: state.treasuryId ?? '',
              amountCents: state.received,
              reference: state.reference.trim() === '' ? null : state.reference.trim(),
            },
          ]
        : [],
    writeOffCents: 0,
    commissionVoucher:
      state.voucherMode === 'included'
        ? {
            mode: 'included',
            voucherType: state.voucherType,
            pointOfSale: Number.isNaN(pos) ? null : pos,
            number: Number.isNaN(number) ? null : number,
            issueDate: state.date ?? '',
          }
        : { mode: state.voucherMode },
    notes: null,
  }
}

// ─── ¿Quién te pagó? ─────────────────────────────────────────────────────────

export type PayerCard = {
  id: string
  name: string
  kind: PartyKind
  debtCents: number
  /** «Te debe $ 2.536.151 · atrasado desde el 07/10». */
  consequence: string
}

export function payerName(p: Pick<SheetParty, 'name' | 'tradeName'>): string {
  return p.tradeName && p.tradeName !== p.name ? p.tradeName : p.name
}

/** Cuántas tarjetas se muestran antes de pasar al buscador. */
export const PAYER_CARDS_MAX = 4

/**
 * Los que más deben, el más atrasado primero (el mismo orden que tenían los
 * atajos): hasta `max` tarjetas para elegir con un toque. Los demás quedan en
 * el buscador.
 */
export function payerCards(
  receivables: readonly ReceivableSummary[],
  partiesById: ReadonlyMap<
    string,
    Pick<SheetParty, 'id' | 'name' | 'tradeName' | 'kind' | 'active'>
  >,
  max: number = PAYER_CARDS_MAX,
): PayerCard[] {
  return receivables
    .filter((r) => r.debtCents > 0 && partiesById.get(r.partyId)?.active)
    .sort(
      (a, b) =>
        b.overdueCents - a.overdueCents ||
        (a.oldestDueDate ?? '9999').localeCompare(b.oldestDueDate ?? '9999') ||
        b.debtCents - a.debtCents,
    )
    .slice(0, Math.max(0, max))
    .flatMap((r) => {
      const party = partiesById.get(r.partyId)
      if (!party) return []
      const owes = `Te debe ${formatCentsShort(r.debtCents)}`
      const when = !r.oldestDueDate
        ? null
        : r.overdueCents > 0
          ? `atrasado desde el ${formatDayMonth(r.oldestDueDate)}`
          : `llega el ${formatDayMonth(r.oldestDueDate)}`
      return [
        {
          id: party.id,
          name: payerName(party),
          kind: party.kind,
          debtCents: r.debtCents,
          consequence: when ? `${owes} · ${when}` : owes,
        },
      ]
    })
}

// ─── El número que importa ───────────────────────────────────────────────────

export type SettlementSummary = {
  /** Lo que te descontaron: lo de las ventas menos lo que entró. */
  discountCents: number
  /** «6,7 %». */
  percentText: string
  /** «$ 93,35»: lo que te queda de cada $ 100. */
  keptOfHundred: string
}

/** Un porcentaje con un decimal, sin `Intl`: 6.654 → «6,7 %», 6 → «6 %». */
function oneDecimalPercent(part: number, total: number): string {
  const tenths = Math.round((part * 1000) / total)
  const whole = Math.trunc(tenths / 10)
  const rest = Math.abs(tenths % 10)
  return rest === 0 ? `${whole} %` : `${whole},${rest} %`
}

/**
 * «Te descontaron $ 127.465 (6,7 %)»: lo que suman las ventas menos lo que
 * entró. `null` mientras falte un dato o si entró más de lo que suman las
 * ventas (eso no es un descuento: es plata a cuenta).
 */
export function settlementSummary(input: {
  grossCents: number | null
  receivedCents: number | null
}): SettlementSummary | null {
  const { grossCents, receivedCents } = input
  if (grossCents === null || receivedCents === null) return null
  if (grossCents <= 0 || receivedCents <= 0 || receivedCents > grossCents) return null
  const discountCents = grossCents - receivedCents
  return {
    discountCents,
    percentText: oneDecimalPercent(discountCents, grossCents),
    keptOfHundred: formatCents(Math.round((receivedCents * 10_000) / grossCents)),
  }
}
