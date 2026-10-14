import { describe, expect, it } from 'vitest'
import {
  CONFIG_STEP_IDS,
  configSteps,
  doneNextSteps,
  setupNextView,
  stepHref,
} from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/setup-next'
import { buildSetup, type SetupStep } from '@/lib/accounting/home'
import { type OnboardingData, onboardingState } from '@/lib/accounting/onboarding'

/**
 * «Lo próximo» de la puesta en marcha en la portada de Ajustes y en «Listo». Tiene que ser la
 * MISMA verdad que la franja del Resumen: los pasos salen de `buildSetup`, y acá solo se filtran
 * los de esta área. Si el Resumen dice «Cargá lo que hay hoy en cada caja», Ajustes dice eso
 * mismo, con el mismo botón y al mismo lugar.
 */

const BASE = '/hub/administracion'

/** HUB hoy: sin saldos iniciales, sin CUIT, sin banco, 9 medios, sin puntos de venta ni ARCA. */
const HUB: OnboardingData = {
  today: '2026-10-13',
  sasMissing: ['cuit', 'activity_start_date'],
  bankWithCbu: false,
  walletWithCvu: false,
  salesMethods: 9,
  salesPoints: 0,
  openingDone: false,
  partnerGranted: true,
  accountantAdded: false,
  arca: null,
  arcaVouchersAttention: 0,
  mp: null,
  imports: {},
  mcPrevMonthCovered: false,
  recurringActive: 31,
  dailyCloseMissing: 1,
  mpInvoiceThisMonth: false,
  treasuriesUnchecked: 2,
  prevMonthClosed: false,
  booksStartDate: '2026-10-12',
  manual: [],
}

const FULL: OnboardingData = {
  ...HUB,
  sasMissing: [],
  bankWithCbu: true,
  walletWithCvu: true,
  salesPoints: 2,
  openingDone: true,
  accountantAdded: true,
  arca: { status: 'connected', certNotAfter: '2028-10-01', emissionEnabled: true },
  manual: ['platforms'],
}

function strip(
  data: OnboardingData,
  settings: { openingStatus: 'pending' | 'posted'; cuit: string | null },
) {
  return buildSetup({
    summary: null,
    settings,
    onboarding: { state: onboardingState(data), data },
    canWrite: true,
    base: BASE,
  })
}

const HUB_STRIP = strip(HUB, { openingStatus: 'pending', cuit: null })
const HUB_FACTS = { openingPending: true, cuitMissing: true, noMethods: false }

describe('los pasos de esta área', () => {
  it('son ocho, y salen de buildSetup en su orden', () => {
    const steps = configSteps(HUB_STRIP)
    expect(steps.map((s) => s.id)).toEqual([
      'opening',
      'sas_data',
      'treasuries',
      'sales_methods',
      'platforms',
      'sales_points',
      'access',
      'arca',
    ])
    expect(new Set(steps.map((s) => s.id))).toEqual(new Set(CONFIG_STEP_IDS))
    // Es un filtro: el orden relativo es el de la franja del Resumen.
    const all = HUB_STRIP.steps.map((s) => s.id)
    const picked = steps.map((s) => all.indexOf(s.id))
    expect(picked).toEqual([...picked].sort((a, b) => a - b))
  })

  it('no trae lo que se hace en otra área (el plan de cuentas, los gastos fijos, importar)', () => {
    const ids = configSteps(HUB_STRIP).map((s) => s.id)
    for (const other of ['chart_review', 'arca_first_import', 'recurring', 'first_close']) {
      expect(ids).not.toContain(other)
    }
  })

  it('cada paso es EL MISMO objeto que arma la franja del Resumen (título, oración y botón)', () => {
    for (const step of configSteps(HUB_STRIP)) {
      expect(HUB_STRIP.steps).toContain(step)
    }
  })
})

describe('HUB hoy: lo que hace que los números sean de verdad', () => {
  const view = setupNextView(configSteps(HUB_STRIP), HUB_FACTS)

  it('lo primero son los saldos iniciales, con el texto y el botón del Resumen', () => {
    expect(view.kind).toBe('urgent')
    if (view.kind !== 'urgent') return
    expect(view.step.id).toBe('opening')
    expect(view.step.title).toBe('Cargá lo que hay hoy en cada caja')
    expect(view.step.detail).toBe(
      'Los saldos iniciales: cuánta plata hay y cuánto se debe. Sin eso, todo arranca en cero.',
    )
    expect(view.step.action).toEqual({
      kind: 'href',
      href: '/hub/administracion/configurar',
      label: 'Cargar lo que hay',
    })
    expect(stepHref(view.step)).toBe('/hub/administracion/configurar')
  })

  it('«Después»: los dos pendientes que siguen', () => {
    if (view.kind !== 'urgent') return
    expect(view.after.map((s) => s.title)).toEqual([
      'Completá los datos de la SAS',
      'Cajas y cuentas',
    ])
    expect(view.after.map(stepHref)).toEqual([
      '/hub/administracion/ajustes?tab=sas',
      '/hub/administracion/ajustes?tab=cajas',
    ])
  })
})

describe('qué es urgente y qué puede esperar', () => {
  it('con los saldos cargados y sin CUIT, lo urgente es la CUIT', () => {
    const s = strip({ ...HUB, openingDone: true }, { openingStatus: 'posted', cuit: null })
    const view = setupNextView(configSteps(s), { ...HUB_FACTS, openingPending: false })
    expect(view.kind === 'urgent' && view.step.id).toBe('sas_data')
  })

  it('sin ningún medio prendido, eso es urgente (no se puede cargar el cierre)', () => {
    const s = strip(
      { ...HUB, openingDone: true, sasMissing: [], salesMethods: 0 },
      { openingStatus: 'posted', cuit: '30712345671' },
    )
    const view = setupNextView(configSteps(s), {
      openingPending: false,
      cuitMissing: false,
      noMethods: true,
    })
    expect(view.kind === 'urgent' && view.step.id).toBe('sales_methods')
  })

  it('con CUIT y saldos, lo demás puede esperar: una línea, sin cartel de «falta»', () => {
    const s = strip(
      { ...HUB, openingDone: true, sasMissing: ['activity_start_date'] },
      { openingStatus: 'posted', cuit: '30712345671' },
    )
    const view = setupNextView(configSteps(s), {
      openingPending: false,
      cuitMissing: false,
      noMethods: false,
    })
    expect(view.kind).toBe('later')
    if (view.kind !== 'later') return
    // Faltan: el resto de la constancia, el banco, las comisiones, los puntos de venta, la
    // contadora y ARCA. Se nombran hasta tres.
    expect(view.steps.map((x) => x.id)).toEqual(['sas_data', 'treasuries', 'platforms'])
    expect(view.more).toBe(3)
  })

  it('un hecho urgente sin su paso pendiente no inventa un cartel', () => {
    const s = strip(FULL, { openingStatus: 'posted', cuit: '30712345671' })
    expect(setupNextView(configSteps(s), HUB_FACTS)).toEqual({ kind: 'complete' })
  })

  it('con todo hecho: completa', () => {
    const s = strip(FULL, { openingStatus: 'posted', cuit: '30712345671' })
    expect(configSteps(s).every((x) => x.done)).toBe(true)
    expect(
      setupNextView(configSteps(s), {
        openingPending: false,
        cuitMissing: false,
        noMethods: false,
      }),
    ).toEqual({ kind: 'complete' })
  })

  it('sin pasos (la guía no cargó): completa, no un error', () => {
    expect(setupNextView([], HUB_FACTS)).toEqual({ kind: 'complete' })
  })
})

describe('«Lo próximo» de la pantalla «Listo»', () => {
  it('hasta tres pendientes, con su link', () => {
    const s = strip({ ...HUB, openingDone: true }, { openingStatus: 'posted', cuit: null })
    const next = doneNextSteps(configSteps(s))
    expect(next).toHaveLength(3)
    expect(next[0]?.title).toBe('Completá los datos de la SAS')
    expect(next[0]?.detail).toBe('Falta la CUIT y el inicio de actividades.')
    expect(next[0]?.action?.label).toBe('Completar')
    for (const step of next) expect(stepHref(step)).toMatch(/^\/hub\/administracion\//)
  })

  it('sin pendientes no hay nada que mostrar', () => {
    const s = strip(FULL, { openingStatus: 'posted', cuit: '30712345671' })
    expect(doneNextSteps(configSteps(s))).toEqual([])
  })

  it('un paso sin link no se ofrece', () => {
    const step: SetupStep = {
      id: 'opening',
      title: 'x',
      detail: null,
      done: false,
      optional: false,
      action: null,
    }
    expect(stepHref(step)).toBeNull()
    expect(doneNextSteps([step])).toEqual([])
  })
})

describe('la contadora', () => {
  it('recibe solo lo que le cambia la lectura, sin acciones', () => {
    const s = buildSetup({
      summary: null,
      settings: { openingStatus: 'pending', cuit: null },
      onboarding: { state: onboardingState(HUB), data: HUB },
      canWrite: false,
      base: BASE,
    })
    expect(s.steps.map((x) => x.title)).toEqual([
      'Faltan los saldos iniciales',
      'Falta el CUIT de la SAS',
    ])
    expect(s.steps.every((x) => x.action === null)).toBe(true)
  })
})
