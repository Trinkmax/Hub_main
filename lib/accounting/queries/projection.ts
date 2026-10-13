import 'server-only'
import type { ProjectionSourceDay } from '@/lib/accounting/projection'
import { TREASURY_KINDS, type TreasuryKind } from '@/lib/accounting/types'
import { eventTitle } from '@/lib/salon/events-report'
import {
  bool,
  callRpcRows,
  cents,
  centsOrNull,
  dayOrNull,
  int,
  isRecord,
  queryError,
  readerClient,
  requireRange,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Lecturas de Ventas › Proyección y «Ventas contra caja» (12/10/2026): el
 * reporte por día (`acc_report_sales_projection`), lo que entró en cada caja y
 * los eventos del calendario del bar. Las cuentas se hacen en
 * `lib/accounting/projection.ts`.
 */

export function parseProjectionRow(row: UnknownRecord): ProjectionSourceDay | null {
  const day = dayOrNull(row.day)
  if (!day) return null
  return {
    day,
    targetCents: centsOrNull(row.target_cents),
    note: strOrNull(row.note),
    closes: int(row.closes),
    salonCents: cents(row.salon_cents),
    deliveryCents: cents(row.delivery_cents),
    eventsCents: cents(row.events_cents),
    salonCommissionCents: cents(row.salon_commission_cents),
    deliveryCommissionCents: cents(row.delivery_commission_cents),
    eventsCommissionCents: cents(row.events_commission_cents),
    cashCountedCents: centsOrNull(row.cash_counted_cents),
  }
}

/** Una fila por día del rango (también los días sin nada), del más viejo al más nuevo. */
export async function getSalesProjection(
  tenantId: string,
  range: { from: string; to: string },
): Promise<ProjectionSourceDay[]> {
  const { from, to } = requireRange(range.from, range.to)
  const raw = await callRpcRows('acc_report_sales_projection', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
  })
  return raw.map(parseProjectionRow).filter((row): row is ProjectionSourceDay => row !== null)
}

// ─── Lo que entró en cada caja ───────────────────────────────────────────────

export type CashCountTreasury = {
  id: string
  name: string
  kind: TreasuryKind
  active: boolean
}

/** Por día, lo cargado en cada caja: `{ '2026-10-05': { '<caja>': 6000000 } }`. */
export type DailyCashCounts = Record<string, Record<string, number>>

function treasuryKind(value: unknown): TreasuryKind {
  return typeof value === 'string' && (TREASURY_KINDS as readonly string[]).includes(value)
    ? (value as TreasuryKind)
    : 'other'
}

/**
 * Las cajas donde puede entrar plata (todas menos la tarjeta de la empresa),
 * en el orden de Ajustes. Vienen también las desactivadas: un día viejo puede
 * tener algo cargado en una que ya no se usa.
 */
export async function listCashCountTreasuries(tenantId: string): Promise<CashCountTreasury[]> {
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_treasury_accounts')
    .select('id, name, kind, active, sort')
    .eq('tenant_id', tenantId)
    .neq('kind', 'credit_card')
    .order('sort', { ascending: true })
    .order('name', { ascending: true })
    .limit(200)
  if (error) throw queryError('acc_treasury_accounts', error)
  return ((data ?? []) as unknown[]).filter(isRecord).map((row) => ({
    id: str(row.id),
    name: str(row.name),
    kind: treasuryKind(row.kind),
    active: bool(row.active),
  }))
}

/** Lo que entró cada día del rango, caja por caja (para abrir el diálogo con lo ya cargado). */
export async function listDailyCashCounts(
  tenantId: string,
  range: { from: string; to: string },
): Promise<DailyCashCounts> {
  const { from, to } = requireRange(range.from, range.to)
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_daily_cash_counts')
    .select('day, treasury_account_id, amount_cents')
    .eq('tenant_id', tenantId)
    .gte('day', from)
    .lte('day', to)
    .limit(5000)
  if (error) throw queryError('acc_daily_cash_counts', error)
  const out: DailyCashCounts = {}
  for (const row of ((data ?? []) as unknown[]).filter(isRecord)) {
    const day = dayOrNull(row.day)
    const treasuryId = strOrNull(row.treasury_account_id)
    const amount = centsOrNull(row.amount_cents)
    if (!day || !treasuryId || amount === null) continue
    const byTreasury = out[day] ?? {}
    byTreasury[treasuryId] = amount
    out[day] = byTreasury
  }
  return out
}

// ─── Eventos del calendario del bar ──────────────────────────────────────────

/** Los nombres de los eventos de cada día: `{ '2026-10-17': ['Noche de tacos'] }`. */
export type DayEvents = Record<string, string[]>

/**
 * Los eventos programados en el calendario del bar, por día (la columna
 * «Evento» de la planilla). Solo lectura y solo el nombre: un grupo privado no
 * es un evento para mostrar. La contadora no lee el calendario (está aislada de
 * todo lo que no es Administración): para ella vuelve vacío.
 */
export async function listDayEvents(
  tenantId: string,
  range: { from: string; to: string },
): Promise<DayEvents> {
  const { from, to } = requireRange(range.from, range.to)
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('scheduled_events')
    .select('event_date, name_override, private_group, template:scheduled_event_templates(name)')
    .eq('tenant_id', tenantId)
    .gte('event_date', from)
    .lte('event_date', to)
    .order('event_date', { ascending: true })
    .order('starts_at_local', { ascending: true })
    .limit(1000)
  if (error) throw queryError('scheduled_events', error)
  const out: DayEvents = {}
  for (const row of ((data ?? []) as unknown[]).filter(isRecord)) {
    const day = dayOrNull(row.event_date)
    if (!day || row.private_group === true) continue
    const tpl = Array.isArray(row.template) ? row.template[0] : row.template
    const title = eventTitle({
      name_override: strOrNull(row.name_override),
      template: isRecord(tpl) ? { name: strOrNull(tpl.name) } : null,
    })
    const names = out[day] ?? []
    if (!names.includes(title)) names.push(title)
    out[day] = names
  }
  return out
}
