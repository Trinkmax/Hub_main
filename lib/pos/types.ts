/**
 * Formas de lo que devuelven las lecturas del punto de venta (RPC `pos_*`,
 * migración `pos_salon_en_vivo`). Son el contrato entre la base y las pantallas:
 * si cambia una RPC, cambia acá.
 */

export type PrepStatus = 'queued' | 'preparing' | 'ready' | 'served'
export type TicketStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled'

export type FloorKind =
  | 'table'
  | 'wall'
  | 'pillar'
  | 'island'
  | 'bar'
  | 'door'
  | 'text'
  | 'stage'
  | 'booth'
export type FloorShape = 'rect' | 'circle' | 'banquette'

export type PosBranch = {
  id: string
  name: string
  short_name: string | null
  slug: string
  color: string
  is_default: boolean
}

/** Minutos a partir de los cuales una mesa pide atención. */
export type PosThresholds = {
  order_warn_minutes: number
  kitchen_warn_minutes: number
  kitchen_late_minutes: number
  ready_warn_minutes: number
  bill_warn_minutes: number
}

export const DEFAULT_THRESHOLDS: PosThresholds = {
  order_warn_minutes: 6,
  kitchen_warn_minutes: 12,
  kitchen_late_minutes: 20,
  ready_warn_minutes: 2,
  bill_warn_minutes: 4,
}

export type FloorArea = {
  id: string
  name: string
  position: number
  width: number
  height: number
}

export type FloorElement = {
  id: string
  area_id: string
  kind: FloorKind
  shape: FloorShape
  x: number
  y: number
  w: number
  h: number
  rotation: number
  corner_radius: number
  z: number
  label: string | null
  color: string | null
  table_id: string | null
  table_label: string | null
  capacity: number | null
}

export type FloorCustomer = {
  id: string
  first_name: string
  last_name: string
  tier: string | null
  tier_color: string | null
}

export type FloorSession = {
  id: string
  table_id: string | null
  opened_at: string
  party_size: number | null
  alias: string | null
  reservation_id: string | null
  bill_requested_at: string | null
  total_cents: number
  is_practice: boolean
  kind: 'table' | 'quick' | 'delivery'
  customer: FloorCustomer | null
  /** Tandas cargadas que todavía no salieron a cocina («después»). */
  held_tickets: number
  items_queued: number
  items_preparing: number
  items_ready: number
  items_served: number
  /** Desde cuándo espera comida (la tanda más vieja sin terminar). */
  waiting_since: string | null
  /** Desde cuándo hay algo listo sin llevar. */
  ready_since: string | null
  last_served_at: string | null
  first_order_at: string | null
}

export type FloorReservation = {
  id: string
  /** «21:00» */
  time: string
  name: string
  guests: number
  status: 'pending' | 'arrived'
  table_label: string | null
  deposit_cents: number
  kind: 'normal' | 'birthday' | 'special'
  comments: string | null
  alerts: string[]
  customer_id: string | null
  event: string | null
}

export type FloorSnapshot = {
  now: string
  service_day: string
  branch: PosBranch
  settings: PosThresholds | null
  areas: FloorArea[]
  elements: FloorElement[]
  loose_tables: { id: string; label: string; capacity: number | null }[]
  sessions: FloorSession[]
  reservations: FloorReservation[]
  /**
   * Hasta cuándo la sucursal está en modo práctica (`null` = no está). No viene de la RPC: lo suma la
   * capa de servidor (`getFloorSnapshot`) leyendo la sucursal.
   */
  practice_until?: string | null
}

export type ItemModifier = {
  id: string
  label: string
  group: string
  delta_cents: number
}

export type SessionItem = {
  id: string
  menu_item_id: string
  name: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  notes: string | null
  modifiers: ItemModifier[]
  station_id: string | null
  prep_status: PrepStatus
  ready_at: string | null
  served_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
}

export type SessionTicket = {
  id: string
  status: TicketStatus
  course: number
  held: boolean
  submitted_at: string
  fired_at: string | null
  kitchen_seen_at: string | null
  ready_at: string | null
  served_at: string | null
  total_cents: number
  items: SessionItem[]
}

export type SessionDetail = {
  now: string
  session: {
    id: string
    status: 'open' | 'paid' | 'merged' | 'abandoned'
    branch_id: string
    table_id: string | null
    opened_at: string
    party_size: number | null
    alias: string | null
    note: string | null
    bill_requested_at: string | null
    total_cents: number
    is_practice: boolean
    kind: 'table' | 'quick' | 'delivery'
    paid_at: string | null
  }
  table: { id: string; label: string; capacity: number | null; area: string | null } | null
  reservation: {
    id: string
    name: string
    time: string
    guests: number
    deposit_cents: number
    kind: 'normal' | 'birthday' | 'special'
    comments: string | null
    alerts: string[]
    cake_count: number
    champagne_count: number
    event: string | null
  } | null
  customer: {
    id: string
    first_name: string
    last_name: string
    points_balance: number
    tier: string | null
    tier_color: string | null
    total_visits: number
    alerts: string[]
  } | null
  tickets: SessionTicket[]
}

export type MenuCategory = {
  id: string
  name: string
  parent_id: string | null
  position: number
  station_id: string | null
}

export type MenuItem = {
  id: string
  name: string
  category_id: string
  position: number
  price_cents: number
  description: string | null
  station_id: string | null
  sold_out: boolean
}

export type MenuStation = { id: string; name: string; color: string }

export type ModifierGroup = {
  id: string
  name: string
  selection: 'single' | 'multi'
  required: boolean
  options: { id: string; label: string; delta_cents: number }[]
  category_ids: string[]
  item_ids: string[]
}

export type PosMenu = {
  service_day: string
  categories: MenuCategory[]
  items: MenuItem[]
  stations: MenuStation[]
  modifier_groups: ModifierGroup[]
  /** Lo que más sale a esta hora, de más a menos. */
  popular_now: string[]
}

export type KitchenItem = {
  id: string
  menu_item_id: string
  name: string
  quantity: number
  notes: string | null
  modifiers: ItemModifier[]
  station_id: string | null
  prep_status: PrepStatus
  started_at: string | null
  ready_at: string | null
}

export type KitchenTicket = {
  id: string
  session_id: string
  status: TicketStatus
  course: number
  fired_at: string
  ready_at: string | null
  kitchen_seen_at: string | null
  is_practice: boolean
  table_label: string | null
  area: string | null
  alias: string | null
  party_size: number | null
  kind: 'table' | 'quick' | 'delivery'
  /** Nombre del evento, si la mesa vino por una reserva de evento. */
  event: string | null
  alerts: string[] | null
  items: KitchenItem[]
}

export type KitchenQueue = {
  now: string
  branch: { id: string; name: string; color: string }
  settings: { kitchen_warn_minutes: number; kitchen_late_minutes: number } | null
  stations: MenuStation[]
  tickets: KitchenTicket[]
}

/** Un renglón del pedido que el mozo está armando. */
export type OrderLineInput = {
  menu_item_id: string
  quantity: number
  option_ids: string[]
  notes: string | null
}

export type PosActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string; code?: string }
