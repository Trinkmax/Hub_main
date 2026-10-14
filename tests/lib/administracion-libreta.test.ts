import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerender } from 'react-dom/static'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComprasDoor } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/compras-door'
import { DebtBar } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/debt-bar'
import {
  DocumentRows,
  PaymentRows,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/document-rows'
import { DocumentsTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/documents-tab'
import { LibretaHero } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/libreta-hero'
import {
  LibretaList,
  LibretaToolbar,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/libreta-list'
import {
  type SorterItem,
  SupplierSorter,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-sorter'
import {
  type LibretaData,
  SETTLED_PREVIEW_UNSORTED,
  SuppliersBody,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/suppliers-tab'
import { UnclassifiedStrip } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/unclassified-strip'
import {
  dateRail,
  documentRowState,
  dueRail,
  type LibretaInfo,
  ledgerRail,
  libretaSentence,
  libretaView,
  paymentAppliedText,
  paymentMeansText,
  paymentsHeadline,
  periodLead,
  SETTLED_PREVIEW,
  supplierDisplayName,
  supplierShortName,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/libreta'
import {
  countClassifiable,
  countUnclassified,
  isVisibleSupplier,
  SUPPLIER_FILTERS,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/suppliers'
import { payablesTranches } from '@/lib/accounting/home'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import {
  matchesPartyFilter,
  matchesPartyQuery,
  type PartyListRow,
} from '@/lib/accounting/queries/parties'

/**
 * La libreta de proveedores («Compras y pagos»): qué renglones se ven, qué
 * dice el margen de cada uno y cómo se lee el estado de un comprobante. Y lo
 * que la pantalla le promete a cada uno ya dibujada: que un dato que falta no
 * salga como «$ 0» y que la contadora no reciba ningún botón de carga.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
// Las dos lecturas de Comprobantes y Pagos: acá se contestan a mano (sin base).
const reads = vi.hoisted(() => ({ listDocuments: vi.fn(), getMonthSpending: vi.fn() }))
vi.mock('@/lib/accounting/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/queries')>()),
  listDocuments: reads.listDocuments,
  getMonthSpending: reads.getMonthSpending,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
const accounting = () => ({
  tenantSlug: 'hub',
  today: '2026-10-13',
  access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
  readOnly: ui.readOnly,
  openAction: () => {},
  closeAction: () => {},
})
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => accounting(),
  useAccountingOptional: () => accounting(),
}))
// Las acciones del servidor no hacen falta para dibujar.
vi.mock('@/lib/accounting/actions/master', () => ({
  saveParty: vi.fn(),
  createPartiesBulk: vi.fn(),
}))

afterEach(() => {
  ui.readOnly = false
  reads.listDocuments.mockReset()
  reads.getMonthSpending.mockReset()
})

const TODAY = '2026-10-13'
const SLUG = 'hub'
const MATCH = { filter: matchesPartyFilter, query: matchesPartyQuery }
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const LONG_NAME = 'Distribuidora Mayorista de Bebidas y Alimentos del Centro SA' // 60 caracteres

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ')
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lo mismo, esperando a los bloques que leen detrás de un `Suspense` (los de servidor). */
async function htmlAsync(node: ReactElement): Promise<string> {
  const { prelude } = await prerender(node)
  const reader = prelude.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return (out + decoder.decode()).replaceAll(NB, ' ')
}

let seq = 0
function row(patch: Partial<PartyListRow> = {}): PartyListRow {
  seq += 1
  const debt = patch.debtCents ?? 0
  const credit = patch.creditCents ?? 0
  return {
    partyId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    partyName: `Proveedor ${String(seq).padStart(3, '0')}`,
    partyKind: 'supplier',
    taxId: null,
    tradeName: null,
    active: true,
    systemKey: null,
    debtCents: 0,
    creditCents: 0,
    netCents: debt - credit,
    notDueCents: 0,
    dueSoonCents: 0,
    overdue1to30Cents: 0,
    overdue31to60Cents: 0,
    overdue60PlusCents: 0,
    noDueCents: 0,
    overdueCents: 0,
    oldestDueDate: null,
    nextDueDate: null,
    lastIncreaseDate: null,
    trafficLight: 'none',
    trafficText: 'Sin deuda',
    ...patch,
  }
}

function info(patch: Partial<LibretaInfo> = {}): LibretaInfo {
  return {
    kind: 'supplier',
    systemKey: null,
    active: true,
    defaultAccountId: null,
    defaultAccountName: null,
    updatedAt: '2026-10-12T10:00:00Z',
    ...patch,
  }
}

/** Una libreta parecida a la del bar que recién arranca: dos con deuda y muchos sin nada. */
function sample() {
  const late = row({
    partyName: 'Barracuda Bebidas',
    debtCents: 12_000_000,
    overdueCents: 12_000_000,
    overdue1to30Cents: 12_000_000,
    oldestDueDate: '2026-10-12',
    lastIncreaseDate: '2026-10-12',
    trafficLight: 'red',
    trafficText: 'Vencida hace 1 día',
  })
  const soon = row({
    partyName: 'Almacén Don José',
    taxId: '30711222335',
    debtCents: 7_235_800,
    dueSoonCents: 7_235_800,
    nextDueDate: '2026-10-18',
    creditCents: 500_000,
    trafficLight: 'yellow',
    trafficText: 'Vence en 5 días',
  })
  const favor = row({ partyName: 'Hielo Cristal', creditCents: 6_050_000 })
  const arca = row({ partyName: 'ARCA', partyKind: 'tax_agency', systemKey: 'arca' })
  const rest = Array.from({ length: 20 }, (_, i) =>
    row({ partyName: `Proveedor sin deuda ${String(i).padStart(2, '0')}` }),
  )
  const rows = [late, soon, favor, arca, ...rest]
  const classes = new Map<string, LibretaInfo>(rows.map((r) => [r.partyId, info()]))
  classes.set(
    late.partyId,
    info({ defaultAccountId: 'acc-1', defaultAccountName: 'Compras: bebidas con alcohol' }),
  )
  classes.set(arca.partyId, info({ kind: 'tax_agency', systemKey: 'arca' }))
  return { rows, classes, late, soon, favor, arca, rest }
}

describe('libretaView: los grupos y su orden', () => {
  it('«Les debés» primero (lo más vencido arriba), después «a favor» y al final los sin deuda', () => {
    const s = sample()
    const view = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'todos',
      q: '',
      match: MATCH,
    })
    expect(view.debt.map((e) => e.row.partyName)).toEqual(['Barracuda Bebidas', 'Almacén Don José'])
    expect(view.credit.map((e) => e.row.partyName)).toEqual(['Hielo Cristal'])
    // ARCA es del sistema y no tiene saldo: no ensucia la libreta.
    expect(view.shown.some((e) => e.row.partyName === 'ARCA')).toBe(false)
    expect(view.settled).toHaveLength(SETTLED_PREVIEW)
    expect(view.settledMore).toHaveLength(20 - SETTLED_PREVIEW)
    expect(view.settled.map((e) => e.row.partyName)).toEqual(
      [...view.settled.map((e) => e.row.partyName)].sort((a, b) => a.localeCompare(b, 'es')),
    )
  })

  it('el pie suma lo que se ve y la barrita mide contra la deuda más grande', () => {
    const s = sample()
    const view = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'todos',
      q: '',
      match: MATCH,
    })
    expect(view.totals).toEqual({
      debtCents: 19_235_800,
      overdueCents: 12_000_000,
      creditCents: 6_550_000,
    })
    expect(view.maxDebtCents).toBe(12_000_000)
  })

  it('con búsqueda u otro filtro no se pliega nada', () => {
    const s = sample()
    const searched = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'todos',
      q: 'sin deuda',
      match: MATCH,
    })
    expect(searched.settled).toHaveLength(20)
    expect(searched.settledMore).toHaveLength(0)
    const unclassified = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'sin-clasificar',
      q: '',
      match: MATCH,
    })
    expect(unclassified.settledMore).toHaveLength(0)
    // Barracuda ya tiene categoría: no está entre los que faltan.
    expect(unclassified.shown.some((e) => e.row.partyName === 'Barracuda Bebidas')).toBe(false)
    expect(unclassified.shown).toHaveLength(22)
  })

  it('cada píldora cuenta lo mismo que filtra `listParties` (más la regla de los organismos)', () => {
    const s = sample()
    for (const q of ['', 'don', '30711']) {
      const view = libretaView({
        rows: s.rows,
        classes: s.classes,
        filter: 'todos',
        q,
        match: MATCH,
      })
      for (const f of SUPPLIER_FILTERS) {
        if (f.unclassifiedOnly) continue
        const expected = s.rows.filter(
          (r) =>
            matchesPartyFilter(r, f.filter) &&
            matchesPartyQuery(r, q) &&
            isVisibleSupplier(r, f.filter),
        ).length
        expect(view.counts[f.value], `${f.value} · «${q}»`).toBe(expected)
        const filtered = libretaView({
          rows: s.rows,
          classes: s.classes,
          filter: f.value,
          q,
          match: MATCH,
        })
        expect(filtered.shown, `${f.value} · «${q}»`).toHaveLength(expected)
      }
    }
  })

  it('«Impuestos y sueldos» sí muestra a los organismos sin saldo', () => {
    const s = sample()
    const view = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'impuestos',
      q: '',
      match: MATCH,
    })
    expect(view.shown.map((e) => e.row.partyName)).toEqual(['ARCA'])
  })

  it('sin las fichas la libreta se arma igual, sin categoría', () => {
    const s = sample()
    const view = libretaView({ rows: s.rows, classes: null, filter: 'todos', q: '', match: MATCH })
    expect(view.shown).toHaveLength(23)
    expect(view.counts['sin-clasificar']).toBe(0)
    expect(view.shown.every((e) => e.state === null)).toBe(true)
  })

  it('vacío no es cero: sin proveedores no hay renglones ni totales inventados', () => {
    const view = libretaView({ rows: [], classes: new Map(), filter: 'todos', q: '', match: MATCH })
    expect(view.shown).toEqual([])
    expect(view.totals).toEqual({ debtCents: 0, overdueCents: 0, creditCents: 0 })
    expect(view.maxDebtCents).toBe(0)
  })

  it('cuenta a quiénes se les puede elegir categoría (los organismos no)', () => {
    const s = sample()
    expect(countClassifiable(s.classes.values())).toBe(23)
    expect(countUnclassified(s.classes.values())).toBe(22)
  })

  it('los nombres: con fantasía se muestra «Fantasía (Razón social)»', () => {
    const named = { partyName: 'Cervecería y Maltería SA', tradeName: 'Barracuda' }
    expect(supplierDisplayName(named)).toBe('Barracuda (Cervecería y Maltería SA)')
    expect(supplierShortName(named)).toBe('Barracuda')
    expect(supplierDisplayName({ partyName: 'Hielo Cristal', tradeName: 'Hielo Cristal' })).toBe(
      'Hielo Cristal',
    )
  })
})

describe('el margen: desde cuándo o para cuándo, nunca un importe', () => {
  const base = {
    debtCents: 0,
    creditCents: 0,
    overdueCents: 0,
    dueSoonCents: 0,
    oldestDueDate: null,
    nextDueDate: null,
  }

  it('vencido: cuenta desde el vencimiento más viejo', () => {
    expect(
      ledgerRail({ ...base, debtCents: 10, overdueCents: 10, oldestDueDate: '2026-10-01' }, TODAY),
    ).toEqual({ label: 'vencido hace', value: 12, unit: 'días', tone: 'late' })
    expect(
      ledgerRail({ ...base, debtCents: 10, overdueCents: 10, oldestDueDate: '2026-10-12' }, TODAY),
    ).toEqual({ label: 'vencido hace', value: 1, unit: 'día', tone: 'late' })
  })

  it('más de mil días entra sin punto de miles', () => {
    const rail = ledgerRail(
      { ...base, debtCents: 10, overdueCents: 10, oldestDueDate: '2023-06-28' },
      TODAY,
    )
    expect(rail?.value).toBe(1203)
    expect(String(rail?.value)).not.toContain('.')
  })

  it('vence hoy, mañana o en N días', () => {
    const soon = { ...base, debtCents: 10, dueSoonCents: 10 }
    expect(ledgerRail({ ...soon, nextDueDate: TODAY }, TODAY)).toEqual({
      label: 'vence',
      value: 'hoy',
      tone: 'warn',
    })
    expect(ledgerRail({ ...soon, nextDueDate: '2026-10-14' }, TODAY)).toEqual({
      label: 'vence',
      value: 'mañana',
      tone: 'warn',
    })
    expect(ledgerRail({ ...soon, nextDueDate: '2026-10-18' }, TODAY)).toEqual({
      label: 'vence en',
      value: 5,
      unit: 'días',
      tone: 'warn',
    })
  })

  it('con deuda más adelante dice la fecha; sin fecha, lo dice', () => {
    expect(ledgerRail({ ...base, debtCents: 10, nextDueDate: '2026-10-30' }, TODAY)).toEqual({
      label: 'vence el',
      value: '30/10',
      tone: 'muted',
    })
    expect(ledgerRail({ ...base, debtCents: 10 }, TODAY)).toEqual({
      label: 'sin',
      value: 'fecha',
      tone: 'muted',
    })
  })

  it('solo a favor, y sin nada el margen queda vacío', () => {
    expect(ledgerRail({ ...base, creditCents: 10 }, TODAY)).toEqual({
      label: 'a tu',
      value: 'favor',
      tone: 'ok',
    })
    expect(ledgerRail(base, TODAY)).toBeNull()
  })

  it('lo vencido manda sobre lo que vence esta semana', () => {
    const rail = ledgerRail(
      {
        ...base,
        debtCents: 20,
        overdueCents: 10,
        dueSoonCents: 10,
        oldestDueDate: '2026-10-10',
        nextDueDate: '2026-10-15',
      },
      TODAY,
    )
    expect(rail?.tone).toBe('late')
  })

  it('una compra sola: mismas palabras', () => {
    expect(dueRail(null, TODAY)).toEqual({ label: 'sin', value: 'fecha', tone: 'muted' })
    expect(dueRail('2026-10-01', TODAY).value).toBe(12)
    expect(dueRail(TODAY, TODAY).value).toBe('hoy')
    expect(dueRail('2026-10-20', TODAY)).toEqual({
      label: 'vence en',
      value: 7,
      unit: 'días',
      tone: 'warn',
    })
    expect(dueRail('2026-10-21', TODAY)).toEqual({
      label: 'vence el',
      value: '21/10',
      tone: 'muted',
    })
  })

  it('la fecha de un comprobante: el mes arriba y el día grande', () => {
    expect(dateRail('2026-10-08')).toEqual({ label: 'oct', value: '08' })
    expect(dateRail('2026-01-31')).toEqual({ label: 'ene', value: '31' })
  })
})

describe('la oración del héroe: la misma urgencia que dice el Resumen', () => {
  const tranches = (total: number, overdue: number, week: number) => {
    const t = payablesTranches({
      totalCents: total,
      overdueCents: overdue,
      dueWeekCents: week,
      partiesRed: overdue > 0 ? 2 : 0,
    })
    if (!t) throw new Error('sin tramos')
    return t
  }

  it('con algo vencido', () => {
    const t = tranches(19_235_800, 12_000_000, 7_235_800)
    expect(libretaSentence(2, t).replaceAll(NB, ' ')).toBe(
      `A 2 proveedores. ${t.sentence}`.replaceAll(NB, ' '),
    )
    expect(libretaSentence(2, t)).toContain('ya venció')
  })

  it('uno solo, y nada vence esta semana', () => {
    expect(libretaSentence(1, tranches(5_000_000, 0, 0))).toBe(
      'A 1 proveedor. Nada vence esta semana.',
    )
  })

  it('sin deuda no hay oración (el vacío lo dice el título)', () => {
    expect(libretaSentence(0, tranches(0, 0, 0))).toBe('')
  })
})

describe('el período, dicho en palabras', () => {
  const chips = [
    { key: 'este-mes', value: '2026-10' },
    { key: 'mes-pasado', value: '2026-09' },
    { key: 'ultimos-90', value: '2026-07-16..2026-10-13' },
    { key: 'este-anio', value: '2026-01-01..2026-10-13' },
  ]

  it('un mes se nombra; los otros chips, como se dicen', () => {
    expect(periodLead({ chips, active: '2026-10', from: '2026-10-01', to: '2026-10-31' })).toBe(
      'En octubre',
    )
    expect(periodLead({ chips, active: '2026-09', from: '2026-09-01', to: '2026-09-30' })).toBe(
      'En septiembre',
    )
    expect(
      periodLead({ chips, active: chips[2]?.value ?? '', from: '2026-07-16', to: '2026-10-13' }),
    ).toBe('En los últimos 90 días')
    expect(
      periodLead({ chips, active: chips[3]?.value ?? '', from: '2026-01-01', to: '2026-10-13' }),
    ).toBe('En lo que va del año')
  })

  it('un rango a mano: el mes si es entero, las fechas si no', () => {
    expect(periodLead({ chips, active: null, from: '2026-08-01', to: '2026-08-31' })).toBe(
      'En agosto',
    )
    expect(periodLead({ chips, active: null, from: '2026-08-01', to: '2026-10-13' })).toBe(
      'Del 01/08 al 13/10',
    )
    expect(
      periodLead({ chips, active: null, from: '2026-08-01', to: '2026-10-13' }, { lower: true }),
    ).toBe('del 01/08 al 13/10')
  })
})

function doc(patch: Partial<DocumentListRow> = {}): DocumentListRow {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    seq: 12,
    kind: 'purchase',
    title: 'Factura A 0003-00001290',
    voucherType: 'factura_a',
    pointOfSale: 3,
    number: 1290,
    partyId: '00000000-0000-4000-8000-0000000000p1',
    partyName: 'Barracuda Bebidas',
    issueDate: '2026-10-08',
    accountingDate: '2026-10-08',
    dueDate: '2026-10-30',
    description: '',
    totalCents: 12_000_000,
    openCents: 12_000_000,
    paymentStatus: 'unpaid',
    status: 'posted',
    imputation: 'Compras: bebidas con alcohol',
    means: null,
    appliedTo: null,
    createdByName: 'Socio',
    createdAt: '2026-10-08T12:00:00Z',
    ...patch,
  }
}

describe('documentRowState: el estado de un comprobante con palabras de dueño', () => {
  it('anulado', () => {
    expect(documentRowState(doc({ status: 'voided' }), TODAY)).toMatchObject({
      text: 'Anulado',
      voided: true,
      payable: false,
    })
  })

  it('un gasto ya se pagó en el momento', () => {
    expect(
      documentRowState(doc({ kind: 'expense', paymentStatus: 'none', openCents: null }), TODAY),
    ).toMatchObject({ text: 'Pagado en el momento', tone: 'muted', payable: false })
  })

  it('una nota de crédito: a tu favor sin usar, o ya descontada', () => {
    const open = documentRowState(
      doc({ kind: 'purchase_credit_note', openCents: 6_050_000 }),
      TODAY,
    )
    expect(open.text.replaceAll(NB, ' ')).toBe('A tu favor, sin usar: $ 60.500')
    expect(open.tone).toBe('info')
    expect(open.payable).toBe(false)
    expect(documentRowState(doc({ kind: 'purchase_credit_note', openCents: 0 }), TODAY).text).toBe(
      'Ya descontada',
    )
  })

  it('pagada', () => {
    expect(documentRowState(doc({ paymentStatus: 'paid', openCents: 0 }), TODAY)).toMatchObject({
      text: 'Pagada',
      tone: 'ok',
      payable: false,
    })
  })

  it('pagué una parte: cuánto falta y de cuánto', () => {
    const state = documentRowState(doc({ paymentStatus: 'partial', openCents: 4_000_000 }), TODAY)
    expect(state.text.replaceAll(NB, ' ')).toBe('Falta pagar $ 40.000')
    expect(state.note?.replaceAll(NB, ' ')).toBe('de $ 120.000')
    expect(state.tone).toBe('warn')
    expect(state.payable).toBe(true)
  })

  it('impaga vencida, por vencer y sin apuro', () => {
    const late = documentRowState(doc({ dueDate: '2026-10-10' }), TODAY)
    expect(late.text).toBe('Vencida hace 3 días')
    // Sin ningún pago, «falta $ X» repetiría el total de al lado: no se dice.
    expect(late.note).toBeNull()
    expect(late.tone).toBe('late')
    // Con una parte ya descontada (una nota de crédito aplicada), sí: lo que falta es otro número.
    const lessOpen = documentRowState(doc({ dueDate: '2026-10-10', openCents: 7_000_000 }), TODAY)
    expect(lessOpen.note?.replaceAll(NB, ' ')).toBe('falta $ 70.000')
    expect(documentRowState(doc({ dueDate: '2026-10-12' }), TODAY).text).toBe('Vencida hace 1 día')
    expect(documentRowState(doc({ dueDate: TODAY }), TODAY).text).toBe('Vence hoy')
    expect(documentRowState(doc({ dueDate: '2026-10-14' }), TODAY).text).toBe('Vence mañana')
    expect(documentRowState(doc({ dueDate: '2026-10-18' }), TODAY)).toMatchObject({
      text: 'Vence en 5 días',
      tone: 'warn',
    })
    expect(documentRowState(doc({ dueDate: '2026-10-30' }), TODAY)).toMatchObject({
      text: 'Falta pagar',
      note: 'vence el 30/10',
    })
    expect(documentRowState(doc({ dueDate: null }), TODAY)).toMatchObject({
      text: 'Falta pagar',
      note: null,
    })
  })

  it('sin proveedor no hay a quién pagarle', () => {
    expect(documentRowState(doc({ partyId: null }), TODAY).payable).toBe(false)
  })

  it('nueve cifras entran enteras', () => {
    const state = documentRowState(
      doc({ paymentStatus: 'partial', openCents: 99_999_999_900, totalCents: 99_999_999_900 }),
      TODAY,
    )
    expect(state.text.replaceAll(NB, ' ')).toBe('Falta pagar $ 999.999.999')
  })
})

describe('pagos: la línea de arriba y lo que se lee de cada uno', () => {
  const pay = (cents: number, status: 'posted' | 'voided' = 'posted') => ({
    totalCents: cents,
    status,
  })

  it('suma lo que se ve, sin los anulados, solo si entra todo en la página', () => {
    expect(
      paymentsHeadline({
        rows: [pay(100), pay(250), pay(900, 'voided')],
        totalRows: 3,
        searching: false,
      }),
    ).toEqual({ count: 2, cents: 350 })
  })

  it('con más páginas o buscando no dice un total a medias', () => {
    expect(paymentsHeadline({ rows: [pay(100)], totalRows: 128, searching: false })).toBeNull()
    expect(paymentsHeadline({ rows: [pay(100)], totalRows: 1, searching: true })).toBeNull()
    expect(paymentsHeadline({ rows: [], totalRows: 0, searching: false })).toBeNull()
    expect(
      paymentsHeadline({ rows: [pay(100, 'voided')], totalRows: 1, searching: false }),
    ).toBeNull()
  })

  it('con qué y qué pagó', () => {
    expect(paymentMeansText([{ label: 'Caja' }])).toBe('con Caja')
    expect(paymentMeansText([{ label: 'Caja' }, { label: 'Mercado Pago' }])).toBe('con 2 medios')
    expect(paymentMeansText([])).toBeNull()
    expect(paymentMeansText(null)).toBeNull()
    expect(paymentAppliedText([{ label: 'Factura A 0003-00001100' }])).toBe(
      'pagó Factura A 0003-00001100',
    )
    expect(paymentAppliedText([{ label: 'Factura A 1' }, { label: 'x' }, { label: 'y' }])).toBe(
      'pagó Factura A 1 (+2)',
    )
    expect(paymentAppliedText([])).toBe('quedó a cuenta')
    expect(paymentAppliedText(null)).toBeNull()
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

describe('el héroe «Le debés a proveedores»', () => {
  it('con deuda: el número, a cuántos y los tres tramos con su palabra', () => {
    const out = text(
      html(
        createElement(LibretaHero, {
          tenantSlug: SLUG,
          totals: {
            debtCents: 19_235_800,
            overdueCents: 12_000_000,
            dueSoonCents: 7_235_800,
            creditCents: 6_550_000,
            count: 24,
          },
          debtors: 2,
          overdueParties: 1,
          hasSuppliers: true,
        }),
      ),
    )
    expect(out).toContain('Le debés a proveedores')
    expect(out).toContain('192.358')
    expect(out).toContain('A 2 proveedores.')
    for (const word of ['Vencido', 'Vence esta semana', 'Más adelante']) expect(out).toContain(word)
    expect(out).toContain('$ 65.500 a favor')
    expect(out).toContain('¿Cómo se calcula?')
  })

  it('sin deuda no muestra «$ 0»: dice que no le debés nada a nadie', () => {
    const out = text(
      html(
        createElement(LibretaHero, {
          tenantSlug: SLUG,
          totals: { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0, count: 5 },
          debtors: 0,
          overdueParties: 0,
          hasSuppliers: true,
        }),
      ),
    )
    expect(out).toContain('No le debés nada a nadie')
    expect(out).not.toContain('$ 0')
  })

  it('sin los saldos iniciales y sin deuda cargada no dice «nada»: dice que todavía no sabe', () => {
    const out = text(
      html(
        createElement(LibretaHero, {
          tenantSlug: SLUG,
          totals: { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0, count: 79 },
          debtors: 0,
          overdueParties: 0,
          hasSuppliers: true,
          openingPending: true,
        }),
      ),
    )
    expect(out).toContain('Todavía no sé cuánto debés')
    expect(out).toContain('saldos iniciales')
    expect(out).not.toContain('No le debés nada')
    expect(out).not.toContain('$ 0')
  })

  it('sin los saldos iniciales y con deuda (HUB): el número y que es lo cargado hasta ahora', () => {
    const out = text(
      html(
        createElement(LibretaHero, {
          tenantSlug: SLUG,
          totals: {
            debtCents: 19_235_800,
            overdueCents: 19_235_800,
            dueSoonCents: 0,
            creditCents: 0,
            count: 79,
          },
          debtors: 2,
          overdueParties: 2,
          hasSuppliers: true,
          openingPending: true,
          canWrite: true,
        }),
      ),
    )
    expect(out).toContain('192.358')
    expect(out).toContain('Pagar lo vencido')
    expect(out).toContain('Es lo que cargaste hasta ahora')
  })
})

describe('la deuda dibujada en cada renglón', () => {
  it('es un adorno: lo mismo está escrito al lado', () => {
    const out = html(
      createElement(DebtBar, {
        overdueCents: 100,
        soonCents: 50,
        laterCents: 50,
        maxCents: 400,
      }),
    )
    expect(out).toContain('aria-hidden="true"')
    expect(out).not.toContain('tabindex')
    expect(out).toContain('bg-destructive')
    expect(out).toContain('bg-warning')
    expect(out).toContain('bg-adm-neutral')
  })

  it('sin deuda no dibuja nada', () => {
    expect(
      html(createElement(DebtBar, { overdueCents: 0, soonCents: 0, laterCents: 0, maxCents: 0 })),
    ).toBe('')
  })
})

function listProps(canWrite: boolean) {
  const s = sample()
  const view = libretaView({
    rows: s.rows,
    classes: s.classes,
    filter: 'todos',
    q: '',
    match: MATCH,
  })
  return {
    tenantSlug: SLUG,
    view,
    today: TODAY,
    canWrite,
    pickable: canWrite ? new Set(view.shown.map((e) => e.row.partyId)) : new Set<string>(),
    backHref: '/hub/administracion/compras',
  }
}

describe('la libreta dibujada', () => {
  it('quien carga ve [Pagar], «Elegir categoría» y «Cargarle una compra»', () => {
    const out = html(createElement(LibretaList, listProps(true)))
    const read = text(out)
    expect(read).toContain('Les debés')
    expect(read).toContain('Tenés a favor')
    expect(read).toContain('Sin deuda')
    expect(read).toContain('vencido hace 1 día')
    expect(read).toContain('vence en 5 días')
    expect(read).toContain('Bebidas con alcohol')
    expect(read).toContain('Pagar')
    expect(read).toContain('Ver los 8 que faltan')
    expect(out).toContain('Cargarle una compra a Proveedor sin deuda 00')
    expect(read).toContain('Total: le debés $ 192.358')
  })

  it('la contadora no recibe ningún botón de carga', () => {
    ui.readOnly = true
    const out = html(createElement(LibretaList, listProps(false)))
    const read = text(out)
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('Sin categoría')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('compras/nueva')
    expect(read).not.toContain('Pagar')
    expect(read).not.toContain('Elegir categoría')
    expect(read).not.toContain('Cargarle una compra')
  })

  it('un nombre de 60 caracteres queda entero en el `title` y el importe no se parte', () => {
    const big = row({
      partyName: LONG_NAME,
      debtCents: 99_999_999_900,
      overdueCents: 99_999_999_900,
      oldestDueDate: '2026-10-01',
    })
    const view = libretaView({
      rows: [big],
      classes: new Map([[big.partyId, info()]]),
      filter: 'todos',
      q: '',
      match: MATCH,
    })
    const out = html(
      createElement(LibretaList, {
        ...listProps(true),
        view,
        pickable: new Set<string>(),
      }),
    )
    expect(out).toContain(`title="${LONG_NAME}"`)
    expect(text(out)).toContain('$ 999.999.999')
    expect(out).toContain('whitespace-nowrap')
  })
})

describe('la franja de los que no tienen categoría y la puerta de carga', () => {
  it('la franja dice cuántos faltan de cuántos y lleva a clasificarlos', () => {
    const out = html(createElement(UnclassifiedStrip, { tenantSlug: SLUG, pending: 76, total: 79 }))
    expect(text(out)).toContain('76 de 79 proveedores no tienen categoría')
    expect(out).toContain('filtro=sin-clasificar')
    expect(text(out)).toContain('Clasificarlos ahora')
  })

  it('sin pendientes no se dibuja', () => {
    expect(
      html(createElement(UnclassifiedStrip, { tenantSlug: SLUG, pending: 0, total: 79 })),
    ).toBe('')
  })

  it('la puerta son las tres tarjetas del lanzador', () => {
    const out = text(html(createElement(ComprasDoor, { tenantSlug: SLUG })))
    expect(out).toContain('¿Qué querés cargar?')
    expect(out).toContain('Pagué algo recién')
    expect(out).toContain('Me llegó una factura o un remito y lo pago después')
    expect(out).toContain('Pago algo que debía')
  })

  it('la contadora no ve la puerta', () => {
    ui.readOnly = true
    expect(html(createElement(ComprasDoor, { tenantSlug: SLUG }))).toBe('')
  })
})

describe('los comprobantes como renglones', () => {
  const rows = [
    doc(),
    doc({
      id: '00000000-0000-4000-8000-0000000000d2',
      title: 'Remito u otro comprobante (sin factura)',
      voucherType: 'sin_comprobante',
      partyName: LONG_NAME,
      dueDate: '2026-10-10',
    }),
    doc({
      id: '00000000-0000-4000-8000-0000000000d3',
      accountingDate: '2026-10-07',
      status: 'voided',
    }),
  ]

  it('quien carga ve el estado en palabras, «Sin factura» y [Pagarle]', () => {
    const out = html(
      createElement(DocumentRows, { tenantSlug: SLUG, rows, today: TODAY, canWrite: true }),
    )
    const read = text(out)
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('Vencida hace 3 días')
    expect(read).toContain('Sin factura')
    expect(read).toContain('Anulado')
    expect(read).toContain('Pagarle')
    expect(out).toContain('/hub/administracion/comprobantes/00000000-0000-4000-8000-0000000000d1')
    // El mismo día no repite la fecha en el margen: se agrupan solos.
    expect(out.split('>08<').length - 1).toBe(1)
    expect(out.split('>07<').length - 1).toBe(1)
  })

  it('la contadora no ve [Pagarle]', () => {
    ui.readOnly = true
    const out = html(
      createElement(DocumentRows, { tenantSlug: SLUG, rows, today: TODAY, canWrite: false }),
    )
    expect(text(out)).not.toContain('Pagarle')
    expect(out).not.toContain('<button')
  })

  it('los pagos: a quién, con qué y qué pagó', () => {
    const out = text(
      html(
        createElement(PaymentRows, {
          tenantSlug: SLUG,
          rows: [
            doc({
              kind: 'payment',
              title: 'Pago',
              voucherType: null,
              means: [{ id: null, label: 'Mercado Pago', amountCents: 38_000_000 }],
              appliedTo: [],
              totalCents: 38_000_000,
              openCents: null,
              paymentStatus: 'none',
            }),
          ],
        }),
      ),
    )
    // El nombre es el título del renglón (no se corta detrás de «Le pagaste a…»).
    expect(out).toContain('Barracuda Bebidas')
    expect(out).not.toContain('Le pagaste a')
    expect(out).toContain('con Mercado Pago')
    expect(out).toContain('quedó a cuenta')
    expect(out).toContain('$ 380.000')
  })
})

describe('un solo libro: ninguna palabra sugiere que algo queda afuera', () => {
  it('los textos de la libreta no dicen «en negro», «en blanco», «afuera» ni «ganancia»', () => {
    const out = [
      html(createElement(LibretaList, listProps(true))),
      html(
        createElement(DocumentRows, {
          tenantSlug: SLUG,
          rows: [doc({ voucherType: 'sin_comprobante' })],
          today: TODAY,
          canWrite: true,
        }),
      ),
    ]
      .map(text)
      .join(' ')
      .toLowerCase()
    for (const word of ['en negro', 'en blanco', 'afuera', 'ganancia', 'ganaste']) {
      expect(out).not.toContain(word)
    }
  })
})

// ─── La contadora no escribe: lo que faltaba probar dibujado ─────────────────

describe('la barra de la libreta', () => {
  const toolbar = (canWrite: boolean) => {
    const s = sample()
    const view = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'todos',
      q: '',
      match: MATCH,
    })
    return html(
      createElement(LibretaToolbar, {
        tenantSlug: SLUG,
        counts: view.counts,
        filter: 'todos',
        q: '',
        canWrite,
        existingNames: [],
        exportHref: '/api/x',
        exportFileName: 'x.csv',
      }),
    )
  }

  it('quien carga puede agregar proveedores de una lista', () => {
    const read = text(toolbar(true))
    expect(read).toContain('Agregar de una lista')
    expect(read).toContain('Exportar saldos')
    expect(read).toContain('Sin categoría')
  })

  it('la contadora busca, filtra y exporta, pero no agrega a nadie', () => {
    ui.readOnly = true
    const read = text(toolbar(false))
    expect(read).not.toContain('Agregar de una lista')
    expect(read).toContain('Exportar saldos')
    expect(read).toContain('Con deuda')
  })
})

describe('la pestaña «Proveedores» entera, para la contadora', () => {
  const body = async (data: LibretaData, canWrite: boolean) =>
    html(
      await SuppliersBody({
        data: Promise.resolve(data),
        tenantSlug: SLUG,
        sp: {},
        today: TODAY,
        canWrite,
      }),
    )
  const totals = { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0, count: 0 }

  it('con proveedores: ni la franja de categorías, ni «Agregar de una lista», ni un botón de carga', async () => {
    const s = sample()
    const data: LibretaData = {
      list: { ok: true, data: { rows: s.rows, totals, asOf: TODAY } },
      classes: { ok: true, data: s.classes },
      plan: null,
      settings: { ok: true, data: null },
    }
    // Quien carga sí ve la franja: es la misma pestaña con el permiso puesto.
    expect(text(await body(data, true))).toContain('proveedores no tienen categoría')

    ui.readOnly = true
    const out = await body(data, false)
    const read = text(out)
    expect(read).toContain('Barracuda Bebidas')
    expect(read).not.toContain('no tienen categoría')
    expect(read).not.toContain('Clasificarlos ahora')
    expect(read).not.toContain('Agregar de una lista')
    expect(read).not.toContain('Elegir categoría')
    expect(read).not.toContain('Pagar')
    expect(out).not.toContain('compras/nueva')
  })

  it('con casi todos sin categoría asoman pocos «sin deuda» (el resto, plegado)', async () => {
    const s = sample()
    const data: LibretaData = {
      list: { ok: true, data: { rows: s.rows, totals, asOf: TODAY } },
      classes: { ok: true, data: s.classes },
      plan: null,
      settings: { ok: true, data: null },
    }
    const all = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'todos',
      q: '',
      match: MATCH,
    })
    const settled = all.settled.length + all.settledMore.length
    expect(settled).toBeGreaterThan(SETTLED_PREVIEW_UNSORTED)
    const owner = text(await body(data, true))
    expect(owner).toContain(`Ver los ${settled - SETTLED_PREVIEW_UNSORTED} que faltan`)
    // La contadora no clasifica: ve el pliegue de siempre.
    ui.readOnly = true
    const read = text(await body(data, false))
    expect(read).toContain(`Ver los ${settled - SETTLED_PREVIEW} que faltan`)
  })

  it('el bar sin proveedores: el vacío enseña, sin botones para ella', async () => {
    const data: LibretaData = {
      list: { ok: true, data: { rows: [], totals, asOf: TODAY } },
      classes: { ok: true, data: new Map() },
      plan: null,
      settings: { ok: true, data: null },
    }
    const owner = text(await body(data, true))
    expect(owner).toContain('Acá va tu libreta de proveedores')
    expect(owner).toContain('Cargar una compra que debo')
    expect(owner).toContain('Pegar la lista de mis proveedores')

    ui.readOnly = true
    const out = await body(data, false)
    expect(text(out)).toContain('Acá va tu libreta de proveedores')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('compras/nueva')
    expect(text(out)).not.toContain('Pegar la lista')
  })
})

describe('«Clasificar proveedores»: cada toque guarda', () => {
  const queue: SorterItem[] = [
    {
      partyId: '00000000-0000-4000-8000-0000000000c1',
      name: 'Barracuda Bebidas SA',
      displayName: 'Barracuda Bebidas',
      kind: 'supplier',
      updatedAt: '2026-10-12T10:00:00Z',
    },
    {
      partyId: '00000000-0000-4000-8000-0000000000c2',
      name: 'Hielo Cristal',
      displayName: 'Hielo Cristal',
      kind: 'supplier',
      updatedAt: '2026-10-12T10:00:00Z',
    },
  ]
  const sorter = () =>
    html(
      createElement(SupplierSorter, {
        tenantSlug: SLUG,
        queue,
        options: [
          {
            id: 'acc-1',
            name: 'Compras: bebidas con alcohol',
            shortName: 'Bebidas con alcohol',
            code: '5.1.01.01.003',
            groupId: 'g-1',
            groupName: 'Mercadería',
          },
        ],
        featured: ['acc-1'],
        usage: [],
        accounts: [],
        backHref: '/hub/administracion/compras',
        listHref: '/hub/administracion/compras?filtro=sin-clasificar&vista=lista',
      }),
    )

  it('quien carga ve la ficha del primero, el avance y las categorías para tocar', () => {
    const read = text(sorter())
    expect(read).toContain('Vas 0 de 2')
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('¿En qué le comprás?')
    expect(read).toContain('Bebidas con alcohol')
    expect(read).toContain('Saltear')
  })

  it('la contadora no lo ve, aunque alguien lo monte', () => {
    ui.readOnly = true
    expect(sorter()).toBe('')
  })
})

describe('Comprobantes y Pagos vacíos: el botón del paso siguiente es solo de quien carga', () => {
  const tab = (mode: 'comprobantes' | 'pagos', canWrite: boolean) =>
    htmlAsync(
      createElement(DocumentsTab, {
        mode,
        tenantId: 't-1',
        tenantSlug: SLUG,
        sp: {},
        today: TODAY,
        canWrite,
      }),
    )
  const empty = () => {
    reads.listDocuments.mockResolvedValue({
      rows: [],
      nextCursor: null,
      totalRows: 0,
      truncated: false,
    })
    reads.getMonthSpending.mockResolvedValue({
      from: '2026-10-01',
      to: '2026-10-31',
      categories: [],
      vouchers: [],
      totalCents: 0,
      documents: 0,
      truncated: false,
    })
  }

  it('quien carga: «Cargar una compra que debo», «Pagué algo recién» y «Pago algo que debía»', async () => {
    empty()
    const docs = text(await tab('comprobantes', true))
    expect(docs).toContain('Todavía no cargaste nada en octubre')
    expect(docs).toContain('Cargar una compra que debo')
    expect(docs).toContain('Pagué algo recién')
    // El filtro con / sin factura está aunque no haya nada que sumar.
    expect(docs).toContain('Con factura')
    expect(docs).toContain('Sin factura')
    expect(docs).not.toContain('$ 0')
    const pays = text(await tab('pagos', true))
    expect(pays).toContain('No hay pagos en octubre')
    expect(pays).toContain('Pago algo que debía')
  })

  it('la contadora ve el mismo vacío sin ningún botón de carga', async () => {
    ui.readOnly = true
    empty()
    const docs = await tab('comprobantes', false)
    expect(text(docs)).toContain('Todavía no cargaste nada en octubre')
    expect(text(docs)).not.toContain('Cargar una compra que debo')
    expect(text(docs)).not.toContain('Pagué algo recién')
    expect(docs).not.toContain('compras/nueva')
    const pays = await tab('pagos', false)
    expect(text(pays)).toContain('No hay pagos en octubre')
    expect(text(pays)).not.toContain('Pago algo que debía')
  })

  it('con comprobantes: ella ve la tabla, sin [Pagarle] ni «Ver como tabla»', async () => {
    ui.readOnly = true
    empty()
    reads.listDocuments.mockResolvedValue({
      rows: [doc()],
      nextCursor: null,
      totalRows: 1,
      truncated: false,
    })
    const out = await tab('comprobantes', false)
    const read = text(out)
    expect(out).toContain('<table')
    expect(read).toContain('Imputación')
    expect(read).not.toContain('Pagarle')
    expect(read).not.toContain('Ver como tabla')
    expect(read).not.toContain('Ver como libreta')
  })

  it('con comprobantes: quien carga ve los renglones con [Pagarle] y puede pasar a la tabla', async () => {
    empty()
    reads.listDocuments.mockResolvedValue({
      rows: [doc()],
      nextCursor: null,
      totalRows: 1,
      truncated: false,
    })
    const read = text(await tab('comprobantes', true))
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('Pagarle')
    expect(read).toContain('Ver como tabla')
  })
})
