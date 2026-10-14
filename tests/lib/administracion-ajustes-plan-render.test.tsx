// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ChartAccount } from '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas/_lib/tree'

/**
 * Lo que se corrigió en la pasada visual del 07/10 (plan de cuentas, puesta en marcha): el saldo en
 * cero alineado con los que llevan «D»/«A», el saldo de los grupos en el celular, los pasos del
 * asistente sin cortarse y la puesta en marcha ya hecha mandando a Ajustes.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hub/administracion/plan-de-cuentas',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/accounting/actions/master', () => ({
  saveAccount: vi.fn(),
  importAccounts: vi.fn(),
  remapSystemAccount: vi.fn(),
  saveTreasuryAccount: vi.fn(),
  saveParty: vi.fn(),
  ensureSuppliers: vi.fn(),
}))
// Las acciones de la puesta en marcha no se llaman al pintar: se reemplazan para no cargar el servidor.
vi.mock('@/lib/accounting/actions/setup', () => ({
  bootstrapAccounting: vi.fn(),
  postOpening: vi.fn(),
  skipOpening: vi.fn(),
}))

const PLAN = '@/app/(manager)/[tenantSlug]/administracion/plan-de-cuentas'
const CONFIGURAR = '@/app/(manager)/[tenantSlug]/administracion/configurar'

function account(over: Partial<ChartAccount> & Pick<ChartAccount, 'id' | 'code' | 'name'>) {
  return {
    type: 'asset',
    normalSide: 'debit',
    parentId: null,
    level: 1,
    postable: false,
    active: true,
    systemKey: null,
    requiresParty: false,
    isTreasury: false,
    purchaseSelectable: false,
    manualSelectable: true,
    description: null,
    balanceCents: 0,
    hasChildren: false,
    updatedAt: '2026-10-07T12:00:00.000+00:00',
    ...over,
  } satisfies ChartAccount
}

async function renderTree(accounts: ChartAccount[]): Promise<string> {
  const { ChartWorkspace } = await import(`${PLAN}/_components/chart-workspace`)
  const { ChartTree } = await import(`${PLAN}/_components/chart-tree`)
  return renderToString(
    createElement(
      ChartWorkspace,
      {
        tenantSlug: 'hub',
        accounts,
        readOnly: false,
        canAdmin: true,
        balancesAvailable: true,
        initialAccountId: null,
      },
      createElement(ChartTree),
    ),
  )
}

describe('plan de cuentas: saldos', () => {
  it('el cero deja el lugar de la letra (los centavos alineados) y los grupos muestran saldo en el celular', async () => {
    const html = await renderTree([
      account({
        id: '00000000-0000-4000-8000-000000000001',
        code: '1.0.00.00.000',
        name: 'ACTIVO',
        balanceCents: 1_000_000,
        hasChildren: true,
      }),
      account({
        id: '00000000-0000-4000-8000-000000000002',
        code: '2.0.00.00.000',
        name: 'PASIVO',
        type: 'liability',
        normalSide: 'credit',
        balanceCents: 0,
      }),
    ])
    // Cero: «0,00» + la «D» invisible (solo ocupa su lugar; los lectores no la leen).
    expect(html).toMatch(/0,00<span aria-hidden="true" class="invisible ml-1">D<\/span>/)
    // Los dos son grupos y los dos dicen su saldo en la línea del celular.
    expect(html.match(/Saldo /g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('puesta en marcha', () => {
  // Antes eran cuatro pasos («Datos», «Cajas», «Saldos», «Listo») y el segundo escondía tres
  // temas. Ahora el riel dice los seis, con el nombre que cada lugar tiene en Ajustes.
  it('el riel dice los seis pasos por su nombre, y en el celular «Paso N de 6»', async () => {
    const { SetupRail } = await import(`${CONFIGURAR}/_components/setup-rail`)
    const html = renderToString(
      createElement(SetupRail, { current: 2, summaries: { 1: 'Bar de Prueba SAS' } }),
    ).replaceAll('<!-- -->', '')
    for (const label of [
      'Datos de la SAS',
      'Cajas y cuentas',
      'Medios de cobro',
      'Puntos de venta',
      'Revisá y arrancá',
      'Saldos iniciales',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).toContain('aria-label="Pasos de la puesta en marcha"')
    // El paso que toca se marca para lectores, y uno solo.
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1)
    expect(html).toContain('Paso 2 de 6')
    // Lo ya cargado se lee debajo del paso resuelto.
    expect(html).toContain('Bar de Prueba SAS')
    expect(html).toContain('Después: sumar a tus socios y conectar ARCA, cuando quieras.')
  })

  it('el avance del riel es el de verdad', async () => {
    const { setupRailItems, OPENING_RAIL_STEP } = await import(`${CONFIGURAR}/_lib/wizard-steps`)
    const states = (current: number | 'done', doneUpTo?: number) =>
      (setupRailItems(current, {}, doneUpTo) as { state: string }[]).map((s) => s.state)
    expect(states(1)).toEqual(['current', 'todo', 'todo', 'todo', 'todo', 'todo'])
    // Con el bar ya configurado toca el sexto: los cinco anteriores, tildados.
    expect(states(OPENING_RAIL_STEP)).toEqual(['done', 'done', 'done', 'done', 'done', 'current'])
    expect(states('done')).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
    // Volver atrás a cambiar un paso no destilda lo que ya se resolvió.
    expect(states(2, 4)).toEqual(['done', 'current', 'done', 'done', 'todo', 'todo'])
  })

  it('ya configurada: lo dice y manda a Ajustes', async () => {
    const { SetupDone } = await import(`${CONFIGURAR}/_components/setup-done`)
    const html = renderToString(createElement(SetupDone, { tenantSlug: 'hub' }))
    expect(html).toContain('Administración ya está configurada.')
    expect(html).toContain('href="/hub/administracion/ajustes"')
    expect(html).toContain('Ir a Ajustes')
    expect(html).toContain('Ir al Resumen')
    // Sin pendientes no hay «Lo próximo».
    expect(html).not.toContain('Lo próximo')
  })

  it('el ticket de los saldos iniciales: recién guardado no dice «Todavía no está guardado»', async () => {
    const { OpeningTicket } = await import(`${CONFIGURAR}/_components/opening-ticket`)
    const props = {
      startDate: '12/10/2026',
      boxes: [{ id: 'caja', name: 'Caja Efectivo', cents: 4_825_000 }],
      boxesCents: 4_825_000,
      owedToYou: { count: 0, cents: 0 },
      youOwed: { count: 4, cents: 87_120_000 },
      totals: {
        assetsCents: 4_825_000,
        liabilitiesCents: 87_120_000,
        equityCents: -82_295_000,
        capitalCents: 0,
        unassignedCents: -82_295_000,
      },
      entries: [],
    }
    const pending = renderToString(createElement(OpeningTicket, props))
    expect(pending).toContain('aria-label="Lo que había al 12/10/2026"')
    expect(pending).toContain('Caja Efectivo')
    expect(pending).toContain(
      'Todavía no está guardado: se guarda una sola vez, en el último paso.',
    )
    const saved = renderToString(createElement(OpeningTicket, { ...props, saved: true }))
    expect(saved).toContain('Guardado')
    expect(saved).not.toContain('Todavía no está guardado')
    // El ticket es un resumen: no trae ningún botón que guarde.
    expect(saved).not.toMatch(/Guardar|type="submit"/)
  })

  it('ya configurada y con pendientes: «Lo próximo» con su botón', async () => {
    const { SetupDone } = await import(`${CONFIGURAR}/_components/setup-done`)
    const html = renderToString(
      createElement(SetupDone, {
        tenantSlug: 'hub',
        guideHref: '/hub/administracion/guias/como-arrancar',
        next: [
          {
            id: 'sas_data',
            title: 'Completá los datos de la SAS',
            detail: 'Falta la CUIT.',
            done: false,
            optional: false,
            action: {
              kind: 'href',
              href: '/hub/administracion/ajustes?tab=sas',
              label: 'Completar',
            },
          },
        ],
      }),
    )
    expect(html).toContain('Lo próximo')
    expect(html).toContain('Completá los datos de la SAS')
    expect(html).toContain('Falta la CUIT.')
    expect(html).toContain('href="/hub/administracion/ajustes?tab=sas"')
    expect(html).toContain('Ver todo lo que falta')
  })
})

/**
 * El 12/10 un Enter cerró la puesta en marcha de un bar a medias. Desde el rediseño el asistente
 * son cinco pasos dentro de UN formulario: «Seguir» nunca envía y solo el último paso guarda. Un
 * `<button>` sin `type` adentro de un formulario envía: acá se prueba que no haya ninguno.
 */
describe('puesta en marcha: qué botones envían', () => {
  const WIZARD = { tenantName: 'Bar de Prueba', displayName: 'Franco', today: '2026-10-13' }
  const noop = () => {}

  /** Los `<button …>` del HTML, con sus atributos. */
  const buttonTags = (html: string) => html.match(/<button\b[^>]*>/g) ?? []
  const submits = (html: string) => buttonTags(html).filter((tag) => tag.includes('type="submit"'))
  const untyped = (html: string) => buttonTags(html).filter((tag) => !/\btype="/.test(tag))

  type Steps = { sas: string; cajas: string; cobros: string; puntos: string }

  async function renderSteps(): Promise<Steps> {
    const { initialWizardState } = await import(`${CONFIGURAR}/_lib/wizard`)
    const { StepSas } = await import(`${CONFIGURAR}/_components/wizard/step-sas`)
    const { StepCajas } = await import(`${CONFIGURAR}/_components/wizard/step-cajas`)
    const { StepCobros } = await import(`${CONFIGURAR}/_components/wizard/step-cobros`)
    const { StepPuntos } = await import(`${CONFIGURAR}/_components/wizard/step-puntos`)
    const state = initialWizardState(WIZARD)
    const common = { state, errors: {}, clearError: noop }
    return {
      sas: renderToString(
        createElement(StepSas, {
          ...common,
          today: WIZARD.today,
          update: noop,
          setState: noop,
          setErrors: noop,
        }),
      ),
      cajas: renderToString(
        createElement(StepCajas, {
          ...common,
          updateTreasury: noop,
          removeTreasury: noop,
          addTreasury: noop,
        }),
      ),
      cobros: renderToString(
        createElement(StepCobros, {
          ...common,
          proposed: state.rates,
          setState: noop,
          update: noop,
        }),
      ),
      puntos: renderToString(
        createElement(StepPuntos, {
          ...common,
          updatePoint: noop,
          removePoint: noop,
          addPoint: noop,
        }),
      ),
    }
  }

  it('los pasos 1 a 4 no traen ningún botón que envíe el formulario', async () => {
    const steps = await renderSteps()
    for (const [name, html] of Object.entries(steps)) {
      expect(submits(html), `paso ${name}: submit`).toEqual([])
      expect(untyped(html), `paso ${name}: botón sin type`).toEqual([])
    }
    // Para que no pase por estar vacío: cada paso dibuja sus controles.
    expect(steps.sas).toContain('¿Desde qué día querés cargar?')
    expect(buttonTags(steps.cajas).length).toBeGreaterThan(0)
    expect(steps.cobros).toContain('role="switch"')
    expect(steps.puntos).toContain('Agregar un punto de venta')
  })

  it('el paso 5 es el único que guarda, con UN botón; ya guardado, ninguno', async () => {
    const { initialWizardState } = await import(`${CONFIGURAR}/_lib/wizard`)
    const { StepReview } = await import(`${CONFIGURAR}/_components/wizard/step-review`)
    const props = {
      state: initialWizardState(WIZARD),
      pending: false,
      saved: false,
      banner: null,
      formError: null,
      continueHref: '/hub/administracion/configurar',
    }
    const review = renderToString(createElement(StepReview, props))
    expect(submits(review)).toHaveLength(1)
    expect(review).toContain('Guardar y arrancar')
    expect(review).toContain('Hasta acá no se guardó nada')
    const saved = renderToString(createElement(StepReview, { ...props, saved: true }))
    expect(submits(saved)).toEqual([])
    expect(saved).toContain('href="/hub/administracion/configurar"')
  })

  it('la bienvenida no guarda nada: un solo botón, «Empezar», y ningún formulario', async () => {
    const { SetupWizard } = await import(`${CONFIGURAR}/_components/setup-wizard`)
    const html = renderToString(
      createElement(SetupWizard, {
        tenantSlug: 'hub',
        today: WIZARD.today,
        tenantName: WIZARD.tenantName,
        defaultDisplayName: WIZARD.displayName,
        haveAtHand: ['La constancia de inscripción de la SAS.'],
      }),
    )
    expect(html).toContain('Armemos Administración')
    expect(html).toContain('La constancia de inscripción de la SAS.')
    expect(html).not.toContain('<form')
    expect(buttonTags(html)).toHaveLength(1)
    expect(submits(html)).toEqual([])
    expect(html).toContain('Empezar')
  })

  // La propuesta del banco ya trae su nombre escrito y, si queda, viaja y se crea como proveedor
  // (`createBankParty`). Lo que viaja sin que nadie lo toque tiene que estar a la vista: no puede
  // quedar adentro de un «(puede esperar)» plegado.
  it('el banco propuesto se ve sin abrir nada; plegados quedan solo el alias y el CBU', async () => {
    const { initialWizardState, wizardPayload } = await import(`${CONFIGURAR}/_lib/wizard`)
    const state = initialWizardState(WIZARD)
    const { cajas } = await renderSteps()
    const bank = cajas.indexOf('id="wz-t-bank_main-bank"')
    expect(bank).toBeGreaterThan(-1)
    expect(cajas).toContain('value="Banco de la Nación Argentina"')
    // Entre el comienzo de su tarjeta y el campo no se abre ningún plegado.
    const card = cajas.lastIndexOf('id="wz-t-bank_main-name"', bank)
    expect(card).toBeGreaterThan(-1)
    expect(cajas.slice(card, bank)).not.toContain('<details')
    // El alias y el CBU sí pueden esperar: van después, plegados.
    const alias = cajas.indexOf('id="wz-t-bank_main-alias"')
    expect(cajas.slice(bank, alias)).toContain('<details')
    expect(cajas.slice(bank, alias)).not.toMatch(/<details[^>]*open=""/)
    // Y es lo que viaja si la persona no toca nada.
    const sent = wizardPayload(state).raw.treasuries as Array<Record<string, unknown>>
    expect(sent.find((t) => t.key === 'bank_main')).toMatchObject({
      bankName: 'Banco de la Nación Argentina',
      createBankParty: true,
    })
  })

  it('saldos iniciales: un solo botón guarda; «arrancar en cero» y el resto no envían', async () => {
    const { OpeningStep } = await import(`${CONFIGURAR}/_components/opening-step`)
    const html = renderToString(
      createElement(OpeningStep, {
        tenantSlug: 'hub',
        booksStartDate: '2026-10-12',
        treasuries: [
          { id: 'caja', name: 'Caja Efectivo', kind: 'cash' },
          { id: 'mp', name: 'Mercado Pago', kind: 'wallet' },
        ],
        // El motor no llega a armar nada con el formulario vacío: alcanza con los partícipes.
        ctx: { parties: new Map() },
        accounts: [],
        otherAccountIds: [],
      }),
    ).replaceAll('<!-- -->', '')
    expect(html.match(/<form\b/g) ?? []).toHaveLength(1)
    expect(submits(html)).toHaveLength(1)
    expect(untyped(html)).toEqual([])
    expect(html).toContain('Guardar los saldos iniciales')
    expect(html).toContain('No tengo los números: arrancar todo en cero')
    expect(html).toContain('Falta una caja o cuenta')
    // Vacío no dibuja ceros: el total dice «—», nunca «$ 0».
    expect(html).toContain('Cargá algún importe y esto se arma solo.')
    expect(html).toContain('Todavía sin importes')
  })
})
