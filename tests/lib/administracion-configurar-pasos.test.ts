import { describe, expect, it } from 'vitest'
import {
  checkWizard,
  initialWizardState,
  STEP_ONE_FIELDS,
  type WizardState,
  wizardPayload,
  wizardStateFromDraft,
} from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/wizard'
import {
  cajasSummary,
  cobrosSummary,
  draftStepOf,
  enabledMethodCount,
  errorsOfScreen,
  firstErrorScreen,
  OPENING_RAIL_STEP,
  puntosSummary,
  readWizardDraft,
  SETUP_RAIL_STEPS,
  sasSummary,
  setupRailItems,
  visualStepOfField,
  WIZARD_NEXT_LABEL,
  WIZARD_QUESTIONS,
  WIZARD_SCREENS,
  welcomeChecklist,
  wizardDraftValue,
} from '@/app/(manager)/[tenantSlug]/administracion/configurar/_lib/wizard-steps'
import { ONBOARDING_HAVE_AT_HAND } from '@/lib/accounting/onboarding'

/**
 * Los pasos de la puesta en marcha como se ven. El asistente pasó de dos pantallas a cinco pasos
 * chicos (más los saldos iniciales): cambia el recorrido, no lo que se manda. El borrador de
 * antes se tiene que seguir leyendo y lo que viaja tiene que ser lo mismo.
 */

const TODAY = '2026-10-13'
const initial = (): WizardState =>
  initialWizardState({ tenantName: 'Bar de Prueba', displayName: 'Ana', today: TODAY })

describe('el riel', () => {
  it('son seis pasos, con los nombres de cada lugar; el sexto son los saldos iniciales', () => {
    expect([...SETUP_RAIL_STEPS]).toEqual([
      'Datos de la SAS',
      'Cajas y cuentas',
      'Medios de cobro',
      'Puntos de venta',
      'Revisá y arrancá',
      'Saldos iniciales',
    ])
    expect(OPENING_RAIL_STEP).toBe(6)
    expect(SETUP_RAIL_STEPS[OPENING_RAIL_STEP - 1]).toBe('Saldos iniciales')
  })

  it('el avance es de verdad: lo anterior hecho, el actual y lo que falta', () => {
    expect(setupRailItems(3).map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ])
  })

  it('bar ya configurado con los saldos pendientes: cinco tildes y toca el sexto', () => {
    expect(setupRailItems(OPENING_RAIL_STEP).map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'current',
    ])
  })

  it('todo hecho: los seis tildados', () => {
    expect(setupRailItems('done').every((s) => s.state === 'done')).toBe(true)
  })

  it('al volver atrás a cambiar un paso, lo ya resuelto sigue tildado', () => {
    expect(setupRailItems(2, {}, 4).map((s) => s.state)).toEqual([
      'done',
      'current',
      'done',
      'done',
      'todo',
      'todo',
    ])
  })

  it('el resumen va solo en los pasos hechos', () => {
    const items = setupRailItems(2, { 1: 'Bar SAS', 2: 'Caja', 3: null })
    expect(items[0]).toEqual({ title: 'Datos de la SAS', state: 'done', summary: 'Bar SAS' })
    expect(items[1]).toEqual({ title: 'Cajas y cuentas', state: 'current' })
    expect(items[2]).toEqual({ title: 'Medios de cobro', state: 'todo' })
  })
})

describe('los cinco pasos del asistente', () => {
  it('cada paso pregunta una cosa y su botón dice a dónde va', () => {
    expect(WIZARD_SCREENS).toEqual([1, 2, 3, 4, 5])
    expect(WIZARD_QUESTIONS[1]).toBe('¿Cómo figura el bar en los papeles?')
    expect(WIZARD_QUESTIONS[2]).toBe('¿Dónde está la plata?')
    expect(WIZARD_QUESTIONS[3]).toBe('¿Cómo te pagan?')
    expect(WIZARD_QUESTIONS[4]).toBe('¿Con qué número facturás?')
    expect(WIZARD_QUESTIONS[5]).toBe('Revisá y arrancá')
    // Ningún «Seguir» se llama «Guardar»: solo guarda el último paso.
    for (const label of Object.values(WIZARD_NEXT_LABEL)) expect(label).not.toMatch(/guard/i)
  })

  it('a qué paso va el error de cada campo', () => {
    for (const field of STEP_ONE_FIELDS) expect(visualStepOfField(field)).toBe(1)
    expect(visualStepOfField('form')).toBe(1)
    expect(visualStepOfField('treasuries')).toBe(2)
    expect(visualStepOfField('treasury.bank_main.name')).toBe(2)
    expect(visualStepOfField('treasury.extra_1.cbuCvu')).toBe(2)
    expect(visualStepOfField('methods')).toBe(3)
    expect(visualStepOfField('transferDestination')).toBe(3)
    expect(visualStepOfField('rates')).toBe(3)
    expect(visualStepOfField('rates.mpQr')).toBe(3)
    expect(visualStepOfField('rates.pedidosya')).toBe(3)
    expect(visualStepOfField('salesPoints')).toBe(4)
    expect(visualStepOfField('salesPoint.sp_1.number')).toBe(4)
  })

  it('al dejar un paso se ven solo sus errores', () => {
    const errors = {
      legalName: 'Falta',
      'treasury.bank_main.name': 'Falta',
      'rates.debit': 'Mal',
      'salesPoint.sp_1.number': 'Mal',
    }
    expect(errorsOfScreen(errors, 2)).toEqual({ 'treasury.bank_main.name': 'Falta' })
    expect(errorsOfScreen(errors, 3)).toEqual({ 'rates.debit': 'Mal' })
    expect(errorsOfScreen(errors, 4)).toEqual({ 'salesPoint.sp_1.number': 'Mal' })
    expect(errorsOfScreen(errors, 5)).toEqual({})
    expect(errorsOfScreen({}, 1)).toEqual({})
  })

  it('al guardar, se abre el primer paso con un error', () => {
    expect(firstErrorScreen({})).toBeNull()
    expect(firstErrorScreen({ 'rates.debit': 'x', 'salesPoint.sp_1.number': 'y' })).toBe(3)
    expect(firstErrorScreen({ salesPoints: 'y', cuit: 'z' })).toBe(1)
  })

  it('con el esquema del servidor: un porcentaje mal va al paso 3; un punto de venta, al 4', () => {
    const state = initial()
    state.rates.debit = 'mucho'
    // Un punto de venta con nombre y sin número.
    state.salesPoints = [{ id: 'sp_1', number: '', label: 'Salón', channel: 'salon' }]
    const check = checkWizard(state, TODAY, 2)
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(Object.keys(errorsOfScreen(check.errors, 3))).toContain('rates.debit')
    expect(Object.keys(errorsOfScreen(check.errors, 2))).toEqual([])
    expect(Object.keys(errorsOfScreen(check.errors, 4)).length).toBeGreaterThan(0)
  })
})

describe('el borrador (hub:acc:draft:configurar:{slug})', () => {
  it('uno de antes del rediseño se sigue leyendo: retoma en el primer paso de su tramo', () => {
    const state = initial()
    expect(readWizardDraft({ v: 1, step: 2, state })).toEqual({ step: 2, screen: 2, state })
    expect(readWizardDraft({ v: 1, step: 1, state })).toEqual({ step: 1, screen: 1, state })
    // Y su estado se levanta con la función de siempre.
    const draft = readWizardDraft({ v: 1, step: 2, state })
    expect(wizardStateFromDraft(draft?.state, initial())).toEqual(state)
  })

  it('el nuevo conserva la versión y `step` (1 | 2), y suma en qué paso se estaba', () => {
    const state = initial()
    expect(wizardDraftValue(1, state)).toEqual({ v: 1, step: 1, screen: 1, state })
    for (const screen of [2, 3, 4, 5] as const) {
      expect(wizardDraftValue(screen, state)).toEqual({ v: 1, step: 2, screen, state })
      expect(draftStepOf(screen)).toBe(2)
    }
    expect(draftStepOf(1)).toBe(1)
  })

  it('ida y vuelta: lo que se guarda es lo que se lee', () => {
    const state = initial()
    for (const screen of WIZARD_SCREENS) {
      const saved: unknown = JSON.parse(JSON.stringify(wizardDraftValue(screen, state)))
      expect(readWizardDraft(saved)?.screen).toBe(screen)
    }
  })

  it('un `screen` que no existe o que no es de su tramo no se cree', () => {
    const state = initial()
    expect(readWizardDraft({ v: 1, step: 2, screen: 9, state })?.screen).toBe(2)
    expect(readWizardDraft({ v: 1, step: 1, screen: 4, state })?.screen).toBe(1)
    expect(readWizardDraft({ v: 1, step: 2, screen: 1, state })?.screen).toBe(2)
    expect(readWizardDraft({ v: 1, step: 2, screen: '3', state })?.screen).toBe(2)
  })

  it('otra versión, o algo que no es un borrador: no se lee', () => {
    expect(readWizardDraft({ v: 2, step: 1, state: {} })).toBeNull()
    expect(readWizardDraft({ step: 1 })).toBeNull()
    expect(readWizardDraft(null)).toBeNull()
    expect(readWizardDraft('x')).toBeNull()
    expect(readWizardDraft([])).toBeNull()
  })
})

describe('lo que se manda no cambió', () => {
  it('el estado inicial pasa la validación y viaja con las claves de siempre', () => {
    const state = initial()
    expect(checkWizard(state, TODAY, 1).ok).toBe(true)
    expect(checkWizard(state, TODAY, 2).ok).toBe(true)
    const raw = wizardPayload(state).raw as {
      displayName: string
      settings: Record<string, unknown>
      treasuries: unknown[]
      sales: Record<string, unknown>
    }
    expect(Object.keys(raw).sort()).toEqual(['displayName', 'sales', 'settings', 'treasuries'])
    expect(Object.keys(raw.settings).sort()).toEqual(
      [
        'legalName',
        'cuit',
        'ivaCondition',
        'iibbRegime',
        'iibbNumber',
        'iibbJurisdictionCode',
        'activityStartDate',
        'fiscalAddress',
        'booksStartDate',
        'fiscalYearEndMonth',
        'ivaSettlementMode',
      ].sort(),
    )
    expect(Object.keys(raw.sales).sort()).toEqual(
      [
        'transferDestination',
        'transferDeductsIibb',
        'enabledMethods',
        'enabledPlatforms',
        'rates',
        'salesPoints',
      ].sort(),
    )
    // La fecha que ahora se pregunta «¿Desde qué día querés cargar?» es el mismo campo.
    expect(raw.settings.booksStartDate).toBe('2026-10-01')
    expect(raw.treasuries).toHaveLength(3)
  })

  it('«seguir sin cargar ninguno» (sin renglones) manda lo mismo que dejar el renglón en blanco', () => {
    const blank = initial()
    const none = { ...initial(), salesPoints: [] }
    expect(wizardPayload(none).raw).toEqual(wizardPayload(blank).raw)
  })
})

describe('el resumen de cada paso', () => {
  it('con el estado inicial', () => {
    const state = initial()
    expect(sasSummary(state)).toBe('Bar de Prueba SAS · cargás desde el 01/10/2026')
    expect(cajasSummary(state)).toBe('Caja, Mercado Pago y Banco Nación · cuenta corriente')
    expect(enabledMethodCount(state)).toBe(6)
    expect(cobrosSummary(state)).toBe('6 medios · transferencias a Mercado Pago')
    expect(puntosSummary(state)).toBe('Sin puntos de venta')
  })

  it('las cajas apagadas no se nombran, y sin billetera el QR no cuenta', () => {
    const state = initial()
    state.treasuries = state.treasuries.map((t) =>
      t.preset === 'wallet' ? { ...t, enabled: false } : t,
    )
    expect(cajasSummary(state)).toBe('Caja y Banco Nación · cuenta corriente')
    // El QR no tiene adónde ir: se ve apagado y no viaja.
    expect(enabledMethodCount(state)).toBe(5)
    expect(cobrosSummary(state)).toBe('5 medios · transferencias a Banco Nación · cuenta corriente')
  })

  it('con apps de delivery y sin transferencias', () => {
    const state = initial()
    state.platforms.pedidosya = true
    state.platforms.rappi = true
    state.methods.transfer = false
    expect(cobrosSummary(state)).toBe('7 medios')
    state.methods = {
      cash: true,
      transfer: false,
      qr_mp: false,
      debit: false,
      credit: false,
      customer_account: false,
    }
    state.platforms.pedidosya = false
    state.platforms.rappi = false
    expect(cobrosSummary(state)).toBe('1 medio')
  })

  it('los puntos de venta', () => {
    const state = initial()
    state.salesPoints = [{ id: 'sp_1', number: '3', label: '', channel: 'salon' }]
    expect(puntosSummary(state)).toBe('Punto de venta 0003 · Salón')
    state.salesPoints = [{ id: 'sp_1', number: '3', label: 'Barra', channel: 'salon' }]
    expect(puntosSummary(state)).toBe('Punto de venta 0003 · Barra')
    state.salesPoints = [
      { id: 'sp_1', number: '3', label: 'Salón', channel: 'salon' },
      { id: 'sp_2', number: '5', label: 'Delivery', channel: 'delivery' },
      { id: 'sp_3', number: '', label: '', channel: 'salon' },
    ]
    expect(puntosSummary(state)).toBe('2 puntos de venta: 0003 y 0005')
  })

  it('datos raros no rompen el resumen', () => {
    const state = initial()
    expect(sasSummary({ legalName: '  ', booksStartDate: null })).toBe('Sin razón social')
    const long = 'Sociedad de Bares y Afines del Centro de Córdoba Sociedad por Acciones'
    expect(sasSummary({ legalName: long, booksStartDate: '2026-10-12' })).toBe(
      `${long} · cargás desde el 12/10/2026`,
    )
    expect(cajasSummary({ treasuries: [] })).toBe('Ninguna caja')
    state.treasuries = state.treasuries.map((t) => ({ ...t, name: '' }))
    expect(cajasSummary(state)).toBe('Sin nombre, Sin nombre y Sin nombre')
  })
})

describe('la bienvenida', () => {
  it('«Tené a mano» son cuatro renglones de la guía «Cómo arrancar»', () => {
    const list = welcomeChecklist(ONBOARDING_HAVE_AT_HAND)
    expect(list).toHaveLength(4)
    for (const line of list) expect(ONBOARDING_HAVE_AT_HAND).toContain(line)
    expect(list[0]).toMatch(/constancia de inscripción/)
    expect(list[1]).toMatch(/Mercado Pago/)
    expect(list[2]).toMatch(/comisión/)
    expect(list[3]).toMatch(/puntos de venta/)
  })

  it('si la guía no trae un renglón, no se inventa', () => {
    expect(welcomeChecklist([])).toEqual([])
    expect(welcomeChecklist(['La constancia de inscripción de la SAS.'])).toHaveLength(1)
  })
})
