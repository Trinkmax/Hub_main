import { nameKey } from '@/lib/customers/search-query'
import { eachIsoDay, isLeapYear, isoDayInCordoba, isRealIsoDay } from '@/lib/dates'
import { computeExpiry, wouldDropTier } from '@/lib/points/category'
import type { LedgerEntry, RedemptionListEntry } from '@/lib/points/queries'
import { type LoyaltyTier, progressToNext } from '@/lib/points/tiers'
import { parseServiceAlerts, type ServiceAlert } from '@/lib/salon/alerts'
import type { TenantRole } from '@/lib/tenant/types'
import { compact } from '../read/common'
import { dayText, money } from '../types'

export {
  type CustomerQuery,
  nameFilter,
  nameKey,
  parseCustomerQuery,
} from '@/lib/customers/search-query'

/**
 * Lo puro de Clientes: qué se le muestra a Tex de un cliente, cómo se busca a alguien y cómo se arma lo
 * que reciben las acciones de su ficha. Lo del programa está en `_club-values.ts`.
 *
 * **Datos personales:** lo que devuelve una herramienta viaja a la API de un tercero. De un cliente van
 * el nombre, los últimos 4 números del teléfono si hace falta distinguirlo y sus números del club. Nunca
 * el teléfono ni el mail enteros, ni el año de nacimiento, ni las notas, ni los avisos de salud, ni el
 * `qr_token` (es su credencial). `customerRow` y `customerCardData` son listas blancas por eso: un campo
 * nuevo de la tabla no sale solo.
 */

/** Las pantallas de Clientes y del Club y las acciones del programa: `requireRole(['owner'])`. */
export const OWNER_ONLY: readonly TenantRole[] = ['owner']
/** `updateCustomer`, las etiquetas, `closeTable` y `redeemReward`: dueño o caja. */
export const OWNER_OR_CASHIER: readonly TenantRole[] = ['owner', 'cashier']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

/** `1 punto`, `1.200 puntos`. Los puntos no son plata: sin `money`. */
export function pointsWord(points: number): string {
  return `${points.toLocaleString('es-AR')} ${Math.abs(points) === 1 ? 'punto' : 'puntos'}`
}

/** Un `timestamptz` como lo lee Tex: el día de Córdoba, no el de la base. */
export function dayOf(timestamp: string | null | undefined): string | null {
  return dayText(isoDayInCordoba(timestamp))
}

// ─── Lo que se dice de una persona ───────────────────────────────────────────

/** `…1234`: alcanza para distinguir a dos con el mismo nombre. */
export function phoneTail(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `…${digits.slice(-4)}` : null
}

/** `j…@gmail.com`: para que quien mira el tique reconozca el mail sin que quede entero a la vista. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [user, domain] = email.split('@')
  return user && domain ? `${user.slice(0, 1)}…@${domain}` : '…'
}

export function customerName(customer: { first_name: string; last_name: string }): string {
  return `${customer.first_name} ${customer.last_name}`.trim() || 'Sin nombre'
}

/** `12/05`: el cumple sin el año, que no hace falta para nada de lo que hace Tex. */
export function birthdayText(birthdate: string | null | undefined): string | null {
  if (!birthdate) return null
  return `${birthdate.slice(8, 10)}/${birthdate.slice(5, 7)}`
}

const ORIGIN_WORDS: Readonly<Record<string, string>> = {
  reservation: 'Reservas',
  walkin: 'Walk-in',
  import: 'Importado',
}

/** Lo que trae una búsqueda. El teléfono entero se lee para sacarle la cola, y no pasa de acá. */
export type CustomerLite = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
  category_points: number
  total_visits: number
  last_visit_at: string | null
  current_tier_id: string | null
}

export const CUSTOMER_LITE_COLUMNS =
  'id, first_name, last_name, phone, points_balance, category_points, total_visits, last_visit_at, current_tier_id'

export type TierNames = ReadonlyMap<string, string>

export function tierNames(tiers: readonly Pick<LoyaltyTier, 'id' | 'name'>[]): TierNames {
  return new Map(tiers.map((tier) => [tier.id, tier.name]))
}

/** Una fila de una lista de clientes. */
export function customerRow(customer: CustomerLite, tiers: TierNames) {
  return compact({
    cliente_id: customer.id,
    nombre: customerName(customer),
    tel: phoneTail(customer.phone),
    puntos: customer.points_balance,
    nivel: customer.current_tier_id ? (tiers.get(customer.current_tier_id) ?? null) : null,
    visitas: customer.total_visits,
    ultima_visita: dayOf(customer.last_visit_at),
  })
}

// ─── Buscar a alguien ────────────────────────────────────────────────────────

export type Picked<T> = { ok: true; value: T } | { ok: false; message: string }

/** Un teléfono o un mail no se repiten en un mensaje: ya se sabe de qué se habla. */
function asked(wanted: string): string {
  if (wanted.includes('@')) return 'ese mail'
  return /\d{5,}/.test(wanted.replace(/[\s()+.-]/g, '')) ? 'ese teléfono' : `«${wanted.trim()}»`
}

const OPTIONS_SHOWN = 8

function customerOption(customer: CustomerLite): string {
  const tail = phoneTail(customer.phone)
  return `${customerName(customer)}${tail ? ` ${tail}` : ''} (id ${customer.id})`
}

/** Tex nunca elige a ojo entre dos personas: si no hay una sola, vuelve con las opciones. */
export function chooseCustomer(
  rows: readonly CustomerLite[],
  total: number,
  wanted: string,
): Picked<CustomerLite> {
  const key = nameKey(wanted)
  const exact = rows.filter((row) => nameKey(customerName(row)) === key)
  const pool = exact.length > 0 ? exact : rows
  const [only] = pool
  if (only && pool.length === 1) return { ok: true, value: only }
  if (pool.length === 0) {
    return {
      ok: false,
      message: `No encontré a ${asked(wanted)}. Preguntale si es nuevo o si se llama de otra forma.`,
    }
  }
  const shown = pool.slice(0, OPTIONS_SHOWN)
  const hidden = (exact.length > 0 ? exact.length : Math.max(total, rows.length)) - shown.length
  return {
    ok: false,
    message: `${asked(wanted)} puede ser: ${shown.map(customerOption).join('; ')}${hidden > 0 ? `; y ${hidden} más` : ''}. Preguntale cuál, o pedile el apellido o los últimos números del teléfono.`,
  }
}

/** Lo mismo para lo del club (una recompensa, un nivel, una marca): por nombre o por id. */
export function pickByName<T extends { id: string }>(
  rows: readonly T[],
  wanted: string,
  nameOf: (row: T) => string,
  what: string,
): Picked<T> {
  const clean = wanted.trim()
  const key = nameKey(clean)
  const exact = rows.filter((row) => nameKey(nameOf(row)) === key)
  const pool = isUuid(clean)
    ? rows.filter((row) => row.id === clean)
    : exact.length > 0
      ? exact
      : rows.filter((row) => {
          const name = nameKey(nameOf(row))
          return name.includes(key) || key.includes(name)
        })
  const [only] = pool
  if (only && pool.length === 1) return { ok: true, value: only }
  const options = (list: readonly T[]) =>
    list
      .slice(0, OPTIONS_SHOWN)
      .map((row) => `${nameOf(row)} (id ${row.id})`)
      .join('; ')
  if (pool.length > 1) {
    return { ok: false, message: `«${clean}» puede ser: ${options(pool)}. Preguntale cuál.` }
  }
  return {
    ok: false,
    message: `No encontré ${what} «${clean}». Hay: ${options(rows) || 'ninguno'}.`,
  }
}

// ─── La ficha ────────────────────────────────────────────────────────────────

/** Lo que trae `getCustomerById` y usa Tex. El resto de la fila ni se mira. */
export type CustomerFull = CustomerLite & {
  email: string | null
  notes: string | null
  birthdate: string | null
  opt_in_marketing: boolean
  is_blocked: boolean
  service_alerts: unknown
  total_spent_cents: number
  created_at: string
  acquisition_channel: string
  tags: Array<{ id: string; name: string; color: string }>
}

const REDEMPTION_WORDS: Readonly<Record<string, string>> = {
  delivered: 'Entregado',
  pending: 'Para retirar',
  cancelled: 'Cancelado',
}

export function redemptionRow(redemption: RedemptionListEntry) {
  return compact({
    que: redemption.reward_name,
    puntos: redemption.points_spent > 0 ? redemption.points_spent : null,
    fecha: dayOf(redemption.redeemed_at),
    estado: REDEMPTION_WORDS[redemption.status] ?? redemption.status,
  })
}

const LEDGER_WORDS: Readonly<Record<string, string>> = {
  qr_award: 'Consumo acreditado',
  rule_engine: 'Visita',
  session_paid: 'Mesa cobrada',
  session_payment_discount: 'Descuento con puntos al cobrar',
  reward_redeem: 'Canje',
  welcome_bonus: 'Bono de bienvenida',
  event_attendance: 'Asistencia a un evento',
}

/** Un movimiento de puntos. Del `payload` solo sale el nombre de la recompensa. */
export function ledgerRow(entry: LedgerEntry) {
  const reward = entry.reason === 'reward_redeem' ? entry.payload?.reward_name : null
  return {
    fecha: dayOf(entry.created_at),
    puntos: entry.delta > 0 ? `+${entry.delta}` : String(entry.delta),
    motivo:
      typeof reward === 'string' ? `Canje · ${reward}` : (LEDGER_WORDS[entry.reason] ?? 'Otro'),
  }
}

/** Las tarjetas de sellos de un cliente, como las ve la caja. */
export type CustomerCardLine = {
  templateName: string
  current: number
  threshold: number
  lockedByTier: boolean
  requiredTierNames: string[]
}

export type CustomerStats = {
  avg_ticket_cents?: number | null
  days_since_last_visit?: number | null
  visit_frequency_days?: number | null
  favorite_item_name?: string | null
  favorite_category_name?: string | null
} | null

export const CARD_LIST_MAX = 10

/**
 * La ficha, para que la lea Tex. Es una lista blanca a propósito (ver arriba): de lo sensible solo sale
 * si existe, no qué dice. Las notas y los avisos se leen en su pantalla.
 */
export function customerCardData(input: {
  customer: CustomerFull
  tiers: readonly LoyaltyTier[]
  ledger: readonly LedgerEntry[]
  redemptions: readonly RedemptionListEntry[]
  stats: CustomerStats
  cards: readonly CustomerCardLine[]
  windowMonths: number
  now: Date
}) {
  const { customer: c, tiers, ledger, redemptions, stats, cards, windowMonths, now } = input
  const progress = progressToNext(c.category_points, tiers)
  const tierName = c.current_tier_id
    ? (tiers.find((tier) => tier.id === c.current_tier_id)?.name ?? null)
    : (progress.current?.name ?? null)
  const expiry = computeExpiry(ledger, now, windowMonths)
  const drop = expiry ? wouldDropTier(c.category_points, expiry.points, tiers) : null
  const pending = redemptions.filter((r) => r.status === 'pending')
  return compact({
    cliente_id: c.id,
    nombre: customerName(c),
    tel: phoneTail(c.phone),
    tiene_mail: c.email ? true : null,
    cumple: birthdayText(c.birthdate),
    origen: ORIGIN_WORDS[c.acquisition_channel] ?? null,
    cliente_desde: dayOf(c.created_at),
    etiquetas: c.tags.length > 0 ? c.tags.map((tag) => tag.name) : null,
    acepta_promos: c.opt_in_marketing,
    no_contactar: c.is_blocked ? true : null,
    tiene_notas: c.notes?.trim() ? true : null,
    tiene_avisos: parseServiceAlerts(c.service_alerts).length > 0 ? true : null,
    puntos_canjeables: c.points_balance,
    puntos_de_categoria: c.category_points,
    nivel: tierName,
    proximo_nivel: progress.next
      ? { nombre: progress.next.name, faltan_puntos: progress.pointsToNext }
      : null,
    vencen_de_categoria: expiry
      ? compact({
          puntos: expiry.points,
          el: dayOf(expiry.expiresAt.toISOString()),
          baja_a: drop?.drops ? (drop.toTierName ?? 'sin nivel') : null,
        })
      : null,
    visitas: c.total_visits,
    gastado: money(c.total_spent_cents),
    ticket_promedio:
      c.total_visits > 0 ? money(Math.floor(c.total_spent_cents / c.total_visits)) : null,
    ultima_visita: dayOf(c.last_visit_at),
    dias_sin_venir: stats?.days_since_last_visit ?? null,
    viene_cada_dias:
      stats?.visit_frequency_days != null ? Math.round(Number(stats.visit_frequency_days)) : null,
    plato_favorito: stats?.favorite_item_name ?? null,
    categoria_favorita: stats?.favorite_category_name ?? null,
    para_retirar: pending.length > 0 ? pending.length : null,
    canjes: redemptions.length > 0 ? redemptions.slice(0, CARD_LIST_MAX).map(redemptionRow) : null,
    canjes_hay_mas: redemptions.length > CARD_LIST_MAX ? true : null,
    movimientos: ledger.length > 0 ? ledger.slice(0, CARD_LIST_MAX).map(ledgerRow) : null,
    tarjetas:
      cards.length > 0
        ? cards.map((card) =>
            compact({
              nombre: card.templateName,
              sellos: `${card.current} de ${card.threshold}`,
              solo_para: card.lockedByTier ? card.requiredTierNames : null,
            }),
          )
        : null,
  })
}

// ─── Las listas ──────────────────────────────────────────────────────────────

export type BirthdayCustomer = Pick<
  CustomerLite,
  'id' | 'first_name' | 'last_name' | 'total_visits' | 'last_visit_at' | 'current_tier_id'
> & { birthdate: string }

/**
 * Quién cumple en un período, en el orden en que van cumpliendo. El 29/02 se festeja el 28 los años que
 * no son bisiestos. No sale el año: alcanza con el día.
 */
export function birthdayRows(
  rows: readonly BirthdayCustomer[],
  period: { from: string; to: string },
  today: string,
  tiers: TierNames,
) {
  const dayOfYear = new Map<string, string>()
  for (const day of eachIsoDay(period.from, period.to)) {
    const key = day.slice(5)
    if (!dayOfYear.has(key)) dayOfYear.set(key, day)
  }
  const feb28 = dayOfYear.get('02-28')
  if (feb28 && !dayOfYear.has('02-29') && !isLeapYear(Number(feb28.slice(0, 4)))) {
    dayOfYear.set('02-29', feb28)
  }
  return rows
    .flatMap((row) => {
      const on = dayOfYear.get(row.birthdate.slice(5, 10))
      return on ? [{ row, on }] : []
    })
    .sort(
      (a, b) =>
        a.on.localeCompare(b.on) || customerName(a.row).localeCompare(customerName(b.row), 'es'),
    )
    .map(({ row, on }) =>
      compact({
        cliente_id: row.id,
        nombre: customerName(row),
        cumple: `${on.slice(8, 10)}/${on.slice(5, 7)}`,
        es_hoy: on === today ? true : null,
        nivel: row.current_tier_id ? (tiers.get(row.current_tier_id) ?? null) : null,
        visitas: row.total_visits,
        ultima_visita: dayOf(row.last_visit_at),
      }),
    )
}

export type NewCustomer = Pick<CustomerLite, 'id' | 'first_name' | 'last_name'> & {
  created_at: string
  acquisition_channel: string
}

export function newCustomerRow(customer: NewCustomer) {
  return compact({
    cliente_id: customer.id,
    nombre: customerName(customer),
    alta: dayOf(customer.created_at),
    origen: ORIGIN_WORDS[customer.acquisition_channel] ?? null,
  })
}

/** Lo que vale de `v_customer_stats`: la misma fila que muestra Estadísticas, sin el teléfono. */
export function topCustomerRow(row: {
  customer_id: string
  first_name: string
  last_name: string
  total_visits: number
  total_spent_cents: number
  avg_ticket_cents: number
  last_visit_at: string | null
  favorite_item_name: string | null
}) {
  return compact({
    cliente_id: row.customer_id,
    nombre: customerName(row),
    gastado: money(row.total_spent_cents),
    visitas: row.total_visits,
    ticket_promedio: money(row.avg_ticket_cents),
    ultima_visita: dayOf(row.last_visit_at),
    plato_favorito: row.favorite_item_name,
  })
}

/** Lo que consumió cada uno en un período, de mayor a menor. */
export function rankVisits(
  visits: ReadonlyArray<{ customer_id: string; total_amount_cents: number }>,
  by: 'gasto' | 'visitas',
): Array<{ customerId: string; visits: number; cents: number }> {
  const byCustomer = new Map<string, { customerId: string; visits: number; cents: number }>()
  for (const visit of visits) {
    const sum = byCustomer.get(visit.customer_id) ?? {
      customerId: visit.customer_id,
      visits: 0,
      cents: 0,
    }
    sum.visits += 1
    sum.cents += Number(visit.total_amount_cents)
    byCustomer.set(visit.customer_id, sum)
  }
  return [...byCustomer.values()].sort((a, b) =>
    by === 'gasto'
      ? b.cents - a.cents || b.visits - a.visits
      : b.visits - a.visits || b.cents - a.cents,
  )
}

// ─── Lo que recibe cada acción ───────────────────────────────────────────────

export const ALERT_WORDS = {
  celiaco: 'celiac',
  alergia: 'allergy',
  vegetariano: 'vegetarian',
  vegano: 'vegan',
  movilidad_reducida: 'reduced_mobility',
} as const satisfies Record<string, ServiceAlert>

export type AlertWord = keyof typeof ALERT_WORDS

export const ALERT_WORD_KEYS = Object.keys(ALERT_WORDS) as [AlertWord, ...AlertWord[]]

/** Una fecha de nacimiento que existe y ya pasó. El esquema de la acción solo mira la forma. */
export function isRealBirthdate(iso: string, today: string): boolean {
  return isRealIsoDay(iso) && iso <= today && iso >= '1900-01-01'
}

export type CustomerChange = {
  first_name?: string
  last_name?: string
  phone?: string
  email?: string | null
  birthdate?: string | null
  opt_in_marketing?: boolean
  is_blocked?: boolean
  add_note?: string
  add_alerts?: ServiceAlert[]
  remove_alerts?: ServiceAlert[]
}

export type CustomerFormRow = Pick<
  CustomerFull,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'email'
  | 'notes'
  | 'birthdate'
  | 'opt_in_marketing'
  | 'is_blocked'
  | 'service_alerts'
>

/**
 * La ficha entera, con lo que cambia. `updateCustomer` pisa todos los campos con lo que viene en el
 * formulario: lo que no se dijo tiene que viajar igual, o el teléfono, las notas, los avisos y el
 * consentimiento se perderían. Por eso se arma de nuevo con la ficha de ese momento al confirmar, y no
 * cuando se preparó el tique: entre uno y otro pueden pasar horas.
 */
export function customerEditValues(current: CustomerFormRow, change: CustomerChange) {
  const alerts = new Set<ServiceAlert>(parseServiceAlerts(current.service_alerts))
  for (const alert of change.add_alerts ?? []) alerts.add(alert)
  for (const alert of change.remove_alerts ?? []) alerts.delete(alert)
  const note = change.add_note?.trim()
  return {
    id: current.id,
    first_name: change.first_name ?? current.first_name,
    last_name: change.last_name ?? current.last_name,
    phone: change.phone ?? current.phone,
    email: change.email !== undefined ? change.email : current.email,
    notes: note ? (current.notes?.trim() ? `${current.notes}\n${note}` : note) : current.notes,
    birthdate: change.birthdate !== undefined ? change.birthdate : current.birthdate,
    opt_in_marketing: change.opt_in_marketing ?? current.opt_in_marketing,
    is_blocked: change.is_blocked ?? current.is_blocked,
    service_alerts: [...alerts],
  }
}

export type CustomerEditValues = ReturnType<typeof customerEditValues>

/** Lo que manda el formulario de la ficha. */
export function customerEditForm(values: CustomerEditValues): FormData {
  const form = new FormData()
  form.set('id', values.id)
  form.set('first_name', values.first_name)
  form.set('last_name', values.last_name)
  form.set('phone', values.phone)
  form.set('email', values.email ?? '')
  form.set('notes', values.notes ?? '')
  form.set('birthdate', values.birthdate ?? '')
  if (values.opt_in_marketing) form.set('opt_in_marketing', 'on')
  if (values.is_blocked) form.set('is_blocked', 'on')
  for (const alert of values.service_alerts) form.append('service_alerts', alert)
  return form
}

export type CustomerNewValues = {
  phone: string
  first_name: string
  last_name: string
  email: string | null
  birthdate: string | null
  opt_in_marketing: boolean
}

/** Lo que manda el formulario de «Nuevo cliente». */
export function customerCreateForm(values: CustomerNewValues): FormData {
  const form = new FormData()
  form.set('phone', values.phone)
  form.set('first_name', values.first_name)
  form.set('last_name', values.last_name)
  form.set('email', values.email ?? '')
  form.set('birthdate', values.birthdate ?? '')
  if (values.opt_in_marketing) form.set('opt_in_marketing', 'on')
  return form
}
