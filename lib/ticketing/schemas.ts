import { isValidPhoneNumber } from 'libphonenumber-js'
import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'
import { pesosToCents } from './pricing'
import type { ExperienceStep, GalleryItem } from './types'

/**
 * Los bordes de las entradas online (CLAUDE.md §6): lo que manda el panel, lo
 * que manda la página pública y lo que se lee de los jsonb de la base.
 */

// ──────────────────────────────────────────────
// Piezas
// ──────────────────────────────────────────────

/** «mi-entrada» es la ruta de la entrada del cliente: no puede ser una película. */
export const RESERVED_EXPERIENCE_SLUGS = new Set(['mi-entrada'])

export const experienceSlugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'Solo minúsculas, números y guiones (2 a 60).')
  .refine((s) => !RESERVED_EXPERIENCE_SLUGS.has(s), 'Ese nombre de link está reservado.')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))

/** Imágenes: solo https (las sube el panel al bucket público del bar). */
const imageUrlField = z
  .string()
  .trim()
  .max(600)
  .refine((v) => /^https:\/\/\S+$/i.test(v), 'La imagen tiene que ser un link https.')

const optionalImageUrl = z
  .union([imageUrlField, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v ? v : null))

export const accentField = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido')
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null))

export const experienceStepSchema = z.object({
  icon: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .transform((v) => (v ? v : null)),
  title: z.string().trim().min(1, 'Poné el nombre del paso').max(60, 'Máximo 60 caracteres'),
  description: optionalText(240),
  label: optionalText(24),
})

export const galleryItemSchema = z.object({
  url: imageUrlField,
  caption: optionalText(140),
  kind: z.enum(['scene', 'venue']).default('scene'),
})

/** Pesos enteros como los escribe el dueño («35000» o «35.000»). */
const pesosField = (label: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const raw = typeof v === 'number' ? v : Number(v.replace(/\./g, '').replace(',', '.').trim())
    if (!Number.isFinite(raw) || raw < 0) {
      ctx.addIssue({ code: 'custom', message: `${label}: escribí un monto en pesos` })
      return z.NEVER
    }
    return pesosToCents(raw)
  })

// ──────────────────────────────────────────────
// Panel — la página de una película
// ──────────────────────────────────────────────

export const experienceFormSchema = z
  .object({
    id: z.string().uuid(),
    slug: experienceSlugField,
    published: z.boolean(),
    series: optionalText(60),
    title: z.string().trim().min(1, 'Poné el título').max(80, 'Máximo 80 caracteres'),
    tagline: optionalText(160),
    synopsis: optionalText(1500),
    schedule_note: optionalText(120),
    poster_url: optionalImageUrl,
    hero_url: optionalImageUrl,
    accent_hex: accentField,
    steps: z.array(experienceStepSchema).max(16, 'Máximo 16 pasos'),
    steps_note: optionalText(400),
    gallery: z.array(galleryItemSchema).max(24, 'Máximo 24 fotos'),
    price: pesosField('Precio'),
    deposit: pesosField('Seña'),
    min_party_size: z.coerce
      .number({ error: 'Poné desde cuántas personas se vende' })
      .int('Tiene que ser un número entero')
      .min(1, 'Al menos 1 persona por compra')
      .max(30, 'Máximo 30 personas por compra'),
    max_party_size: z.coerce
      .number({ error: 'Poné cuántas personas como máximo por compra' })
      .int('Tiene que ser un número entero')
      .min(1, 'Al menos 1 persona por compra')
      .max(30, 'Máximo 30 personas por compra'),
    price_note: optionalText(140),
    terms: optionalText(800),
  })
  .superRefine((v, ctx) => {
    if (v.price < 100) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'Poné el precio por persona.' })
    }
    if (v.deposit > 0 && v.deposit >= v.price) {
      ctx.addIssue({
        code: 'custom',
        path: ['deposit'],
        message: 'La seña tiene que ser menor que el precio.',
      })
    }
    if (v.min_party_size > v.max_party_size) {
      ctx.addIssue({
        code: 'custom',
        path: ['min_party_size'],
        message: 'El mínimo no puede ser más que el máximo.',
      })
    }
  })

export type ExperienceFormInput = z.input<typeof experienceFormSchema>
export type ExperienceFormValues = z.output<typeof experienceFormSchema>

/** Pesos opcionales al crear una película (vacío = como la última cargada). */
const optionalPesosAmount = (label: string) =>
  z
    .number({ error: `${label}: escribí un monto en pesos` })
    .finite(`${label}: escribí un monto en pesos`)
    .min(0, `${label}: no puede ser negativo`)
    .max(1_000_000, `${label}: revisá el monto`)
    .nullish()

export const createExperienceSchema = z.object({
  template_id: z.string().uuid('Elegí un formato del calendario.'),
  price: optionalPesosAmount('Precio'),
  deposit: optionalPesosAmount('Seña'),
})

// ──────────────────────────────────────────────
// Panel — configuración y Mercado Pago
// ──────────────────────────────────────────────

const optionalPhoneField = z.union([z.string(), z.null(), z.undefined()]).transform((v, ctx) => {
  const trimmed = (v ?? '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+') && isValidPhoneNumber(trimmed)) return trimmed
  const normalized = tryNormalizePhone(trimmed)
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido' })
    return z.NEVER
  }
  return normalized
})

export const ticketingSettingsSchema = z.object({
  headline: optionalText(80),
  intro: optionalText(500),
  venue_address: optionalText(160),
  contact_whatsapp: optionalPhoneField,
  hold_minutes: z.coerce
    .number({ error: 'Poné cuántos minutos se guarda el lugar' })
    .int('Tiene que ser un número entero')
    .min(5, 'Al menos 5 minutos')
    .max(60, 'Como mucho 60 minutos'),
  online_manager_id: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type TicketingSettingsInput = z.input<typeof ticketingSettingsSchema>

export const mercadoPagoCredentialsSchema = z.object({
  access_token: z
    .string()
    .trim()
    .regex(
      /^(APP_USR|TEST)-[A-Za-z0-9-]{20,200}$/,
      'El Access Token empieza con «APP_USR-» (o «TEST-» si es de prueba).',
    ),
  webhook_secret: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^[A-Za-z0-9]{16,200}$/.test(v),
      'La clave secreta no parece válida.',
    ),
})

// ──────────────────────────────────────────────
// Página pública — la compra
// ──────────────────────────────────────────────

const guestPhoneField = z
  .string()
  .trim()
  .min(1, 'Dejanos tu WhatsApp')
  .transform((v, ctx) => {
    if (v.startsWith('+') && isValidPhoneNumber(v)) return v
    const normalized = tryNormalizePhone(v)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Ese WhatsApp no parece válido' })
      return z.NEVER
    }
    return normalized
  })

export const checkoutSchema = z.object({
  tenant_slug: z.string().trim().min(1).max(60),
  experience_slug: experienceSlugField,
  event_id: z.string().uuid('Elegí una fecha'),
  party_size: z.coerce.number().int().min(1, 'Elegí cuántos van').max(30),
  option: z.enum(['deposit', 'full']),
  guest_name: z
    .string()
    .trim()
    .min(2, 'Escribí el nombre de la reserva')
    .max(120, 'Máximo 120 caracteres'),
  guest_phone: guestPhoneField,
  marketing_opt_in: z.boolean().default(false),
  // Honeypot: un humano nunca ve ni llena este campo.
  website: z.string().max(0).optional().default(''),
})

export type CheckoutInput = z.input<typeof checkoutSchema>

export const orderIdSchema = z.string().uuid()

// ──────────────────────────────────────────────
// Lectura de los jsonb (defensiva: una fila rota no tumba la página)
// ──────────────────────────────────────────────

export function parseSteps(raw: unknown): ExperienceStep[] {
  if (!Array.isArray(raw)) return []
  const out: ExperienceStep[] = []
  for (const item of raw) {
    const parsed = experienceStepSchema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function parseGallery(raw: unknown): GalleryItem[] {
  if (!Array.isArray(raw)) return []
  const out: GalleryItem[] = []
  for (const item of raw) {
    const parsed = galleryItemSchema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}
