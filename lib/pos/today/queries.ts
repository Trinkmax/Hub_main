import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPayMethod } from '@/lib/pos/cash/types'
import { createClient } from '@/lib/supabase/server'
import { serviceDayWindow } from './summary'
import type {
  SalesDay,
  TodayBill,
  TodayBranch,
  TodayData,
  TodayLine,
  TodayOpenTable,
  TodayPayment,
  TodayShift,
} from './types'

/**
 * Lo que lee «Hoy en vivo». Va con el cliente de la persona (nunca con el de servicio): las tablas
 * de plata (`pos_payments`, `pos_closed_bills`, `pos_shifts`) solo se dejan leer a dueño y caja, y
 * mesas y comandas a quien trabaja en el bar. Además, cada consulta lleva el bar a la vista.
 *
 * Las tablas del punto de venta todavía no están en `types/database.ts`: cliente sin tipar, y se
 * tipa acá.
 */

async function untyped(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export class TodayReadError extends Error {
  constructor(what: string) {
    super(`No se pudo leer ${what}`)
    this.name = 'TodayReadError'
  }
}

/** La base devuelve de a mil filas: se piden de a tandas hasta que no haya más. */
const PAGE = 1000
/** Un tope de cordura: ningún día tiene más que esto. */
const MAX_PAGES = 10

type Result = { data: unknown; error: { code?: string; message: string } | null }

async function readAll<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<Result>,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let index = 0; index < MAX_PAGES; index++) {
    const { data, error } = await page(index * PAGE, index * PAGE + PAGE - 1)
    if (error) {
      console.error(`[pos.today.${what}]`, error.code, error.message)
      throw new TodayReadError(what)
    }
    const batch = (data ?? []) as Row[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

type PaymentRow = {
  id: string
  branch_id: string
  session_id: string
  shift_id: string | null
  method: string
  amount_cents: unknown
  surcharge_cents: unknown
  tip_cents: unknown
  invoice: boolean
  status: string
  created_at: string
  edits: Array<{ id: string }> | null
}
type BillRow = {
  session_id: string
  branch_id: string
  party_size: number | null
  subtotal_cents: unknown
  discount_cents: unknown
  deposit_cents: unknown
  due_cents: unknown
  closed_at: string
  customer_id: string | null
  points_awarded: number | null
}
type ShiftRow = {
  id: string
  branch_id: string
  label: string | null
  status: string
  opened_at: string
  opened_by_name: string
  closed_at: string | null
  closed_by_name: string | null
  difference_cents: unknown
}
type OpenRow = {
  id: string
  branch_id: string
  party_size: number | null
  total_cents: unknown
  opened_at: string
  bill_requested_at: string | null
}
type TicketRow = {
  id: string
  session: { branch_id: string } | Array<{ branch_id: string }> | null
  items: Array<{
    menu_item_id: string
    quantity: number
    line_total_cents: unknown
    cancelled_at: string | null
    item: { name: string } | Array<{ name: string }> | null
  }> | null
}

const one = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

/**
 * Todo lo de un día de servicio, en una ida (las lecturas van en paralelo). El día es su ventana de
 * tiempo, de 5 a 5: cuenta lo que se cobró, se cerró y se pidió adentro. `isToday` suma las mesas que
 * siguen abiertas y los turnos de caja abiertos aunque hayan arrancado otro día.
 */
export async function getToday(
  tenantId: string,
  day: string,
  isToday: boolean,
): Promise<TodayData> {
  const loadedAt = Date.now()
  const supabase = await untyped()
  // El día es una ventana de tiempo (de 5 a 5): una mesa abierta ayer y cobrada hoy es venta de hoy.
  const { from: since, to: until } = serviceDayWindow(day)

  const [branchRows, paymentRows, billRows, shiftRows, openRows, ticketRows] = await Promise.all([
    readAll<{
      id: string
      name: string
      short_name: string | null
      slug: string
      color: string
      position: number
      is_default: boolean
    }>('branches', (from, to) =>
      supabase
        .from('branches')
        .select('id, name, short_name, slug, color, position, is_default')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('position')
        .order('id')
        .range(from, to),
    ),
    readAll<PaymentRow>('payments', (from, to) =>
      supabase
        .from('pos_payments')
        .select(
          'id, branch_id, session_id, shift_id, method, amount_cents, surcharge_cents, tip_cents, invoice, status, created_at, edits:pos_payment_edits(id)',
        )
        .eq('tenant_id', tenantId)
        .gte('created_at', since)
        .lt('created_at', until)
        .eq('is_practice', false)
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
    readAll<BillRow>('bills', (from, to) =>
      supabase
        .from('pos_closed_bills')
        .select(
          'session_id, branch_id, party_size, subtotal_cents, discount_cents, deposit_cents, due_cents, closed_at, customer_id, points_awarded',
        )
        .eq('tenant_id', tenantId)
        .gte('closed_at', since)
        .lt('closed_at', until)
        .eq('is_practice', false)
        .order('closed_at')
        .order('session_id')
        .range(from, to),
    ),
    readAll<ShiftRow>('shifts', (from, to) => {
      const query = supabase
        .from('pos_shifts')
        .select(
          'id, branch_id, label, status, opened_at, opened_by_name, closed_at, closed_by_name, difference_cents',
        )
        .eq('tenant_id', tenantId)
        .eq('is_practice', false)
      return (
        isToday
          ? query.or(`and(opened_at.gte."${since}",opened_at.lt."${until}"),status.eq.open`)
          : query.gte('opened_at', since).lt('opened_at', until)
      )
        .order('opened_at')
        .order('id')
        .range(from, to)
    }),
    isToday
      ? readAll<OpenRow>('open tables', (from, to) =>
          supabase
            .from('table_sessions')
            .select('id, branch_id, party_size, total_cents, opened_at, bill_requested_at')
            .eq('tenant_id', tenantId)
            .eq('status', 'open')
            .eq('is_practice', false)
            .order('opened_at')
            .order('id')
            .range(from, to),
        )
      : Promise.resolve([] as OpenRow[]),
    readAll<TicketRow>('tickets', (from, to) =>
      supabase
        .from('tickets')
        .select(
          'id, session:table_sessions!inner(branch_id), items:ticket_items(menu_item_id, quantity, line_total_cents, cancelled_at, item:menu_items(name))',
        )
        .eq('tenant_id', tenantId)
        .eq('is_practice', false)
        .gte('submitted_at', since)
        .lt('submitted_at', until)
        .order('submitted_at')
        .order('id')
        .range(from, to),
    ),
  ])

  const branches: TodayBranch[] = [...branchRows]
    .sort(
      (a, b) =>
        Number(b.is_default) - Number(a.is_default) ||
        a.position - b.position ||
        a.name.localeCompare(b.name, 'es'),
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      shortName: row.short_name,
      slug: row.slug,
      color: row.color,
    }))

  const payments: TodayPayment[] = paymentRows.flatMap((row) =>
    isPayMethod(row.method)
      ? [
          {
            id: row.id,
            branchId: row.branch_id,
            sessionId: row.session_id,
            shiftId: row.shift_id,
            method: row.method,
            amountCents: num(row.amount_cents),
            surchargeCents: num(row.surcharge_cents),
            tipCents: num(row.tip_cents),
            invoice: row.invoice === true,
            status: row.status === 'voided' ? ('voided' as const) : ('ok' as const),
            createdAt: row.created_at,
            edits: row.edits?.length ?? 0,
          },
        ]
      : [],
  )

  const bills: TodayBill[] = billRows.map((row) => ({
    sessionId: row.session_id,
    branchId: row.branch_id,
    partySize: row.party_size,
    subtotalCents: num(row.subtotal_cents),
    discountCents: num(row.discount_cents),
    depositCents: num(row.deposit_cents),
    dueCents: num(row.due_cents),
    closedAt: row.closed_at,
    hasCustomer: row.customer_id !== null,
    pointsAwarded: row.points_awarded ?? 0,
  }))

  const shifts: TodayShift[] = shiftRows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    label: row.label,
    status: row.status === 'closed' ? 'closed' : 'open',
    openedAt: row.opened_at,
    openedByName: row.opened_by_name,
    closedAt: row.closed_at,
    closedByName: row.closed_by_name,
    differenceCents: row.difference_cents === null ? null : num(row.difference_cents),
  }))

  const openTables: TodayOpenTable[] = openRows.map((row) => ({
    sessionId: row.id,
    branchId: row.branch_id,
    partySize: row.party_size,
    totalCents: num(row.total_cents),
    openedAt: row.opened_at,
    billRequestedAt: row.bill_requested_at,
  }))

  const lines: TodayLine[] = ticketRows.flatMap((ticket) => {
    const branchId = one(ticket.session)?.branch_id
    if (!branchId) return []
    return (ticket.items ?? []).map((item) => ({
      branchId,
      menuItemId: item.menu_item_id,
      name: one(item.item)?.name ?? 'Producto',
      quantity: item.quantity,
      totalCents: num(item.line_total_cents),
      cancelled: item.cancelled_at !== null,
    }))
  })

  return { day, isToday, loadedAt, branches, payments, bills, shifts, openTables, lines }
}

type SalesDayRow = {
  day: string
  sales_cents: unknown
  surcharge_cents: unknown
  tip_cents: unknown
  payments: unknown
  tables: unknown
  people: unknown
  consumption_cents: unknown
  discount_cents: unknown
  deposit_cents: unknown
}

/**
 * Lo vendido día por día entre dos fechas (la función `pos_sales_days`, solo para dueños). Devuelve
 * solo los días que tuvieron algo. Si no se puede leer, `null`: la pantalla sigue sin la tira.
 */
export async function getSalesDays(
  tenantId: string,
  from: string,
  to: string,
  branchId: string | null,
): Promise<SalesDay[] | null> {
  const supabase = await untyped()
  const { data, error } = await supabase.rpc('pos_sales_days', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
    p_branch_id: branchId,
  })
  if (error) {
    console.error('[pos.today.sales_days]', error.code, error.message)
    return null
  }
  const rows = ((data as { days?: SalesDayRow[] } | null)?.days ?? []) as SalesDayRow[]
  return rows.map((row) => ({
    day: row.day,
    salesCents: num(row.sales_cents),
    surchargeCents: num(row.surcharge_cents),
    tipCents: num(row.tip_cents),
    payments: num(row.payments),
    tables: num(row.tables),
    people: num(row.people),
    consumptionCents: num(row.consumption_cents),
    discountCents: num(row.discount_cents),
    depositCents: num(row.deposit_cents),
  }))
}
