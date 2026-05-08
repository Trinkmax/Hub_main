import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email inválido')
  .max(160, 'Email demasiado largo')

/**
 * Mínimo razonable para una app interna de bar:
 *  - 8+ caracteres
 *  - al menos una letra y un número
 * Sin obligar símbolos para no fricción del staff.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .max(72, 'Máximo 72 caracteres')
  .refine((v) => /[a-zA-Z]/.test(v), 'Tiene que tener al menos una letra')
  .refine((v) => /\d/.test(v), 'Tiene que tener al menos un número')

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Ingresá tu contraseña').max(72),
  redirectTo: z.string().optional(),
})

export const requestResetSchema = z.object({
  email: emailSchema,
})

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
    /**
     * Solo requerido cuando NO venimos de un magic link de recovery
     * (la action lo valida según la cookie `hub_recovery_flow`).
     */
    currentPassword: z.string().optional(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm'],
  })

export type SignInInput = z.infer<typeof signInSchema>
export type RequestResetInput = z.infer<typeof requestResetSchema>
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>
