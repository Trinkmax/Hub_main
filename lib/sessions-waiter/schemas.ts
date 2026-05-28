import { z } from 'zod'

export const QR_TOKEN_REGEX = /^[A-Za-z0-9]{16}$/

const partySizeField = z.coerce
  .number()
  .int('Tiene que ser un número entero')
  .min(1, 'Cargá al menos 1 comensal')
  .max(100, 'Máximo 100 comensales')

const sourceField = z.enum(['scan', 'manual'])

export const activateByQrSchema = z.object({
  qrToken: z.string().regex(QR_TOKEN_REGEX, 'QR inválido'),
  partySize: partySizeField,
  source: sourceField.default('scan'),
})

export const activateByIdSchema = z.object({
  physicalTableId: z.string().uuid('Mesa inválida'),
  partySize: partySizeField,
  source: sourceField.default('manual'),
})

export const updatePartySizeSchema = z.object({
  sessionId: z.string().uuid('Sesión inválida'),
  partySize: partySizeField,
})

export type ActivateByQrInput = z.infer<typeof activateByQrSchema>
export type ActivateByIdInput = z.infer<typeof activateByIdSchema>
export type UpdatePartySizeInput = z.infer<typeof updatePartySizeSchema>
