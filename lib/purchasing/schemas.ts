import { z } from 'zod'
import {
  COUNT_KINDS,
  COUNT_STATES,
  FREQUENCIES,
  MAX_ARRIVE_DAYS_BEFORE,
  MAX_COUNT_WINDOW_DAYS,
} from './types'

/**
 * Bordes de Compras. Las actions reciben objetos (no FormData) desde componentes de cliente, siempre con
 * todas las claves: los opcionales viajan como `null` (con zod 4.4 una clave ausente en una unión con
 * `.transform` falla; ver BACKLOG).
 */

const slug = z.string().min(1).max(80)
const id = z.uuid()
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
const qty = z.number().finite().min(0).max(1_000_000)
const text = (max: number) =>
  z.string().trim().min(1, 'Falta completar').max(max, `Hasta ${max} caracteres`)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Hasta ${max} caracteres`)
    .nullable()
    .transform((v) => (v ? v : null))
const weekdays = z.array(z.number().int().min(0).max(6)).max(7)

export const startCountSchema = z.object({
  slug,
  kind: z.enum(COUNT_KINDS),
  countDate: isoDay,
  eventsUntil: isoDay,
  countedByName: text(60),
})

export const saveCountLinesSchema = z.object({
  slug,
  countId: id,
  lines: z
    .array(
      z.object({
        itemId: id,
        /** null = borrar lo marcado («cambiar»). */
        state: z.enum(COUNT_STATES).nullable(),
        quantity: qty.nullable(),
      }),
    )
    .min(1)
    .max(400),
})

export const countIdSchema = z.object({ slug, countId: id })

export const updateCountSchema = z.object({
  slug,
  countId: id,
  countedByName: text(60),
  eventsUntil: isoDay,
})

export const orderIdSchema = z.object({ slug, orderId: id })

export const draftSchema = z.object({
  slug,
  orderId: id,
  lines: z.array(z.object({ id, orderedPacks: qty.nullable() })).max(500),
  added: z.array(z.object({ itemId: id, packs: qty.positive('Poné una cantidad') })).max(50),
  supplierNote: optionalText(500),
  /** Solo para un pedido «sin proveedor»: a quién se le pide. */
  supplierId: id.nullable(),
  /** Que esos insumos queden con ese proveedor de ahora en más. */
  rememberSupplier: z.boolean(),
})

/** Un pedido nuevo a un proveedor que no tiene uno para revisar: lo arma Tex, con productos de la lista. */
/** «Sumar al pedido» desde la fecha de un evento: lo de su receta para ese proveedor. */
export const eventOrderSchema = z.object({ slug, scheduledEventId: id, supplierId: id })

export const newDraftSchema = z.object({
  slug,
  supplierId: id,
  lines: z
    .array(z.object({ itemId: id, packs: qty.positive('Poné una cantidad') }))
    .min(1, 'Sumale al menos un producto.')
    .max(50),
  supplierNote: optionalText(500),
})

export const confirmChangesSchema = z.object({
  slug,
  orderId: id,
  lines: z.array(z.object({ id, confirmedPacks: qty })).max(500),
  expectedDate: isoDay.nullable(),
  kitchenNote: optionalText(500),
})

export const receiveSchema = z.object({
  slug,
  orderId: id,
  receivedByName: text(60),
  lines: z
    .array(
      z.object({
        id,
        state: z.enum(['ok', 'partial', 'missing']),
        packs: qty.nullable(),
      }),
    )
    .max(500),
})

export const itemSchema = z.object({
  slug,
  id: id.nullable(),
  code: optionalText(20),
  name: text(80),
  brand: optionalText(60),
  zoneId: id.nullable(),
  unit: text(20),
  frequency: z.enum(FREQUENCIES),
  targetQty: qty.nullable(),
  packLabel: optionalText(60),
  packSize: z.number().finite().positive().max(1_000_000).nullable(),
  supplierId: id.nullable(),
  notes: optionalText(500),
  active: z.boolean(),
})

export const zoneSchema = z.object({
  slug,
  id: id.nullable(),
  name: text(60),
  area: optionalText(40),
})

export const zoneOrderSchema = z.object({ slug, ids: z.array(id).min(1).max(100) })

export const zoneDeleteSchema = z.object({ slug, id })

export const supplierSchema = z.object({
  slug,
  id: id.nullable(),
  name: text(80),
  contactName: optionalText(60),
  /** Como lo escriben: «351 555-1234», «+54 9 351…». Se normaliza en la action. */
  whatsapp: optionalText(30),
  deliveryWeekdays: weekdays,
  leadDays: z.number().int().min(0).max(14),
  notes: optionalText(500),
  active: z.boolean(),
})

/** Unir o soltar una razón social de Administración. */
export const supplierPartySchema = z.object({ slug, supplierId: id, partyId: id })

export const recipeSchema = z.object({
  slug,
  id: id.nullable(),
  templateId: id.nullable(),
  name: text(80),
  variant: text(40),
  baseGuests: z.number().int().min(1).max(1000),
  notes: optionalText(500),
  active: z.boolean(),
})

export const recipeLinesSchema = z.object({
  slug,
  recipeId: id,
  lines: z
    .array(
      z.object({
        itemId: id.nullable(),
        name: text(80),
        quantity: z.number().finite().positive().max(1_000_000).nullable(),
        unit: optionalText(20),
        inHouse: z.boolean(),
        note: optionalText(300),
      }),
    )
    .max(200),
})

export const recipeDeleteSchema = z.object({ slug, id })

export const eventPlanSchema = z.object({
  slug,
  scheduledEventId: id,
  recipeId: id.nullable(),
  guests: z.number().int().min(1).max(5000).nullable(),
  skip: z.boolean(),
})

/** `{0: 4, 3: 5}`: por día de conteo, cuántos días después termina su ventana de eventos. */
const countWindows = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      days: z.number().int().min(0).max(MAX_COUNT_WINDOW_DAYS),
    }),
  )
  .max(7)

export const settingsSchema = z.object({
  slug,
  countWeekdays: weekdays,
  countWindows,
  arriveDaysBefore: z.number().int().min(0).max(MAX_ARRIVE_DAYS_BEFORE),
  recipeBaseGuests: z.number().int().min(1).max(1000),
  reviewerName: optionalText(40),
  senderName: optionalText(60),
})
