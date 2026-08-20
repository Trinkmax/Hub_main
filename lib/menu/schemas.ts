import { z } from 'zod'

const categoryImageUrl = z
  .union([z.string().trim().url().max(2048), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v && v.length > 0 ? v : null))

// parent_id: guid o null/'' (raíz). '' y undefined → null.
const parentId = z
  .union([z.guid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(60, 'Máximo 60'),
  image_url: categoryImageUrl.optional().default(null),
  parent_id: parentId,
})

export const moveCategorySchema = z.object({
  id: z.guid(),
  parent_id: z.guid().nullable(),
})

export const reorderCategoriesSchema = z.object({
  parent_id: z.guid().nullable(),
  ids: z.array(z.guid()).min(1),
})

export const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  active: z.coerce.boolean(),
  image_url: categoryImageUrl,
})

export const createMenuItemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z
    .union([z.string().trim().max(300), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  price_cents: z.coerce.number().int().min(0).max(1_000_000_000_000),
  // Vacío = sin override. Los vacíos van ANTES del número: `z.coerce.number()`
  // convierte `''` y `null` en 0 y la union se queda con la primera rama que
  // pasa, así que con el número adelante todo ítem sin override se guardaba en 0
  // y la carta pública le colgaba un chip "+0 pts". Mismo criterio que
  // `optionalNumber` en lib/points/schemas.ts.
  points_override: z
    .union([z.literal(''), z.null(), z.undefined(), z.coerce.number().int()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  image_url: z
    .union([z.string().trim().url().max(2048), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  // Video del ítem (bucket menu-images, path `..._v.{ext}`). '' → null,
  // mismo patrón que image_url.
  video_url: z
    .union([z.string().trim().url().max(2048), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? v : null)),
  // Campos opcionales del rediseño 2026 — featured (destacados) y tag_ids
  // (asignación inicial de tags). Mantienen compat con consumers que no los
  // pasen (default false / []).
  featured: z.coerce.boolean().optional().default(false),
  tag_ids: z.array(z.string().uuid()).max(50).optional().default([]),
})

export const updateMenuItemSchema = createMenuItemSchema.extend({
  id: z.string().uuid(),
  active: z.coerce.boolean(),
})

export const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
})

// Mover varios ítems a una categoría destino de una sola vez.
export const moveItemsSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1).max(1000),
  target_category_id: z.string().uuid(),
})

export const reorderItemsSchema = reorderSchema.extend({
  category_id: z.string().uuid(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>
