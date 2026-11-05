/**
 * «Cómo arrancar» (diseño §5.2, WP11): los textos de la guía y los helpers
 * puros de la pantalla. La guía es la misma para todos los bares: ningún
 * texto nombra al bar, su CUIT, su sistema de caja ni su banco; cada ítem dice
 * qué, dónde (una pantalla que existe) y cómo (de 2 a 4 pasos).
 */

import { describe, expect, it } from 'vitest'
import { LAUNCHER_ITEMS } from '@/components/administracion/nav/launcher-items'
import { GUIDE_RECIPES, guideRoutine } from '@/lib/accounting/guides'
import {
  canMarkManually,
  minutesText,
  ONBOARDING_GLOSSARY,
  ONBOARDING_HAVE_AT_HAND,
  ONBOARDING_ITEM_IDS,
  ONBOARDING_ITEMS,
  ONBOARDING_MANUAL_STEPS,
  ONBOARDING_SECTION_LABEL,
  ONBOARDING_SECTIONS,
  ONBOARDING_STAYS_MANUAL,
  onboardingRows,
  onboardingStatusText,
  PLATFORM_DOES,
  sectionProgressText,
  supplierRequestMessage,
  supplierRequestWhy,
} from '@/lib/accounting/onboarding'
import { IMPORT_SOURCE_COPY } from '@/lib/imports/ui/labels'
import { QUESTION_COPY } from '@/lib/imports/ui/review-copy'

/** Todo texto que ve la persona en la guía. */
function allCopy(): string[] {
  const out: string[] = []
  for (const item of ONBOARDING_ITEMS) {
    out.push(item.title, item.where.label, item.what, ...item.how)
    for (const extra of [
      item.whatLabel,
      item.example,
      item.auto,
      item.actionLabel,
      item.manualLabel,
    ]) {
      if (extra) out.push(extra)
    }
  }
  for (const task of ONBOARDING_STAYS_MANUAL) out.push(task.title, task.where.label, task.why)
  for (const entry of ONBOARDING_GLOSSARY) out.push(entry.term, entry.meaning)
  out.push(...ONBOARDING_HAVE_AT_HAND, ...PLATFORM_DOES)
  out.push(...Object.values(ONBOARDING_SECTION_LABEL))
  return out
}

/** Las pantallas que existen (o que llegan con esta fase) bajo `/<bar>/administracion`. */
const KNOWN_ROUTES = [
  /^\/ajustes\?tab=(sas|cajas|medios|participes|impuestos|accesos)$/,
  /^\/ajustes\/arca$/,
  /^\/configurar$/,
  /^\/plan-de-cuentas$/,
  /^\/importar\/(arca|mercado-pago|banco)$/,
  /^\/compras\/nueva(\?modo=pago)?$/,
  /^\/gastos-fijos$/,
  /^\/sueldos$/,
  /^\/ventas\/cierre$/,
  /^\/cajas$/,
  /^\/libros\/cierres$/,
]

describe('los ítems de la guía', () => {
  it('uno por id, en el orden de ONBOARDING_ITEM_IDS y agrupados por sección', () => {
    expect(ONBOARDING_ITEMS.map((i) => i.id)).toEqual([...ONBOARDING_ITEM_IDS])
    const order = ONBOARDING_ITEMS.map((i) => ONBOARDING_SECTIONS.indexOf(i.section))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('cada uno dice qué, dónde y cómo (de 2 a 4 pasos)', () => {
    for (const item of ONBOARDING_ITEMS) {
      expect(item.title.trim(), item.id).not.toBe('')
      expect(item.what.trim(), item.id).not.toBe('')
      expect(item.where.label.trim(), item.id).not.toBe('')
      expect(item.how.length, item.id).toBeGreaterThanOrEqual(2)
      expect(item.how.length, item.id).toBeLessThanOrEqual(4)
      // Oraciones cortas y cerradas (el «…» de una lista abierta también cierra).
      for (const step of item.how)
        expect(/[.…]$/.test(step.trim()), `${item.id}: ${step}`).toBe(true)
      if (item.example) expect(item.example.startsWith('Ejemplo: '), item.id).toBe(true)
    }
  })

  it('el «Dónde» lleva a una pantalla que existe, y el botón tiene adónde ir', () => {
    for (const item of ONBOARDING_ITEMS) {
      const path = item.where.path
      if (path !== null) {
        expect(
          KNOWN_ROUTES.some((re) => re.test(path)),
          `${item.id}: ${path}`,
        ).toBe(true)
      }
      if (item.actionLabel && item.id !== 'suppliers_message') {
        expect(Boolean(item.sheet || item.where.path), item.id).toBe(true)
      }
    }
    for (const task of ONBOARDING_STAYS_MANUAL) {
      const path = task.where.path
      if (path !== null)
        expect(
          KNOWN_ROUTES.some((re) => re.test(path)),
          path,
        ).toBe(true)
      else expect(task.sheet, task.title).toBeDefined()
    }
  })

  it('lo que se sube trae su «¿Cómo lo bajo?»', () => {
    const howTo = Object.fromEntries(
      ONBOARDING_ITEMS.filter((i) => i.howTo).map((i) => [i.id, i.howTo]),
    )
    expect(howTo).toEqual({
      arca_first_import: 'mis_comprobantes',
      mp_connect: 'mercado_pago',
      mp_weekly: 'mercado_pago',
      bank_weekly: 'banco',
      arca_monthly: 'mis_comprobantes',
    })
  })

  it('la factura de comisiones de Mercado Pago se contesta al importar (no hay casilla a mano)', () => {
    const item = ONBOARDING_ITEMS.find((i) => i.id === 'mp_invoice')
    expect(item?.where.path).toBe('/importar/arca')
    // Con las palabras de la pregunta de la revisión (`QUESTION_COPY.mp_invoice`).
    const asked = QUESTION_COPY.mp_invoice.question.replace(/^¿Es /, '').replace(/\?$/, '')
    expect(item?.how.join(' ')).toContain(asked)
  })

  it('se marcan a mano los que pasan afuera y los que aceptan «Ya cargué los que tengo»', () => {
    expect([...ONBOARDING_MANUAL_STEPS].sort()).toEqual(
      [
        'access',
        'chart_review',
        'payroll',
        'platforms',
        'recurring',
        'suppliers_message',
        'taxes',
        'treasuries',
      ].sort(),
    )
    for (const item of ONBOARDING_ITEMS) {
      expect(canMarkManually(item), item.id).toBe(ONBOARDING_MANUAL_STEPS.includes(item.id))
      if (canMarkManually(item)) expect(item.manualLabel, item.id).toBeTruthy()
    }
  })
})

describe('con los nombres de las pantallas de hoy', () => {
  const item = (id: (typeof ONBOARDING_ITEM_IDS)[number]) => {
    const found = ONBOARDING_ITEMS.find((i) => i.id === id)
    if (!found) throw new Error(`Falta el ítem ${id}`)
    return found
  }

  it('la Puesta en marcha: sin puntos de venta, con impuestos y sueldos, en el orden aprobado', () => {
    expect((ONBOARDING_ITEM_IDS as readonly string[]).includes('sales_points')).toBe(false)
    const day1 = ONBOARDING_ITEMS.filter((i) => i.section === 'day1').map((i) => i.id)
    expect(day1).toEqual([
      'sas_data',
      'treasuries',
      'sales_methods',
      'platforms',
      'taxes',
      'opening',
      'access',
      'chart_review',
      'arca',
      'arca_first_import',
      'recurring',
      'payroll',
      'mp_connect',
      'suppliers_message',
    ])
    expect(item('taxes').where).toEqual({
      label: 'Ajustes › Impuestos',
      path: '/ajustes?tab=impuestos',
    })
    expect(item('taxes').manualLabel).toBe('Ya los revisé')
    expect(item('taxes').kind).toBe('manual')
    expect(item('payroll').where).toEqual({
      label: 'Gastos y sueldos › Sueldos',
      path: '/sueldos',
    })
    expect(item('payroll').kind).toBe('manual')
    expect(item('chart_review').kind).toBe('manual')
  })

  it('el cierre de mes, la caja, los medios de cobro y los sueldos se llaman como en su pantalla', () => {
    expect(item('month_close').where).toEqual({
      label: 'Contabilidad › Cierre de mes',
      path: '/libros/cierres',
    })
    expect(item('month_close').actionLabel).toBe('Ir a Cierre de mes')
    expect(item('treasury_check').where).toEqual({ label: 'Caja', path: '/cajas' })
    expect(item('small_expenses').where).toEqual({
      label: '+ Cargar › Compra y pago',
      path: '/compras/nueva?modo=pago',
    })
    // Las apps y las tarjetas viven en «Medios de cobro» (el link viejo sigue abriendo ahí).
    expect(item('platforms').where).toEqual({
      label: 'Ajustes › Medios de cobro',
      path: '/ajustes?tab=participes',
    })
    expect(item('platforms').actionLabel).toBe('Revisar las comisiones')
    const payroll = ONBOARDING_STAYS_MANUAL.find((task) => task.title.startsWith('Sueldos'))
    expect(payroll?.where).toEqual({ label: 'Gastos y sueldos › Sueldos', path: '/sueldos' })
    const purchase = ONBOARDING_STAYS_MANUAL.find((task) => task.where.path === '/compras/nueva')
    expect(purchase?.where.label).toBe('+ Cargar › Compra')
  })

  it('la puesta en marcha se llama igual que la franja del Resumen', () => {
    expect(ONBOARDING_SECTION_LABEL.day1.startsWith('Puesta en marcha')).toBe(true)
    expect(Object.values(ONBOARDING_SECTION_LABEL).join(' ')).not.toMatch(/minutos/)
    expect(guideRoutine(null).map((group) => group.frequency)).toEqual([
      'daily',
      'weekly',
      'monthly',
    ])
  })

  it('lo que se carga con una hoja dice por dónde se entra y su botón es el de la receta', () => {
    const launcher = LAUNCHER_ITEMS.map((item) => item.title)
    const recipeButtons = new Set(GUIDE_RECIPES.map((r) => r.action.label))
    for (const task of ONBOARDING_STAYS_MANUAL.filter((t) => t.sheet)) {
      // «+ Cargar» › y la opción del menú, no el título de la hoja.
      const option = /^\+ Cargar › (.+)$/.exec(task.where.label)?.[1]
      expect(option, task.title).toBeDefined()
      expect(launcher, task.title).toContain(option)
      expect(recipeButtons, task.title).toContain(task.sheetLabel)
    }
    const small = ONBOARDING_ITEMS.find((i) => i.id === 'small_expenses')
    expect(recipeButtons).toContain(small?.actionLabel)
  })

  it('las tres subidas dicen «Subir…», como el botón de cada bandeja de Importar', () => {
    expect(item('arca_first_import').actionLabel).toBe(IMPORT_SOURCE_COPY.arca_recibidos.cta)
    expect(item('arca_monthly').actionLabel).toBe(IMPORT_SOURCE_COPY.arca_recibidos.cta)
    expect(item('mp_invoice').actionLabel).toBe(IMPORT_SOURCE_COPY.arca_recibidos.cta)
    expect(item('mp_weekly').actionLabel).toBe(IMPORT_SOURCE_COPY.mp_release.cta)
    expect(item('bank_weekly').actionLabel).toBe(IMPORT_SOURCE_COPY.bank_statement.cta)
  })

  it('no quedan los nombres que cambiaron con el rediseño', () => {
    const stale = [
      /ajustar saldo/i,
      /otro ingreso o egreso/i,
      /por acreditar/i,
      /\bacredit(a|an|aron|ar|ó)\b/i,
      /Libros › Cierres/,
      /Ajustes › (Plataformas|Partícipes)/,
      /tasas de Plataformas/,
      /Cajas y bancos/,
      /Cargar factura/,
      /Nueva compra/,
      /Libros › Asiento manual/,
      /gastos? bancarios?/i,
      /Importar (de ARCA|Mercado Pago|del banco)/,
      /Pagué algo/,
      /Nuevo gasto/,
      /Me entró plata/,
      /Mover plata/,
      /\bContadora\b/,
      /Libros › /,
      /Fin de mes/,
      /en camino/i,
      /Ajustes › Puntos de venta/,
    ]
    for (const text of allCopy()) {
      for (const re of stale) expect(re.test(text), `${re}: ${text}`).toBe(false)
    }
  })
})

describe('textos para cualquier bar', () => {
  it('no nombran al bar, su CUIT, su sistema de caja ni su banco', () => {
    const banned = [/thinkeon/i, /\bhub\b/i, /nación empresa/i, /\bne24\b/i, /\bepec\b/i]
    for (const text of allCopy()) {
      for (const re of banned) expect(re.test(text), text).toBe(false)
      expect(/\b\d{2}-\d{8}-\d\b/.test(text), text).toBe(false)
    }
  })

  it('las palabras de ARCA y de contabilidad están explicadas', () => {
    const terms = ONBOARDING_GLOSSARY.map((g) => g.term)
    for (const term of [
      'ARCA',
      'CUIT',
      'Constancia de inscripción',
      'Ingresos Brutos',
      'Crédito fiscal',
      'Punto de venta',
      'Mis Comprobantes',
      'CBU y CVU',
      'Acreditación',
      'Retención',
      'Saldos iniciales',
      'Plan de cuentas',
      'Asiento',
    ]) {
      expect(terms, term).toContain(term)
    }
    for (const entry of ONBOARDING_GLOSSARY) expect(entry.meaning.length).toBeLessThan(140)
  })
})

describe('helpers de la pantalla', () => {
  it('sin estado de la base: la guía entera, sin marcas (los informativos siguen siéndolo)', () => {
    const rows = onboardingRows(null)
    expect(rows).toHaveLength(ONBOARDING_ITEMS.length)
    expect(rows.find((r) => r.id === 'small_expenses')?.status).toBe('info')
    expect(rows.filter((r) => r.id !== 'small_expenses').every((r) => r.status === 'unknown')).toBe(
      true,
    )
    expect(rows.every((r) => !r.manualDone && r.pending === null)).toBe(true)
  })

  it('el estado en palabras: lo de una vez y las rutinas', () => {
    const day1 = { section: 'day1' as const, manualDone: false }
    const weekly = { section: 'weekly' as const, manualDone: false }
    expect(onboardingStatusText({ ...day1, status: 'done' })).toBe('Listo')
    expect(onboardingStatusText({ ...weekly, status: 'done' })).toBe('Al día')
    expect(onboardingStatusText({ ...day1, status: 'done', manualDone: true })).toBe(
      'Marcado por vos',
    )
    expect(onboardingStatusText({ ...day1, status: 'todo' })).toBe('Falta')
    expect(onboardingStatusText({ ...weekly, status: 'todo' })).toBe('Te toca')
    expect(onboardingStatusText({ ...weekly, status: 'todo' }, true)).toBe('Lo próximo')
    expect(onboardingStatusText({ ...day1, status: 'info' })).toBe('Para saber')
    expect(onboardingStatusText({ ...day1, status: 'unknown' })).toBeNull()
  })

  it('el avance de cada sección y el tiempo', () => {
    expect(sectionProgressText('day1', { done: 7, total: 12 })).toBe('7 de 12 listos')
    expect(sectionProgressText('day1', { done: 1, total: 1 })).toBe('1 de 1 listo')
    expect(sectionProgressText('weekly', { done: 1, total: 2 })).toBe('1 de 2 al día')
    expect(sectionProgressText('monthly', { done: 0, total: 0 })).toBe('')
    expect(minutesText(5)).toBe('≈ 5 min')
    expect(minutesText(60)).toBe('≈ 1 h')
    expect(minutesText(90)).toBe('≈ 1 h 30 min')
    expect(minutesText(null)).toBeNull()
    expect(minutesText(0)).toBeNull()
  })

  it('el mensaje para los proveedores según la condición frente al IVA de la SAS', () => {
    const ri = supplierRequestMessage({
      legalName: 'Bar de Prueba SAS',
      cuit: '30712345678',
      ivaCondition: 'responsable_inscripto',
    })
    expect(ri).toBe(
      'Hola, desde ahora facturanos a BAR DE PRUEBA SAS, CUIT 30-71234567-8, Responsable inscripto, con Factura A. ¡Gracias!',
    )
    expect(supplierRequestMessage({ legalName: 'Bar de Prueba SAS', cuit: '30712345678' })).toBe(ri)
    expect(
      supplierRequestMessage({
        legalName: 'Bar de Prueba SAS',
        cuit: null,
        ivaCondition: 'exento',
      }),
    ).toBe('Hola, desde ahora facturanos a BAR DE PRUEBA SAS (IVA exento). ¡Gracias!')
    expect(
      supplierRequestMessage({
        legalName: 'Bar de Prueba SAS',
        cuit: '30712345678',
        ivaCondition: 'monotributo',
      }),
    ).toBe(
      'Hola, desde ahora facturanos a BAR DE PRUEBA SAS, CUIT 30-71234567-8 (Monotributo). ¡Gracias!',
    )
    expect(supplierRequestWhy('responsable_inscripto')).toContain('crédito fiscal')
    expect(supplierRequestWhy(null)).toContain('crédito fiscal')
    expect(supplierRequestWhy('exento')).toBeNull()
  })
})
