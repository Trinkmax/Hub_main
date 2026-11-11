/**
 * Filas `pur_*` → tipos del dominio (camelCase, números de verdad). Puro.
 */
import type { Database } from '@/types/database'
import {
  type CalendarEvent,
  COUNT_KINDS,
  COUNT_STATES,
  type CountKind,
  type CountState,
  type CountStatus,
  DEFAULT_SETTINGS,
  FREQUENCIES,
  type Frequency,
  MAX_ARRIVE_DAYS_BEFORE,
  MAX_COUNT_WINDOW_DAYS,
  type OrderStatus,
  type PurCount,
  type PurCountLine,
  type PurEventPlan,
  type PurItem,
  type PurOrder,
  type PurOrderLine,
  type PurRecipe,
  type PurRecipeLine,
  type PurSettings,
  type PurSupplier,
  type PurZone,
  type ReceivedState,
} from './types'

type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Tables[T]['Row']

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft',
  'sent',
  'confirmed',
  'with_differences',
  'completed',
  'discarded',
]

function oneOf<T extends string>(
  value: string | null | undefined,
  options: readonly T[],
  fallback: T,
): T {
  return value && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * `{"0": 4, "3": 5}` → `{0: 4, 3: 5}`. Lo que no sea un día de la semana con un número de días razonable se
 * ignora (ese día vuelve a la ventana calculada).
 */
export function parseCountWindows(value: unknown): Record<number, number> {
  const out: Record<number, number> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value)) {
    const day = Number(key)
    const days = typeof raw === 'number' ? raw : Number.NaN
    if (!/^[0-6]$/.test(key) || !Number.isInteger(days)) continue
    if (days < 0 || days > MAX_COUNT_WINDOW_DAYS) continue
    out[day] = days
  }
  return out
}

export function toSettings(row: Row<'pur_settings'> | null | undefined): PurSettings {
  if (!row) return DEFAULT_SETTINGS
  const arrive = row.arrive_days_before
  return {
    countWeekdays: (row.count_weekdays ?? []).map(Number),
    countWindows: parseCountWindows(row.count_windows),
    arriveDaysBefore:
      typeof arrive === 'number' && arrive >= 0 && arrive <= MAX_ARRIVE_DAYS_BEFORE
        ? arrive
        : DEFAULT_SETTINGS.arriveDaysBefore,
    recipeBaseGuests: row.recipe_base_guests ?? DEFAULT_SETTINGS.recipeBaseGuests,
    reviewerName: row.reviewer_name,
    senderName: row.sender_name,
    lowFraction: num(row.low_fraction) ?? DEFAULT_SETTINGS.lowFraction,
  }
}

export function toZone(row: Row<'pur_zones'>): PurZone {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    sortOrder: row.sort_order,
    active: row.active,
  }
}

export function toSupplier(row: Row<'pur_suppliers'>): PurSupplier {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    whatsapp: row.whatsapp,
    deliveryWeekdays: (row.delivery_weekdays ?? []).map(Number),
    leadDays: row.lead_days,
    notes: row.notes,
    active: row.active,
  }
}

export function toItem(row: Row<'pur_items'>): PurItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    brand: row.brand,
    zoneId: row.zone_id,
    unit: row.unit,
    frequency: oneOf<Frequency>(row.frequency, FREQUENCIES, 'frequent'),
    targetQty: num(row.target_qty),
    packLabel: row.pack_label,
    packSize: num(row.pack_size),
    supplierId: row.supplier_id,
    notes: row.notes,
    active: row.active,
  }
}

export function toRecipeLine(row: Row<'pur_recipe_lines'>): PurRecipeLine {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    quantity: num(row.quantity),
    unit: row.unit,
    inHouse: row.in_house,
    note: row.note,
    sortOrder: row.sort_order,
  }
}

export function toRecipe(
  row: Row<'pur_recipes'> & { pur_recipe_lines?: Row<'pur_recipe_lines'>[] },
): PurRecipe {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    variant: row.variant,
    baseGuests: row.base_guests,
    notes: row.notes,
    active: row.active,
    lines: (row.pur_recipe_lines ?? [])
      .map(toRecipeLine)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es')),
  }
}

export function toEventPlan(row: Row<'pur_event_plans'>): PurEventPlan {
  return {
    scheduledEventId: row.scheduled_event_id,
    recipeId: row.recipe_id,
    guests: row.guests,
    skip: row.skip,
  }
}

export function toCalendarEvent(row: {
  scheduled_event_id: string
  event_date: string
  starts_at_local: string | null
  name: string
  template_id: string | null
  capacity: number | null
  reserved_guests: number | null
}): CalendarEvent {
  return {
    id: row.scheduled_event_id,
    date: row.event_date,
    startsAt: row.starts_at_local ? row.starts_at_local.slice(0, 5) : null,
    name: row.name,
    templateId: row.template_id,
    capacity: row.capacity,
    reservedGuests: row.reserved_guests ?? 0,
  }
}

export function toCount(row: Row<'pur_counts'>): PurCount {
  return {
    id: row.id,
    kind: oneOf<CountKind>(row.kind, COUNT_KINDS, 'order'),
    countDate: row.count_date,
    eventsUntil: row.events_until,
    countedByName: row.counted_by_name,
    status: oneOf<CountStatus>(row.status, ['open', 'sent', 'discarded'], 'open'),
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }
}

export function toCountLine(
  row: Pick<Row<'pur_count_lines'>, 'item_id' | 'state' | 'quantity'>,
): PurCountLine {
  return {
    itemId: row.item_id,
    state: oneOf<CountState>(row.state, COUNT_STATES, 'exact'),
    quantity: num(row.quantity),
  }
}

export function toOrderLine(row: Row<'pur_order_lines'>): PurOrderLine {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    unit: row.unit,
    packLabel: row.pack_label,
    packSize: num(row.pack_size),
    countedQty: num(row.counted_qty),
    countState: row.count_state ? oneOf<CountState>(row.count_state, COUNT_STATES, 'exact') : null,
    targetQty: num(row.target_qty),
    eventQty: num(row.event_qty) ?? 0,
    eventNames: row.event_names ?? [],
    inTransitQty: num(row.in_transit_qty) ?? 0,
    suggestedPacks: num(row.suggested_packs),
    orderedPacks: num(row.ordered_packs),
    confirmedPacks: num(row.confirmed_packs),
    receivedState: row.received_state
      ? oneOf<ReceivedState>(row.received_state, ['ok', 'partial', 'missing'], 'ok')
      : null,
    receivedPacks: num(row.received_packs),
    addedByHand: row.added_by_hand,
    sortOrder: row.sort_order,
  }
}

export function toOrder(
  row: Row<'pur_orders'> & { pur_order_lines?: Row<'pur_order_lines'>[] },
): PurOrder {
  return {
    id: row.id,
    countId: row.count_id,
    supplierId: row.supplier_id,
    status: oneOf<OrderStatus>(row.status, ORDER_STATUSES, 'draft'),
    expectedDate: row.expected_date,
    supplierNote: row.supplier_note,
    kitchenNote: row.kitchen_note,
    message: row.message,
    sentAt: row.sent_at,
    confirmedAt: row.confirmed_at,
    confirmedWithChanges: row.confirmed_with_changes,
    receivedAt: row.received_at,
    receivedByName: row.received_by_name,
    closedAt: row.closed_at,
    discardedAt: row.discarded_at,
    discardReason:
      row.discard_reason === 'skipped' || row.discard_reason === 'superseded'
        ? row.discard_reason
        : null,
    createdAt: row.created_at,
    lines: (row.pur_order_lines ?? [])
      .map(toOrderLine)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es')),
  }
}
