import 'server-only'
import { TREASURY_KINDS, type TreasuryKind } from '@/lib/accounting/types'
import { todayInCordoba } from '@/lib/dates/zone'
import {
  asRecord,
  asRecords,
  bool,
  callRpc,
  cents,
  centsOrNull,
  dayOrNull,
  instantOrNull,
  intOrNull,
  isRecord,
  optionalDay,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Resumen de Administración (§F.10, H.4): una sola llamada a
 * `acc_report_summary`. Todo en centavos; la UI arma los textos.
 */

export const SUMMARY_ATTENTION_KINDS = [
  'payable_overdue',
  'payable_due_week',
  'recurring_due',
  'missing_daily_close',
  'receivable_overdue',
  'treasury_unchecked',
  'month_ready',
  'opening_unassigned',
  'vat_pending_documentation',
  'sas_cuit_missing',
] as const
/** `other`: un aviso que esta versión de la pantalla todavía no conoce (se muestra sin acción). */
export type SummaryAttentionKind = (typeof SUMMARY_ATTENTION_KINDS)[number] | 'other'

export type SummaryTreasury = {
  id: string
  name: string
  kind: TreasuryKind
  accountCode: string | null
  /** Debe − Haber: en la tarjeta de la empresa la deuda es negativa. */
  balanceCents: number
  /** Billeteras: partidas abiertas «a acreditar» (+ $ X por acreditar). */
  pendingWalletCents: number
  lastCheckedOn: string | null
  lastMovementDate: string | null
}

export type SummaryAttentionItem = {
  kind: SummaryAttentionKind
  /** Lo que abre la acción: partida, comprobante, gasto fijo, caja o período. */
  refId: string | null
  /**
   * Texto de la base: la fila entera («Coca-Cola · Factura A 0003-00001234 ·
   * venció hace 3 días»), o solo el nombre en `treasury_unchecked` («Mercado
   * Pago») y el mes en `month_ready` («Octubre 2026»). Si la base no manda
   * texto, uno general por tipo (nunca vacío para los tipos conocidos).
   */
  label: string
  amountCents: number | null
  date: string | null
  days: number | null
  /** Partícipe de la fila, si la base lo manda (abre «Pagar» o «Cobrar» con él). */
  partyId: string | null
  /** Cuántos casos junta la fila («Faltan 3 cierres»), si aplica. */
  count: number | null
}

export type SummaryReceivableTop = {
  partyId: string
  name: string
  openCents: number
  daysLate: number | null
}

export type AccSummary = {
  /** El día al que se calculó (hoy en Córdoba si no se pidió otro). */
  asOf: string
  treasuries: SummaryTreasury[]
  /** Plata en cajas, bancos y billeteras (sin la tarjeta de la empresa). */
  availableCents: number
  /** Deuda de las tarjetas de la empresa (positiva). */
  cardDebtCents: number
  pendingWalletCents: number
  /**
   * «Le debés». `null` mientras la base no lo calcula (antes de la fase de
   * compras): la pantalla muestra «—», nunca «$ 0».
   */
  payables: {
    totalCents: number
    overdueCents: number
    dueWeekCents: number
    partiesRed: number
  } | null
  /** «Te deben». `null` mientras la base no lo calcula (antes de la fase de ventas). */
  receivables: { totalCents: number; overdueCents: number; top: SummaryReceivableTop[] } | null
  /** IVA del mes en curso (estimado). `null` si la base todavía no lo calcula. */
  ivaMonth: {
    month: string
    toPayCents: number
    inFavorCents: number
    provisional: boolean
  } | null
  monthToDate: { soldCents: number; purchasesAndExpensesCents: number }
  /** Ordenada por urgencia, hasta 8. */
  attention: SummaryAttentionItem[]
  books: {
    lastClosedMonth: string | null
    closedBy: string | null
    closedAt: string | null
    openMonth: string | null
    openWarnings: number | null
  }
  firstSteps: {
    firstExpense: boolean
    firstDailyClose: boolean
    accountantAdded: boolean
    partnerGranted: boolean
  }
}

function treasuryKind(value: unknown): TreasuryKind {
  return typeof value === 'string' && (TREASURY_KINDS as readonly string[]).includes(value)
    ? (value as TreasuryKind)
    : 'other'
}

function attentionKind(value: unknown): SummaryAttentionKind {
  return typeof value === 'string' && (SUMMARY_ATTENTION_KINDS as readonly string[]).includes(value)
    ? (value as SummaryAttentionKind)
    : 'other'
}

function parseTreasury(row: UnknownRecord): SummaryTreasury {
  return {
    id: str(row.id ?? row.treasury_id),
    name: str(row.name),
    kind: treasuryKind(row.kind),
    accountCode: strOrNull(row.account_code),
    balanceCents: cents(row.balance_cents),
    pendingWalletCents: cents(row.pending_wallet_cents),
    lastCheckedOn: dayOrNull(row.last_checked_on),
    lastMovementDate: dayOrNull(row.last_movement_date),
  }
}

/**
 * Texto de los avisos que la base manda sin `label` (los arma la pantalla con
 * sus números; esto es lo mínimo para que nunca quede una fila vacía).
 */
const ATTENTION_FALLBACK_LABELS: Readonly<Partial<Record<SummaryAttentionKind, string>>> = {
  opening_unassigned: 'Hay patrimonio inicial sin asignar: lo revisa la contadora.',
  sas_cuit_missing: 'Falta el CUIT de la SAS: los libros de IVA lo necesitan.',
  month_ready: 'Hay un mes listo para cerrar.',
  treasury_unchecked: 'Hay una caja sin ajustar hace más de 7 días.',
  missing_daily_close: 'Faltan cierres del día.',
  vat_pending_documentation: 'Hay IVA de comisiones a documentar: falta la factura.',
}

function parseAttention(row: UnknownRecord): SummaryAttentionItem {
  const kind = attentionKind(row.kind)
  return {
    kind,
    refId: strOrNull(row.ref_id),
    label: str(row.label).trim() || ATTENTION_FALLBACK_LABELS[kind] || '',
    amountCents: centsOrNull(row.amount_cents),
    date: dayOrNull(row.date),
    days: intOrNull(row.days),
    partyId: strOrNull(row.party_id),
    count: intOrNull(row.count),
  }
}

/** El JSON de `acc_report_summary` → `AccSummary`. Lo que falte (versión de una fase anterior) queda en cero o vacío. */
export function parseSummary(raw: unknown, asOf: string): AccSummary {
  const data = asRecord(raw)
  const treasuries = asRecords(data.treasuries).map(parseTreasury)
  const payables = isRecord(data.payables) ? data.payables : null
  const receivables = isRecord(data.receivables) ? data.receivables : null
  const iva =
    data.iva_month === null || data.iva_month === undefined ? null : asRecord(data.iva_month)
  const mtd = asRecord(data.month_to_date)
  const books = asRecord(data.books)
  const steps = asRecord(data.first_steps)
  const assets = treasuries.filter((t) => t.kind !== 'credit_card')
  return {
    asOf: dayOrNull(data.as_of) ?? asOf,
    treasuries,
    availableCents:
      data.available_cents === undefined
        ? assets.reduce((sum, t) => sum + t.balanceCents, 0)
        : cents(data.available_cents),
    cardDebtCents:
      data.card_debt_cents === undefined
        ? treasuries
            .filter((t) => t.kind === 'credit_card')
            .reduce((sum, t) => sum + Math.max(0, -t.balanceCents), 0)
        : cents(data.card_debt_cents),
    pendingWalletCents:
      data.pending_wallet_cents === undefined
        ? treasuries.reduce((sum, t) => sum + t.pendingWalletCents, 0)
        : cents(data.pending_wallet_cents),
    payables: payables
      ? {
          totalCents: cents(payables.total_cents),
          overdueCents: cents(payables.overdue_cents),
          dueWeekCents: cents(payables.due_week_cents),
          partiesRed: intOrNull(payables.parties_red) ?? 0,
        }
      : null,
    receivables: receivables
      ? {
          totalCents: cents(receivables.total_cents),
          overdueCents: cents(receivables.overdue_cents),
          top: asRecords(receivables.top).map((row) => ({
            partyId: str(row.party_id),
            name: str(row.name ?? row.party_name),
            openCents: cents(row.open_cents),
            daysLate: intOrNull(row.days_late),
          })),
        }
      : null,
    ivaMonth: iva
      ? {
          month: dayOrNull(iva.month) ?? `${asOf.slice(0, 7)}-01`,
          toPayCents: cents(iva.to_pay_cents),
          inFavorCents: cents(iva.in_favor_cents),
          provisional: iva.provisional === undefined ? true : bool(iva.provisional),
        }
      : null,
    monthToDate: {
      soldCents: cents(mtd.sold_cents),
      purchasesAndExpensesCents: cents(mtd.purchases_and_expenses_cents),
    },
    attention: asRecords(data.attention).map(parseAttention).slice(0, 8),
    books: {
      lastClosedMonth: dayOrNull(books.last_closed_month),
      closedBy: strOrNull(books.closed_by),
      closedAt: instantOrNull(books.closed_at),
      openMonth: dayOrNull(books.open_month),
      openWarnings: intOrNull(books.open_warnings),
    },
    firstSteps: {
      firstExpense: bool(steps.first_expense),
      firstDailyClose: bool(steps.first_daily_close),
      accountantAdded: bool(steps.accountant_added),
      partnerGranted: bool(steps.partner_granted),
    },
  }
}

/**
 * El Resumen entero en una llamada (`acc_report_summary`). Sin fecha, hoy en
 * Córdoba. «Vendiste» sale de los cierres: nunca es ganancia.
 */
export async function getSummary(
  tenantId: string,
  opts: { asOf?: string | null } = {},
): Promise<AccSummary> {
  const asOf = optionalDay(opts.asOf) ?? todayInCordoba()
  const data = await callRpc('acc_report_summary', { p_tenant_id: tenantId, p_as_of: asOf })
  return parseSummary(data, asOf)
}
