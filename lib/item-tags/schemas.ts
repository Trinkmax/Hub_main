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
