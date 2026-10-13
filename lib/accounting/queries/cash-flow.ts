import 'server-only'
import {
  CASH_DAILY_MAX_DAYS,
  type CashDailyAccount,
  type CashDailyDay,
  type CashDailyReport,
} from '@/lib/accounting/cash-daily'
import { TREASURY_KINDS, type TreasuryKind } from '@/lib/accounting/types'
import { daysBetween } from '@/lib/dates/civil'
import {
  AccQueryError,
  asRecords,
  bool,
  callRpcRows,
  cents,
  dayOrNull,
  requireRange,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Cómo se movió la plata de las cajas, día por día (Cajas y bancos › Saldos):
 * `acc_report_cash_daily`. Una fila por caja con sus días con movimiento
 * adentro, y una fila sin caja con todas juntas (las de activo, sin las
 * tarjetas de la empresa y sin contar la plata que se mueve entre cajas).
 * Saldos Debe − Haber, como `listTreasuryBalances`: la serie del gráfico la
 * arma `buildCashDailySeries` (`lib/accounting/cash-daily`).
 */

function treasuryKind(value: unknown): TreasuryKind {
  return typeof value === 'string' && (TREASURY_KINDS as readonly string[]).includes(value)
    ? (value as TreasuryKind)
    : 'other'
}

function parseDays(value: unknown, range: { from: string; to: string }): CashDailyDay[] {
  const days: CashDailyDay[] = []
  for (const row of asRecords(value)) {
    const day = dayOrNull(row.day)
    // Un día sin fecha o fuera del período no se puede dibujar.
    if (day === null || day < range.from || day > range.to) continue
    days.push({
      day,
      inCents: cents(row.in_cents),
      outCents: cents(row.out_cents),
      balanceCents: cents(row.balance_cents),
    })
  }
  return days.sort((a, b) => a.day.localeCompare(b.day))
}

function parseAccount(row: UnknownRecord, range: { from: string; to: string }): CashDailyAccount {
  const treasuryId = strOrNull(row.treasury_id)
  return {
    treasuryId,
    name: str(row.name),
    kind: treasuryId === null ? null : treasuryKind(row.kind),
    active: row.active === undefined || row.active === null ? true : bool(row.active),
    openingCents: cents(row.opening_cents),
    closingCents: cents(row.closing_cents),
    days: parseDays(row.days, range),
  }
}

/** Las filas de `acc_report_cash_daily` → el reporte. Si faltara la fila de todas, queda en cero. */
export function parseCashDaily(
  raw: readonly UnknownRecord[],
  range: { from: string; to: string },
): CashDailyReport {
  const rows = raw.map((row) => parseAccount(row, range))
  const total = rows.find((r) => r.treasuryId === null) ?? {
    treasuryId: null,
    name: '',
    kind: null,
    active: true,
    openingCents: 0,
    closingCents: 0,
    days: [],
  }
  return {
    from: range.from,
    to: range.to,
    total,
    accounts: rows.filter((r) => r.treasuryId !== null),
  }
}

/** Saldo, entradas y salidas de cada caja por día, y de todas juntas. Hasta 366 días. */
export async function getCashDaily(
  tenantId: string,
  params: { from: string; to: string },
): Promise<CashDailyReport> {
  const range = requireRange(params.from, params.to)
  if (daysBetween(range.from, range.to) + 1 > CASH_DAILY_MAX_DAYS) {
    throw new AccQueryError(
      'params',
      'invalid',
      `El período puede tener hasta ${CASH_DAILY_MAX_DAYS} días. Elegí uno más corto.`,
    )
  }
  const raw = await callRpcRows('acc_report_cash_daily', {
    p_tenant_id: tenantId,
    p_from: range.from,
    p_to: range.to,
  })
  return parseCashDaily(raw, range)
}
