import { describe, expect, it } from 'vitest'
import { parseRatingFilter, reviewSettingsSchema } from '@/lib/reviews/schemas'

describe('parseRatingFilter', () => {
  it('acepta 1..5 como string del searchParam', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(parseRatingFilter(String(n))).toBe(n)
    }
  })

  it('cualquier basura cae en "todas" (undefined), no rompe la página', () => {
    for (const raw of [undefined, null, '', '  ', '0', '6', '-1', '4.5', 'cinco', ['5']]) {
      expect(parseRatingFilter(raw)).toBeUndefined()
    }
  })
})

describe('reviewSettingsSchema — WhatsApp de feedback', () => {
  const base = {
    google_maps_review_url: 'https://g.page/r/abc/review',
    review_gating_enabled: true,
    review_reward_points: 10,
  }

  it('normaliza a E.164 lo que el dueño escriba a mano', () => {
    const parsed = reviewSettingsSchema.parse({
      ...base,
      feedback_whatsapp_phone: '351 283-9101',
    })
    expect(parsed.feedback_whatsapp_phone).toBe('+5493512839101')
  })

  it('vacío = null (el botón de WhatsApp no se muestra)', () => {
    for (const raw of ['', '   ', null, undefined]) {
      expect(
        reviewSettingsSchema.parse({ ...base, feedback_whatsapp_phone: raw })
          .feedback_whatsapp_phone,
      ).toBeNull()
    }
  })

  it('un número inválido falla en vez de guardarse como null silencioso', () => {
    const res = reviewSettingsSchema.safeParse({ ...base, feedback_whatsapp_phone: '123' })
    expect(res.success).toBe(false)
  })
})
