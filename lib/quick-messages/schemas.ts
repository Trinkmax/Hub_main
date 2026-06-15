import { z } from 'zod'

export const quickMessageCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'El título es requerido')
    .max(80, 'El título no puede superar 80 caracteres'),
  shortcut: z
    .string()
    .trim()
    .min(1, 'El atajo es requerido')
    .max(40, 'El atajo no puede superar 40 caracteres')
    .regex(
      /^[a-z0-9_-]{1,40}$/,
      'El atajo solo puede contener letras minúsculas, números, guiones y guiones bajos',
    ),
  body: z
    .string()
    .trim()
    .min(1, 'El cuerpo del mensaje es requerido')
    .max(1024, 'El cuerpo no puede superar 1024 caracteres'),
})

export const quickMessageUpdateSchema = quickMessageCreateSchema.extend({
  id: z.string().uuid('ID inválido'),
})

export type QuickMessageCreate = z.infer<typeof quickMessageCreateSchema>
export type QuickMessageUpdate = z.infer<typeof quickMessageUpdateSchema>
