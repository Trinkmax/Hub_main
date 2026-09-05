import { describe, expect, it } from 'vitest'
import {
  LANDING_CSP,
  LANDING_PREVIEW_SANDBOX,
  LANDING_SECURITY_HEADERS,
} from '@/lib/landings/security'
import nextConfig from '@/next.config'

/**
 * EL CANDADO de la feature de páginas HTML.
 *
 * Las landings las escribe una persona y se sirven desde el MISMO dominio que
 * el panel, donde viven las cookies de sesión de Supabase (que son legibles por
 * JS: `@supabase/ssr` las setea con httpOnly:false por diseño). Lo único que
 * evita que un <script> pegado adentro de una landing se lleve esa sesión es el
 * `Content-Security-Policy: sandbox` sin `allow-same-origin`.
 *
 * Si alguien borra ese header —o le agrega `allow-same-origin` para "arreglar"
 * el localStorage de una landing— estos tests tienen que ponerse en rojo.
 */

describe('LANDING_CSP', () => {
  it('sandboxea el documento', () => {
    expect(LANDING_CSP).toMatch(/^sandbox\b/)
  })

  it('NUNCA lleva allow-same-origin (sería devolverle el acceso a las cookies)', () => {
    expect(LANDING_CSP).not.toContain('allow-same-origin')
    expect(LANDING_CSP).not.toContain('allow-same-site-none-cookies')
  })

  it('deja correr lo que una landing de verdad necesita', () => {
    for (const flag of [
      'allow-scripts',
      'allow-forms',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
    ]) {
      expect(LANDING_CSP).toContain(flag)
    }
  })

  it('no permite que la embeban en un iframe de otro sitio', () => {
    expect(LANDING_CSP).toContain("frame-ancestors 'none'")
  })

  it('la previa del panel usa los mismos flags que la página publicada', () => {
    // Si divergen, la previa miente: algo anda en el editor y no online.
    const publicFlags = new Set(
      LANDING_CSP.split(';')[0]
        ?.trim()
        .split(/\s+/)
        .filter((token) => token.startsWith('allow-')) ?? [],
    )
    const previewFlags = LANDING_PREVIEW_SANDBOX.split(/\s+/).filter(Boolean)

    for (const flag of previewFlags) {
      expect(publicFlags.has(flag)).toBe(true)
    }
    expect(previewFlags).not.toContain('allow-same-origin')
  })
})

describe('headers de next.config para /p/*', () => {
  it('define un bloque propio para las landings, DESPUÉS del general', async () => {
    const headers = await nextConfig.headers?.()
    expect(headers).toBeDefined()

    const generalIndex = headers?.findIndex((entry) => entry.source === '/:path*') ?? -1
    const landingIndex = headers?.findIndex((entry) => entry.source.startsWith('/p/')) ?? -1

    expect(generalIndex).toBeGreaterThanOrEqual(0)
    expect(landingIndex).toBeGreaterThanOrEqual(0)
    // En Next, ante la misma key gana la ÚLTIMA definición: el bloque de las
    // landings tiene que ir después para pisar el Referrer-Policy general.
    expect(landingIndex).toBeGreaterThan(generalIndex)
  })

  it('el bloque de landings trae el CSP con sandbox', () => {
    const csp = LANDING_SECURITY_HEADERS.find((header) => header.key === 'Content-Security-Policy')
    expect(csp?.value).toBe(LANDING_CSP)
  })

  it('corta el referrer y el uso como subrecurso de otros sitios', () => {
    const byKey = new Map(LANDING_SECURITY_HEADERS.map((header) => [header.key, header.value]))
    expect(byKey.get('Referrer-Policy')).toBe('no-referrer')
    expect(byKey.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
  })
})
