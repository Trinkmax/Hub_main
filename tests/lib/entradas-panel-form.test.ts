import { describe, expect, it } from 'vitest'
import {
  experienceToFormValues,
  finalizeSlug,
  formatPesosInput,
  invalidFormMessage,
  isExperienceFieldPath,
  parsePesosInput,
  pesosFieldValue,
  pesosToInput,
  priceExample,
  sanitizePesosTyping,
  sanitizeSlugInput,
  sectionsWithErrors,
  uploadErrorMessage,
} from '@/app/(manager)/[tenantSlug]/entradas/_lib/experience-form'
import type { AdminExperience } from '@/lib/ticketing/queries'
import { experienceFormSchema } from '@/lib/ticketing/schemas'

/**
 * El editor de una película trabaja en pesos (el dueño nunca ve centavos) y la
 * acción vuelve a validar con `experienceFormSchema`, que pasa a centavos.
 */

const nbsp = (s: string) => s.replace(/\s/g, ' ')

describe('pesos', () => {
  it('lo que se tipea: solo números y separadores', () => {
    expect(sanitizePesosTyping('$ 35.000')).toBe('35.000')
    expect(sanitizePesosTyping('35 mil')).toBe('35')
  })

  it('se leen como los escribe el dueño, siempre enteros', () => {
    expect(parsePesosInput('35000')).toBe(35000)
    expect(parsePesosInput('35.000')).toBe(35000)
    expect(parsePesosInput('$ 35.000,50')).toBe(35000)
    expect(parsePesosInput('35000.50')).toBe(35000)
    expect(parsePesosInput('1.500')).toBe(1500)
    expect(parsePesosInput('0')).toBe(0)
  })

  it('vacío o sin números: null', () => {
    expect(parsePesosInput('')).toBeNull()
    expect(parsePesosInput('$')).toBeNull()
  })

  it('se muestran con puntos de miles', () => {
    expect(pesosToInput(35000)).toBe('35.000')
    expect(pesosToInput(1500000)).toBe('1.500.000')
    expect(pesosToInput(0)).toBe('0')
    expect(pesosToInput(null)).toBe('')
    expect(pesosToInput(-5)).toBe('')
    expect(formatPesosInput('35000')).toBe('35.000')
    expect(formatPesosInput('nada')).toBe('')
  })

  it('el valor del campo puede venir como número o como texto', () => {
    expect(pesosFieldValue('35.000')).toBe(35000)
    expect(pesosFieldValue(5000)).toBe(5000)
    expect(pesosFieldValue(undefined)).toBeNull()
  })

  it('lo que muestra el campo lo entiende el schema del server (pesos → centavos)', () => {
    const base = experienceToFormValues(EXPERIENCE)
    const parsed = experienceFormSchema.parse({
      ...base,
      price: formatPesosInput('42000'),
      deposit: formatPesosInput('7000'),
    })
    expect(parsed.price).toBe(4_200_000)
    expect(parsed.deposit).toBe(700_000)
  })
})

describe('el link', () => {
  it('mientras se tipea: minúsculas, sin tildes, espacios a guiones', () => {
    expect(sanitizeSlugInput('Ratatouille Ñoño')).toBe('ratatouille-nono')
    expect(sanitizeSlugInput('Shrek 2!!')).toBe('shrek-2')
    expect(sanitizeSlugInput('--hola')).toBe('hola')
    expect(sanitizeSlugInput('a  --  b')).toBe('a-b')
  })

  it('deja el guion del final para poder seguir escribiendo', () => {
    expect(sanitizeSlugInput('shrek-')).toBe('shrek-')
    expect(finalizeSlug('shrek-')).toBe('shrek')
  })

  it('nunca pasa de 60 caracteres', () => {
    expect(sanitizeSlugInput('a'.repeat(80))).toHaveLength(60)
  })
})

const EXPERIENCE: AdminExperience = {
  id: '6f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  slug: 'shrek',
  title: 'Shrek',
  series: 'Cine y degustación',
  tagline: null,
  synopsis: 'Un ogro, un burro y una princesa.',
  scheduleNote: 'Ingreso 21:00 · Película 21:20',
  posterUrl: 'https://x.supabase.co/storage/v1/object/public/landing-media/t/p.webp',
  heroUrl: null,
  accent: '#c0573e',
  steps: [
    { icon: '🧅', title: 'Cebollas', description: null, label: null },
    { icon: null, title: 'Postre del pantano', description: 'Verde.', label: 'Final · Postre' },
  ],
  stepsNote: null,
  gallery: [{ url: 'https://x.supabase.co/a.webp', caption: null, kind: 'venue' }],
  priceCents: 3_500_000,
  depositCents: 500_000,
  cashPriceCents: null,
  minPartySize: 1,
  maxPartySize: 10,
  priceNote: null,
  terms: null,
  functions: [],
  published: true,
  templateId: '7f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  templateName: 'Shrek',
  templateColor: '#40ed54',
  sortOrder: 0,
  updatedAt: '2026-10-26T12:00:00Z',
}

describe('experienceToFormValues', () => {
  it('pesos y textos vacíos en vez de centavos y null', () => {
    const values = experienceToFormValues(EXPERIENCE)
    expect(values.price).toBe('35.000')
    expect(values.deposit).toBe('5.000')
    expect(values.tagline).toBe('')
    expect(values.hero_url).toBe('')
    expect(values.steps[0]).toEqual({ icon: '🧅', title: 'Cebollas', description: '', label: '' })
    expect(values.gallery[0]).toEqual({
      url: 'https://x.supabase.co/a.webp',
      caption: '',
      kind: 'venue',
    })
  })

  it('sin tocar nada, el server guarda exactamente lo que había', () => {
    const parsed = experienceFormSchema.safeParse(experienceToFormValues(EXPERIENCE))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.price).toBe(EXPERIENCE.priceCents)
    expect(parsed.data.deposit).toBe(EXPERIENCE.depositCents)
    expect(parsed.data.tagline).toBeNull()
    expect(parsed.data.hero_url).toBeNull()
    expect(parsed.data.poster_url).toBe(EXPERIENCE.posterUrl)
    expect(parsed.data.steps).toEqual(EXPERIENCE.steps)
    expect(parsed.data.gallery).toEqual(EXPERIENCE.gallery)
    expect(parsed.data.max_party_size).toBe(10)
    expect(parsed.data.min_party_size).toBe(1)
    expect(parsed.data.price_note).toBeNull()
    expect(parsed.data.cash_price).toBeNull()
  })
})

describe('priceExample', () => {
  it('el ejemplo del pedido: 2 personas, seña $10.000 hoy y $60.000 en efectivo, o $70.000', () => {
    const example = priceExample({ price: '35.000', deposit: '5.000', maxPartySize: 10 })
    expect(example?.people).toBe('2 personas')
    expect(nbsp(example?.deposit?.today ?? '')).toBe('$ 10.000')
    expect(nbsp(example?.deposit?.cash ?? '')).toBe('$ 60.000')
    expect(nbsp(example?.full ?? '')).toBe('$ 70.000')
  })

  it('seña 0: solo el total', () => {
    const example = priceExample({ price: '35.000', deposit: '0', maxPartySize: 10 })
    expect(example?.deposit).toBeNull()
    expect(nbsp(example?.full ?? '')).toBe('$ 70.000')
  })

  it('una seña que no es menor que el precio no se ofrece', () => {
    expect(priceExample({ price: '5.000', deposit: '5.000', maxPartySize: 10 })?.deposit).toBeNull()
  })

  it('si el máximo por compra es 1, el ejemplo es para 1', () => {
    const example = priceExample({ price: '35.000', deposit: '5.000', maxPartySize: 1 })
    expect(example?.people).toBe('1 persona')
    expect(nbsp(example?.full ?? '')).toBe('$ 35.000')
  })

  it('con precio en efectivo: seña $10.000 hoy y $50.000 en efectivo, o $70.000', () => {
    const example = priceExample({
      price: '35.000',
      deposit: '5.000',
      cashPrice: '30.000',
      maxPartySize: 10,
      minPartySize: 2,
    })
    expect(nbsp(example?.deposit?.today ?? '')).toBe('$ 10.000')
    expect(nbsp(example?.deposit?.cash ?? '')).toBe('$ 50.000')
    expect(nbsp(example?.full ?? '')).toBe('$ 70.000')
  })

  it('con un mínimo de más de 2, el ejemplo es para el mínimo', () => {
    const example = priceExample({
      price: '35.000',
      deposit: '5.000',
      maxPartySize: 10,
      minPartySize: 4,
    })
    expect(example?.people).toBe('4 personas')
    expect(nbsp(example?.full ?? '')).toBe('$ 140.000')
  })

  it('sin precio todavía: null', () => {
    expect(priceExample({ price: '', deposit: '5.000', maxPartySize: 10 })).toBeNull()
    expect(priceExample({ price: '0', deposit: '', maxPartySize: 10 })).toBeNull()
  })
})

describe('avisos del editor', () => {
  it('las secciones con errores, en el orden de la pantalla y sin repetir', () => {
    expect(sectionsWithErrors(['price', 'title', 'steps.2.title', 'deposit'])).toEqual([
      'Textos',
      'Precios',
      'Menú',
    ])
    expect(sectionsWithErrors(['algo-raro'])).toEqual([])
  })

  it('una frase que se entiende', () => {
    expect(invalidFormMessage(['slug'])).toBe('Revisá Textos antes de guardar.')
    expect(invalidFormMessage(['gallery.0.url', 'price', 'title'])).toBe(
      'Revisá Textos, Precios y Fotos antes de guardar.',
    )
    expect(invalidFormMessage([], 'publicar')).toBe('Revisá lo marcado en rojo antes de publicar.')
  })

  it('reconoce los campos del formulario, también los anidados', () => {
    expect(isExperienceFieldPath('slug')).toBe(true)
    expect(isExperienceFieldPath('steps.0.title')).toBe(true)
    expect(isExperienceFieldPath('tenant_id')).toBe(false)
  })

  it('al subir una imagen: los avisos propios tal cual, lo demás en castellano', () => {
    expect(
      uploadErrorMessage(new Error('La imagen pesa más de 10 MB. Reducila antes de subir.')),
    ).toBe('La imagen pesa más de 10 MB. Reducila antes de subir.')
    expect(uploadErrorMessage(new Error('new row violates row-level security policy'))).toBe(
      'No pudimos subir la imagen. Revisá la conexión y probá de nuevo.',
    )
    expect(uploadErrorMessage('???')).toBe(
      'No pudimos subir la imagen. Revisá la conexión y probá de nuevo.',
    )
  })
})
