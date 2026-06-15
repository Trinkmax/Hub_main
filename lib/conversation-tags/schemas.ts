import { z } from 'zod'

const nameField = z.string().trim().min(1, 'Requerido').max(40, 'Máximo 40 caracteres')
const colorField = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (ej: #94a3b8)')
  .default('#94a3b8')

export const createConversationTagSchema = z.object({
  name: nameField,
  color: colorField,
})

export const tagIdSchema = z.object({ id: z.string().uuid('ID inválido') })

export const setConversationTagsSchema = z.object({
  conversation_id: z.string().uuid('ID de conversación inválido'),
  tag_ids: z.array(z.string().uuid()).max(50, 'Máximo 50 etiquetas'),
})
