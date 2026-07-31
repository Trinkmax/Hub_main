import { afterEach, describe, expect, it } from 'vitest'
import {
  buildClubOtpConversationPreview,
  buildClubOtpTemplateVariables,
  buildClubOtpText,
  countTemplateBodyVariables,
  getClubOtpTemplateName,
} from '@/lib/club-auth/message'

const CODE = '493021'

afterEach(() => {
  // `= undefined` no sirve: Node lo guarda como el string "undefined".
  delete process.env.CLUB_OTP_TEMPLATE_NAME
})

describe('buildClubOtpText', () => {
  it('saluda por nombre, nombra el bar y lleva el código', () => {
    const text = buildClubOtpText({ firstName: 'Ana', tenantName: 'HUB', code: CODE })
    expect(text).toContain('Hola Ana')
    expect(text).toContain('HUB')
    expect(text).toContain(CODE)
  })

  it('cae en un saludo neutro si el socio no tiene nombre cargado', () => {
    const text = buildClubOtpText({ firstName: null, tenantName: 'HUB', code: CODE })
    expect(text.startsWith('Hola,')).toBe(true)
    expect(text).not.toContain('Hola ,')
  })

  it('ignora un nombre que es sólo espacios', () => {
    const text = buildClubOtpText({ firstName: '   ', tenantName: 'HUB', code: CODE })
    expect(text.startsWith('Hola,')).toBe(true)
  })

  it('avisa el vencimiento y no manda ningún link (un OTP con link es phishing)', () => {
    const text = buildClubOtpText({ firstName: 'Ana', tenantName: 'HUB', code: CODE })
    expect(text).toContain('10 minutos')
    expect(text).not.toMatch(/https?:\/\//)
  })
})

describe('buildClubOtpTemplateVariables', () => {
  it('devuelve nombre y código en ese orden', () => {
    expect(buildClubOtpTemplateVariables({ firstName: 'Ana', code: CODE })).toEqual(['Ana', CODE])
  })

  it('nunca manda una variable vacía: Meta rechaza la plantilla', () => {
    for (const firstName of [null, '', '   ']) {
      const vars = buildClubOtpTemplateVariables({ firstName, code: CODE })
      expect(vars).toHaveLength(2)
      expect(vars[0]?.length ?? 0).toBeGreaterThan(0)
      expect(vars[1]).toBe(CODE)
    }
  })

  it('con una sola variable (plantilla AUTHENTICATION) manda sólo el código', () => {
    expect(
      buildClubOtpTemplateVariables({ firstName: 'Ana', code: CODE, variableCount: 1 }),
    ).toEqual([CODE])
  })

  it('vuelve a nombre + código si no se pudo saber cuántas variables tiene', () => {
    expect(
      buildClubOtpTemplateVariables({ firstName: 'Ana', code: CODE, variableCount: null }),
    ).toEqual(['Ana', CODE])
  })
})

describe('countTemplateBodyVariables', () => {
  it('cuenta los placeholders del BODY', () => {
    const components = [
      { type: 'HEADER', text: 'Club' },
      { type: 'BODY', text: 'Hola {{1}}, tu código es {{2}}.' },
    ]
    expect(countTemplateBodyVariables(components)).toBe(2)
  })

  it('cuenta una sola vez el placeholder repetido', () => {
    expect(countTemplateBodyVariables([{ type: 'BODY', text: '{{1}} y de nuevo {{1}}' }])).toBe(1)
  })

  it('tolera espacios adentro de las llaves', () => {
    expect(countTemplateBodyVariables([{ type: 'body', text: '{{ 1 }} y {{2}}' }])).toBe(2)
  })

  it('devuelve 0 si el BODY no tiene variables', () => {
    expect(countTemplateBodyVariables([{ type: 'BODY', text: 'Sin variables.' }])).toBe(0)
  })

  it('devuelve null cuando no hay nada que leer', () => {
    expect(countTemplateBodyVariables(null)).toBeNull()
    expect(countTemplateBodyVariables(undefined)).toBeNull()
    expect(countTemplateBodyVariables({ type: 'BODY' })).toBeNull()
    expect(countTemplateBodyVariables([{ type: 'FOOTER', text: 'x' }])).toBeNull()
  })
})

describe('getClubOtpTemplateName', () => {
  it('usa el default cuando no hay env', () => {
    expect(getClubOtpTemplateName()).toBe('hub_codigo_recuperacion')
  })

  it('respeta CLUB_OTP_TEMPLATE_NAME', () => {
    process.env.CLUB_OTP_TEMPLATE_NAME = 'bar_otp_v2'
    expect(getClubOtpTemplateName()).toBe('bar_otp_v2')
  })
})

describe('buildClubOtpConversationPreview', () => {
  it('nunca incluye el código: la bandeja del bar la ve el staff', () => {
    expect(buildClubOtpConversationPreview(null)).not.toContain(CODE)
    expect(buildClubOtpConversationPreview('hub_codigo_recuperacion')).not.toContain(CODE)
  })

  it('marca la plantilla usada cuando el envío fue fuera de la ventana de 24 h', () => {
    expect(buildClubOtpConversationPreview('hub_codigo_recuperacion')).toContain(
      '[template:hub_codigo_recuperacion]',
    )
  })
})
