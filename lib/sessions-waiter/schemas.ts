import { z } from 'zod'

export const QR_TOKEN_REGEX = /^[A-Za-z0-9]{16}$/

const partySizeField = z.coerce
  .number()
  .int('Tiene que ser un número entero')
  .min(1, 'Cargá al menos 1 comensal')
  .max(100, 'Máximo 100 comensales')

const sourceField = z.enum(['scan', 'manual'])

// Alias opcional. El RPC también valida; acá hacemos preflight para feedback inmediato.
const aliasField = z
  .union([
    z.string().trim().max(60, 'Máximo 60 caracteres'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => {
    if (typeof v !== 'string') return null
    const trimmed = v.trim()
    return trimmed.length === 0 ? null : trimmed
  })

export const activateByQrSchema = z.object({
  qrToken: z.string().regex(QR_TOKEN_REGEX, 'QR inválido'),
  partySize: partySizeField,
  source: sourceField.default('scan'),
  alias: aliasField.optional(),
})

export const activateByIdSchema = z.object({
  physicalTableId: z.string().uuid('Mesa inválida'),
  partySize: partySizeField,
  source: sourceField.default('manual'),
  alias: aliasField.optional(),
})

export const updatePartySizeSchema = z.object({
  sessionId: z.string().uuid('Sesión inválida'),
  partySize: partySizeField,
})

export const updateAliasSchema = z.object({
  sessionId: z.string().uuid('Sesión inválida'),
  alias: aliasField,
})

export type ActivateByQrInput = z.infer<typeof activateByQrSchema>
export type ActivateByIdInput = z.infer<typeof activateByIdSchema>
export type UpdatePartySizeInput = z.infer<typeof updatePartySizeSchema>
export type UpdateAliasInput = z.infer<typeof updateAliasSchema>
