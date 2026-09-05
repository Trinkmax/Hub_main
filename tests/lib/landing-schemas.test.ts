import { describe, expect, it } from 'vitest'
import {
  checkSlugFormat,
  LANDING_HTML_MAX_CHARS,
  landingCreateSchema,
  landingHtmlSchema,
  landingSettingsSchema,
  suggestLandingSlug,
} from '@/lib/landings/schemas'

const UUID = '11111111-2222-4333-8444-555555555555'

/**
 * El slug es la parte delicada: se convierte en una URL pública y GLOBAL
 * (hubbar.com.ar/p/<slug>), así que lo que pase por acá termina en el link que
 * el bar pega en una historia de Instagram.
 */
describe('landingCreateSchema', () => {
  it('acepta un alta normal', () => {
    const parsed = landingCreateSchema.safeParse({
      title: '  Halloween 2026  ',
      slug: 'Halloween-2026',
    })
    expect(parsed.success).toBe(true)
    // El título se recorta y el slug baja a minúsculas solo.
    expect(parsed.data?.title).toBe('Halloween 2026')
    expect(parsed.data?.slug).toBe('halloween-2026')
  })

  it('rechaza el slug con espacios, acentos o símbolos', () => {
    for (const slug of ['promo jueves', 'promoción', 'promo_jueves', 'promo/jueves', 'promo!']) {
      expect(landingCreateSchema.safeParse({ title: 'x', slug }).success).toBe(false)
    }
  })

  it('rechaza un slug de una sola letra y uno de más de 40', () => {
    expect(landingCreateSchema.safeParse({ title: 'x', slug: 'a' }).success).toBe(false)
    expect(landingCreateSchema.safeParse({ title: 'x', slug: 'a'.repeat(41) }).success).toBe(false)
    expect(landingCreateSchema.safeParse({ title: 'x', slug: 'a'.repeat(40) }).success).toBe(true)
  })

  it('rechaza el slug que arranca con guion (la URL quedaría rara)', () => {
    expect(landingCreateSchema.safeParse({ title: 'x', slug: '-promo' }).success).toBe(false)
    expect(landingCreateSchema.safeParse({ title: 'x', slug: 'promo-' }).success).toBe(true)
  })

  it('exige un nombre y lo corta en 80', () => {
    expect(landingCreateSchema.safeParse({ title: '   ', slug: 'promo' }).success).toBe(false)
    expect(landingCreateSchema.safeParse({ title: 'a'.repeat(81), slug: 'promo' }).success).toBe(
      false,
    )
  })
})

describe('suggestLandingSlug', () => {
  it('propone un slug usable a partir del nombre', () => {
    expect(suggestLandingSlug('Fiesta de Halloween 🎃')).toBe('fiesta-de-halloween')
    expect(suggestLandingSlug('Promo 2x1 — Jueves')).toBe('promo-2x1-jueves')
    expect(suggestLandingSlug('Ñoquis del 29')).toBe('noquis-del-29')
  })

  it('lo que propone siempre pasa la validación (o queda vacío)', () => {
    for (const title of ['Halloween 2026', 'Carta de vinos', 'After office']) {
      expect(checkSlugFormat(suggestLandingSlug(title))).toBeNull()
    }
  })
})

describe('landingHtmlSchema', () => {
  it('acepta el HTML tal cual, sin tocarlo', () => {
    const html = '<!doctype html><html><body>  <b>Hola</b>  </body></html>'
    const parsed = landingHtmlSchema.safeParse({ id: UUID, html })
    expect(parsed.success).toBe(true)
    // Nada de trim ni de sanitización: sale igual que como entró.
    expect(parsed.data?.html).toBe(html)
  })

  it('acepta el HTML vacío (una página recién creada todavía no tiene nada)', () => {
    expect(landingHtmlSchema.safeParse({ id: UUID, html: '' }).success).toBe(true)
  })

  it('frena en el mismo techo que el CHECK de la tabla', () => {
    expect(
      landingHtmlSchema.safeParse({ id: UUID, html: 'x'.repeat(LANDING_HTML_MAX_CHARS) }).success,
    ).toBe(true)
    expect(
      landingHtmlSchema.safeParse({ id: UUID, html: 'x'.repeat(LANDING_HTML_MAX_CHARS + 1) })
        .success,
    ).toBe(false)
  })

  it('exige un id válido', () => {
    expect(landingHtmlSchema.safeParse({ id: 'no-soy-uuid', html: '' }).success).toBe(false)
  })
})

describe('landingSettingsSchema', () => {
  it('normaliza indexable desde el checkbox', () => {
    const parsed = landingSettingsSchema.safeParse({
      id: UUID,
      title: 'Promo',
      slug: 'promo',
      indexable: 'true',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.indexable).toBe(true)
  })
})

describe('checkSlugFormat', () => {
  it('devuelve null cuando está bien y un mensaje cuando no', () => {
    expect(checkSlugFormat('promo-jueves')).toBeNull()
    expect(checkSlugFormat('')).toBe('Poné el final del link')
    expect(checkSlugFormat('con espacio')).toContain('minúsculas')
  })
})
