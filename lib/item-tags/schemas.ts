import { z } from 'zod'

const nameField = z.string().trim().min(1, 'Requerido').max(40, 'Máximo 40')
const colorField = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (ej: #94a3b8)')
  .default('#94a3b8')

export const createItemTagSchema = z.object({
  name: nameField,
  color: colorField,
})

export const updateItemTagSchema = z.object({
  id: z.string().uuid(),
  name: nameField,
  color: colorField,
})

export const tagIdSchema = z.object({ id: z.string().uuid() })

export const assignTagSchema = z.object({
  menu_item_id: z.string().uuid(),
  tag_id: z.string().uuid(),
})

// Reemplaza el set completo de tags asignadas a un ítem. tag_ids puede ser
// vacío (significa "borrar todas las tags de este ítem").
export const setItemTagsSchema = z.object({
  menu_item_id: z.string().uuid(),
  tag_ids: z.array(z.string().uuid()).max(50),
})

// Aplica (agrega o quita) un set de tags a varios ítems a la vez. Ambas listas
// deben tener al menos un elemento — sin ítems o sin tags no hay nada que hacer.
export const bulkItemTagsSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1).max(1000),
  tag_ids: z.array(z.string().uuid()).min(1).max(50),
})
