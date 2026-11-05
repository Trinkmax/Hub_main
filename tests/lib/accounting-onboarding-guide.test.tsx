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
  it('la barra de avance y el estado de cada paso en palabras, en una planilla', () => {
    const html = render()
    const t = text(html)
    // Un solo número: el de la puesta en marcha (lo de una sola vez), como la franja del Resumen.
    expect(t).toContain('de 13 listos')
    expect(html).toContain('role="progressbar"')
    for (const head of ['Estado', 'Paso']) expect(html).toContain(`>${head}</th>`)
    // Faltan los datos de la SAS: es lo primero.
    expect(t).toContain('Falta el número de Ingresos Brutos.')
    expect(t).toMatch(/Lo próximo Datos de la SAS/)
    expect(t).toMatch(/Listo Medios de cobro/)
    expect(t).toMatch(/Marcado por vos Comisiones de apps, tarjetas y Mercado Pago/)
    expect(t).toMatch(/Para saber Gastos chicos/)
  })

  it('los pasos que pidieron: impuestos y sueldos sí; puntos de venta, no', () => {
    const t = text(render())
    expect(t).toContain('Impuestos: Ingresos Brutos, Comercio e Industria, débitos y créditos')
    expect(t).toContain('Empleados y sueldos')
    expect(t).toContain('Ya los revisé')
    expect(t).not.toContain('Puntos de venta')
  })

  it('cada sección con su ancla; el avance es el de la puesta en marcha', () => {
    const html = render()
    for (const section of ['day1', 'daily', 'weekly', 'monthly']) {
      expect(html).toContain(`id="arranque-${section}"`)
    }
    // Día 1: los medios de cobro (los vio la base) y las plataformas (marcadas a mano); el
    // opcional (Mercado Pago) no cuenta.
    expect(text(html)).toContain('2 de 13 listos')
  })

  it('[Ir] lleva a la pantalla exacta del bar', () => {
    const html = render()
    for (const path of [
      'ajustes?tab=sas',
      'ajustes?tab=impuestos',
      'configurar',
      'importar/arca',
      'ajustes/arca',
      'sueldos',
      'libros/cierres',
    ]) {
      expect(html).toContain(`href="/bar-demo/administracion/${path}"`)
    }
    // Dice adónde va para quien no ve la fila: el botón visible es «Ir».
    expect(html).toContain('aria-label="Completar los datos"')
    expect(text(html)).toContain('Ir')
  })

  it('el detalle está en la página, plegado: se abre al tocar el paso', () => {
    const html = render()
    expect(text(html)).toContain('Bajá la constancia de inscripción')
    expect(html).not.toMatch(/aria-expanded="true"/)
    expect(html).toMatch(/<tr id="arranque-sas_data" hidden=""/)
    // La mini guía del archivo (con sus maquetas) se arma recién al abrir el paso.
    expect(html).not.toContain('data-como-lo-bajo')
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
  it('la lista entera, sin marcas ni «Ya lo hice»', () => {
    const t = text(render({ data: null, problem: { kind: 'unavailable' } }))
    expect(t).toContain('Todavía no podemos marcar tu avance solos')
    expect(t).toContain('Datos de la SAS')
    expect(t).toContain('Cerrar el mes con la contadora')
    expect(t).not.toContain('Ya lo revisamos')
    expect(t).not.toContain('Falta')
    expect(t).not.toContain('Listo')
  })

  it('si falló la lectura, lo dice y la lista se sigue viendo', () => {
    const t = text(
      render({ data: null, problem: { kind: 'error', message: 'No pudimos cargar esto.' } }),
    )
    expect(t).toContain('No pudimos ver tu avance')
    expect(t).toContain('Saldos iniciales')
  })
})

describe('la contadora (solo lectura)', () => {
  it('ve el avance y los pasos, sin botones de carga ni marcas', () => {
    const html = render({ canWrite: false })
    const t = text(html)
    expect(t).toContain('Bajá la constancia de inscripción')
    expect(t).toContain(MESSAGE)
    for (const label of [
      'Ya lo revisamos',
      'Desmarcar',
      'Copiar el mensaje',
      'Mandarlo por WhatsApp',
      'Tené a mano',
    ]) {
      expect(t).not.toContain(label)
    }
    expect(html).not.toContain('aria-label="Completar los datos"')
  })
})

describe('el mensaje para los proveedores sin datos de la SAS', () => {
  it('dice dónde completarlos', () => {
    const html = render({ supplier: { status: 'missing' } })
    expect(text(html)).toContain('Completá la razón social en Ajustes › Datos de la SAS')
    expect(text(html)).not.toContain('Copiar el mensaje')
  })
})
