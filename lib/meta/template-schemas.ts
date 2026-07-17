import { z } from 'zod'
import { extractPositionalVars, isContiguousFrom1 } from './template-components'

export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export const createTemplateSchema = z
  .object({
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
    // Un ejemplo por cada variable {{n}} del cuerpo, en orden.
    bodyExamples: z.array(z.string().trim().min(1, 'Completá el ejemplo.')).default([]),
    headerText: z
      .string()
      .trim()
      .max(60, 'El encabezado no puede superar los 60 caracteres.')
      .optional(),
    headerExample: z.string().trim().max(60, 'Ejemplo demasiado largo.').optional(),
    footerText: z.string().trim().max(60, 'El pie no puede superar los 60 caracteres.').optional(),
    // Botón de baja (quick reply) — recomendado para marketing.
    optOut: z.boolean().default(false),
    optOutLabel: z
      .string()
      .trim()
      .min(1, 'El texto del botón es requerido.')
      .max(25, 'Máximo 25 caracteres.')
      .default('No recibir promociones'),
    // Botón de enlace opcional.
    urlButtonText: z.string().trim().max(25, 'Máximo 25 caracteres.').optional(),
    urlButtonUrl: z.string().trim().url('URL inválida.').max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    const bodyVars = extractPositionalVars(data.bodyText)
    if (!isContiguousFrom1(bodyVars)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bodyText'],
        message: 'Usá las variables en orden: {{1}}, {{2}}, {{3}}…',
      })
    }
    if (bodyVars.length !== data.bodyExamples.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['bodyExamples'],
        message: `Completá un ejemplo por cada variable del cuerpo (${bodyVars.length}).`,
      })
    }

    const headerVars = data.headerText ? extractPositionalVars(data.headerText) : []
    if (headerVars.length > 1 || (headerVars.length === 1 && headerVars[0] !== 1)) {
      ctx.addIssue({
        code: 'custom',
        path: ['headerText'],
        message: 'El encabezado admite una sola variable y debe ser {{1}}.',
      })
    }
    if (headerVars.length === 1 && !data.headerExample?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['headerExample'],
        message: 'Completá el ejemplo del encabezado.',
      })
    }

    if (data.footerText && extractPositionalVars(data.footerText).length > 0) {
      ctx.addIssue({ code: 'custom', path: ['footerText'], message: 'El pie no admite variables.' })
    }

    if (data.urlButtonText && !data.urlButtonUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['urlButtonUrl'],
        message: 'Completá la URL del botón.',
      })
    }
    if (data.urlButtonUrl && !data.urlButtonText) {
      ctx.addIssue({
        code: 'custom',
        path: ['urlButtonText'],
        message: 'Completá el texto del botón.',
      })
    }
  })

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>

export const deleteTemplateSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  channel_id: z.string().uuid('El channel_id debe ser un UUID válido.'),
})

export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema>
