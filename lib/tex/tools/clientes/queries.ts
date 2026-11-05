import 'server-only'

import { getCustomerById } from '@/lib/customers/queries'
import { addDays, cordobaDayStartUtc } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import type { TexToolContext } from '../types'
import {
  type BirthdayCustomer,
  CUSTOMER_LITE_COLUMNS,
  type CustomerFull,
  type CustomerLite,
  type CustomerQuery,
  chooseCustomer,
  isUuid,
  type NewCustomer,
  nameFilter,
  type Picked,
  parseCustomerQuery,
} from './_values'

/**
 * Las lecturas de Clientes y Club que no tienen una función de consulta: las pantallas no buscan por
 * varias palabras ni sin acentos, ni cuentan socios por nivel. Todas con la sesión de la persona y con
 * `tenant_id`.
 */

const PAGE_ROWS = 1000

/** PostgREST corta en 1000 filas por pedido, aunque se le pida más. */
async function readAll<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
  max: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  for (let from = 0; from < max; from += PAGE_ROWS) {
    const { data, error } = await read(from, from + PAGE_ROWS - 1)
    if (error) throw new Error(`tex.clientes: ${error.code ?? 'red'}`)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_ROWS) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

function failed(error: { code?: string } | null): void {
  if (error) throw new Error(`tex.clientes: ${error.code ?? 'red'}`)
}

/** Las puntas de un período en el reloj del bar, para comparar contra un `timestamptz`. */
function dayBounds(from: string, to: string): { start: string; end: string } {
  return { start: cordobaDayStartUtc(from), end: cordobaDayStartUtc(addDays(to, 1)) }
}

export async function findCustomers(
  tenantId: string,
  opts: {
    query?: CustomerQuery
    tierId?: string | null
    tagId?: string | null
    limit: number
  },
): Promise<{ rows: CustomerLite[]; total: number }> {
  const supabase = await createClient()
  const columns = opts.tagId
    ? `${CUSTOMER_LITE_COLUMNS}, customer_tag_assignments!inner(tag_id)`
    : CUSTOMER_LITE_COLUMNS
  let query = supabase
    .from('customers')
    .select(columns, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  // Varios `or` van con Y entre sí: cada palabra tiene que estar en el nombre o en el apellido.
  for (const token of opts.query?.names ?? []) query = query.or(nameFilter(token))
  if (opts.query?.phone) query = query.ilike('phone', `%${opts.query.phone}%`)
  if (opts.tierId) query = query.eq('current_tier_id', opts.tierId)
  if (opts.tagId) query = query.eq('customer_tag_assignments.tag_id', opts.tagId)
  const { data, error, count } = await query
    .order('last_visit_at', { ascending: false, nullsFirst: false })
    .order('first_name', { ascending: true })
    .limit(opts.limit)
  failed(error)
  return { rows: (data ?? []) as unknown as CustomerLite[], total: count ?? 0 }
}

const RESOLVE_ROWS = 21
const NOT_FOUND = 'No encontré a ese cliente. Buscalo con buscar_cliente.'

/** La ficha de quien ya se sabe el id, o `null`. El tenant lo filtra `getCustomerById`. */
export async function customerById(
  ctx: Pick<TexToolContext, 'tenantId'>,
  id: string,
): Promise<CustomerFull | null> {
  return (await getCustomerById({
    tenantId: ctx.tenantId,
    id,
  })) as unknown as CustomerFull | null
}

/** De lo que dice la gente («Juan», «…1234») al cliente. Si no hay uno solo, vuelve con las opciones. */
export async function resolveCustomer(
  ctx: Pick<TexToolContext, 'tenantId'>,
  wanted: string,
): Promise<Picked<CustomerLite>> {
  const clean = wanted.trim()
  if (isUuid(clean)) {
    const customer = await customerById(ctx, clean)
    return customer ? { ok: true, value: customer } : { ok: false, message: NOT_FOUND }
  }
  const query = parseCustomerQuery(clean)
  if (query.names.length === 0 && !query.phone) {
    return { ok: false, message: 'Preguntale el nombre o los últimos números del teléfono.' }
  }
  const { rows, total } = await findCustomers(ctx.tenantId, { query, limit: RESOLVE_ROWS })
  return chooseCustomer(rows, total, clean)
}

/** Quién tiene ese teléfono o ese mail: `createCustomer` no duplica, y el tique no puede prometerlo. */
export async function customerByContact(
  tenantId: string,
  contact: { phone?: string | null; email?: string | null },
): Promise<(CustomerLite & { matchedBy: 'teléfono' | 'mail' }) | null> {
  const supabase = await createClient()
  const lookup = async (column: 'phone' | 'email', value: string) => {
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_LITE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq(column, value)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    failed(error)
    return data as unknown as CustomerLite | null
  }
  if (contact.phone) {
    const found = await lookup('phone', contact.phone)
    if (found) return { ...found, matchedBy: 'teléfono' }
  }
  if (contact.email) {
    const found = await lookup('email', contact.email)
    if (found) return { ...found, matchedBy: 'mail' }
  }
  return null
}

/** A cuántos se les puede mandar una promo: aceptaron y no pidieron que no los contacten. */
export async function countAcceptingPromos(tenantId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .eq('opt_in_marketing', true)
    .eq('is_blocked', false)
  failed(error)
  return count ?? 0
}

const BIRTHDAY_COLUMNS =
  'id, first_name, last_name, birthdate, total_visits, last_visit_at, current_tier_id'
const BIRTHDAYS_READ = 10_000

/**
 * Los que tienen cargado el cumple. PostgREST no filtra por mes y día de una fecha: se leen todos y se
 * elige en memoria. Son pocas columnas, y solo los que lo cargaron.
 */
export async function customersWithBirthdate(
  tenantId: string,
): Promise<{ rows: BirthdayCustomer[]; truncated: boolean; withoutBirthdate: number }> {
  const supabase = await createClient()
  const [{ rows, truncated }, without] = await Promise.all([
    readAll<BirthdayCustomer>(
      (from, to) =>
        supabase
          .from('customers')
          .select(BIRTHDAY_COLUMNS)
          .eq('tenant_id', tenantId)
          .is('deleted_at', null)
          .not('birthdate', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      BIRTHDAYS_READ,
    ),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .is('birthdate', null),
  ])
  failed(without.error)
  return { rows, truncated, withoutBirthdate: without.count ?? 0 }
}

const NEW_CUSTOMERS_SHOWN = 21

export type NewCustomersReport = {
  total: number
  rows: NewCustomer[]
  reservations: number
  walkin: number
  imported: number
  alreadyCame: number
  previous: number
}

/** Cuántos clientes se sumaron en un período, de dónde vinieron y cuántos en el período anterior. */
export async function newCustomers(
  tenantId: string,
  period: { from: string; to: string },
  previous: { from: string; to: string },
): Promise<NewCustomersReport> {
  const supabase = await createClient()
  const count = (range: { from: string; to: string }) => {
    const { start, end } = dayBounds(range.from, range.to)
    return supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .gte('created_at', start)
      .lt('created_at', end)
  }
  const { start, end } = dayBounds(period.from, period.to)
  const [list, reservations, walkin, imported, alreadyCame, before] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, last_name, created_at, acquisition_channel', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(NEW_CUSTOMERS_SHOWN),
    count(period).eq('acquisition_channel', 'reservation'),
    count(period).eq('acquisition_channel', 'walkin'),
    count(period).eq('acquisition_channel', 'import'),
    count(period).gt('total_visits', 0),
    count(previous),
  ])
  failed(list.error)
  return {
    total: list.count ?? 0,
    rows: (list.data ?? []) as unknown as NewCustomer[],
    reservations: reservations.count ?? 0,
    walkin: walkin.count ?? 0,
    imported: imported.count ?? 0,
    alreadyCame: alreadyCame.count ?? 0,
    previous: before.count ?? 0,
  }
}

export type LiveTopRow = {
  id: string
  first_name: string
  last_name: string
  total_visits: number
  total_spent_cents: number
  points_balance: number
  last_visit_at: string | null
  current_tier_id: string | null
}

const LIVE_TOP_COLUMNS =
  'id, first_name, last_name, total_visits, total_spent_cents, points_balance, last_visit_at, current_tier_id'

/** Los que más vinieron o más puntos tienen. `getTopCustomersBySpent` solo ordena por lo gastado. */
export async function topCustomersBy(
  tenantId: string,
  column: 'total_visits' | 'points_balance',
  limit: number,
): Promise<LiveTopRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select(LIVE_TOP_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .gt(column, 0)
    .order(column, { ascending: false })
    .limit(limit)
  failed(error)
  return (data ?? []) as unknown as LiveTopRow[]
}

export async function customersByIds(tenantId: string, ids: readonly string[]) {
  if (ids.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select(LIVE_TOP_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .in('id', [...ids])
  failed(error)
  return (data ?? []) as unknown as LiveTopRow[]
}

const VISITS_READ = 20_000

/** Las visitas de un período, para ver quién vino y gastó más en ese tiempo. */
export async function visitsInPeriod(
  tenantId: string,
  period: { from: string; to: string },
): Promise<{
  rows: Array<{ customer_id: string; total_amount_cents: number }>
  truncated: boolean
}> {
  const supabase = await createClient()
  const { start, end } = dayBounds(period.from, period.to)
  return readAll(
    (from, to) =>
      supabase
        .from('visits')
        .select('customer_id, total_amount_cents')
        .eq('tenant_id', tenantId)
        .gte('visited_at', start)
        .lt('visited_at', end)
        .order('id', { ascending: true })
        .range(from, to),
    VISITS_READ,
  )
}

/** Cuántos socios tiene cada nivel, y cuántos no llegan a ninguno. */
export async function tierMembers(
  tenantId: string,
  tierIds: readonly string[],
): Promise<{ byTier: Map<string, number>; withoutTier: number }> {
  const supabase = await createClient()
  const count = () =>
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
  const [none, ...counts] = await Promise.all([
    count().is('current_tier_id', null),
    ...tierIds.map((id) => count().eq('current_tier_id', id)),
  ])
  const byTier = new Map<string, number>()
  tierIds.forEach((id, index) => {
    byTier.set(id, counts[index]?.count ?? 0)
  })
  return { byTier, withoutTier: none.count ?? 0 }
}

/** Los meses que duran los puntos de categoría en este bar. */
export async function categoryWindowMonths(tenantId: string): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('category_window_months')
    .eq('id', tenantId)
    .maybeSingle()
  failed(error)
  return (data as { category_window_months?: number | null } | null)?.category_window_months ?? 4
}

const TAG_ASSIGNMENTS_READ = 50_000

/**
 * Las etiquetas de clientes con cuántos la tienen. Se cuenta sobre los clientes que siguen en la lista:
 * los dados de baja conservan sus etiquetas, y el total no daría lo mismo que el filtro de Personas.
 */
export async function tagsWithCounts(
  tenantId: string,
): Promise<Array<{ id: string; name: string; count: number }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customer_tags')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  failed(error)
  const tags = (data ?? []) as Array<{ id: string; name: string }>
  if (tags.length === 0) return []
  const { rows } = await readAll<{ tag_id: string }>(
    (from, to) =>
      supabase
        .from('customer_tag_assignments')
        .select('tag_id, customers!inner(deleted_at)')
        .in(
          'tag_id',
          tags.map((tag) => tag.id),
        )
        .is('customers.deleted_at', null)
        .order('customer_id', { ascending: true })
        .order('tag_id', { ascending: true })
        .range(from, to),
    TAG_ASSIGNMENTS_READ,
  )
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1)
  return tags.map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }))
}

const PUNCH_CARDS_READ = 20_000

/** Las tarjetas de sellos de los socios, para contar cuántas van y cuántas se completaron. */
export async function punchCardProgress(tenantId: string) {
  const supabase = await createClient()
  return readAll<{
    template_id: string
    completed_at: string | null
    expired_at: string | null
    current_stamps: number
  }>(
    (from, to) =>
      supabase
        .from('customer_punch_cards')
        .select('template_id, completed_at, expired_at, current_stamps')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    PUNCH_CARDS_READ,
  )
}
