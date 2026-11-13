/**
 * El borde de «Precios»: lo que el navegador le puede mandar al servidor. Todo en centavos
 * enteros, entre 0 y 1e12 (el mismo tope que el CHECK de la base).
 */

import { z } from 'zod'
import { PERCENT_BP_MAX, PERCENT_BP_MIN } from './bulk'
import { pointKey } from './types'

/** El tope de `menu_items.price_cents` y de `menu_item_branches.price_cents`. */
export const PRICE_MAX_CENTS = 1_000_000_000_000
/** Hasta cuántos precios en un pedido: una carta grande con varias sucursales entra holgada. */
export const MAX_CHANGES = 3_000

const cents = z.number().int().min(0).max(PRICE_MAX_CENTS)

const priceChange = z.object({
  itemId: z.guid(),
  /** Vacío = el precio de la carta. */
  branchId: z.guid().nullable(),
  /** En una sucursal, `null` = volver al precio de la carta. */
  priceCents: cents.nullable(),
  /** Lo que la persona veía escrito ahí. */
  expectedCents: cents.nullable(),
})

/** Por qué se cambian: un precio a mano, deshacer, volver al de la carta, un aumento. */
export const PRICE_REASONS = ['edit', 'undo', 'reset', 'bulk', 'bulk_undo'] as const
export type PriceReason = (typeof PRICE_REASONS)[number]

export const applyPriceChangesSchema = z
  .object({
    changes: z.array(priceChange).min(1).max(MAX_CHANGES),
    reason: z.enum(PRICE_REASONS),
    /** Solo en un aumento: con qué se armó, para la auditoría. */
    bulk: z
      .object({
        percentBp: z.number().int().min(PERCENT_BP_MIN).max(PERCENT_BP_MAX),
        roundingCents: z.number().int().min(0).max(100_000_000),
        scope: z.enum(['all', 'categories']),
        categoryCount: z.number().int().min(0).max(10_000),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const [index, change] of value.changes.entries()) {
      // El precio de la carta no puede quedar vacío, ni se lo veía vacío.
      if (
        change.branchId === null &&
        (change.priceCents === null || change.expectedCents === null)
      ) {
        ctx.addIssue({ code: 'custom', path: ['changes', index], message: 'Falta el precio.' })
      }
      const key = pointKey(change.branchId, change.itemId)
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['changes', index], message: 'Precio repetido.' })
      }
      seen.add(key)
    }
  })

export type ApplyPriceChangesInput = z.infer<typeof applyPriceChangesSchema>

export const setAvailabilitySchema = z.object({
  branchId: z.guid(),
  itemIds: z.array(z.guid()).min(1).max(MAX_CHANGES),
  available: z.boolean(),
})

export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>

export const priceHistorySchema = z.object({
  /** Vacío = los últimos cambios de toda la carta. */
  itemId: z.guid().nullable(),
})
