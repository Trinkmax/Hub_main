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

/**
 * Paleta curada de la UI nueva. Evita el hex crudo (`<input type="color">`) que
 * dejaba elegir colores ilegibles sobre los tokens OKLCH del tema. Los tags
 * viejos con hex arbitrario siguen validando por `colorField` (creación legacy);
 * la edición sólo ofrece estos 10.
 */
export const TAG_COLORS = [
  '#94a3b8', // slate
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // amber
  '#4ade80', // green
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
] as const

export type TagColor = (typeof TAG_COLORS)[number]

const paletteColor = z
  .string()
  .refine((c): c is TagColor => (TAG_COLORS as readonly string[]).includes(c), {
    message: 'Elegí un color de la paleta',
  })

export const updateConversationTagSchema = z.object({
  id: z.string().uuid('ID inválido'),
  name: nameField,
  color: paletteColor,
})
