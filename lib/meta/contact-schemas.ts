import { z } from 'zod'

const uuidSchema = z.string().uuid()

const templateSchema = z.object({
  name: z.string().min(1),
  language: z.string().min(2),
  variables: z.array(z.string()),
})

/**
 * Input de contactCustomer.
 *
 * Restricciones semánticas:
 * - Al menos uno de customer_id / phone debe estar presente.
 * - Exactamente uno de body / template debe estar presente (no ambos, no ninguno).
 */
export const contactCustomerInputSchema = z
  .object({
    customer_id: uuidSchema.optional(),
    phone: z.string().optional(),
    body: z.string().trim().min(1).max(4096).optional(),
    template: templateSchema.optional(),
  })
  .superRefine((val, ctx) => {
    // Validar destinatario
    if (!val.customer_id && !val.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requiere customer_id o phone.',
        path: ['customer_id'],
      })
    }

    // Validar contenido: exactamente uno
    const hasBody = val.body !== undefined
    const hasTemplate = val.template !== undefined

    if (!hasBody && !hasTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requiere body o template.',
        path: ['body'],
      })
    }

    if (hasBody && hasTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Solo se puede enviar body o template, no ambos.',
        path: ['body'],
      })
    }
  })

export type ContactCustomerInput = z.infer<typeof contactCustomerInputSchema>
