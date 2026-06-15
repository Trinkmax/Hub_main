import { z } from 'zod'

export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1, 'El nombre es requerido.')
    .max(512, 'El nombre no puede superar los 512 caracteres.')
    .regex(
      /^[a-z0-9_]+$/,
      'Solo letras minúsculas, números y guiones bajos (sin espacios ni mayúsculas).',
    ),
  language: z
    .string()
    .min(2, 'El idioma es requerido.')
    .max(20, 'Código de idioma demasiado largo.'),
  category: z.enum(TEMPLATE_CATEGORIES, {
    error: () => 'Categoría inválida.',
  }),
  bodyText: z
    .string()
    .min(1, 'El cuerpo del mensaje es requerido.')
    .max(1024, 'El cuerpo no puede superar los 1024 caracteres.'),
  headerText: z.string().max(60, 'El encabezado no puede superar los 60 caracteres.').optional(),
  footerText: z.string().max(60, 'El pie no puede superar los 60 caracteres.').optional(),
})

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>

export const deleteTemplateSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  channel_id: z.string().uuid('El channel_id debe ser un UUID válido.'),
})

export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema>
