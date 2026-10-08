// @vitest-environment node
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArcaChecksList } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/arca-checks'
import { ArcaHomologacion } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/arca-homologacion'
import { ArcaFailureNotice } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/arca-shared'
import { type ArcaConnectionView, arcaTestView } from '@/lib/arca/views'

/**
 * «Pruebas (homologación)» con lo que dejó la corrida real del 08/10: la prueba falló porque el
 * certificado no era de WSASS. Cada «Cómo se arregla» y cada «Ir al paso N» de las pruebas
 * tienen que llevar a los pasos de esa misma tarjeta (`#homologacion-paso-N`), no a la guía de
 * producción (`/ajustes/arca#paso-6`).
 */

vi.mock('@/lib/arca/actions', () => ({
  markGuideStep: vi.fn(),
  saveArcaPointOfSale: vi.fn(),
  saveArcaSettings: vi.fn(),
  startArcaCertificate: vi.fn(),
  downloadArcaCsr: vi.fn(),
  uploadArcaCertificate: vi.fn(),
  testArcaConnection: vi.fn(),
  disconnectArca: vi.fn(),
}))

vi.mock('@/lib/arca/emit-actions', () => ({ emitArcaTestVoucher: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/bar/administracion/ajustes',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

/** El HTML del primer render, sin los separadores `<!-- -->` que React pone entre textos. */
const html = (node: ReactElement) => renderToString(node).replaceAll('<!-- -->', '')

const SAVED_TEST = {
  at: '2026-10-08T16:13:28.038Z',
  environment: 'homologacion',
  status: 'error' as const,
  checks: [
    { key: 'service', ok: true, detail: { db: 'OK', app: 'OK', auth: 'OK' } },
    {
      key: 'wsfe_ticket',
      ok: false,
      error: 'arca_wrong_environment',
      detail: { code: 'cms.cert.untrusted' },
    },
  ],
}
const CTX = { alias: 'bartest', pointOfSale: 1, sasName: 'Bar de Prueba SAS' }

const homologacion: ArcaConnectionView = {
  id: '6f1d2c4e-0000-4000-8000-000000000009',
  environment: 'homologacion',
  environmentLabel: 'Homologación (pruebas)',
  status: 'error',
  statusLabel: 'Con un problema',
  representedCuit: '30712345671',
  certCuit: '20123456786',
  alias: 'bartest',
  hasCsr: true,
  csrFileName: 'arca-bartest.csr',
  renewalPending: false,
  certificate: {
    serial: '7B46CCE5AAC6C49E',
    issuer: 'CN=QA',
    notBefore: '2026-10-08T16:07:24.000Z',
    notAfter: '2028-10-07T16:07:24.000Z',
    daysLeft: 729,
    expired: false,
    renewSoon: false,
  },
  pointOfSale: 1,
  allowedClasses: ['B'],
  defaultConcepto: 1,
  emissionEnabled: false,
  services: { wsfe: 'arca_wrong_environment', padron: null },
  lastTestAt: SAVED_TEST.at,
  lastTest: arcaTestView(SAVED_TEST, { ...CTX, environment: 'homologacion' }),
  lastError: null,
  updatedAt: SAVED_TEST.at,
}

describe('Pruebas (homologación) · los arreglos van a los pasos de las pruebas', () => {
  it('la tarjeta: pasos con ancla, punto de venta 0001 y «Cómo se arregla» al paso 2', () => {
    const out = html(
      createElement(ArcaHomologacion, { slug: 'bar', connection: homologacion, canWrite: true }),
    )
    for (const n of [1, 2, 3, 4, 5]) expect(out).toContain(`id="homologacion-paso-${n}"`)
    expect(out).toContain('0001')
    expect(out).toContain('Las pruebas usan el punto de venta')
    expect(out).toContain('ARCA de pruebas no reconoce el certificado')
    expect(out).toContain('Cómo se arregla: paso 2 de las pruebas')
    expect(out).toContain('href="#homologacion-paso-2"')
    // Nada lleva a la guía de producción por el certificado.
    expect(out).not.toContain('ajustes/arca#paso-6')
    expect(out).not.toContain('o al revés')
  })

  it('la misma lista en producción sigue llevando a la guía', () => {
    const prod = arcaTestView(
      { ...SAVED_TEST, environment: 'produccion' },
      { ...CTX, environment: 'produccion' },
    )
    const out = html(
      createElement(ArcaChecksList, { test: prod, guideHref: '/bar/administracion/ajustes/arca' }),
    )
    expect(out).toContain('Cómo se arregla: paso 6')
    expect(out).toContain('href="/bar/administracion/ajustes/arca#paso-6"')
    expect(out).not.toContain('de las pruebas')
  })

  it('«Falta el pedido» en las pruebas: «Ir al paso 1» de la tarjeta, con su texto', () => {
    const failure = {
      ok: false as const,
      code: 'conflict' as const,
      message:
        'No encontramos la clave de la plataforma para este certificado. Generá un pedido nuevo (paso 5) y repetí el paso 6.',
      detail: { key: 'arca_key_missing' },
    }
    const homo = html(
      createElement(ArcaFailureNotice, { failure, slug: 'bar', environment: 'homologacion' }),
    )
    expect(homo).toContain('href="#homologacion-paso-1"')
    expect(homo).toContain('Ir al paso 1')
    expect(homo).toContain('Primero generá el pedido (paso 1)')
    expect(homo).not.toContain('paso 5')

    const prod = html(createElement(ArcaFailureNotice, { failure, slug: 'bar' }))
    expect(prod).toContain('href="/bar/administracion/ajustes/arca#paso-5"')
    expect(prod).toContain('Ir al paso 5')
  })
})
