/**
 * Compras: los tipos del dominio, ya en camelCase (las consultas traducen las filas `pur_*`).
 * Ver docs/features/compras.md.
 *
 * Cantidades: lo que se cuenta va en la UNIDAD del insumo (kg, L, unidad…). Lo que se pide va en
 * PRESENTACIONES («3» = tres «Caja x 150 u»); `packSize` dice cuántas unidades trae cada una.
 */

export type Frequency = 'frequent' | 'secondary' | 'occasional'
export const FREQUENCIES: readonly Frequency[] = ['frequent', 'secondary', 'occasional']
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  frequent: 'Frecuente',
  secondary: 'Secundario',
  occasional: 'Eventual',
}
export const FREQUENCY_HINTS: Record<Frequency, string> = {
  frequent: 'Aparece en todos los conteos.',
  secondary: 'Se cuenta una vez por mes.',
  occasional: 'Solo cuando un evento lo pide.',
}

/** Alcanza · Poco (número opcional) · No hay · el número exacto (lo que pide un evento). */
export type CountState = 'enough' | 'low' | 'none' | 'exact'
export const COUNT_STATES: readonly CountState[] = ['enough', 'low', 'none', 'exact']

export type CountKind = 'order' | 'top_up'
export const COUNT_KINDS: readonly CountKind[] = ['order', 'top_up']
export const COUNT_KIND_LABELS: Record<CountKind, string> = { order: 'Pedido', top_up: 'Refuerzo' }

export type CountStatus = 'open' | 'sent' | 'discarded'

export type OrderStatus =
  | 'draft'
  | 'sent'
  | 'confirmed'
  | 'with_differences'
  | 'completed'
  | 'discarded'
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Para revisar',
  sent: 'Enviado',
  confirmed: 'Confirmado',
  with_differences: 'Con diferencias',
  completed: 'Completado',
  discarded: 'Descartado',
}

export type ReceivedState = 'ok' | 'partial' | 'missing'

export type PurSettings = {
  /** 0 = domingo … 6 = sábado. */
  countWeekdays: number[]
  recipeBaseGuests: number
  reviewerName: string | null
  senderName: string | null
  /** «Poco» sin número = esta fracción del objetivo. */
  lowFraction: number
}

export const DEFAULT_SETTINGS: PurSettings = {
  countWeekdays: [1, 3],
  recipeBaseGuests: 60,
  reviewerName: null,
  senderName: null,
  lowFraction: 0.5,
}

export type PurZone = {
  id: string
  name: string
  area: string | null
  sortOrder: number
  active: boolean
}

export type PurSupplier = {
  id: string
  name: string
  contactName: string | null
  /** Dígitos con el país, para wa.me: 5493511234567. */
  whatsapp: string | null
  deliveryWeekdays: number[]
  leadDays: number
  notes: string | null
  accPartyId: string | null
  active: boolean
}

export type PurItem = {
  id: string
  code: string | null
  name: string
  brand: string | null
  zoneId: string | null
  unit: string
  frequency: Frequency
  targetQty: number | null
  packLabel: string | null
  packSize: number | null
  supplierId: string | null
  notes: string | null
  active: boolean
}

export type PurRecipeLine = {
  id: string
  itemId: string | null
  name: string
  quantity: number | null
  unit: string | null
  inHouse: boolean
  note: string | null
  sortOrder: number
}

export type PurRecipe = {
  id: string
  templateId: string | null
  name: string
  variant: string
  baseGuests: number
  notes: string | null
  active: boolean
  lines: PurRecipeLine[]
}

export type PurEventPlan = {
  scheduledEventId: string
  recipeId: string | null
  guests: number | null
  skip: boolean
}

/** Una fecha del calendario, como la devuelve `pur_events_between`. */
export type CalendarEvent = {
  id: string
  date: string
  startsAt: string | null
  name: string
  templateId: string | null
  capacity: number | null
  reservedGuests: number
}

export type PurCount = {
  id: string
  kind: CountKind
  countDate: string
  eventsUntil: string
  countedByName: string
  status: CountStatus
  sentAt: string | null
  createdAt: string
}

export type PurCountLine = {
  itemId: string
  state: CountState
  quantity: number | null
}

export type PurOrderLine = {
  id: string
  itemId: string | null
  name: string
  unit: string
  packLabel: string | null
  packSize: number | null
  countedQty: number | null
  countState: CountState | null
  targetQty: number | null
  eventQty: number
  eventNames: string[]
  inTransitQty: number
  suggestedPacks: number | null
  orderedPacks: number | null
  confirmedPacks: number | null
  receivedState: ReceivedState | null
  receivedPacks: number | null
  addedByHand: boolean
  sortOrder: number
}

export type PurOrder = {
  id: string
  countId: string | null
  supplierId: string | null
  status: OrderStatus
  expectedDate: string | null
  supplierNote: string | null
  kitchenNote: string | null
  message: string | null
  sentAt: string | null
  confirmedAt: string | null
  confirmedWithChanges: boolean
  receivedAt: string | null
  receivedByName: string | null
  closedAt: string | null
  discardedAt: string | null
  discardReason: 'skipped' | 'superseded' | null
  createdAt: string
  lines: PurOrderLine[]
}

/** Lo que trae cada pedido en camino: lo confirmado o, si no hubo confirmación, lo pedido. */
export function expectedPacks(line: Pick<PurOrderLine, 'confirmedPacks' | 'orderedPacks'>): number {
  return line.confirmedPacks ?? line.orderedPacks ?? 0
}
