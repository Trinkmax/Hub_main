import { isValidPhoneNumber } from 'libphonenumber-js'
import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'
import { SERVICE_ALERTS, type ServiceAlert } from './alerts'
import { TABLE_LABEL_MAX } from './types'

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

/**
 * HH:MM(:SS) con rango real: 00–23 h, 00–59 min. La versión vieja era
 * `\d{2}:\d{2}` y dejaba pasar "25:99" — un `<input type="time">` no lo puede
 * generar, pero una Server Action es un endpoint público y ahí llegaba hasta
 * Postgres para explotar como error crudo de la base.
 */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

const timeField = z
  .string()
  .regex(TIME_RE, 'Horario inválido (HH:MM)')
  .transform((v) => (v.length === 5 ? `${v}:00` : v))

/**
 * Hora opcional. Tres estados, y los tres importan:
 *   - `'21:30'` → `'21:30:00'` (cargada)
 *   - `''` o `null` → `null` (el usuario la vació a propósito)
 *   - ausente (`undefined`) → se queda `undefined`, y la action NO toca la columna
 *
 * Ese tercer caso es el que evita un borrado silencioso: `panelPayload` del
 * quick-view manda un payload completo cada vez que alguien mueve la hora o las
 * personas desde el popup. Si `undefined` colapsara a `null`, cada uno de esos
 * toques borraría el horario de fin sin que nadie se entere.
 */
const optionalTimeField = z
  .union([z.string().regex(TIME_RE, 'Horario inválido (HH:MM)'), z.literal(''), z.null()])
  .transform((v) => (v ? (v.length === 5 ? `${v}:00` : v) : null))
  .optional()

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v && v.length > 0 ? String(v) : null))

// ──────────────────────────────────────────────────────────
// Reservas
// ──────────────────────────────────────────────────────────

/**
 * Avisos de servicio. Multi-select, así que llega como array — pero un form
 * HTML con un solo chip marcado manda un string suelto y con ninguno no manda
 * la clave. Los tres casos tienen que dar un array.
 *
 * `.optional()` por fuera a propósito: ausente se queda `undefined` y la action
 * NO toca la columna. Es la misma defensa que el horario de fin — `panelPayload`
 * del quick-view manda un payload completo cada vez que se mueve la hora o las
 * personas, y si `undefined` colapsara a `[]`, cada uno de esos toques borraría
 * el aviso de que la mesa 4 es celíaca.
 */
const serviceAlertsField = z
  .union([z.array(z.enum(SERVICE_ALERTS)), z.enum(SERVICE_ALERTS), z.literal(''), z.null()])
  .transform((v) => (!v ? [] : Array.isArray(v) ? v : [v]) as ServiceAlert[])
  .optional()

/**
 * Checkbox/Switch tolerante al borde. `z.coerce.boolean()` NO sirve acá: el
 * string `'false'` que manda un FormData es truthy y daría `true`.
 */
const checkboxField = z
  .union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('on'), z.literal('')])
  .transform((v) => v === true || v === 'true' || v === 'on')
  .optional()

/**
 * Torta elegida del catálogo del bar. Tres estados, y los tres importan — misma
 * defensa que el horario de fin:
 *   - `'<uuid>'` → la eligieron
 *   - `''` o `null` → la sacaron a propósito (o dejaron de traer torta)
 *   - ausente (`undefined`) → la action NO toca la columna
 *
 * Sin ese tercer caso, cada vez que alguien mueve la hora o las personas desde
 * el popup del listado (que manda un payload completo) se borraría la torta y
 * la cocina se quedaría sin saber cuál hacer.
 */
const cakeOptionField = z
  .union([z.string().uuid('Torta inválida'), z.literal(''), z.null()])
  .transform((v) => (v ? v : null))
  .optional()

/**
 * Mesa asignada en el servicio. Texto libre corto ("12", "12+13", "Barra"):
 * se normalizan espacios internos y se recorta. Mismo tri-estado que la torta:
 *   - `'12'` → `'12'` (asignada)
 *   - `''` o `null` → `null` (la quitaron a propósito)
 *   - ausente → `undefined` (la action no toca la columna)
 */
export const tableLabelField = z
  .union([z.string().max(80), z.literal(''), z.null()])
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null
    const cleaned = v.trim().replace(/\s+/g, ' ')
    if (cleaned === '') return null
    if (cleaned.length > TABLE_LABEL_MAX) {
      ctx.addIssue({ code: 'custom', message: `Máximo ${TABLE_LABEL_MAX} caracteres` })
      return z.NEVER
    }
    return cleaned
  })
  .optional()

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
    reservation_end_time_local: optionalTimeField,
    zone: salonZoneEnum,
    scheduled_event_id: z.string().uuid().optional().nullable(),
    // Para reservas especiales (cumple/recibida) que piden un formato calendarizado
    // que puede NO estar programado ese día. Si está seteado y no hay instance,
    // la Server Action crea una ad-hoc via ensure_scheduled_event_for_template.
    requested_template_id: z.string().uuid().optional().nullable(),

    estimated_guests: z.coerce.number().int().min(1).max(99),

    cake_count: z.coerce.number().int().min(0).max(2).default(0),
    cake_option_id: cakeOptionField,
    champagne_count: z.coerce.number().int().min(0).max(2).default(0),
    deposit_cents: z.coerce.number().int().min(0).default(0),

    origin: reservationOriginEnum.default('whatsapp'),
    primary_manager_id: z.string().uuid({ message: 'Asignar gestor' }),
    assistant_manager_id: z.string().uuid().optional().nullable(),
    comments: optionalText(2000).optional(),
    service_alerts: serviceAlertsField,
    highlight_comment: checkboxField,
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
    reservation_end_time_local: optionalTimeField,
    zone: salonZoneEnum,
    scheduled_event_id: z.string().uuid().optional().nullable(),

    estimated_guests: z.coerce.number().int().min(1).max(99),
    actual_guests: z.union([z.coerce.number().int().min(1).max(99), z.null()]).optional(),

    cake_count: z.coerce.number().int().min(0).max(2).default(0),
    cake_option_id: cakeOptionField,
    champagne_count: z.coerce.number().int().min(0).max(2).default(0),
    deposit_cents: z.coerce.number().int().min(0).default(0),

    origin: reservationOriginEnum,
    primary_manager_id: z.string().uuid(),
    assistant_manager_id: z.string().uuid().optional().nullable(),
    comments: optionalText(2000).optional(),
    service_alerts: serviceAlertsField,
    highlight_comment: checkboxField,
    table_label: tableLabelField,
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
  /**
   * Mesa asignada en el mismo gesto que "Llegó": la anfitriona cuenta a la
   * gente y decide dónde va en el mismo momento. Ausente = no se toca.
   */
  table_label: tableLabelField,
})

/** Asignar / cambiar / quitar la mesa sin tocar nada más de la reserva. */
export const reservationTableLabelSchema = z.object({
  id: z.string().uuid(),
  table_label: tableLabelField,
})
export type ReservationTableLabelInput = z.infer<typeof reservationTableLabelSchema>

/**
 * "Pasar lista": el barrido de fin de noche. Una fila por reserva con la
 * cantidad que realmente vino.
 *
 * El tope de 200 no es defensivo por gusto: es una Server Action pública y el
 * guardado hace una llamada al RPC por fila. Un array de 10.000 sería un
 * timeout garantizado y un candidato a abuso.
 */
export const bulkActualGuestsSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().uuid(),
        actual_guests: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1, 'No hay nada para guardar')
    .max(200, 'Demasiadas reservas en una sola pasada'),
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

// Alta rápida de formato (staff) desde el alta de reservas — campos mínimos.
// El slug se genera server-side; consume_special_reservations queda en false.
export const quickTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre').max(80),
  default_capacity: z
    .union([z.coerce.number().int().min(1).max(9999), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null))
    .optional()
    .transform((v) => v ?? null),
  default_meal_type: mealTypeEnum.default('dinner'),
  color_hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (#RRGGBB)')
    .default('#7c3aed'),
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
  // Puntos de fidelización que gana quien asiste (reserva cerrada/sentada).
  attendance_points: z.coerce.number().int().min(0).max(100000).default(0),
  notes: optionalText(500).optional(),
})

// ──────────────────────────────────────────────────────────
// Tortas de cumpleaños
// ──────────────────────────────────────────────────────────

/**
 * Una opción del menú de tortas. Los rellenos llegan como array desde el editor
 * (un input por relleno); se limpian los vacíos antes de validar el largo, así
 * que una fila en blanco al final no rompe el guardado.
 */
export const cakeOptionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Poné un nombre (ej. "Opción 1")').max(80),
  base: z.string().trim().min(1, 'Poné el bizcochuelo').max(120),
  fillings: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : [v]).map((f) => f.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.string().max(120, 'Relleno demasiado largo'))
        .min(1, 'Poné al menos un relleno')
        .max(4, 'Máximo 4 rellenos'),
    ),
  position: z.coerce.number().int().min(0).max(999).default(0),
  active: z
    .union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('on'), z.literal('')])
    .transform((v) => v === true || v === 'true' || v === 'on')
    .default(true),
})

export const idOnlySchema = z.object({ id: z.string().uuid() })

export const moveScheduledEventSchema = z.object({
  id: z.string().uuid(),
  event_date: dateField,
})

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
export type QuickTemplateInput = z.infer<typeof quickTemplateSchema>
export type ScheduledEventInput = z.infer<typeof scheduledEventSchema>
export type MoveScheduledEventInput = z.infer<typeof moveScheduledEventSchema>
export type ManagerInput = z.infer<typeof managerSchema>
export type RateTierInput = z.infer<typeof rateTierSchema>
export type BonusRuleInput = z.infer<typeof bonusRuleSchema>
export type ZoneCapacityOverrideInput = z.infer<typeof zoneCapacityOverrideSchema>
export type ZoneCapacityDefaultsInput = z.infer<typeof zoneCapacityDefaultsSchema>
export type MarkPaidInput = z.infer<typeof markPaidSchema>
export type CakeOptionInput = z.infer<typeof cakeOptionSchema>
