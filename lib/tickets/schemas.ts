import { z } from 'zod'

const ticketIdSchema = z.string().uuid()
const reasonSchema = z.string().trim().min(1, 'Motivo requerido').max(200)

export const acceptTicketSchema = z.object({ ticket_id: ticketIdSchema })

export const rejectTicketSchema = z.object({
  ticket_id: ticketIdSchema,
  reason: reasonSchema,
})

export const updateTicketStatusSchema = z.object({
  ticket_id: ticketIdSchema,
  new_status: z.enum(['preparing', 'ready', 'served']),
})

export const cancelTicketItemSchema = z.object({
  ticket_item_id: z.string().uuid(),
  reason: reasonSchema,
})

export const addStaffTicketSchema = z.object({
  session_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        menu_item_id: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(50),
        notes: z.string().trim().max(200).optional().nullable(),
        assigned_to_guest_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1, 'El ticket no puede estar vacío'),
  assigned_to_guest_id: z.string().uuid().nullable().optional(),
})
