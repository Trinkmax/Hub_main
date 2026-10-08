// @vitest-environment node
import { type ComponentType, createElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArcaChecksList } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/arca-checks'
import { ArcaPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/arca-panel'
import {
  GuideSteps,
  type GuideStepsData,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/arca/_components/guide-steps'
import { arcaMockData } from '@/components/administracion/guias/arca-guide-model'
import { MockDataProvider } from '@/components/administracion/guias/arca-mock/mock-data'
import { ScaledMock } from '@/components/administracion/guias/arca-mock/scaled-mock'
import * as screens from '@/components/administracion/guias/arca-mock/screens'
import { GuideNavProvider } from '@/components/administracion/guias/guide-nav'
import { GuideMobileBar, GuideRail } from '@/components/administracion/guias/guide-rail'
import { GuideStep, GuideTroubles } from '@/components/administracion/guias/guide-step'
import {
  HowToBanco,
  HowToMercadoPago,
  HowToMisComprobantes,
} from '@/components/administracion/guias/how-to'
import { StepScreens } from '@/components/administracion/guias/step-screens'
import { type ArcaGuideStepId, arcaGuideState, guideProgressSummary } from '@/lib/arca/guide'
import {
  type ArcaConnectionView,
  type ArcaGuideStepView,
  type ArcaOverview,
  arcaProblemView,
  arcaStepProblem,
  arcaTestView,
} from '@/lib/arca/views'

/**
 * Lo que la guía «Conectar ARCA» tiene que traer en el primer render (SSR), para el teclado,
 * los lectores de pantalla y el celular: acordeón con `aria-expanded`, maquetas como imágenes
 * con descripción, estados en texto, links al paso que arregla cada problema, y las mini guías
 * plegables. Y que ningún texto nombre a un bar en particular (la plataforma es multi-bar).
 */

// Las acciones del servidor no se llaman al pintar: se reemplazan para no cargar el servidor.
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
  usePathname: () => '/bar/administracion/ajustes/arca',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

/** El HTML del primer render, sin los separadores `<!-- -->` que React pone entre textos. */
const html = (node: ReactElement) => renderToString(node).replaceAll('<!-- -->', '')

const MOCK = arcaMockData({
  legalName: 'Bar de Prueba SAS',
  cuit: '30712345671',
  alias: 'barplataforma',
  pointOfSale: 7,
})

/**
 * `createElement` con hijos como argumentos (como pide Biome) para componentes cuyos tipos
 * exigen `children`.
 */
function el<P extends { children?: ReactNode }>(
  type: ComponentType<P>,
  props: Omit<P, 'children'>,
  ...children: ReactNode[]
): ReactElement {
  return createElement(type, props as unknown as P, ...children)
}

function withMock(node: ReactNode) {
  return el(MockDataProvider, { value: MOCK }, node)
}

const STEP_PROPS = {
  id: 's6_certificado',
  anchor: 'paso-6',
  n: 6,
  title: 'Creá el certificado en ARCA y bajalo',
  status: 'todo' as const,
  statusText: 'Te toca',
  footerHow: 'Se marca solo cuando subís un certificado válido.',
  next: { id: 's7_wsfe', anchor: 'paso-7', label: 'Siguiente: paso 7' },
}

describe('GuideStep (acordeón)', () => {
  it('cerrado: botón con aria-expanded=false que controla el cuerpo escondido', () => {
    const out = html(el(GuideStep, STEP_PROPS, createElement('p', null, 'Cuerpo')))
    expect(out).toContain('<section id="paso-6" aria-labelledby="paso-6-nombre"')
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="paso-6-contenido"/)
    expect(out).toMatch(/id="paso-6-contenido" hidden=""/)
    expect(out).toContain('Te toca')
    expect(out).toContain('Paso 6')
  })

  it('abierto por la guía: el «Te toca» viene abierto, con el pie y el siguiente paso', () => {
    const out = html(
      el(
        GuideNavProvider,
        { items: [{ id: 's6_certificado', anchor: 'paso-6' }], initialOpen: ['s6_certificado'] },
        el(GuideStep, STEP_PROPS, createElement('p', null, 'Cuerpo')),
      ),
    )
    expect(out).toMatch(/aria-expanded="true"/)
    expect(out).not.toMatch(/id="paso-6-contenido" hidden=""/)
    expect(out).toContain('Cómo se marca:')
    expect(out).toContain('href="#paso-7"')
    expect(out).toContain('Siguiente: paso 7')
  })

  it('«Si algo sale mal» se abre problema por problema', () => {
    const out = html(
      createElement(GuideTroubles, {
        items: [{ problem: 'El desplegable está vacío', fix: 'Repetí el paso 6.' }],
      }),
    )
    expect(out).toContain('<details')
    expect(out).toContain('<summary')
    expect(out).toContain('El desplegable está vacío')
  })
})

describe('ScaledMock (el marco «Así se ve en ARCA»)', () => {
  it('es una imagen con descripción; el dibujo va oculto para lectores', () => {
    const out = html(
      el(
        ScaledMock,
        { height: 300, label: 'Pantalla de prueba', caption: 'Pie de foto', approximate: true },
        createElement('div', null, 'dibujo'),
      ),
    )
    expect(out).toMatch(/role="img" aria-label="Pantalla de prueba"/)
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('Así se ve en ARCA')
    expect(out).toContain('Puede verse distinto')
    expect(out).toContain('<figcaption')
    expect(out).toContain('aspect-ratio:720 / 300')
  })
})

describe('las pantallas de ARCA', () => {
  const all: Array<[string, () => ReactElement]> = [
    ['login', () => createElement(screens.ScreenLogin)],
    ['portal', () => createElement(screens.ScreenPortalHome)],
    [
      'buscar',
      () =>
        createElement(screens.ScreenPortalSearch, {
          query: 'certificados',
          title: 'Administración de Certificados Digitales',
          description: 'Administre aquí sus Certificados Digitales para webservices',
        }),
    ],
    ['autoridad', () => createElement(screens.ScreenAutoridad)],
    ['menu', () => createElement(screens.ScreenMenuRelaciones, { highlight: 'acting' })],
    ['relacion', () => createElement(screens.ScreenNuevaRelacion, { highlight: 'buscarServicio' })],
    [
      'arbol',
      () =>
        createElement(screens.ScreenArbolServicios, {
          folder: 'WebServices',
          service: { name: 'Facturación Electrónica', description: 'Factura electrónica' },
          wrong: {
            name: 'Factura Electrónica con Detalle - MTXCA',
            description: 'Factura Electrónica con Detalle - MTXCA',
          },
        }),
    ],
    [
      'persona',
      () => createElement(screens.ScreenRepresentantePersona, { service: 'Mis Comprobantes' }),
    ],
    [
      'computador',
      () => createElement(screens.ScreenComputadorFiscal, { service: 'Facturación Electrónica' }),
    ],
    ['pv-menu', () => createElement(screens.ScreenPvMenu)],
    ['pv-listado', () => createElement(screens.ScreenPvListado)],
    ['pv-alta', () => createElement(screens.ScreenPvAlta)],
    ['factura-a', () => createElement(screens.ScreenFacturaA)],
    ['cert-lista', () => createElement(screens.ScreenCertLista, { withAlias: true })],
    ['cert-agregar', () => createElement(screens.ScreenCertAgregar)],
    ['cert-detalle', () => createElement(screens.ScreenCertDetalle)],
    ['mis-comprobantes', () => createElement(screens.ScreenMisComprobantes, { step: 'consulta' })],
    ['wsass', () => createElement(screens.ScreenWsass)],
    ['mini-acting', () => createElement(screens.MiniActing)],
    ['mini-sistema', () => createElement(screens.MiniSistema)],
  ]

  it.each(all)('%s: imagen con descripción y sin nombres de otro bar', (_name, screen) => {
    const out = html(withMock(screen()))
    expect(out).toMatch(/role="img" aria-label="[^"]{20,}"/)
    expect(out).not.toMatch(/thinkeon/i)
    expect(out).not.toMatch(/\bHUB\b/i)
  })

  it('muestran exactamente lo que la persona tiene que ver: la SAS, su CUIT, el alias y el pedido', () => {
    const autoridad = html(withMock(createElement(screens.ScreenAutoridad)))
    expect(autoridad).toContain('BAR DE PRUEBA SAS [30-71234567-1]')
    const agregar = html(withMock(createElement(screens.ScreenCertAgregar)))
    expect(agregar).toContain('arca-barplataforma.csr')
    expect(agregar).toContain('30-71234567-1')
    const detalle = html(withMock(createElement(screens.ScreenCertDetalle)))
    expect(detalle).toContain('SERIALNUMBER=CUIT 30712345671, CN=barplataforma')
    const alta = html(withMock(createElement(screens.ScreenPvAlta)))
    expect(alta).toContain('RECE para aplicativo y web services')
  })

  it('la CUIT de la persona nunca se inventa', () => {
    const out = html(withMock(createElement(screens.ScreenLogin)))
    expect(html(withMock(createElement(screens.ScreenAutoridad)))).toContain('TU NOMBRE [TU CUIT]')
    expect(out).not.toMatch(/\b2[0-7]-\d{8}-\d\b/)
  })
})

describe('StepScreens (qué vas a ver + qué tocás)', () => {
  it('una pantalla por vez, el contador, el anuncio y «Ver pantalla N» en el texto', () => {
    const out = html(
      createElement(StepScreens, {
        screens: [
          { title: 'Primera', mock: createElement('div', null, 'm1') },
          { title: 'Segunda', mock: createElement('div', null, 'm2') },
          { title: 'Tercera', mock: createElement('div', null, 'm3') },
        ],
        instructions: [
          { content: 'Hacé lo primero', screen: 0 },
          { content: 'Hacé lo segundo', screen: 1 },
          { content: 'Cerrá sesión' },
        ],
      }),
    )
    expect(out).toContain('Pantalla 1 de 3')
    expect(out).toContain('aria-live="polite"')
    expect(out).toContain('m1')
    expect(out).not.toContain('m2')
    expect(out).toContain('Ver pantalla 2')
    expect(out).toContain('Es la pantalla de arriba')
    expect(out).toContain('aria-label="Pantalla siguiente"')
    expect(out).toContain('Qué vas a ver')
    expect(out).toContain('Qué tocás')
  })
})

describe('el riel y la barra del celular', () => {
  const items = [
    {
      id: 's5_pedido',
      anchor: 'paso-5',
      n: 5,
      title: 'Generá el pedido',
      status: 'done' as const,
      statusText: 'Hecho',
    },
    {
      id: 's6_certificado',
      anchor: 'paso-6',
      n: 6,
      title: 'Creá el certificado',
      status: 'todo' as const,
      statusText: 'Te toca',
    },
    {
      id: 's10_mis_comprobantes',
      anchor: 'paso-10',
      n: 10,
      title: 'Mis Comprobantes',
      status: 'pending' as const,
      statusText: 'Opcional',
      optional: true,
    },
  ]

  it('nav con nombre, links a cada paso, el actual marcado y la barra de avance', () => {
    const out = html(
      createElement(GuideRail, {
        label: 'Pasos para conectar ARCA',
        items,
        summary: { done: 5, total: 9 },
        currentId: 's6_certificado',
      }),
    )
    expect(out).toContain('<nav aria-label="Pasos para conectar ARCA"')
    expect(out).toContain('href="#paso-5"')
    expect(out).toMatch(/href="#paso-6" aria-current="step"/)
    expect(out).not.toMatch(/href="#paso-5" aria-current/)
    expect(out).toContain('5 de 9 pasos listos')
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('Opcional')
  })

  it('en el celular: lo que toca, el avance y «Pasos» que abre la lista', () => {
    const out = html(
      createElement(GuideMobileBar, {
        label: 'Pasos para conectar ARCA',
        items,
        summary: { done: 5, total: 9 },
        currentId: 's6_certificado',
        headline: 'Te toca: 6. Creá el certificado',
      }),
    )
    expect(out).toContain('Te toca: 6. Creá el certificado')
    expect(out).toContain('aria-haspopup="dialog"')
    expect(out).toContain('5 de 9')
  })
})

describe('los chequeos de «Probar conexión»', () => {
  const view = arcaTestView(
    {
      at: '2026-10-08T13:32:10Z',
      environment: 'produccion',
      status: 'error',
      checks: [
        { key: 'service', ok: true },
        {
          key: 'wsfe_ticket',
          ok: false,
          error: 'arca_not_authorized',
          detail: { code: 'coe.notAuthorized' },
        },
      ],
    },
    {
      alias: 'barplataforma',
      pointOfSale: 7,
      sasName: 'BAR DE PRUEBA SAS',
      environment: 'produccion',
    },
  )

  it('cada chequeo con su estado en texto, el arreglo y el código para soporte', () => {
    const out = html(createElement(ArcaChecksList, { test: view }))
    expect(out).toContain('Bien.')
    expect(out).toContain('No anduvo.')
    expect(out).toContain('href="#paso-7"')
    expect(out).toContain('Cómo se arregla: paso 7')
    expect(out).toContain('coe.notAuthorized')
    expect(out).toContain('No se llegó a probar')
    expect(out).toContain('barplataforma')
  })

  it('desde la pestaña, el link va a la guía', () => {
    const out = html(
      createElement(ArcaChecksList, { test: view, guideHref: '/bar/administracion/ajustes/arca' }),
    )
    expect(out).toContain('href="/bar/administracion/ajustes/arca#paso-7"')
  })
})

describe('las mini guías «¿Cómo lo bajo?» (contrato C1)', () => {
  it('Mis Comprobantes: plegable, con los pasos y las pantallas', () => {
    const out = html(createElement(HowToMisComprobantes))
    expect(out).toMatch(/^<details(?![^>]*\bopen\b)/)
    expect(out).toContain('¿Cómo lo bajo?')
    expect(out).toContain('«CSV»')
    expect(out).toContain('role="img"')
    expect(out).not.toMatch(/thinkeon|\bHUB\b/i)
  })

  it('se puede abrir de entrada', () => {
    expect(html(createElement(HowToMercadoPago, { defaultOpen: true }))).toMatch(
      /^<details[^>]*open=""/,
    )
  })

  it('Mercado Pago: el camino en el panel, los 60 días y las columnas', () => {
    const out = html(createElement(HowToMercadoPago))
    expect(out).toContain('Liquidaciones')
    expect(out).toContain('60 días')
    expect(out).toContain('NET_CREDIT_AMOUNT')
  })

  it('Banco: solo texto y pide un archivo de ejemplo si no lo reconoce', () => {
    const out = html(createElement(HowToBanco, { className: 'mt-4' }))
    expect(out).not.toContain('role="img"')
    expect(out).toContain('archivo de ejemplo')
    expect(out).toContain('mt-4')
  })
})

describe('la guía entera (los 11 pasos)', () => {
  function statesFor(connection: ArcaConnectionView | null) {
    const states = arcaGuideState(
      {
        status: connection?.status ?? null,
        hasSasCuit: true,
        hasCsr: connection?.hasCsr ?? false,
        hasCertificate: connection?.certificate != null,
        certNotAfter: connection?.certificate?.notAfter ?? null,
        pointOfSale: connection?.pointOfSale ?? null,
        allowedClasses: connection?.allowedClasses ?? ['B'],
      },
      [],
      null,
      new Date('2026-10-08T15:00:00Z'),
    )
    return Object.fromEntries(
      states.map((st) => [st.id, { ...st, problem: arcaStepProblem(st.reason) }]),
    ) as Record<ArcaGuideStepId, ArcaGuideStepView>
  }

  const base: Omit<GuideStepsData, 'states' | 'connection' | 'canWrite'> = {
    slug: 'bar',
    base: '/bar/administracion',
    sasName: 'Bar de Prueba SAS',
    sasCuit: '30712345671',
    suggestedAlias: 'barplataforma',
    salesPoints: [{ number: 1, label: 'Salón' }],
  }

  const connected: ArcaConnectionView = {
    id: '6f1d2c4e-0000-4000-8000-000000000001',
    environment: 'produccion',
    environmentLabel: 'Producción',
    status: 'connected',
    statusLabel: 'Conectado',
    representedCuit: '30712345671',
    certCuit: '30712345671',
    alias: 'barplataforma',
    hasCsr: true,
    csrFileName: 'arca-barplataforma.csr',
    renewalPending: false,
    certificate: {
      serial: 'AB12',
      issuer: 'CN=Computadores',
      notBefore: '2026-10-01T12:00:00.000Z',
      notAfter: '2028-10-01T12:00:00.000Z',
      daysLeft: 724,
      expired: false,
      renewSoon: false,
    },
    pointOfSale: 7,
    allowedClasses: ['B'],
    defaultConcepto: 1,
    emissionEnabled: false,
    services: { wsfe: 'ok', padron: 'ok' },
    lastTestAt: null,
    lastTest: null,
    lastError: null,
    updatedAt: '2026-10-08T15:00:00.000Z',
  }

  /** Cuántos `<button>` tienen ese texto (los textos del pie lo nombran, pero no son botones). */
  function buttonsWith(out: string, label: string): number {
    return (out.match(/<button\b[\s\S]*?<\/button>/g) ?? []).filter((b) => b.includes(label)).length
  }

  function render(data: GuideStepsData) {
    return html(
      el(
        MockDataProvider,
        { value: MOCK },
        el(GuideNavProvider, { items: [], initialOpen: [] }, createElement(GuideSteps, { data })),
      ),
    )
  }

  it('un bar que recién empieza: los 11 pasos, el paso 0 te toca y las acciones de carga', () => {
    const out = render({ ...base, canWrite: true, connection: null, states: statesFor(null) })
    for (let n = 0; n <= 10; n++) expect(out).toContain(`<section id="paso-${n}"`)
    expect(out).toContain('Te toca')
    expect(buttonsWith(out, 'Ya revisé todo')).toBe(1)
    expect(out).toContain('Generar el pedido y bajarlo')
    expect(out).toContain('Elegir el archivo')
    expect(out).toContain('Número del punto de venta')
    expect(out).toContain('Ya tenés cargados en Ajustes › Puntos de venta')
    expect(out).toContain('Primero, el certificado')
    expect(out).not.toMatch(/thinkeon|\bHUB\b/i)
  })

  it('la contadora: los mismos pasos, sin botones de carga', () => {
    const out = render({
      ...base,
      canWrite: false,
      connection: connected,
      states: statesFor(connected),
    })
    for (let n = 0; n <= 10; n++) expect(out).toContain(`<section id="paso-${n}"`)
    // Los botones «Ya lo hice» no están (el pie igual explica cómo se marca cada paso).
    for (const label of ['Ya revisé todo', 'Ya me aparece el servicio', 'Ya lo hice']) {
      expect(buttonsWith(out, label)).toBe(0)
    }
    expect(buttonsWith(out, 'Generar el pedido y bajarlo')).toBe(0)
    expect(out).not.toContain('Elegir el archivo')
    expect(out).not.toContain('type="file"')
    expect(out).toContain('Punto de venta guardado: 0007.')
    expect(out).toContain('El pedido ya está generado (alias barplataforma).')
    expect(out).toContain('Hecho')
  })
})

describe('Ajustes › ARCA (la tarjeta en sus cuatro estados)', () => {
  const base: ArcaConnectionView = {
    id: '6f1d2c4e-0000-4000-8000-000000000002',
    environment: 'produccion',
    environmentLabel: 'Producción',
    status: 'connected',
    statusLabel: 'Conectado',
    representedCuit: '30712345671',
    certCuit: '30712345671',
    alias: 'barplataforma',
    hasCsr: true,
    csrFileName: 'arca-barplataforma.csr',
    renewalPending: false,
    certificate: {
      serial: 'AB12',
      issuer: 'CN=Computadores',
      notBefore: '2026-10-01T12:00:00.000Z',
      notAfter: '2028-10-01T12:00:00.000Z',
      daysLeft: 724,
      expired: false,
      renewSoon: false,
    },
    pointOfSale: 7,
    allowedClasses: ['B'],
    defaultConcepto: 1,
    emissionEnabled: false,
    services: { wsfe: 'ok', padron: 'ok' },
    lastTestAt: '2026-10-08T13:32:10.000Z',
    lastTest: null,
    lastError: null,
    updatedAt: '2026-10-08T15:00:00.000Z',
  }

  function overview(connection: ArcaConnectionView | null, marks = 0): ArcaOverview {
    const states = arcaGuideState(
      {
        status: connection?.status ?? null,
        hasSasCuit: true,
        hasCsr: connection?.hasCsr ?? false,
        hasCertificate: connection?.certificate != null,
        certNotAfter: connection?.certificate?.notAfter ?? null,
        pointOfSale: connection?.pointOfSale ?? null,
        allowedClasses: connection?.allowedClasses ?? ['B'],
      },
      ['s0_prereq', 's1_elegir_sas'].slice(0, marks).map((step) => ({
        step,
        doneAt: '2026-10-08T12:00:00.000Z',
        doneByName: 'Ana',
      })),
      connection?.lastTest
        ? {
            at: connection.lastTest.at,
            environment: 'produccion',
            status: connection.lastTest.status,
            checks: [],
          }
        : null,
    )
    const guide = {
      steps: states.map((st) => ({ ...st, problem: arcaStepProblem(st.reason) })),
      summary: guideProgressSummary(states),
    }
    return {
      sas: { legalName: 'Bar de Prueba SAS', cuit: '30712345671' },
      connections: { produccion: connection, homologacion: null },
      guide: { produccion: guide, homologacion: guide },
      progress: [],
      lookup: { environment: null, testData: false },
      attention: [],
    }
  }

  const panel = (o: ArcaOverview, canWrite = true) =>
    html(createElement(ArcaPanel, { slug: 'bar', overview: o, canWrite }))

  it('A · sin empezar: qué gana el bar y «Conectar ARCA» a la guía', () => {
    const out = panel(overview(null))
    expect(out).toContain('Conectá ARCA y que la plataforma trabaje por vos')
    expect(out).toContain('href="/bar/administracion/ajustes/arca"')
    expect(out).toContain('Conectar ARCA')
    expect(out).toContain('Pruebas (homologación)')
  })

  it('B · en curso: «3 de 9», la lista de pasos y «Seguir con la guía» al que toca', () => {
    const out = panel(
      overview(
        { ...base, status: 'key_ready', certificate: null, lastTestAt: null, pointOfSale: null },
        2,
      ),
    )
    expect(out).toContain('3 de 9 pasos listos')
    expect(out).toContain('Seguir con la guía')
    expect(out).toMatch(/href="\/bar\/administracion\/ajustes\/arca#paso-2"/)
    expect(out).toContain('role="progressbar"')
  })

  it('C · conectado: estado, CUIT, punto de venta, certificado, emisión y desconectar', () => {
    const lastTest = arcaTestView({
      at: '2026-10-08T13:32:10Z',
      environment: 'produccion',
      status: 'connected',
      checks: [{ key: 'service', ok: true }],
    })
    const out = panel(overview({ ...base, lastTest }))
    expect(out).toContain('Conectado')
    expect(out).toContain('30-71234567-1')
    expect(out).toContain('0007')
    expect(out).toContain('Certificado hasta el 01/10/2028.')
    expect(out).toContain('Emitir facturas desde la plataforma')
    expect(out).toContain('¿Qué Factura A te autorizó ARCA?')
    expect(out).toContain('Probar de nuevo')
    expect(out).toContain('Desconectar')
    expect(out).toContain('href="/bar/administracion/ajustes/arca#renovar"')
  })

  it('C · el certificado que vence pronto avisa con «Renovar»', () => {
    const out = panel(
      overview({
        ...base,
        certificate: {
          ...(base.certificate as NonNullable<ArcaConnectionView['certificate']>),
          daysLeft: 12,
          renewSoon: true,
        },
      }),
    )
    expect(out).toContain('Renovalo antes de que venza')
  })

  it('D · con un problema: el texto simple y «Cómo se arregla» al paso', () => {
    const out = panel(
      overview({
        ...base,
        status: 'error',
        statusLabel: 'Con un problema',
        lastError: arcaProblemView('arca_not_authorized', { alias: 'barplataforma' }),
      }),
    )
    expect(out).toContain('Falta autorizar el certificado')
    expect(out).toContain('Cómo se arregla')
    expect(out).toMatch(/href="\/bar\/administracion\/ajustes\/arca#paso-7"/)
  })

  it('la contadora: ve el estado sin botones de carga', () => {
    const out = panel(overview(base), false)
    expect(out).toContain('Conectado')
    expect(out).not.toContain('Desconectar')
    expect(out).not.toContain('Probar')
    expect(out).not.toContain('role="switch"')
    expect(out).toContain('Ver la guía')
    expect(out).not.toMatch(/thinkeon|\bHUB\b/i)
  })
})
