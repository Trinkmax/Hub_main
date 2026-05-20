import { isValidPhoneNumber } from 'libphonenumber-js'
import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

// ──────────────────────────────────────────────────────────
// Field helpers (reusables)
// ──────────────────────────────────────────────────────────

const nameField = z.string().trim().min(1, 'Requerido').max(120, 'Máximo 120 caracteres')

const optionalPhoneField = z
  .union([z.string().min(1), z.literal(''), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (!v) return null
    const trimmed = String(v).trim()
    if (trimmed === '') return null
    if (trimmed.startsWith('+') && isValidPhoneNumber(trimmed)) return trimmed
    const normalized = tryNormalizePhone(trimmed)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Teléfono inválido' })
      return z.NEVER
    }
    return normalized
  })

const optionalEmailField = z
  .union([
    z.string().trim().email('Email inválido').max(160),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (v && v.length > 0 ? String(v).toLowerCase() : null))

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const timeField = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Horario inválido (HH:MM)')
  .transform((v) => (v.length === 5 ? `${v}:00` : v))

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? String(v) : null))

// ──────────────────────────────────────────────────────────
// Reservas
// ──────────────────────────────────────────────────────────

export const reservationKindEnum = z.enum(['normal', 'birthday', 'special'])
export const mealTypeEnum = z.enum(['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event'])
export const reservationOriginEnum = z.enum([
  'whatsapp',
  'instagram',
  'messenger',
  'in_person',
  'partner_referral',
])
export const salonZoneEnum = z.enum(['planta_alta', 'planta_baja', 'event_floating'])
export const salonStatusEnum = z.enum([
  'pending',
  'arrived',
  'seated',
  'closed',
  'no_show',
  'cancelled',
])

export const createSalonReservationSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    guest_name: nameField,
    guest_phone: optionalPhoneField.optional(),
    guest_email: optionalEmailField.optional(),

    kind: reservationKindEnum.default('normal'),
    meal_type: mealTypeEnum,
    reservation_date: dateField,
    reservation_time_local: timeField,
    zone: salonZoneEnum,
    scheduled_event_id: z.string().uuid().optional().nullable(),
    // Para reservas especiales (cumple/recibida) que piden un formato calendizado
    // que puede NO estar programado ese día. Si está seteado y no hay instance,
    // la Server Action crea una ad-hoc via ensure_scheduled_event_for_template.
    requested_template_id: z.string().uuid().optional().nullable(),

    estimated_guests: z.coerce.number().int().min(1).max(99),

    cake_count: z.coerce.number().int().min(0).max(2).default(0),
    champagne_count: z.coerce.number().int().min(0).max(2).default(0),
    deposit_cents: z.coerce.number().int().min(0).default(0),

    origin: reservationOriginEnum.default('whatsapp'),
    primary_manager_id: z.string().uuid({ message: 'Asignar gestor' }),
    assistant_manager_id: z.string().uuid().optional().nullable(),
    comments: optionalText(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.zone === 'event_floating' && !data.scheduled_event_id && !data.requested_template_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduled_event_id'],
        message: 'La zona "Sujeta a evento" requiere un evento programado o un formato pedido.',
      })
    }
    if (data.assistant_manager_id && data.assistant_manager_id === data.primary_manager_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['assistant_manager_id'],
        message: 'El asistente no puede ser el mismo que el gestor principal.',
      })
    }
    if (data.requested_template_id && data.kind === 'normal') {
      ctx.addIssue({
        code: 'custom',
        path: ['requested_template_id'],
        message: 'Solo Cumpleaños o Reservas especiales pueden pedir un formato ad-hoc.',
      })
    }
  })

export const updateSalonReservationSchema = z
  .object({
    id: z.string().uuid(),
    customer_id: z.string().uuid().optional().nullable(),
    guest_name: nameField,
    guest_phone: optionalPhoneField.optional(),
    guest_email: optionalEmailField.optional(),

    kind: reservationKindEnum,
    meal_type: mealTypeEnum,
    reservation_date: dateField,
    reservation_time_local: timeField,
    zone: salonZoneEnum,
    scheduled_event_id: z.string().uuid().optional().nullable(),

    estimated_guests: z.coerce.number().int().min(1).max(99),
    actual_guests: z.union([z.coerce.number().int().min(1).max(99), z.null()]).optional(),

    cake_count: z.coerce.number().int().min(0).max(2).default(0),
    champagne_count: z.coerce.number().int().min(0).max(2).default(0),
    deposit_cents: z.coerce.number().int().min(0).default(0),

    origin: reservationOriginEnum,
    primary_manager_id: z.string().uuid(),
    assistant_manager_id: z.string().uuid().optional().nullable(),
    comments: optionalText(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.zone === 'event_floating' && !data.scheduled_event_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduled_event_id'],
        message: 'La zona "Sujeta a evento" requiere un evento programado.',
      })
    }
    if (data.assistant_manager_id && data.assistant_manager_id === data.primary_manager_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['assistant_manager_id'],
        message: 'El asistente no puede ser el mismo que el gestor principal.',
      })
    }
  })

export const transitionStatusSchema = z.object({
  id: z.string().uuid(),
  to: salonStatusEnum,
  actual_guests: z.union([z.coerce.number().int().min(1).max(99), z.null()]).optional(),
})

export const actualGuestsSchema = z.object({
  id: z.string().uuid(),
  actual_guests: z.coerce.number().int().min(1).max(99),
})

export const cancelReservationSchema = z.object({
  id: z.string().uuid(),
  reason: optionalText(280).optional(),
})

// ──────────────────────────────────────────────────────────
// Eventos programados + templates
// ──────────────────────────────────────────────────────────

export const scheduledTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'Slug inválido (a-z, 0-9, guiones)'),
  consume_special_reservations: z.coerce.boolean().default(true),
  default_capacity: z.coerce.number().int().min(1).max(9999).optional().nullable(),
  default_meal_type: mealTypeEnum.default('dinner'),
  color_hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (#RRGGBB)')
    .default('#7c3aed'),
  active: z.coerce.boolean().default(true),
})

export const scheduledEventSchema = z.object({
  id: z.string().uuid().optional(),
  template_id: z.string().uuid(),
  name_override: optionalText(120).optional(),
  event_date: dateField,
  starts_at_local: timeField,
  ends_at_local: z
    .union([timeField, z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v !== '' ? (v as string) : null))
    .optional(),
  capacity: z.coerce.number().int().min(1).max(999),
  meal_type: mealTypeEnum,
  full_bonus_active: z.coerce.boolean().default(true),
  notes: optionalText(500).optional(),
})

export const idOnlySchema = z.object({ id: z.string().uuid() })

// ──────────────────────────────────────────────────────────
// Configuración: gestores + tarifas + capacidades
// ──────────────────────────────────────────────────────────

export const managerSchema = z.object({
  id: z.string().uuid().optional(),
  display_name: z.string().trim().min(1).max(80),
  phone: optionalPhoneField.optional(),
  email: optionalEmailField.optional(),
  commission_eligible: z.coerce.boolean().default(false),
  active: z.coerce.boolean().default(true),
  notes: optionalText(500).optional(),
  user_id: z.string().uuid().optional().nullable(),
})

export const rateTierSchema = z.object({
  id: z.string().uuid().optional(),
  meal_type: mealTypeEnum,
  min_guests: z.coerce.number().int().min(1).max(999),
  max_guests: z
    .union([z.coerce.number().int().min(1).max(999), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  rate_per_guest_cents: z.coerce.number().int().min(0).max(99_999_999),
  active: z.coerce.boolean().default(true),
})

export const bonusRuleSchema = z.object({
  id: z.string().uuid().optional(),
  scope: z.literal('scheduled_event_full').default('scheduled_event_full'),
  bonus_per_guest_cents: z.coerce.number().int().min(0).max(99_999_999),
  active: z.coerce.boolean().default(true),
})

export const zoneCapacityOverrideSchema = z.object({
  id: z.string().uuid().optional(),
  zone: salonZoneEnum.exclude(['event_floating']),
  override_date: dateField,
  capacity: z.coerce.number().int().min(0).max(999),
  reason: optionalText(280).optional(),
})

export const zoneCapacityDefaultsSchema = z.object({
  planta_alta: z.coerce.number().int().min(0).max(999),
  planta_baja: z.coerce.number().int().min(0).max(999),
})

export const markPaidSchema = z.object({
  ledger_ids: z.array(z.string().uuid()).min(1).max(500),
  paid_at: z.string().datetime().optional(),
})

// ──────────────────────────────────────────────────────────
// Inferred input types
// ──────────────────────────────────────────────────────────

export type CreateSalonReservationInput = z.infer<typeof createSalonReservationSchema>
export type UpdateSalonReservationInput = z.infer<typeof updateSalonReservationSchema>
export type TransitionStatusInput = z.infer<typeof transitionStatusSchema>
export type ActualGuestsInput = z.infer<typeof actualGuestsSchema>
export type CancelReservationInput = z.infer<typeof cancelReservationSchema>
export type ScheduledTemplateInput = z.infer<typeof scheduledTemplateSchema>
export type ScheduledEventInput = z.infer<typeof scheduledEventSchema>
export type ManagerInput = z.infer<typeof managerSchema>
export type RateTierInput = z.infer<typeof rateTierSchema>
export type BonusRuleInput = z.infer<typeof bonusRuleSchema>
export type ZoneCapacityOverrideInput = z.infer<typeof zoneCapacityOverrideSchema>
export type ZoneCapacityDefaultsInput = z.infer<typeof zoneCapacityDefaultsSchema>
export type MarkPaidInput = z.infer<typeof markPaidSchema>
