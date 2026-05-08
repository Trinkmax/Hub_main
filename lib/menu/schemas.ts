import { z } from 'zod'

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(60, 'Máximo 60'),
})

export const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  active: z.coerce.boolean(),
})

export const createMenuItemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z
    .union([z.string().trim().max(300), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  price_cents: z.coerce.number().int().min(0).max(1_000_000_000_000),
  points_override: z
    .union([z.coerce.number().int(), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
})

export const updateMenuItemSchema = createMenuItemSchema.extend({
  id: z.string().uuid(),
  active: z.coerce.boolean(),
})

export const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
})

export const reorderItemsSchema = reorderSchema.extend({
  category_id: z.string().uuid(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>
