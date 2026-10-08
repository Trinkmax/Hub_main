// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * El índice de Guías (WP11): cada tarjeta se ve aunque su lectura falle o su
 * parte de la base todavía no esté, dice cómo va en palabras y lleva a la
 * guía; las mini guías de los tres archivos con su importador (solo para
 * quien carga).
 */

vi.mock('@/components/administracion/guias/onboarding/how-to-slot', () => ({
  HowToFor: ({ source }: { source: string }) =>
    createElement('div', { 'data-como-lo-bajo': source }),
}))

import {
  ArcaGuideCard,
  DownloadGuides,
  OnboardingGuideCard,
} from '@/components/administracion/guias/onboarding/guides-index'
import { onboardingState, parseOnboardingData } from '@/lib/accounting/onboarding'
import type { ArcaConnectionView, ArcaOverview } from '@/lib/arca/views'

function text(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

const REPORT = {
  today: '2026-10-15',
  sas_missing: [],
  bank_with_cbu: true,
  wallet_with_cvu: true,
  sales_methods: 4,
  sales_points: 0,
  opening_done: true,
  partner_granted: false,
  accountant_added: false,
  arca: null,
  mp: null,
  imports: {},
  recurring_active: 0,
  daily_close_missing: 0,
  treasuries_unchecked: 0,
  manual: [],
}

function stateOf(): ReturnType<typeof onboardingState> {
  const data = parseOnboardingData(REPORT)
  if (!data) throw new Error('No se pudo leer')
  return onboardingState(data)
}

/** Un panorama de ARCA mínimo: solo lo que mira la tarjeta. */
function arca(
  connection: Partial<ArcaConnectionView> | null,
  summary: {
    done: number
    total: number
    next: ArcaOverview['guide']['produccion']['summary']['next']
  },
): ArcaOverview {
  const guide = { steps: [], summary }
  return {
    sas: { legalName: 'Bar de Prueba SAS', cuit: null },
    connections: {
      produccion: connection ? (connection as ArcaConnectionView) : null,
      homologacion: null,
    },
    guide: { produccion: guide, homologacion: guide },
    progress: [],
    lookup: { environment: null, testData: false },
    attention: [],
  }
}

describe('«Cómo arrancar»', () => {
  it('con el estado: el avance y lo próximo', () => {
    const state = stateOf()
    const t = text(
      renderToString(
        createElement(OnboardingGuideCard, {
          href: '/bar-demo/administracion/guias/como-arrancar',
          outcome: { ok: true, data: { state } },
          canWrite: true,
        }),
      ),
    )
    expect(t).toContain(`${state.done} de ${state.total} listos`)
    expect(t).toContain('Lo próximo: Apps de delivery, tarjetas y Mercado Pago')
    expect(t).toContain('Seguir con la guía')
  })

  it('sin el estado de la base, o si falló la lectura: lo dice y la guía se abre igual', () => {
    const pending = renderToString(
      createElement(OnboardingGuideCard, {
        href: '/x',
        outcome: { ok: true, data: null },
        canWrite: true,
      }),
    )
    expect(text(pending)).toContain('Todavía no marca tu avance sola')
    expect(text(pending)).toContain('Abrir la guía')
    const failed = renderToString(
      createElement(OnboardingGuideCard, {
        href: '/x',
        outcome: { ok: false, message: 'No pudimos cargar esto.' },
        canWrite: false,
      }),
    )
    expect(text(failed)).toContain('No pudimos ver tu avance')
    expect(text(failed)).toContain('Ver la guía')
  })
})

describe('«Conectar ARCA»', () => {
  it('a medio hacer: cuántos pasos van y el que toca', () => {
    const t = text(
      renderToString(
        createElement(ArcaGuideCard, {
          href: '/bar-demo/administracion/ajustes/arca',
          outcome: {
            ok: true,
            data: arca(
              { status: 'key_ready', certificate: null },
              {
                done: 4,
                total: 9,
                next: 's6_certificado',
              },
            ),
          },
          canWrite: true,
        }),
      ),
    )
    expect(t).toContain('4 de 9 pasos hechos')
    expect(t).toContain('Te toca: Creá el certificado en ARCA y bajalo')
    expect(t).toContain('Seguir conectando')
  })

  it('con error en la última prueba, lo dice en palabras', () => {
    const t = text(
      renderToString(
        createElement(ArcaGuideCard, {
          href: '/x',
          outcome: {
            ok: true,
            data: arca(
              {
                status: 'error',
                certificate: null,
                lastError: {
                  key: 'arca_not_authorized',
                  title: 'El certificado no está autorizado.',
                  body: '',
                  step: 's7_wsfe',
                  retry: null,
                },
              },
              { done: 7, total: 9, next: 's7_wsfe' },
            ),
          },
          canWrite: true,
        }),
      ),
    )
    expect(t).toContain('El certificado no está autorizado.')
  })

  it('conectado: el punto de venta y hasta cuándo vale el certificado', () => {
    const t = text(
      renderToString(
        createElement(ArcaGuideCard, {
          href: '/x',
          outcome: {
            ok: true,
            data: arca(
              {
                status: 'connected',
                pointOfSale: 5,
                certificate: {
                  serial: null,
                  issuer: null,
                  notBefore: null,
                  notAfter: '2028-09-10T15:00:00Z',
                  daysLeft: 700,
                  expired: false,
                  renewSoon: false,
                },
              },
              { done: 9, total: 9, next: null },
            ),
          },
          canWrite: true,
        }),
      ),
    )
    expect(t).toContain('Conectado')
    expect(t).toContain('ARCA ya está conectado con el punto de venta 5.')
    expect(t).toContain('El certificado vence el 10/09/2028.')
    expect(t).toContain('Ver la guía')
  })

  it('si no se pudo leer, la tarjeta lo dice y la guía se abre igual', () => {
    const t = text(
      renderToString(
        createElement(ArcaGuideCard, {
          href: '/x',
          outcome: { ok: false, message: 'No pudimos cargar esto.' },
          canWrite: true,
        }),
      ),
    )
    expect(t).toContain('No pudimos ver cómo va la conexión')
    expect(t).toContain('Empezar a conectar')
  })
})

describe('«Bajá los archivos»', () => {
  it('los tres, con su «¿Cómo lo bajo?» y su importador para quien carga', () => {
    const html = renderToString(
      createElement(DownloadGuides, { base: '/bar-demo/administracion', canWrite: true }),
    )
    for (const source of ['mis_comprobantes', 'mercado_pago', 'banco']) {
      expect(html).toContain(`data-como-lo-bajo="${source}"`)
    }
    for (const path of ['arca', 'mercado-pago', 'banco']) {
      expect(html).toContain(`href="/bar-demo/administracion/importar/${path}"`)
    }
    expect(text(html)).toContain('Una vez por mes, del día 11 en adelante.')
  })

  it('la contadora ve cómo se bajan, sin los botones de importar', () => {
    const html = renderToString(
      createElement(DownloadGuides, { base: '/bar-demo/administracion', canWrite: false }),
    )
    expect(html).toContain('data-como-lo-bajo="banco"')
    expect(html).not.toContain('/importar/')
  })
})
