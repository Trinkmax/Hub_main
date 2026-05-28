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

const staffTicketItemSchema = z.object({
  menuItemId: z.string().uuid('Ítem inválido'),
  quantity: z.coerce
    .number()
    .int('Cantidad debe ser entero')
    .min(1, 'Mínimo 1')
    .max(50, 'Máximo 50 por ítem'),
  notes: z
    .union([z.string().trim().max(200, 'Notas muy largas'), z.literal(''), z.null(), z.undefined()])
    .transform((v) => {
      if (typeof v !== 'string') return null
      const t = v.trim()
      return t.length === 0 ? null : t
    })
    .optional(),
})

export const addStaffTicketSchema = z.object({
  sessionId: z.string().uuid('Sesión inválida'),
  assignedToGuestId: z
    .union([z.string().uuid('Guest inválido'), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' ? v : null))
    .optional(),
  items: z.array(staffTicketItemSchema).min(1, 'Agregá al menos un ítem'),
})

export type ActivateByQrInput = z.infer<typeof activateByQrSchema>
export type ActivateByIdInput = z.infer<typeof activateByIdSchema>
export type UpdatePartySizeInput = z.infer<typeof updatePartySizeSchema>
export type UpdateAliasInput = z.infer<typeof updateAliasSchema>
export type AddStaffTicketInput = z.infer<typeof addStaffTicketSchema>
