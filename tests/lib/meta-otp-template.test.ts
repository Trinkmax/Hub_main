import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/meta/crypto', () => ({ decryptToken: vi.fn(async () => 'TOKEN') }))
vi.mock('@/lib/meta/env', () => ({
  graphUrl: (path: string) => `https://graph.facebook.com/v23.0/${path}`,
}))
vi.mock('@/lib/meta/http', () => ({ metaFetch: vi.fn() }))

import { buildOtpTemplateComponents } from '@/lib/meta/templates'

describe('buildOtpTemplateComponents', () => {
  it('es la estructura AUTHENTICATION que exige Meta: cuerpo fijo, pie con vencimiento y botón de copiar', () => {
    const components = buildOtpTemplateComponents({
      codeExpirationMinutes: 10,
      buttonText: 'Copiar código',
    })
    expect(components).toEqual([
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }],
      },
    ])
  })
})
