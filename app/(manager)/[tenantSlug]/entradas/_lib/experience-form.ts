import { centsToPesos, formatPesos, hasDepositOption, quote } from '@/lib/ticketing/pricing'
import type { AdminExperience } from '@/lib/ticketing/queries'
import type { ExperienceFormInput } from '@/lib/ticketing/schemas'

/**
 * Los bordes del editor de una película: los pesos que tipea el dueño, el link
 * y los valores con los que arranca el formulario. Puro: sin DB ni React.
 *
 * El formulario trabaja con lo que se ve (pesos, textos vacíos) y la acción
 * `saveExperience` lo vuelve a validar con `experienceFormSchema`, que pasa
 * los pesos a centavos. Por eso acá nunca se convierte a centavos lo que se
 * manda: se haría dos veces.
 */

// ──────────────────────────────────────────────
// Pesos
// ──────────────────────────────────────────────

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g

/** Mientras se tipea: solo números y separadores (afuera «$», espacios y letras). */
export function sanitizePesosTyping(raw: string): string {
  return raw.replace(/[^\d.,]/g, '')
}

/**
 * Lo tipeado → pesos enteros (el bar nunca cobra centavos). «35.000», «35000»
 * y «$ 35.000,50» dan 35000. Vacío o ilegible → `null`.
 */
export function parsePesosInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '')
  let integer = cleaned
  const lastComma = cleaned.lastIndexOf(',')
  if (lastComma !== -1) {
    // La coma es el decimal en es-AR: lo de después son centavos y se descarta.
    integer = cleaned.slice(0, lastComma)
  } else {
    // «35000.50»: un punto con uno o dos dígitos al final es un decimal pegado.
    const decimal = /\.\d{1,2}$/.exec(cleaned)
    if (decimal) integer = cleaned.slice(0, decimal.index)
  }
  const digits = integer.replace(/\D/g, '')
  if (digits === '') return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

/** 35000 → «35.000» (lo que muestra el campo). */
export function pesosToInput(pesos: number | null | undefined): string {
  if (pesos === null || pesos === undefined || !Number.isFinite(pesos) || pesos < 0) return ''
  return String(Math.round(pesos)).replace(THOUSANDS, '.')
}

/** Al salir del campo: «35000» → «35.000»; lo ilegible queda vacío. */
export function formatPesosInput(raw: string): string {
  return pesosToInput(parsePesosInput(raw))
}

// ──────────────────────────────────────────────
// El link de la película
// ──────────────────────────────────────────────

/**
 * Mientras se tipea el link: minúsculas, sin tildes, espacios a guiones y nada
 * que no sea letra, número o guion. El guion del final se deja (si no, no se
 * puede escribir «shrek-2»).
 */
export function sanitizeSlugInput(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
}

/** Al salir del campo: lo mismo, sin guiones colgando al final. */
export function finalizeSlug(raw: string): string {
  return sanitizeSlugInput(raw).replace(/-+$/, '')
}

// ──────────────────────────────────────────────
// El formulario
// ──────────────────────────────────────────────

export const MAX_STEPS = 16
export const MAX_GALLERY = 24
export const MAX_PARTY_SIZE = 30

/** Una película de la base → lo que muestra el editor (pesos y textos vacíos en vez de null). */
export function experienceToFormValues(experience: AdminExperience): ExperienceFormInput {
  return {
    id: experience.id,
    slug: experience.slug,
    published: experience.published,
    series: experience.series ?? '',
    title: experience.title,
    tagline: experience.tagline ?? '',
    synopsis: experience.synopsis ?? '',
    schedule_note: experience.scheduleNote ?? '',
    poster_url: experience.posterUrl ?? '',
    hero_url: experience.heroUrl ?? '',
    accent_hex: experience.accent,
    steps: experience.steps.map((step) => ({
      icon: step.icon ?? '',
      title: step.title,
      description: step.description ?? '',
      label: step.label ?? '',
    })),
    steps_note: experience.stepsNote ?? '',
    gallery: experience.gallery.map((item) => ({
      url: item.url,
      caption: item.caption ?? '',
      kind: item.kind,
    })),
    price: pesosToInput(centsToPesos(experience.priceCents)),
    deposit: pesosToInput(centsToPesos(experience.depositCents)),
    min_party_size: experience.minPartySize,
    max_party_size: experience.maxPartySize,
    price_note: experience.priceNote ?? '',
    terms: experience.terms ?? '',
  }
}

/** En qué sección del editor vive cada campo (para el aviso de «revisá…»). */
const FIELD_SECTION: Record<string, string> = {
  published: 'Publicación',
  title: 'Textos',
  series: 'Textos',
  tagline: 'Textos',
  synopsis: 'Textos',
  schedule_note: 'Textos',
  slug: 'Textos',
  poster_url: 'Imágenes',
  hero_url: 'Imágenes',
  accent_hex: 'Color',
  price: 'Precios',
  deposit: 'Precios',
  min_party_size: 'Precios',
  max_party_size: 'Precios',
  price_note: 'Precios',
  steps: 'Menú',
  steps_note: 'Menú',
  gallery: 'Fotos',
  terms: 'Condiciones',
}

/** ¿Es un campo del formulario? Acepta los anidados («steps.2.title»). */
export function isExperienceFieldPath(path: string): boolean {
  const head = path.split('.')[0] ?? ''
  return head in FIELD_SECTION
}

/** Las secciones con algo para corregir, en el orden de la pantalla y sin repetir. */
export function sectionsWithErrors(fields: ReadonlyArray<string>): string[] {
  const wanted = new Set(fields.map((field) => FIELD_SECTION[field.split('.')[0] ?? '']))
  return [...new Set(Object.values(FIELD_SECTION))].filter((section) => wanted.has(section))
}

/** «Revisá Textos y Precios antes de guardar.» */
export function invalidFormMessage(fields: ReadonlyArray<string>, action = 'guardar'): string {
  const sections = sectionsWithErrors(fields)
  if (sections.length === 0) return `Revisá lo marcado en rojo antes de ${action}.`
  const list =
    sections.length === 1
      ? sections[0]
      : `${sections.slice(0, -1).join(', ')} y ${sections[sections.length - 1]}`
  return `Revisá ${list} antes de ${action}.`
}

/**
 * Lo que se le dice al dueño cuando una imagen no sube. Los avisos propios
 * (formato, peso) ya vienen en castellano; lo demás (Storage en inglés, la
 * red) se dice con palabras nuestras.
 */
export function uploadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/^(Solo imágenes|La imagen pesa)/.test(message)) return message
  return 'No pudimos subir la imagen. Revisá la conexión y probá de nuevo.'
}

/** «35.000» o 35000 (lo que tenga el campo) → pesos, o `null`. */
export function pesosFieldValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value === 'string') return parsePesosInput(value)
  return null
}

export type PriceExample = {
  /** «2 personas» */
  people: string
  /** Con seña: lo de hoy y lo que queda en efectivo. `null` si no hay seña. */
  deposit: { today: string; cash: string } | null
  /** Todo junto. */
  full: string
}

/**
 * El ejemplo de la cuenta debajo de los precios, para dos personas (o lo que
 * permitan el mínimo y el máximo por compra): «2 personas: seña $10.000 hoy y
 * $60.000 en efectivo, o $70.000 todo junto». `null` mientras no haya un
 * precio que sirva.
 */
export function priceExample(input: {
  price: unknown
  deposit: unknown
  maxPartySize: unknown
  minPartySize?: unknown
}): PriceExample | null {
  const price = pesosFieldValue(input.price)
  if (price === null || price < 1) return null
  const priceCents = price * 100
  const depositCents = (pesosFieldValue(input.deposit) ?? 0) * 100
  const max = Number(input.maxPartySize)
  const min = Number(input.minPartySize)
  let partySize = 2
  if (Number.isFinite(min) && min > partySize) partySize = Math.round(min)
  if (Number.isFinite(max) && max >= 1 && max < partySize) partySize = Math.round(max)
  const people = partySize === 1 ? '1 persona' : `${partySize} personas`
  const full = quote({ priceCents, depositCents, partySize, option: 'full' })
  if (!hasDepositOption(depositCents, priceCents)) {
    return { people, deposit: null, full: formatPesos(full.totalCents) }
  }
  const withDeposit = quote({ priceCents, depositCents, partySize, option: 'deposit' })
  return {
    people,
    deposit: {
      today: formatPesos(withDeposit.totalCents),
      cash: formatPesos(withDeposit.balanceCents),
    },
    full: formatPesos(full.totalCents),
  }
}
