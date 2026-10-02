import { describe, expect, it } from 'vitest'
import {
  HAS_LANDINGS_HOST,
  isLandingsHost,
  LANDING_CSP,
  LANDING_HOST_HEADERS,
  LANDING_PREVIEW_SANDBOX,
  LANDING_SECURITY_HEADERS,
  landingsOrigin,
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

describe('host dedicado (NEXT_PUBLIC_LANDINGS_HOST)', () => {
  it('sin la variable, todo sigue en el dominio del panel y con sandbox', () => {
    // Los tests corren sin la variable: es el modo prudente por default.
    expect(HAS_LANDINGS_HOST).toBe(false)
    expect(landingsOrigin()).toBeNull()
    expect(isLandingsHost('lo-que-sea.vercel.app')).toBe(false)
  })

  it('el host dedicado NO manda sandbox: es justo lo que rompe los videos', () => {
    const keys = LANDING_HOST_HEADERS.map((header) => header.key)
    expect(keys).not.toContain('Content-Security-Policy')
    // Y tampoco no-referrer: YouTube necesita recibir el origen para autorizar
    // el reproductor.
    expect(keys).not.toContain('Referrer-Policy')
  })

  it('la previa del panel NUNCA recupera el origen, ni con host dedicado', () => {
    // Usa srcdoc: con allow-same-origin heredaría el origen DEL PANEL.
    expect(LANDING_PREVIEW_SANDBOX).not.toContain('allow-same-origin')
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

/**
 * La cámara del salón (02/10/2026): con `camera=()` en el bloque general,
 * Chrome —Android incluido— rechazaba getUserMedia y el mozo no podía escanear
 * el QR del socio. Safari no implementa este header, por eso en iPhone andaba.
 */
describe('Permissions-Policy: la cámara', () => {
  const policyOf = (headers: ReadonlyArray<{ key: string; value: string }> | undefined) =>
    headers?.find((header) => header.key === 'Permissions-Policy')?.value ?? ''

  it('el sitio la habilita para su propio origen (el escáner del salón)', async () => {
    const general = (await nextConfig.headers?.())?.find((entry) => entry.source === '/:path*')
    const policy = policyOf(general?.headers)
    expect(policy).toContain('camera=(self)')
    // Nunca abierta a cualquier origen: un iframe de terceros no la puede pedir.
    expect(policy).not.toMatch(/camera=\*/)
    // Micrófono y ubicación siguen cerrados: nadie los usa.
    expect(policy).toContain('microphone=()')
    expect(policy).toContain('geolocation=()')
  })

  it('las landings la vuelven a cerrar, en los dos modos', () => {
    // Son HTML de marketing: no tienen por qué poder pedir la cámara.
    for (const headers of [LANDING_SECURITY_HEADERS, LANDING_HOST_HEADERS]) {
      const policy = policyOf(headers)
      expect(policy).toContain('camera=()')
      expect(policy).toContain('microphone=()')
      expect(policy).toContain('geolocation=()')
    }
  })
})
