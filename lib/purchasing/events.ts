/**
 * Lo que piden los eventos del calendario. Puro.
 *
 * Cada fecha toma la receta de su formato (la variante elegida, o la única que hay) y la multiplica por
 * las personas: las que fijó quien compra, o las reservadas, y nunca menos que las de la receta («las
 * recetas están para 60 y se multiplican si el evento tiene más»).
 */
import { formatWeekdayDayMonth } from '@/lib/dates'
import type { CalendarEvent, PurEventPlan, PurItem, PurRecipe } from './types'
import { convertQty, roundQty } from './units'

export type EventPlanStatus =
  /** Suma insumos al pedido. */
  | 'sums'
  /** El formato no tiene receta: sale con lo de siempre. */
  | 'no_recipe'
  /** Tiene varias variantes y nadie eligió cuál va. */
  | 'needs_variant'
  /** Quien compra dijo que esta fecha no suma. */
  | 'skipped'
  /** La receta es solo un aviso (no tiene insumos). */
  | 'notice_only'

export type GuestsSource = 'plan' | 'reserved' | 'recipe'

export type PlannedEvent = {
  event: CalendarEvent
  /** «Shrek · mar 27/10»: así aparece en las etiquetas de la cocina y en el pedido. */
  label: string
  status: EventPlanStatus
  recipe: PurRecipe | null
  /** Todas las variantes del formato (para elegir). */
  variants: PurRecipe[]
  guests: number
  guestsSource: GuestsSource
  factor: number
  notice: string | null
}

export type EventNeed = { qty: number; events: string[] }

export type InHouseReminder = {
  eventLabel: string
  name: string
  qty: number | null
  unit: string | null
}

export type EventNeeds = {
  events: PlannedEvent[]
  /** Por insumo, en SU unidad. */
  needs: Map<string, EventNeed>
  /** Lo que se hace en el local: aparece como recordatorio, no se pide. */
  inHouse: InHouseReminder[]
}

export function eventLabel(event: Pick<CalendarEvent, 'name' | 'date'>): string {
  return `${event.name} · ${formatWeekdayDayMonth(event.date)}`
}

export function planEvent(input: {
  event: CalendarEvent
  recipes: readonly PurRecipe[]
  plan: PurEventPlan | undefined
  baseGuests: number
}): PlannedEvent {
  const { event, plan } = input
  const variants = event.templateId
    ? input.recipes.filter((r) => r.active && r.templateId === event.templateId)
    : []
  const chosen = plan?.recipeId ? (variants.find((r) => r.id === plan.recipeId) ?? null) : null
  const recipe = chosen ?? (variants.length === 1 ? (variants[0] ?? null) : null)
  const base = recipe?.baseGuests ?? input.baseGuests
  const reserved = Math.max(0, event.reservedGuests)
  const guests = plan?.guests ?? Math.max(reserved, base)
  const guestsSource: GuestsSource = plan?.guests ? 'plan' : reserved > base ? 'reserved' : 'recipe'
  const purchasable = recipe?.lines.some((l) => !l.inHouse) ?? false

  let status: EventPlanStatus
  if (plan?.skip) status = 'skipped'
  else if (!variants.length) status = 'no_recipe'
  else if (!recipe) status = 'needs_variant'
  else if (!purchasable && !recipe.lines.length) status = 'notice_only'
  else status = 'sums'

  return {
    event,
    label: eventLabel(event),
    status,
    recipe,
    variants,
    guests,
    guestsSource,
    factor: guests / base,
    notice: recipe?.notes ?? null,
  }
}

export function computeEventNeeds(input: {
  events: readonly CalendarEvent[]
  recipes: readonly PurRecipe[]
  plans: readonly PurEventPlan[]
  items: ReadonlyMap<string, PurItem>
  baseGuests: number
}): EventNeeds {
  const planByEvent = new Map(input.plans.map((p) => [p.scheduledEventId, p]))
  const needs = new Map<string, EventNeed>()
  const inHouse: InHouseReminder[] = []
  const events = input.events.map((event) =>
    planEvent({
      event,
      recipes: input.recipes,
      plan: planByEvent.get(event.id),
      baseGuests: input.baseGuests,
    }),
  )

  for (const planned of events) {
    if (planned.status !== 'sums' || !planned.recipe) continue
    for (const line of planned.recipe.lines) {
      if (line.inHouse) {
        inHouse.push({
          eventLabel: planned.label,
          name: line.name,
          qty: line.quantity == null ? null : roundQty(line.quantity * planned.factor),
          unit: line.unit,
        })
        continue
      }
      if (!line.itemId || line.quantity == null) continue
      const item = input.items.get(line.itemId)
      if (!item?.active) continue
      // Si la receta usa otra unidad y no hay cuenta segura (unidad contra kg), suma como viene y queda
      // en «Datos para corregir»: es lo que hacía la planilla y no esconde el pedido.
      const qty = convertQty(line.quantity, line.unit, item.unit) ?? line.quantity
      const prev = needs.get(item.id)
      const amount = roundQty(qty * planned.factor)
      if (prev) {
        prev.qty = roundQty(prev.qty + amount)
        if (!prev.events.includes(planned.label)) prev.events.push(planned.label)
      } else {
        needs.set(item.id, { qty: amount, events: [planned.label] })
      }
    }
  }

  return { events, needs, inHouse }
}
