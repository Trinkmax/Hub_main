import { describe, expect, it } from 'vitest'
import {
  checkoutSchema,
  experienceFormSchema,
  mercadoPagoCredentialsSchema,
  parseGallery,
  parseSteps,
  ticketingSettingsSchema,
} from '@/lib/ticketing/schemas'

const EVENT_ID = '9331d338-a8f1-4389-91f6-62919cc630cc'

describe('checkoutSchema', () => {
  const valid = {
    tenant_slug: 'hub',
    experience_slug: 'shrek-2',
    event_id: EVENT_ID,
    party_size: 2,
    option: 'deposit' as const,
    guest_name: '  Ana Pérez ',
    guest_phone: '351 555-1234',
    marketing_opt_in: true,
  }

  it('normaliza el WhatsApp a E.164 y recorta el nombre', () => {
    const parsed = checkoutSchema.parse(valid)
    expect(parsed.guest_phone).toBe('+5493515551234')
    expect(parsed.guest_name).toBe('Ana Pérez')
    expect(parsed.website).toBe('')
  })

  it('acepta el E.164 que manda el selector de país', () => {
    expect(checkoutSchema.parse({ ...valid, guest_phone: '+34612345678' }).guest_phone).toBe(
      '+34612345678',
    )
  })

  it('pide fecha, nombre y un WhatsApp que exista', () => {
    expect(checkoutSchema.safeParse({ ...valid, event_id: '' }).success).toBe(false)
    expect(checkoutSchema.safeParse({ ...valid, guest_name: 'A' }).success).toBe(false)
    expect(checkoutSchema.safeParse({ ...valid, guest_phone: '123' }).success).toBe(false)
  })

  it('el honeypot lleno no pasa', () => {
    expect(checkoutSchema.safeParse({ ...valid, website: 'spam.com' }).success).toBe(false)
  })

  it('no acepta «mi-entrada» como película', () => {
    expect(checkoutSchema.safeParse({ ...valid, experience_slug: 'mi-entrada' }).success).toBe(
      false,
    )
  })
})

describe('experienceFormSchema', () => {
  const base = {
    id: '2b3596c8-f1a8-4383-a0c3-4a8e2ae2e1f1',
    slug: 'Shrek-2',
    published: true,
    series: 'Cine y degustación',
    title: 'Shrek 2',
    tagline: '',
    synopsis: null,
    schedule_note: 'Ingreso 21:00 · Película 21:20',
    poster_url: '',
    hero_url: null,
    accent_hex: '#4A6B2F',
    steps: [{ icon: '🥣', title: 'Rica sopa, suegrita', description: 'Sopa crema', label: '' }],
    steps_note: null,
    gallery: [{ url: 'https://x.supabase.co/storage/v1/object/public/landing-media/a.webp' }],
    price: '35.000',
    deposit: 5000,
    min_party_size: '2',
    max_party_size: '10',
    price_note: '',
    terms: null,
  }

  it('el dueño escribe pesos; se guardan centavos', () => {
    const v = experienceFormSchema.parse(base)
    expect(v.price).toBe(3_500_000)
    expect(v.deposit).toBe(500_000)
    expect(v.slug).toBe('shrek-2')
    expect(v.accent_hex).toBe('#4a6b2f')
    expect(v.tagline).toBeNull()
    expect(v.poster_url).toBeNull()
    expect(v.steps[0]?.label).toBeNull()
    expect(v.gallery[0]?.kind).toBe('scene')
    expect(v.max_party_size).toBe(10)
    expect(v.min_party_size).toBe(2)
    expect(v.price_note).toBeNull()
  })

  it('el mínimo de personas no puede pasar al máximo', () => {
    const r = experienceFormSchema.safeParse({ ...base, min_party_size: 12, max_party_size: 10 })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues[0]?.path).toEqual(['min_party_size'])
  })

  it('el precio en efectivo: pesos a centavos, vacío es null, y mayor que la seña', () => {
    expect(experienceFormSchema.parse({ ...base, cash_price: '30.000' }).cash_price).toBe(3_000_000)
    expect(experienceFormSchema.parse({ ...base, cash_price: '' }).cash_price).toBeNull()
    expect(experienceFormSchema.parse({ ...base, cash_price: null }).cash_price).toBeNull()
    const below = experienceFormSchema.safeParse({ ...base, cash_price: '5.000' })
    expect(below.success).toBe(false)
    if (!below.success) expect(below.error.issues[0]?.path).toEqual(['cash_price'])
    expect(experienceFormSchema.safeParse({ ...base, cash_price: '0' }).success).toBe(false)
  })

  it('la aclaración del total se guarda recortada y con tope de 140', () => {
    const ok = experienceFormSchema.parse({
      ...base,
      price_note: '  Las bebidas se pagan aparte. ',
    })
    expect(ok.price_note).toBe('Las bebidas se pagan aparte.')
    expect(experienceFormSchema.safeParse({ ...base, price_note: 'x'.repeat(141) }).success).toBe(
      false,
    )
  })

  it('la seña tiene que ser menor que el precio', () => {
    const r = experienceFormSchema.safeParse({ ...base, deposit: 35000 })
    expect(r.success).toBe(false)
  })

  it('sin precio no se guarda', () => {
    expect(experienceFormSchema.safeParse({ ...base, price: 0 }).success).toBe(false)
  })

  it('las imágenes tienen que ser https', () => {
    expect(
      experienceFormSchema.safeParse({ ...base, poster_url: 'javascript:alert(1)' }).success,
    ).toBe(false)
  })
})

describe('ticketingSettingsSchema', () => {
  it('normaliza el WhatsApp de consultas y acepta vacío', () => {
    expect(
      ticketingSettingsSchema.parse({ hold_minutes: '15', contact_whatsapp: '3516877882' })
        .contact_whatsapp,
    ).toBe('+5493516877882')
    expect(
      ticketingSettingsSchema.parse({ hold_minutes: 15, contact_whatsapp: '' }).contact_whatsapp,
    ).toBeNull()
  })

  it('el lugar se guarda entre 5 y 60 minutos', () => {
    expect(ticketingSettingsSchema.safeParse({ hold_minutes: 2 }).success).toBe(false)
    expect(ticketingSettingsSchema.safeParse({ hold_minutes: 90 }).success).toBe(false)
  })
})

describe('mercadoPagoCredentialsSchema', () => {
  it('acepta tokens de producción y de prueba', () => {
    expect(
      mercadoPagoCredentialsSchema.safeParse({
        access_token: 'APP_USR-1234567890123456-102612-abcdef0123456789abcdef0123456789-123456789',
      }).success,
    ).toBe(true)
    expect(
      mercadoPagoCredentialsSchema.safeParse({ access_token: 'TEST-1234567890123456-abcdef' })
        .success,
    ).toBe(true)
  })

  it('rechaza la Public Key pegada en lugar del token', () => {
    expect(mercadoPagoCredentialsSchema.safeParse({ access_token: 'APP_USR-1a2b3c' }).success).toBe(
      false,
    )
  })
})

describe('lectura defensiva de los jsonb', () => {
  it('se queda con los pasos y fotos que sirven', () => {
    expect(parseSteps([{ title: 'Ok' }, { title: '' }, 'x', null])).toEqual([
      { icon: null, title: 'Ok', description: null, label: null },
    ])
    expect(
      parseGallery([{ url: 'http://inseguro' }, { url: 'https://ok', kind: 'venue' }]),
    ).toEqual([{ url: 'https://ok', caption: null, kind: 'venue' }])
    expect(parseSteps('nada')).toEqual([])
  })
})
