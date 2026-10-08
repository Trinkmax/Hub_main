// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * «Cómo arrancar» en el primer paint (SSR, WP11): la guía entera aunque la
 * base todavía no dé el estado, las marcas y los botones solo para quien
 * carga, el estado siempre en palabras y el mensaje para los proveedores
 * armado con los datos del bar.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/bar-demo/administracion/guias/como-arrancar',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/imports/actions', () => ({ markOnboardingStep: vi.fn() }))
// La mini guía «¿Cómo lo bajo?» es de otro paquete (contrato C1): acá alcanza con saber dónde va.
vi.mock('@/components/administracion/guias/onboarding/how-to-slot', () => ({
  HowToFor: ({ source }: { source: string }) =>
    createElement('div', { 'data-como-lo-bajo': source }),
}))

import {
  OnboardingGuide,
  type OnboardingGuideProps,
} from '@/components/administracion/guias/onboarding/onboarding-guide'
import { type OnboardingData, parseOnboardingData } from '@/lib/accounting/onboarding'

/** Un bar recién configurado: nada cargado todavía. */
const FRESH = {
  today: '2026-10-15',
  sas_missing: ['iibb_number'],
  bank_with_cbu: false,
  wallet_with_cvu: false,
  sales_methods: 6,
  sales_points: 0,
  opening_done: false,
  partner_granted: false,
  accountant_added: false,
  arca: null,
  arca_vouchers_attention: 0,
  mp: null,
  imports: {},
  mc_prev_month_covered: false,
  recurring_active: 0,
  daily_close_missing: 0,
  mp_invoice_this_month: false,
  treasuries_unchecked: 1,
  prev_month_closed: false,
  manual: ['platforms'],
}

function data(patch: Record<string, unknown> = {}): OnboardingData {
  const d = parseOnboardingData({ ...FRESH, ...patch })
  if (!d) throw new Error('No se pudo leer')
  return d
}

const MESSAGE =
  'Hola, desde ahora facturanos a BAR DE PRUEBA SAS, CUIT 30-71234567-8, Responsable inscripto, con Factura A. ¡Gracias!'

function render(patch: Partial<OnboardingGuideProps> = {}): string {
  const props: OnboardingGuideProps = {
    slug: 'bar-demo',
    data: data(),
    problem: null,
    canWrite: true,
    supplier: { status: 'ready', message: MESSAGE, why: 'Con Factura A recuperás el IVA.' },
    booksStartDate: '2026-10-01',
    ...patch,
  }
  return renderToString(createElement(OnboardingGuide, props))
}

/** El texto visible (sin etiquetas ni comentarios de React), para buscar frases enteras. */
function text(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

describe('la guía con el estado del bar', () => {
  it('el avance, lo próximo y el estado de cada ítem en palabras', () => {
    const t = text(render())
    expect(t).toContain('Tu avance')
    expect(t).toContain('de 19 listos')
    expect(t).toContain('Lo próximo que te conviene hacer')
    // Faltan los datos de la SAS: es lo primero.
    expect(t).toContain('Falta el número de Ingresos Brutos.')
    expect(t).toMatch(/Datos de la SAS Lo próximo/)
    expect(t).toMatch(/Medios de cobro Listo/)
    expect(t).toMatch(/Apps de delivery, tarjetas y Mercado Pago Marcado por vos/)
    expect(t).toMatch(/Puntos de venta Falta/)
    expect(t).toMatch(/Gastos chicos Para saber/)
  })

  it('cada sección con su ancla y su avance', () => {
    const html = render()
    for (const section of ['day1', 'daily', 'weekly', 'monthly']) {
      expect(html).toContain(`id="arranque-${section}"`)
    }
    // Día 1: los medios de cobro (los vio la base) y las plataformas (marcadas a mano); el
    // opcional (Mercado Pago) no cuenta.
    expect(text(html)).toContain('2 de 12 listos')
    expect(text(html)).toContain('3 de 19 listos')
    expect(html).toContain('href="#arranque-sas_data"')
  })

  it('dónde: links a la pantalla exacta del bar', () => {
    const html = render()
    expect(html).toContain('href="/bar-demo/administracion/ajustes?tab=sas"')
    expect(html).toContain('href="/bar-demo/administracion/configurar"')
    expect(html).toContain('href="/bar-demo/administracion/importar/arca"')
    expect(html).toContain('href="/bar-demo/administracion/ajustes/arca"')
  })

  it('cómo: los pasos están en la página, plegados salvo el próximo', () => {
    const html = render()
    expect(text(html)).toContain('Bajá la constancia de inscripción')
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    // La mini guía del archivo (con sus maquetas) se arma recién al abrir el paso.
    expect(html).not.toContain('data-como-lo-bajo')
  })

  it('el paso próximo que es subir un archivo trae abierto su «¿Cómo lo bajo?»', () => {
    const html = render({
      data: data({
        sas_missing: [],
        bank_with_cbu: true,
        wallet_with_cvu: true,
        sales_points: 2,
        opening_done: true,
        partner_granted: true,
        accountant_added: true,
        arca: { status: 'connected', cert_not_after: '2028-10-01T00:00:00Z' },
        manual: ['platforms', 'chart_review'],
      }),
    })
    expect(text(html)).toMatch(/Proveedores y compras del mes pasado Lo próximo/)
    expect(html).toContain('data-como-lo-bajo="mis_comprobantes"')
    expect(html.match(/data-como-lo-bajo=/g)).toHaveLength(1)
  })

  it('quien carga: «Ya lo hice», «Tené a mano» y el mensaje para los proveedores', () => {
    const html = render()
    const t = text(html)
    expect(t).toContain('Ya lo revisamos')
    expect(t).toContain('Ya se lo pedí')
    expect(t).toContain('Desmarcar')
    expect(t).toContain('Tené a mano')
    expect(t).toContain(MESSAGE)
    expect(t).toContain('Copiar el mensaje')
    expect(html).toContain(`href="https://wa.me/?text=${encodeURIComponent(MESSAGE)}"`)
    expect(t).toContain('Los libros arrancan el 01/10/2026')
  })
})

describe('sin el estado de la base', () => {
  it('la guía entera, sin marcas ni «Ya lo hice», y por dónde arrancar', () => {
    const t = text(render({ data: null, problem: { kind: 'unavailable' } }))
    expect(t).toContain('Todavía no podemos marcar tu avance solos')
    expect(t).toContain('Por dónde arrancar')
    expect(t).toContain('Datos de la SAS')
    expect(t).toContain('Cerrar el mes con la contadora')
    expect(t).not.toContain('Ya lo revisamos')
    expect(t).not.toContain('Falta')
    expect(t).not.toContain('Listo')
  })

  it('si falló la lectura, lo dice y la guía se sigue viendo', () => {
    const t = text(
      render({ data: null, problem: { kind: 'error', message: 'No pudimos cargar esto.' } }),
    )
    expect(t).toContain('No pudimos ver tu avance')
    expect(t).toContain('Saldos iniciales')
  })
})

describe('la contadora (solo lectura)', () => {
  it('ve el avance y los pasos, sin botones de carga ni marcas', () => {
    const t = text(render({ canWrite: false }))
    expect(t).toContain('Lo próximo que les toca a los dueños')
    expect(t).toContain('Bajá la constancia de inscripción')
    expect(t).toContain(MESSAGE)
    for (const label of [
      'Completar los datos',
      'Ya lo revisamos',
      'Desmarcar',
      'Copiar el mensaje',
      'Mandarlo por WhatsApp',
      'Tené a mano',
    ]) {
      expect(t).not.toContain(label)
    }
  })
})

describe('el mensaje para los proveedores sin datos de la SAS', () => {
  it('dice dónde completarlos', () => {
    const html = render({ supplier: { status: 'missing' } })
    expect(text(html)).toContain('Completá la razón social en Ajustes › Datos de la SAS')
    expect(text(html)).not.toContain('Copiar el mensaje')
  })
})
