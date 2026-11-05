import 'server-only'
import {
  buildMonthPlan,
  isMonday,
  type MonthPlan,
  type PlanParty,
  type WeekPlanRow,
  weeksOfMonth,
} from '@/lib/accounting/week-plan'
import {
  AccQueryError,
  callRpcRows,
  cents,
  isRecord,
  queryError,
  readerClient,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Lecturas del Plan de la semana. Corren con la sesión de la persona: la RPC empieza con
 * `acc_assert_reader` (dueños con acceso y la contadora) y `acc_parties` pasa por la RLS de lectores.
 */

function requireMonday(weekStart: string): string {
  if (!isMonday(weekStart)) {
    throw new AccQueryError('params', 'invalid', 'Esa semana no existe. Elegila de nuevo.')
  }
  return weekStart
}

function toWeekPlanRow(row: UnknownRecord): WeekPlanRow {
  return {
    partyId: str(row.party_id),
    partyName: str(row.party_name),
    partyKind: str(row.party_kind),
    defaultVoucherType: strOrNull(row.default_voucher_type),
    debtCents: cents(row.debt_cents),
    overdueCents: cents(row.overdue_cents),
    purchasedCents: cents(row.purchased_cents),
    paidCents: cents(row.paid_cents),
    budgetCents: cents(row.budget_cents),
  }
}

/** Una fila por proveedor con deuda, presupuesto o movimiento en esa semana. */
export async function getWeekPlan(tenantId: string, weekStart: string): Promise<WeekPlanRow[]> {
  const rows = await callRpcRows('acc_report_week_plan', {
    p_tenant_id: tenantId,
    p_week_start: requireMonday(weekStart),
  })
  return rows.map(toWeekPlanRow)
}

/** Las semanas del mes una al lado de la otra: una lectura por semana, en paralelo. */
export async function getMonthPlan(tenantId: string, month: string): Promise<MonthPlan> {
  const weeks = weeksOfMonth(month)
  if (weeks.length === 0) {
    throw new AccQueryError('params', 'invalid', 'Ese mes no existe. Elegilo de nuevo.')
  }
  const perWeek = await Promise.all(
    weeks.map(async (weekStart) => ({ weekStart, rows: await getWeekPlan(tenantId, weekStart) })),
  )
  return buildMonthPlan(month, perWeek)
}

/**
 * Los proveedores que se pueden sumar a la planilla: los mismos tipos que trae
 * `acc_report_week_plan` (proveedores y «otros»), activos.
 */
export async function listPlanParties(tenantId: string): Promise<PlanParty[]> {
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_parties')
    .select('id, name, trade_name, tax_id')
    .eq('tenant_id', tenantId)
    .in('kind', ['supplier', 'other'])
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw queryError('acc_parties', error)
  return ((data ?? []) as unknown[]).filter(isRecord).map((row) => ({
    id: str(row.id),
    name: str(row.name),
    tradeName: strOrNull(row.trade_name),
    taxId: strOrNull(row.tax_id),
  }))
}
