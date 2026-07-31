import { describe, expect, it } from 'vitest'
import {
  clubLoginSchema,
  clubPasswordField,
  clubResetCodeField,
  clubSetPasswordSchema,
  clubVerifyCodeSchema,
} from '@/lib/club-auth/schemas'

const LINK = 'hub-club'

describe('clubPasswordField', () => {
  it('rechaza menos de 6 caracteres (mismo piso que la RPC)', () => {
    expect(clubPasswordField.safeParse('12345').success).toBe(false)
  })

  it('acepta exactamente 6', () => {
    expect(clubPasswordField.safeParse('123456').success).toBe(true)
  })

  it('rechaza más de 72 (bcrypt trunca ahí)', () => {
    expect(clubPasswordField.safeParse('a'.repeat(73)).success).toBe(false)
    expect(clubPasswordField.safeParse('a'.repeat(72)).success).toBe(true)
  })

  it('no recorta espacios: son parte de la contraseña', () => {
    const parsed = clubPasswordField.safeParse('  hola  ')
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toBe('  hola  ')
  })
})

describe('clubResetCodeField', () => {
  it('acepta 6 dígitos', () => {
    const parsed = clubResetCodeField.safeParse('493021')
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toBe('493021')
  })

  it('limpia lo que el socio pega desde WhatsApp', () => {
    for (const raw of ['493 021', '493-021', 'código: 493021']) {
      const parsed = clubResetCodeField.safeParse(raw)
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data).toBe('493021')
    }
  })

  it('rechaza códigos de largo distinto a 6', () => {
    expect(clubResetCodeField.safeParse('12345').success).toBe(false)
    expect(clubResetCodeField.safeParse('1234567').success).toBe(false)
    expect(clubResetCodeField.safeParse('abcdef').success).toBe(false)
    expect(clubResetCodeField.safeParse('').success).toBe(false)
  })
})

describe('clubLoginSchema', () => {
  it('normaliza el teléfono a E.164 antes de tocar la DB', () => {
    const parsed = clubLoginSchema.safeParse({
      link_slug: LINK,
      phone: '0351 15 555-1234',
      password: 'secreto',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.phone).toBe('+5493515551234')
  })

  it('deja pasar contraseñas cortas: la política no se filtra en el login', () => {
    const parsed = clubLoginSchema.safeParse({
      link_slug: LINK,
      phone: '3515551234',
      password: 'x',
    })
    expect(parsed.success).toBe(true)
  })

  it('rechaza contraseña vacía y teléfono inválido', () => {
    expect(
      clubLoginSchema.safeParse({ link_slug: LINK, phone: '3515551234', password: '' }).success,
    ).toBe(false)
    expect(
      clubLoginSchema.safeParse({ link_slug: LINK, phone: '123', password: 'secreto' }).success,
    ).toBe(false)
  })

  it('rechaza link slugs con caracteres raros', () => {
    expect(
      clubLoginSchema.safeParse({
        link_slug: 'hub club/../admin',
        phone: '3515551234',
        password: 'secreto',
      }).success,
    ).toBe(false)
  })
})

describe('clubVerifyCodeSchema', () => {
  it('normaliza teléfono y código a la vez', () => {
    const parsed = clubVerifyCodeSchema.safeParse({
      link_slug: LINK,
      phone: '+54 9 351 555 1234',
      code: ' 493021 ',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.phone).toBe('+5493515551234')
      expect(parsed.data.code).toBe('493021')
    }
  })
})

describe('clubSetPasswordSchema', () => {
  it('exige ticket y contraseña de al menos 6', () => {
    expect(
      clubSetPasswordSchema.safeParse({ reset_ticket: 'a'.repeat(24), password: 'secreto' })
        .success,
    ).toBe(true)
    expect(
      clubSetPasswordSchema.safeParse({ reset_ticket: 'a'.repeat(24), password: '123' }).success,
    ).toBe(false)
    expect(
      clubSetPasswordSchema.safeParse({ reset_ticket: 'corto', password: 'secreto' }).success,
    ).toBe(false)
  })
})
