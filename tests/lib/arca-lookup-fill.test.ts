/**
 * «Completar con ARCA» (diseño §3.1): de lo que trae ARCA de una CUIT a los campos
 * de cada formulario. Lo que importa: que lo vacío se complete solo, que lo que la
 * persona escribió no se pise sin preguntar (salvo que sea el comienzo de lo de
 * ARCA, lo que se tipeó en el combo para buscar), que la condición frente al IVA
 * caiga en una opción del combo (o se pida a mano cuando ARCA no la sabe) y que los
 * textos y los links de «Cómo arreglarlo» sean los de la guía.
 *
 * Al final, las piezas de la pantalla (`ArcaLookupTrigger` y `ArcaLookupPanel`)
 * renderizadas en el servidor con un estado armado a mano: qué se ve en cada caso.
 *
 * CUIT sintéticas con el dígito verificador bien: SAS 30-71234567-1, persona 20-12345678-6.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// La pantalla sin Next ni servidor: el link es un <a>, las acciones no se llaman y
// no hay contexto de Administración (como en la puesta en marcha).
vi.mock('next/link', async () => {
  const react = await import('react')
  return {
    default: ({ href, children, ...rest }: Record<string, unknown> & { href: string }) =>
      react.createElement('a', { href, ...rest }, children as never),
  }
})
vi.mock('@/lib/arca/actions', () => ({ lookupCuit: vi.fn(), fetchArcaLookupStatus: vi.fn() }))
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccountingOptional: () => null,
}))

import {
  type ArcaLookupController,
  ArcaLookupPanel,
  type ArcaLookupState,
  ArcaLookupTrigger,
} from '@/components/administracion/arca-lookup'
import { IVA_CONDITIONS, type IvaCondition } from '@/lib/accounting/types'
import {
  arcaGuideStepHref,
  arcaSettingsHref,
  completesTyped,
  ivaOptionsWith,
  ivaPlainText,
  joinEs,
  LOOKUP_ADDRESS_MAX,
  LOOKUP_NAME_MAX,
  lookupAnnouncement,
  lookupAppliedMessage,
  lookupFailureView,
  lookupIvaTarget,
  lookupPatch,
  lookupSourceText,
  lookupWords,
  padronAddressText,
  personKindText,
  planLookupFill,
  sameLookupText,
} from '@/lib/arca/lookup-fill'
import { type PadronLookupData, type PadronLookupResult, padronDataFromRow } from '@/lib/arca/views'

const SLUG = 'bar-demo'

function data(over: Partial<PadronLookupData> = {}): PadronLookupData {
  return {
    cuit: '30712345671',
    name: 'DISTRIBUIDORA EJEMPLO SA',
    personKind: 'juridica',
    active: true,
    ivaCondition: 'responsable_inscripto',
    condicionIvaReceptorId: 1,
    needsReview: false,
    monotributoCategory: null,
    address: 'AV COLON 1234',
    locality: 'CORDOBA',
    province: 'CORDOBA',
    activity: { code: '463211', description: 'VENTA AL POR MAYOR DE BEBIDAS' },
    source: 'arca',
    environment: 'produccion',
    testData: false,
    fetchedAt: '2026-10-08T13:00:00.000Z',
    warnings: [],
    ...over,
  }
}

type Failure = Extract<PadronLookupResult, { ok: false }>
function failure(over: Partial<Failure> & Pick<Failure, 'code'>): Failure {
  return { ok: false, message: 'Algo pasó.', step: null, ...over }
}

// ─── Textos ──────────────────────────────────────────────────────────────────

describe('lookupWords / sameLookupText', () => {
  it('compara sin tildes, sin mayúsculas y sin los puntos de las siglas', () => {
    expect(lookupWords('Distribuidora Ejemplo S.A.')).toEqual(['distribuidora', 'ejemplo', 'sa'])
    expect(sameLookupText('Distribuidora Ejemplo S.A.', 'DISTRIBUIDORA EJEMPLO SA')).toBe(true)
    expect(sameLookupText('Panadería Ñandú  SRL', 'PANADERIA NANDU S.R.L.')).toBe(true)
    expect(sameLookupText('Hub Coffee & Bar', 'HUB COFFEE & BAR')).toBe(true)
  })

  it('dos textos distintos o vacíos no son el mismo', () => {
    expect(sameLookupText('Bebidas del Centro', 'DISTRIBUIDORA EJEMPLO SA')).toBe(false)
    expect(sameLookupText('', '')).toBe(false)
    expect(sameLookupText(null, 'X')).toBe(false)
  })
})

describe('completesTyped', () => {
  it('lo escrito es el comienzo de lo de ARCA (en cualquier orden)', () => {
    expect(completesTyped('distri', 'DISTRIBUIDORA EJEMPLO SA')).toBe(true)
    expect(completesTyped('ejemplo distri', 'DISTRIBUIDORA EJEMPLO SA')).toBe(true)
    expect(completesTyped('Coca-Cola', 'COCA COLA FEMSA DE BUENOS AIRES SA')).toBe(true)
  })

  it('lo escrito dice otra cosa', () => {
    expect(completesTyped('Pepe', 'PEREZ JOSE')).toBe(false)
    expect(completesTyped('Distribuidora Ejemplo (Córdoba)', 'DISTRIBUIDORA EJEMPLO SA')).toBe(
      false,
    )
    expect(completesTyped('', 'DISTRIBUIDORA EJEMPLO SA')).toBe(false)
    expect(completesTyped('distri', '')).toBe(false)
  })
})

describe('joinEs', () => {
  it('une con comas y una «y»', () => {
    expect(joinEs([])).toBe('')
    expect(joinEs(['a'])).toBe('a')
    expect(joinEs(['a', 'b'])).toBe('a y b')
    expect(joinEs(['a', 'b', 'c'])).toBe('a, b y c')
  })
})

describe('padronAddressText', () => {
  it('no repite la localidad cuando es igual a la provincia', () => {
    expect(padronAddressText(data())).toBe('AV COLON 1234, CORDOBA')
  })

  it('arma la línea con lo que haya', () => {
    expect(
      padronAddressText(
        data({
          address: 'AV CORRIENTES  100 ',
          locality: null,
          province: 'CIUDAD AUTONOMA BUENOS AIRES',
        }),
      ),
    ).toBe('AV CORRIENTES 100, CIUDAD AUTONOMA BUENOS AIRES')
    expect(padronAddressText(data({ address: null, locality: 'VILLA MARIA' }))).toBe(
      'VILLA MARIA, CORDOBA',
    )
    expect(padronAddressText(data({ address: null, locality: null, province: null }))).toBeNull()
  })

  it('respeta el tope del campo dirección', () => {
    const long = padronAddressText(data({ address: 'X'.repeat(400) }))
    expect(long?.length).toBe(LOOKUP_ADDRESS_MAX)
  })
})

describe('personKindText', () => {
  it('persona o empresa', () => {
    expect(personKindText('fisica')).toBe('Persona')
    expect(personKindText('juridica')).toBe('Empresa')
    expect(personKindText(null)).toBeNull()
  })
})

describe('ivaPlainText', () => {
  it('explica las seis condiciones sin prometer letras de factura', () => {
    for (const condition of IVA_CONDITIONS) {
      const text = ivaPlainText(condition)
      expect(text.length).toBeGreaterThan(10)
      expect(text).not.toMatch(/Factura [ABCM]\b/)
    }
  })
})

// ─── Condición frente al IVA ─────────────────────────────────────────────────

describe('lookupIvaTarget', () => {
  const supplierQuick: IvaCondition[] = ['responsable_inscripto', 'monotributo', 'exento']

  it('usa la de ARCA si el combo la tiene', () => {
    expect(lookupIvaTarget('monotributo', supplierQuick)).toBe('monotributo')
    expect(lookupIvaTarget('exento')).toBe('exento')
  })

  it('una respuesta firme se usa aunque el combo no la tenga (el formulario la suma)', () => {
    expect(lookupIvaTarget('no_alcanzado', supplierQuick)).toBe('no_alcanzado')
  })

  it('«sin datos» nunca completa; consumidor final solo si el combo lo ofrece', () => {
    expect(lookupIvaTarget('sin_datos')).toBeNull()
    expect(lookupIvaTarget('consumidor_final', supplierQuick)).toBeNull()
    expect(lookupIvaTarget('consumidor_final', ['consumidor_final', 'responsable_inscripto'])).toBe(
      'consumidor_final',
    )
  })
})

describe('ivaOptionsWith', () => {
  const base = [
    { value: 'responsable_inscripto' as const, label: 'Responsable inscripto' },
    { value: 'monotributo' as const, label: 'Monotributo' },
  ]

  it('suma la condición que tiene el formulario si no está en la lista', () => {
    expect(ivaOptionsWith(base, 'no_alcanzado')).toEqual([
      ...base,
      { value: 'no_alcanzado', label: 'No alcanzado' },
    ])
  })

  it('si ya está (o no hay), la lista queda igual', () => {
    expect(ivaOptionsWith(base, 'monotributo')).toBe(base)
    expect(ivaOptionsWith(base, null)).toBe(base)
  })
})

// ─── El plan ─────────────────────────────────────────────────────────────────

describe('planLookupFill', () => {
  it('un formulario vacío se completa entero sin preguntar', () => {
    const plan = planLookupFill(data(), { name: '', ivaCondition: null, address: null })
    expect(plan.fill).toEqual({
      name: 'DISTRIBUIDORA EJEMPLO SA',
      ivaCondition: 'responsable_inscripto',
      address: 'AV COLON 1234, CORDOBA',
    })
    expect(plan.conflicts).toEqual([])
    expect(plan.fills.map((c) => [c.field, c.from, c.to])).toEqual([
      ['name', null, 'DISTRIBUIDORA EJEMPLO SA'],
      ['ivaCondition', null, 'Responsable inscripto'],
      ['address', null, 'AV COLON 1234, CORDOBA'],
    ])
  })

  it('lo que se tipeó en el combo para buscar se completa (no es pisar)', () => {
    const plan = planLookupFill(data(), { name: 'distri ejemplo' })
    expect(plan.fill.name).toBe('DISTRIBUIDORA EJEMPLO SA')
    expect(plan.fills[0]).toMatchObject({ field: 'name', from: 'distri ejemplo' })
    expect(plan.conflicts).toEqual([])
  })

  it('lo guardado en la ficha se pregunta aunque sea el comienzo de lo de ARCA', () => {
    const plan = planLookupFill(
      data(),
      { name: 'Distribuidora', address: 'av colon' },
      { chosen: ['name', 'address'] },
    )
    expect(plan.fill).toEqual({})
    expect(plan.replace).toEqual({
      name: 'DISTRIBUIDORA EJEMPLO SA',
      address: 'AV COLON 1234, CORDOBA',
    })
    // Igual sigue sin preguntar lo que ya dice lo mismo, ni lo vacío.
    const same = planLookupFill(
      data(),
      { name: 'Distribuidora Ejemplo S.A.', address: null },
      { chosen: ['name', 'address'] },
    )
    expect(same.unchanged).toEqual(['name'])
    expect(same.fill).toEqual({ address: 'AV COLON 1234, CORDOBA' })
  })

  it('un nombre distinto se pregunta antes de cambiarlo', () => {
    const plan = planLookupFill(data(), { name: 'Bebidas del Centro' })
    expect(plan.fill).toEqual({})
    expect(plan.replace).toEqual({ name: 'DISTRIBUIDORA EJEMPLO SA' })
    expect(plan.conflicts).toEqual([
      {
        field: 'name',
        label: 'Razón social',
        from: 'Bebidas del Centro',
        to: 'DISTRIBUIDORA EJEMPLO SA',
      },
    ])
  })

  it('el mismo nombre con otra escritura no cambia', () => {
    const plan = planLookupFill(data(), { name: 'Distribuidora Ejemplo S.A.' })
    expect(plan.unchanged).toEqual(['name'])
    expect(plan.fill).toEqual({})
    expect(plan.replace).toEqual({})
  })

  it('la condición del combo sin tocar se completa; la elegida a mano se pregunta', () => {
    const untouched = planLookupFill(data({ ivaCondition: 'monotributo' }), {
      ivaCondition: 'responsable_inscripto',
    })
    expect(untouched.fill).toEqual({ ivaCondition: 'monotributo' })

    const chosen = planLookupFill(
      data({ ivaCondition: 'monotributo' }),
      { ivaCondition: 'responsable_inscripto' },
      { chosen: ['ivaCondition'] },
    )
    expect(chosen.fill).toEqual({})
    expect(chosen.replace).toEqual({ ivaCondition: 'monotributo' })
    expect(chosen.conflicts[0]).toMatchObject({
      field: 'ivaCondition',
      from: 'Responsable inscripto',
      to: 'Monotributo',
    })

    const same = planLookupFill(
      data(),
      { ivaCondition: 'responsable_inscripto' },
      { chosen: ['ivaCondition'] },
    )
    expect(same.unchanged).toEqual(['ivaCondition'])
  })

  it('sin condición en el formulario, la elegida no pisa nada', () => {
    const plan = planLookupFill(data(), { ivaCondition: null }, { chosen: ['ivaCondition'] })
    expect(plan.fill).toEqual({ ivaCondition: 'responsable_inscripto' })
  })

  it('cuando ARCA no sabe la condición, la deja y lo dice', () => {
    const plan = planLookupFill(data({ ivaCondition: 'sin_datos', needsReview: true }), {
      name: '',
      ivaCondition: 'responsable_inscripto',
    })
    expect(plan.fill).toEqual({ name: 'DISTRIBUIDORA EJEMPLO SA' })
    expect(plan.notes).toEqual(['ARCA no dice la condición frente al IVA: elegila vos.'])

    const person = planLookupFill(
      data({ ivaCondition: 'consumidor_final', personKind: 'fisica', needsReview: true }),
      { ivaCondition: 'responsable_inscripto' },
      { ivaOptions: ['responsable_inscripto', 'monotributo', 'exento'] },
    )
    expect(person.fill).toEqual({})
    expect(person.notes[0]).toMatch(/no está inscripto en el IVA ni en el monotributo/)
  })

  it('«No alcanzado» se completa aunque el combo no lo tenga', () => {
    const plan = planLookupFill(
      data({ ivaCondition: 'no_alcanzado' }),
      { ivaCondition: 'responsable_inscripto' },
      { ivaOptions: ['responsable_inscripto', 'monotributo', 'exento'] },
    )
    expect(plan.fill).toEqual({ ivaCondition: 'no_alcanzado' })
  })

  it('solo toca los campos que el formulario tiene', () => {
    const plan = planLookupFill(data(), { name: '' })
    expect(Object.keys(plan.fill)).toEqual(['name'])
    expect(plan.notes).toEqual([])
  })

  it('la dirección solo si ARCA trae la calle, y la escrita se pregunta', () => {
    expect(planLookupFill(data({ address: null }), { address: null }).fill).toEqual({})
    const plan = planLookupFill(data(), { address: 'Bv. San Juan 50' })
    expect(plan.replace).toEqual({ address: 'AV COLON 1234, CORDOBA' })
    const completed = planLookupFill(data(), { address: 'av colon' })
    expect(completed.fill).toEqual({ address: 'AV COLON 1234, CORDOBA' })
  })

  it('recorta el nombre al tope del formulario', () => {
    const plan = planLookupFill(data({ name: 'N'.repeat(200) }), { name: '' })
    expect(plan.fill.name?.length).toBe(LOOKUP_NAME_MAX)
  })

  it('usa el nombre del campo de cada formulario', () => {
    const plan = planLookupFill(data(), { name: 'Otra cosa' }, { labels: { name: 'Nombre' } })
    expect(plan.conflicts[0]?.label).toBe('Nombre')
  })

  it('anda con lo que devuelve el servidor (caché del padrón)', () => {
    const fromRow = padronDataFromRow({
      cuit: '20123456786',
      data: {
        name: 'PEREZ JUAN',
        person_kind: 'fisica',
        active: true,
        iva_condition: 'monotributo',
        condicion_iva_receptor_id: 6,
        needs_review: false,
        monotributo_category: 'B LOCACIONES DE SERVICIO',
        address: 'SAN MARTIN 10',
        locality: 'RIO CUARTO',
        province: 'CORDOBA',
        activity: { code: '561011', description: null },
      },
      environment: 'homologacion',
      fetchedAt: '2026-10-08T13:00:00.000Z',
      source: 'cache',
      purpose: 'supplier',
    })
    expect(fromRow).not.toBeNull()
    if (!fromRow) return
    expect(fromRow.warnings.map((w) => w.key)).toEqual(['monotributo', 'test_data'])
    const plan = planLookupFill(fromRow, { name: 'perez', ivaCondition: 'responsable_inscripto' })
    expect(plan.fill).toEqual({ name: 'PEREZ JUAN', ivaCondition: 'monotributo' })
  })
})

describe('lookupPatch', () => {
  const plan = planLookupFill(
    data({ ivaCondition: 'exento' }),
    { name: 'Bebidas del Centro', ivaCondition: 'monotributo', address: null },
    { chosen: ['ivaCondition'] },
  )

  it('«Dejar lo mío»: solo lo vacío, y lo distinto queda como estaba', () => {
    const { patch, changes, kept } = lookupPatch(plan, false)
    expect(patch).toEqual({ address: 'AV COLON 1234, CORDOBA' })
    expect(changes.map((c) => c.field)).toEqual(['address'])
    expect(kept.map((c) => c.field)).toEqual(['name', 'ivaCondition'])
  })

  it('«Usar lo de ARCA»: también lo que se preguntó', () => {
    const { patch, changes, kept } = lookupPatch(plan, true)
    expect(patch).toEqual({
      address: 'AV COLON 1234, CORDOBA',
      name: 'DISTRIBUIDORA EJEMPLO SA',
      ivaCondition: 'exento',
    })
    expect(changes).toHaveLength(3)
    expect(kept).toEqual([])
  })
})

describe('lookupAppliedMessage', () => {
  const plan = planLookupFill(data(), { name: '', ivaCondition: null, address: null })

  it('dice qué se completó', () => {
    expect(lookupAppliedMessage(plan.fills.slice(0, 2))).toBe(
      'Listo: completamos razón social y condición frente al IVA con lo que dice ARCA.',
    )
    expect(lookupAppliedMessage(plan.fills)).toBe(
      'Listo: completamos razón social, condición frente al IVA y dirección con lo que dice ARCA.',
    )
  })

  it('sin cambios, o con lo distinto que se dejó', () => {
    expect(lookupAppliedMessage([])).toBe('Listo: ya coincidía con lo que dice ARCA.')
    expect(lookupAppliedMessage([], plan.fills.slice(0, 1))).toBe('Listo: dejamos lo que tenías.')
    expect(lookupAppliedMessage(plan.fills.slice(2), plan.fills.slice(0, 1))).toBe(
      'Listo: completamos dirección con lo que dice ARCA. Lo demás quedó como estaba.',
    )
  })
})

// ─── Resultado y links ───────────────────────────────────────────────────────

describe('lookupAnnouncement', () => {
  it('lo que encontró ARCA, con los avisos que importan', () => {
    expect(lookupAnnouncement({ ok: true, data: data() })).toBe(
      'ARCA encontró a DISTRIBUIDORA EJEMPLO SA.',
    )
    expect(lookupAnnouncement({ ok: true, data: data({ testData: true, active: false }) })).toBe(
      'ARCA encontró a DISTRIBUIDORA EJEMPLO SA (datos de prueba). Ojo: la CUIT está inactiva.',
    )
  })

  it('el problema tal cual', () => {
    expect(
      lookupAnnouncement(failure({ code: 'not_found', message: 'ARCA no encontró esa CUIT.' })),
    ).toBe('ARCA no encontró esa CUIT.')
  })
})

describe('lookupSourceText', () => {
  it('recién consultado o la fecha de lo guardado (día de Córdoba)', () => {
    expect(lookupSourceText(data())).toBe('Recién consultado en ARCA.')
    expect(lookupSourceText(data({ source: 'cache', fetchedAt: '2026-10-03T15:00:00.000Z' }))).toBe(
      'Consultado en ARCA el 03/10/2026.',
    )
    // 01:30 UTC del 4 es 22:30 del 3 en Córdoba.
    expect(lookupSourceText(data({ source: 'cache', fetchedAt: '2026-10-04T01:30:00.000Z' }))).toBe(
      'Consultado en ARCA el 03/10/2026.',
    )
  })
})

describe('links', () => {
  it('Ajustes › ARCA y el paso de la guía', () => {
    expect(arcaSettingsHref(SLUG)).toBe('/bar-demo/administracion/ajustes?tab=arca')
    expect(arcaGuideStepHref(SLUG, 's8_padron')).toBe(
      '/bar-demo/administracion/ajustes/arca#paso-8',
    )
    expect(arcaGuideStepHref(SLUG, 's0_prereq')).toBe(
      '/bar-demo/administracion/ajustes/arca#paso-0',
    )
    expect(arcaGuideStepHref(SLUG, 's10_mis_comprobantes')).toBe(
      '/bar-demo/administracion/ajustes/arca#paso-10',
    )
    expect(arcaGuideStepHref(SLUG, null)).toBe('/bar-demo/administracion/ajustes/arca')
  })
})

describe('lookupFailureView', () => {
  it('CUIT que no existe: aviso y volver a preguntarle a ARCA', () => {
    expect(lookupFailureView(SLUG, failure({ code: 'not_found' }))).toMatchObject({
      tone: 'warning',
      fixHref: null,
      connectHref: null,
      retry: 'refresh',
    })
  })

  it('falta autorizar el padrón: «Cómo arreglarlo» va al paso 8', () => {
    expect(lookupFailureView(SLUG, failure({ code: 'arca_not_authorized' }))).toMatchObject({
      tone: 'error',
      fixHref: '/bar-demo/administracion/ajustes/arca#paso-8',
      retry: null,
    })
    expect(
      lookupFailureView(SLUG, failure({ code: 'arca_not_authorized', step: 's6_certificado' }))
        .fixHref,
    ).toBe('/bar-demo/administracion/ajustes/arca#paso-6')
  })

  it('ARCA no contesta: probar de nuevo (y el paso, si lo hay)', () => {
    expect(lookupFailureView(SLUG, failure({ code: 'arca_unavailable' }))).toMatchObject({
      tone: 'error',
      fixHref: null,
      retry: 'again',
    })
    expect(lookupFailureView(SLUG, failure({ code: 'error', step: 's9_probar' })).fixHref).toBe(
      '/bar-demo/administracion/ajustes/arca#paso-9',
    )
    expect(lookupFailureView(SLUG, failure({ code: 'rate_limited' }))).toMatchObject({
      tone: 'warning',
      retry: 'again',
    })
  })

  it('sin ARCA conectado: «Conectar ARCA»; sin permiso: nada para hacer', () => {
    expect(lookupFailureView(SLUG, failure({ code: 'arca_not_connected' }))).toMatchObject({
      tone: 'warning',
      connectHref: '/bar-demo/administracion/ajustes?tab=arca',
      fixHref: null,
      retry: null,
    })
    expect(lookupFailureView(SLUG, failure({ code: 'forbidden' }))).toMatchObject({
      tone: 'error',
      fixHref: null,
      connectHref: null,
      retry: null,
    })
  })
})

// ─── La pantalla (render en el servidor) ─────────────────────────────────────

function controller(over: Partial<ArcaLookupController> = {}): ArcaLookupController {
  return {
    tenantSlug: SLUG,
    availability: 'ready',
    connectHint: true,
    cuitOk: true,
    cuitEmpty: false,
    state: { kind: 'idle' },
    plan: null,
    announcement: '',
    focusToken: 0,
    ids: { hint: 'arca-hint', title: 'arca-title', question: 'arca-q' },
    lookup: () => {},
    applyData: () => {},
    resolve: () => {},
    reset: () => {},
    ...over,
  }
}

function trigger(lookup: ArcaLookupController, withField = true): string {
  return renderToStaticMarkup(
    createElement(
      ArcaLookupTrigger,
      { lookup },
      withField ? createElement('input', { id: 'cuit', defaultValue: '' }) : null,
    ),
  )
}

function panel(lookup: ArcaLookupController): string {
  return renderToStaticMarkup(createElement(ArcaLookupPanel, { lookup }))
}

function found(
  over: Partial<Extract<ArcaLookupState, { kind: 'found' }>> = {},
): Extract<ArcaLookupState, { kind: 'found' }> {
  return {
    kind: 'found',
    cuit: '30712345671',
    data: data(),
    phase: 'review',
    applied: [],
    kept: [],
    ...over,
  }
}

describe('ArcaLookupTrigger', () => {
  it('con ARCA: el campo, el botón y el anuncio para el lector de pantalla', () => {
    const html = trigger(controller())
    expect(html).toContain('id="cuit"')
    expect(html).toContain('Completar con ARCA')
    expect(html).toContain('role="status"')
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('sin CUIT: el botón espera y la ayuda dice para qué sirve', () => {
    const html = trigger(controller({ cuitOk: false, cuitEmpty: true }))
    expect(html).toMatch(/<button[^>]*\sdisabled=""/)
    expect(html).toContain('Con la CUIT traemos el resto de ARCA (ex AFIP).')
    expect(html).toContain('aria-describedby="arca-hint"')
  })

  it('consultando: lo dice el botón', () => {
    const html = trigger(
      controller({ state: { kind: 'loading', cuit: '30712345671', slow: false } }),
    )
    expect(html).toContain('Consultando ARCA…')
    expect(html).toContain('aria-disabled="true"')
  })

  it('sin ARCA conectado: el link a Ajustes › ARCA en otra pestaña, sin botón', () => {
    const html = trigger(controller({ availability: 'not_connected' }))
    expect(html).toContain('Conectá ARCA para completar esto solo')
    expect(html).toContain('href="/bar-demo/administracion/ajustes?tab=arca"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('(se abre en otra pestaña)')
    expect(html).not.toContain('Completar con ARCA')
    expect(
      trigger(controller({ availability: 'not_connected', connectHint: false })),
    ).not.toContain('Conectá ARCA')
  })

  it('contadora, sin saber o averiguando: solo el campo (y sin campo, nada)', () => {
    for (const availability of ['hidden', 'pending'] as const) {
      const html = trigger(controller({ availability }))
      expect(html).toContain('id="cuit"')
      expect(html).not.toContain('Completar con ARCA')
      expect(html).not.toContain('role="status"')
      expect(trigger(controller({ availability }), false)).toBe('')
    }
    expect(trigger(controller({ availability: 'not_connected', connectHint: false }), false)).toBe(
      '',
    )
  })
})

describe('ArcaLookupPanel', () => {
  it('sin consulta, o mientras no tarda, no ocupa lugar', () => {
    expect(panel(controller())).toBe('')
    expect(
      panel(controller({ state: { kind: 'loading', cuit: '30712345671', slow: false } })),
    ).toBe('')
    expect(
      panel(controller({ state: { kind: 'loading', cuit: '30712345671', slow: true } })),
    ).toContain('ARCA está tardando en contestar')
    expect(panel(controller({ availability: 'hidden', state: found() }))).toBe('')
  })

  it('la tarjeta «Según ARCA» con los datos en palabras simples', () => {
    const plan = planLookupFill(data(), { name: '', ivaCondition: null, address: null })
    const html = panel(controller({ state: found(), plan }))
    expect(html).toContain('Según ARCA')
    expect(html).toContain('DISTRIBUIDORA EJEMPLO SA')
    expect(html).toContain('CUIT 30-71234567-1 (activa)')
    expect(html).toContain('Empresa')
    expect(html).toContain('Responsable inscripto')
    expect(html).toContain(ivaPlainText('responsable_inscripto'))
    expect(html).toContain('AV COLON 1234, CORDOBA')
    expect(html).toContain('A qué se dedica')
    expect(html).toContain('Usar estos datos')
    expect(html).toContain('Recién consultado en ARCA.')
    expect(html).not.toContain('Datos de prueba')
  })

  it('los avisos: inactiva, monotributo, datos de prueba y lo que hay que elegir a mano', () => {
    const fromRow = padronDataFromRow({
      cuit: '20123456786',
      data: {
        name: 'PEREZ JUAN',
        person_kind: 'fisica',
        active: false,
        iva_condition: 'monotributo',
        monotributo_category: 'B LOCACIONES DE SERVICIO',
      },
      environment: 'homologacion',
      fetchedAt: '2026-10-03T15:00:00.000Z',
      source: 'cache',
      purpose: 'supplier',
    })
    expect(fromRow).not.toBeNull()
    if (!fromRow) return
    const plan = planLookupFill(fromRow, { name: 'Juan', ivaCondition: null })
    const html = panel(controller({ state: found({ cuit: '20123456786', data: fromRow }), plan }))
    expect(html).toContain('Datos de prueba')
    expect(html).toContain('Son datos de prueba de homologación')
    expect(html).toContain('está inactiva')
    expect(html).toContain('Es monotributista')
    expect(html).toContain('B LOCACIONES DE SERVICIO')
    expect(html).toContain('CUIT 20-12345678-6 (inactiva)')
    expect(html).toContain('Persona')
    expect(html).toContain('Consultado en ARCA el 03/10/2026.')
    expect(html).toContain('Volver a consultar')

    const unknown = data({ ivaCondition: 'sin_datos', needsReview: true })
    const notes = panel(
      controller({
        state: found({ data: unknown }),
        plan: planLookupFill(unknown, { ivaCondition: 'responsable_inscripto' }),
      }),
    )
    expect(notes).toContain('ARCA no dice la condición frente al IVA: elegila vos.')
  })

  it('antes de pisar lo escrito, pregunta (y muestra qué cambia)', () => {
    const plan = planLookupFill(data(), { name: 'Bebidas del Centro', address: null })
    const html = panel(controller({ state: found({ phase: 'confirm' }), plan }))
    expect(html).toContain('<fieldset')
    expect(html).toContain('aria-labelledby="arca-q"')
    expect(html).toContain('Esto ya estaba completo y ARCA dice otra cosa. ¿Lo cambiamos?')
    expect(html).toContain('acá dice «Bebidas del Centro» y ARCA dice «DISTRIBUIDORA EJEMPLO SA».')
    expect(html).toContain('Lo que está vacío se completa igual.')
    expect(html).toContain('Usar lo de ARCA')
    expect(html).toContain('Dejar lo mío')
    expect(html).not.toContain('Usar estos datos')
  })

  it('después de usar los datos: el «Listo» con lo que se completó', () => {
    const plan = planLookupFill(data(), { name: '', ivaCondition: null })
    const html = panel(
      controller({ state: found({ phase: 'applied', applied: plan.fills }), plan }),
    )
    expect(html).toContain(
      'Listo: completamos razón social y condición frente al IVA con lo que dice ARCA.',
    )
    expect(html).toContain('tabindex="-1"')
  })

  it('si ya coincide, no ofrece nada para usar', () => {
    const plan = planLookupFill(data(), {
      name: 'Distribuidora Ejemplo S.A.',
      ivaCondition: 'responsable_inscripto',
    })
    const html = panel(controller({ state: found(), plan }))
    expect(html).toContain('Ya coincide con lo que tenés cargado.')
    expect(html).not.toContain('Usar estos datos')
  })

  it('los problemas con su arreglo', () => {
    const notFound = panel(
      controller({
        state: {
          kind: 'failed',
          cuit: '30712345671',
          failure: failure({ code: 'not_found', message: 'ARCA no encontró esa CUIT.' }),
        },
      }),
    )
    expect(notFound).toContain('ARCA no encontró esa CUIT.')
    expect(notFound).toContain('Consultar de nuevo')
    expect(notFound).not.toContain('Cómo arreglarlo')

    const padron = panel(
      controller({
        state: {
          kind: 'failed',
          cuit: '30712345671',
          failure: failure({ code: 'arca_not_authorized', message: 'Falta autorizar el padrón.' }),
        },
      }),
    )
    expect(padron).toContain('Cómo arreglarlo')
    expect(padron).toContain('href="/bar-demo/administracion/ajustes/arca#paso-8"')

    // «No está conectado» ya lo dice el link de al lado del campo.
    expect(
      panel(
        controller({
          availability: 'not_connected',
          state: {
            kind: 'failed',
            cuit: '30712345671',
            failure: failure({ code: 'arca_not_connected' }),
          },
        }),
      ),
    ).toBe('')
  })
})
