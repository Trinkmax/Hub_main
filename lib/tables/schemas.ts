import { z } from 'zod'

const labelField = z.string().trim().min(1, 'Ingresá un nombre').max(40, 'Máximo 40 caracteres')

const capacityField = z
  .union([z.coerce.number().int().min(1).max(50), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'number' ? v : null))

export const createTableSchema = z.object({
  label: labelField,
  capacity: capacityField,
})

export const updateTableSchema = z.object({
  id: z.string().uuid(),
  label: labelField,
  capacity: capacityField,
})

export const tableIdSchema = z.object({
  id: z.string().uuid(),
})
