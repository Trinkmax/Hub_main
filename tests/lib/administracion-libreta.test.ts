import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerender } from 'react-dom/static'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DocumentRows,
  PaymentRows,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/document-rows'
import { DocumentsTab } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/documents-tab'
import {
  LibretaList,
  LibretaToolbar,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/libreta-list'
import { SupplierAccountProvider } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-account-picker'
import {
  type SorterItem,
  SupplierSorter,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/supplier-sorter'
import {
  type LibretaData,
  SuppliersBody,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/suppliers-tab'
import {
  documentRowState,
  documentsTotal,
  dueRail,
  type LibretaInfo,
  ledgerRail,
  libretaGroupTotals,
  libretaTotalizerItems,
  libretaView,
  paymentAppliedText,
  paymentMeansText,
  periodLead,
  railText,
  supplierDisplayName,
  supplierShortName,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/libreta'
import {
  countClassifiable,
  countUnclassified,
  isTaxOrPayroll,
  isVisibleSupplier,
  SUPPLIER_FILTERS,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/suppliers'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import {
  matchesPartyFilter,
  matchesPartyQuery,
  type PartyListRow,
} from '@/lib/accounting/queries/parties'

/**
 * La libreta de proveedores («Compras y pagos»): qué filas se ven, qué suma el
 * totalizador y cómo se lee el estado de un comprobante. Y lo que la pantalla le
 * promete a cada uno ya dibujada: que un dato que falta no salga como «$ 0» y
 * que la contadora no reciba ningún botón de carga.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
// La lectura de Comprobantes y Pagos: acá se contesta a mano (sin base).
const reads = vi.hoisted(() => ({ listDocuments: vi.fn() }))
vi.mock('@/lib/accounting/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/queries')>()),
  listDocuments: reads.listDocuments,
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
// Los «⋯» se dibujan abiertos: lo que importa es qué ofrecen a cada uno.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  const Item = ({ children, disabled }: { children?: ReactNode; disabled?: boolean }) =>
    createElement('div', { 'data-menu-item': '', 'aria-disabled': disabled }, children)
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Item,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: Pass,
  }
})

afterEach(() => {
  ui.readOnly = false
  reads.listDocuments.mockReset()
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

describe('libretaView: las filas y su orden', () => {
  it('primero los que deben (lo más vencido arriba), después «a favor» y al final los sin deuda', () => {
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
    // Los sin deuda no se pliegan: es una planilla, con su búsqueda y su filtro.
    expect(view.settled).toHaveLength(20)
    expect(view.shown).toHaveLength(23)
    expect(view.settled.map((e) => e.row.partyName)).toEqual(
      [...view.settled.map((e) => e.row.partyName)].sort((a, b) => a.localeCompare(b, 'es')),
    )
  })

  it('la fila del total suma lo que se ve', () => {
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
      dueSoonCents: 7_235_800,
      creditCents: 6_550_000,
    })
  })

  it('la búsqueda y «Sin categoría» dejan solo lo que se pidió', () => {
    const s = sample()
    const searched = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'todos',
      q: 'sin deuda',
      match: MATCH,
    })
    expect(searched.settled).toHaveLength(20)
    expect(searched.debt).toHaveLength(0)
    const unclassified = libretaView({
      rows: s.rows,
      classes: s.classes,
      filter: 'sin-clasificar',
      q: '',
      match: MATCH,
    })
    // Barracuda ya tiene categoría: no está entre los que faltan.
    expect(unclassified.shown.some((e) => e.row.partyName === 'Barracuda Bebidas')).toBe(false)
    expect(unclassified.shown).toHaveLength(22)
  })

  it('cada filtro cuenta lo mismo que filtra `listParties` (más la regla de los organismos)', () => {
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
            isVisibleSupplier(r, f.filter) &&
            (f.filter === 'taxes_payroll' || !isTaxOrPayroll(r)),
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

  it('un impuesto o los sueldos con deuda no entran en los filtros de proveedores', () => {
    const s = sample()
    const rentas = row({
      partyName: 'Rentas',
      partyKind: 'tax_agency',
      systemKey: 'rentas',
      debtCents: 900_000,
      overdueCents: 900_000,
    })
    const personal = row({
      partyName: 'Personal',
      partyKind: 'payroll',
      systemKey: 'personal',
      debtCents: 40_000_000,
    })
    const sindicato = row({ partyName: 'Sindicato', partyKind: 'other', systemKey: 'sindicato' })
    const rows = [...s.rows, rentas, personal, sindicato]
    const names = (filter: 'todos' | 'con-deuda' | 'vencidos' | 'impuestos') =>
      libretaView({ rows, classes: s.classes, filter, q: '', match: MATCH }).shown.map(
        (e) => e.row.partyName,
      )
    for (const filter of ['todos', 'con-deuda', 'vencidos'] as const) {
      expect(names(filter), filter).not.toContain('Rentas')
      expect(names(filter), filter).not.toContain('Personal')
      expect(names(filter), filter).not.toContain('Sindicato')
    }
    expect(names('impuestos')).toEqual(['Rentas', 'Personal', 'ARCA', 'Sindicato'])
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
    expect(view.totals).toEqual({ debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0 })
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

describe('el vencimiento en palabras: desde cuándo o para cuándo, nunca un importe', () => {
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

  it('en una celda se dice en una línea', () => {
    expect(railText(dueRail('2026-10-01', TODAY))).toBe('vencido hace 12 días')
    expect(railText(dueRail('2026-10-18', TODAY))).toBe('vence en 5 días')
    expect(railText(dueRail(TODAY, TODAY))).toBe('vence hoy')
    expect(railText(dueRail('2026-11-20', TODAY))).toBe('vence el 20/11')
    expect(railText(dueRail(null, TODAY))).toBe('sin fecha')
  })
})

describe('el totalizador de arriba: Le debés · Vencido · Vence esta semana', () => {
  const plainTexts = (items: ReadonlyArray<{ hint?: ReactNode }>) =>
    items.map((item) => (typeof item.hint === 'string' ? item.hint.replaceAll(NB, ' ') : item.hint))

  it('suma los proveedores; los impuestos y sueldos, solo en su filtro', () => {
    const late = row({ debtCents: 1_000, overdueCents: 400, dueSoonCents: 100, creditCents: 50 })
    const rentas = row({
      partyKind: 'tax_agency',
      systemKey: 'rentas',
      debtCents: 700,
      overdueCents: 700,
    })
    const personal = row({ partyKind: 'payroll', systemKey: 'personal', debtCents: 9_000 })
    const rows = [late, rentas, personal]
    expect(libretaGroupTotals(rows, 'todos')).toEqual({
      debtCents: 1_000,
      overdueCents: 400,
      dueSoonCents: 100,
      creditCents: 50,
    })
    // Los otros filtros miran la misma foto: no achican lo que se debe.
    expect(libretaGroupTotals(rows, 'vencidos')).toEqual(libretaGroupTotals(rows, 'todos'))
    expect(libretaGroupTotals(rows, 'impuestos')).toEqual({
      debtCents: 9_700,
      overdueCents: 700,
      dueSoonCents: 0,
      creditCents: 0,
    })
  })

  it('dice lo que se debe, con su tono solo si hay algo', () => {
    const items = libretaTotalizerItems({
      debtCents: 19_235_800,
      overdueCents: 12_000_000,
      dueSoonCents: 7_235_800,
      creditCents: 6_550_000,
    })
    expect(items.map((i) => i.label)).toEqual(['Le debés', 'Vencido', 'Vence esta semana'])
    expect(items.map((i) => i.cents)).toEqual([19_235_800, 12_000_000, 7_235_800])
    expect(items.map((i) => i.tone)).toEqual([undefined, 'bad', 'warn'])
    // Lo que hay a favor va aparte: no se resta.
    expect(plainTexts(items)[0]).toBe('$ 65.500 a favor')

    const calm = libretaTotalizerItems({
      debtCents: 100,
      overdueCents: 0,
      dueSoonCents: 0,
      creditCents: 0,
    })
    expect(calm.map((i) => i.tone)).toEqual([undefined, 'default', 'default'])
  })

  it('sin los saldos iniciales y sin deuda cargada no es «$ 0»: todavía no se sabe', () => {
    const items = libretaTotalizerItems(
      { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0 },
      { openingPending: true },
    )
    expect(items.map((i) => i.cents)).toEqual([null, null, null])
    expect(items[0]?.hint).toBe('Faltan los saldos iniciales')
  })

  it('sin los saldos iniciales y con deuda (HUB): el número, y que es lo cargado hasta ahora', () => {
    const items = libretaTotalizerItems(
      { debtCents: 19_235_800, overdueCents: 19_235_800, dueSoonCents: 0, creditCents: 0 },
      { openingPending: true },
    )
    expect(items[0]?.cents).toBe(19_235_800)
    expect(items[0]?.hint).toBe('Lo cargado hasta ahora')
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
    attachmentCount: 0,
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

describe('la fila del total y lo que se lee de cada pago', () => {
  const line = (
    cents: number,
    status: 'posted' | 'voided' = 'posted',
    kind: DocumentListRow['kind'] = 'purchase',
  ) => ({ totalCents: cents, status, kind })

  it('suma lo que se ve, sin los anulados', () => {
    expect(documentsTotal([line(100), line(250), line(900, 'voided')])).toBe(350)
    expect(documentsTotal([])).toBe(0)
  })

  it('una nota de crédito resta', () => {
    expect(documentsTotal([line(1_000), line(300, 'posted', 'purchase_credit_note')])).toBe(700)
    expect(documentsTotal([line(300, 'voided', 'purchase_credit_note')])).toBe(0)
  })

  it('de dónde salió y qué pagó', () => {
    expect(paymentMeansText([{ label: 'Caja' }])).toBe('Caja')
    expect(paymentMeansText([{ label: 'Caja' }, { label: 'Mercado Pago' }])).toBe('2 medios')
    expect(paymentMeansText([])).toBeNull()
    expect(paymentMeansText(null)).toBeNull()
    expect(paymentAppliedText([{ label: 'Factura A 0003-00001100' }])).toBe(
      'Factura A 0003-00001100',
    )
    expect(paymentAppliedText([{ label: 'Factura A 1' }, { label: 'x' }, { label: 'y' }])).toBe(
      'Factura A 1 (+2)',
    )
    expect(paymentAppliedText([])).toBe('A cuenta')
    expect(paymentAppliedText(null)).toBeNull()
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

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
    canWrite,
    pickable: canWrite ? new Set(view.shown.map((e) => e.row.partyId)) : new Set<string>(),
    backHref: '/hub/administracion/compras',
  }
}

describe('la planilla de proveedores dibujada', () => {
  it('quien carga ve Proveedor · Vencido · Esta semana · Saldo, [Pagar] y el ⋯', () => {
    const out = html(createElement(LibretaList, listProps(true)))
    const read = text(out)
    for (const head of ['Proveedor', 'Vencido', 'Esta semana', 'Saldo']) {
      expect(read).toContain(head)
    }
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('Pagar')
    expect(read).toContain('A favor $ 60.500')
    expect(read).toContain('$ 5.000 a favor')
    expect(read).toContain('Compra y pago')
    expect(read).toContain('Ver su cuenta corriente')
    // Sale el margen «vencido hace…» y las barritas: la plata ya está en sus columnas.
    expect(read).not.toContain('vencido hace')
    expect(read).toContain('Total')
    expect(read).toContain('$ 192.358')
    expect(out).toContain('adm-double-rule')
  })

  it('«Elegir categoría» sigue en el ⋯ de la fila, para quien carga', () => {
    const props = listProps(true)
    const read = text(
      html(
        createElement(SupplierAccountProvider, {
          tenantSlug: SLUG,
          accounts: [],
          categories: { options: [], featured: [], pinned: [] },
          rows: [],
          // biome-ignore lint/correctness/noChildrenProp: en un .ts no hay JSX y el tipo lo pide en las props
          children: createElement(LibretaList, props),
        }),
      ),
    )
    // Barracuda ya tiene: se cambia. El resto, se elige.
    expect(read).toContain('Cambiar la categoría')
    expect(read).toContain('Elegir categoría')
  })

  it('toda la fila lleva a su cuenta corriente, y las acciones van por encima', () => {
    const props = listProps(true)
    const out = html(createElement(LibretaList, props))
    const first = props.view.shown[0]?.row.partyId
    expect(out).toContain(`/hub/administracion/compras/proveedores/${first}`)
    expect(out).toContain('after:absolute')
    expect(out).toContain('z-10')
  })

  it('la compra del ⋯ vuelve a esta lista y «Compra y pago» va con su modo', () => {
    const out = html(createElement(LibretaList, listProps(true)))
    expect(out).toContain('compras/nueva?proveedor=')
    expect(out).toContain('compras/nueva?modo=pago')
    expect(out).toContain('volver=%2Fhub%2Fadministracion%2Fcompras')
  })

  it('la contadora no recibe ningún botón de carga', () => {
    ui.readOnly = true
    const out = html(createElement(LibretaList, listProps(false)))
    const read = text(out)
    expect(read).toContain('Barracuda Bebidas')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('compras/nueva')
    expect(read).not.toContain('Pagar')
    expect(read).not.toContain('Elegir categoría')
    expect(read).not.toContain('Compra')
    expect(out).not.toContain('Acciones')
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

  it('sin filas no dibuja nada: el vacío lo decide quien la monta', () => {
    const view = libretaView({ rows: [], classes: new Map(), filter: 'todos', q: '', match: MATCH })
    expect(html(createElement(LibretaList, { ...listProps(true), view }))).toBe('')
  })
})

describe('los comprobantes como planilla', () => {
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

  it('quien carga ve Fecha · Comprobante · Proveedor · Importe · Estado, y [Pagarle]', () => {
    const out = html(
      createElement(DocumentRows, { tenantSlug: SLUG, rows, today: TODAY, canWrite: true }),
    )
    const read = text(out)
    for (const head of ['Fecha', 'Comprobante', 'Proveedor', 'Importe', 'Estado']) {
      expect(read).toContain(head)
    }
    expect(read).toContain('08/10')
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('Vencida hace 3 días')
    expect(read).toContain('Sin factura')
    expect(read).toContain('Anulado')
    expect(read).toContain('Pagarle')
    expect(out).toContain('/hub/administracion/comprobantes/00000000-0000-4000-8000-0000000000d1')
    // Lo anulado no suma: son dos de $ 120.000.
    expect(read).toContain('Total $ 240.000')
    expect(out).toContain('adm-double-rule')
  })

  it('si la lista sigue en otra página, el total lo dice', () => {
    const read = text(
      html(
        createElement(DocumentRows, {
          tenantSlug: SLUG,
          rows,
          today: TODAY,
          canWrite: true,
          totalLabel: 'Total de esta página',
        }),
      ),
    )
    expect(read).toContain('Total de esta página $ 240.000')
  })

  it('una nota de crédito resta, con su signo', () => {
    const read = text(
      html(
        createElement(DocumentRows, {
          tenantSlug: SLUG,
          rows: [
            doc(),
            doc({
              id: '00000000-0000-4000-8000-0000000000d4',
              kind: 'purchase_credit_note',
              title: 'Nota de crédito A 0003-00000015',
              totalCents: 2_000_000,
              openCents: 2_000_000,
              paymentStatus: 'none',
            }),
          ],
          today: TODAY,
          canWrite: true,
        }),
      ),
    )
    expect(read).toContain('−$ 20.000')
    expect(read).toContain('Total $ 100.000')
    expect(read).toContain('A tu favor, sin usar')
  })

  it('la contadora no ve [Pagarle]; con el detalle, sí la imputación y el vencimiento', () => {
    ui.readOnly = true
    const out = html(
      createElement(DocumentRows, {
        tenantSlug: SLUG,
        rows,
        today: TODAY,
        canWrite: false,
        detail: true,
      }),
    )
    const read = text(out)
    expect(read).not.toContain('Pagarle')
    expect(out).not.toContain('<button')
    for (const head of ['Imputación', 'Falta', 'Vence']) expect(read).toContain(head)
    expect(read).toContain('Compras: bebidas con alcohol')
    expect(read).toContain('#12')
  })

  it('las fechas llevan el año solo si la lista cruza de año', () => {
    const read = text(
      html(
        createElement(DocumentRows, {
          tenantSlug: SLUG,
          rows: [doc(), doc({ accountingDate: '2025-12-30', issueDate: '2025-12-30' })],
          today: TODAY,
          canWrite: false,
        }),
      ),
    )
    expect(read).toContain('08/10/2026')
    expect(read).toContain('30/12/2025')
  })

  it('los pagos: a quién, de dónde salió y qué pagó', () => {
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
    expect(out).toContain('Barracuda Bebidas')
    expect(out).toContain('Salió de')
    expect(out).toContain('Mercado Pago')
    expect(out).toContain('A cuenta')
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

describe('arriba de la planilla: la búsqueda, el filtro y el ⋯', () => {
  const toolbar = (canWrite: boolean, filter: 'todos' | 'sin-clasificar' = 'todos') => {
    const s = sample()
    const view = libretaView({ rows: s.rows, classes: s.classes, filter, q: '', match: MATCH })
    return html(
      createElement(LibretaToolbar, {
        tenantSlug: SLUG,
        counts: view.counts,
        filter,
        q: '',
        canWrite,
        existingNames: [],
        exportHref: '/api/x',
        exportFileName: 'x.csv',
      }),
    )
  }

  it('el filtro es Todos · Con deuda · Vencidos · A favor · Impuestos y sueldos', () => {
    const out = toolbar(true)
    const read = text(out)
    for (const label of ['Todos', 'Con deuda', 'Vencidos', 'A favor', 'Impuestos y sueldos']) {
      expect(read).toContain(label)
    }
    expect(read).not.toContain('Sin categoría')
    expect(out).toContain('filtro=impuestos')
    expect(out).toContain('aria-current="true"')
  })

  it('quien carga tiene en el ⋯ la lista, clasificar y exportar', () => {
    const out = toolbar(true)
    const read = text(out)
    expect(read).toContain('Agregar de una lista')
    expect(read).toContain('Clasificar proveedores')
    expect(read).toContain('Exportar saldos')
    // El mazo de fichas, con cuántos faltan.
    expect(out).toContain('filtro=sin-clasificar')
    expect(read).toContain('22')
  })

  it('«Sin categoría» se ve solo si está elegido, y su lista sigue siendo una lista', () => {
    const out = toolbar(true, 'sin-clasificar')
    expect(text(out)).toContain('Sin categoría')
    expect(out).toContain('filtro=sin-clasificar&amp;vista=lista')
  })

  it('la contadora busca, filtra y exporta, pero no agrega ni clasifica', () => {
    ui.readOnly = true
    const read = text(toolbar(false))
    expect(read).not.toContain('Agregar de una lista')
    expect(read).not.toContain('Clasificar proveedores')
    expect(read).toContain('Exportar saldos')
    expect(read).toContain('Con deuda')
    expect(read).toContain('Solo lectura')
  })
})

describe('la pantalla de proveedores entera', () => {
  const body = async (data: LibretaData, canWrite: boolean, sp = {}) =>
    html(
      await SuppliersBody({
        data: Promise.resolve(data),
        tenantSlug: SLUG,
        sp,
        today: TODAY,
        canWrite,
      }),
    )
  const totals = { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0, count: 0 }
  const withRows = (rows: readonly PartyListRow[], classes: Map<string, LibretaInfo>) =>
    ({
      list: { ok: true, data: { rows: [...rows], totals, asOf: TODAY } },
      classes: { ok: true, data: classes },
      plan: null,
      settings: { ok: true, data: null },
    }) as unknown as LibretaData

  it('el totalizador y la planilla, sin héroe, ni puerta, ni franja', async () => {
    const s = sample()
    const read = text(await body(withRows(s.rows, s.classes), true))
    for (const label of ['Le debés', 'Vencido', 'Vence esta semana']) {
      expect(read).toContain(label)
    }
    expect(read).toContain('Barracuda Bebidas')
    expect(read).not.toContain('¿Qué querés cargar?')
    expect(read).not.toContain('Le debés a proveedores')
    expect(read).not.toContain('no tienen categoría')
    expect(read).not.toContain('¿Cómo se calcula?')
  })

  it('un impuesto con deuda no suma en «Le debés»: se ve con su filtro', async () => {
    const s = sample()
    const rentas = row({
      partyName: 'Rentas',
      partyKind: 'tax_agency',
      systemKey: 'rentas',
      debtCents: 90_000_000,
      overdueCents: 90_000_000,
    })
    const rows = [...s.rows, rentas]
    const all = text(await body(withRows(rows, s.classes), true))
    expect(all).not.toContain('Rentas')
    expect(all).not.toContain('900.000')
    const taxes = text(await body(withRows(rows, s.classes), true, { filtro: 'impuestos' }))
    expect(taxes).toContain('Rentas')
    expect(taxes).toContain('$ 900.000')
  })

  it('la contadora: ni «Agregar de una lista», ni un botón de carga', async () => {
    ui.readOnly = true
    const s = sample()
    const out = await body(withRows(s.rows, s.classes), false)
    const read = text(out)
    expect(read).toContain('Barracuda Bebidas')
    expect(read).not.toContain('Agregar de una lista')
    expect(read).not.toContain('Elegir categoría')
    expect(read).not.toContain('Pagar')
    expect(out).not.toContain('compras/nueva')
  })

  it('el bar sin proveedores: una oración y el primer paso, sin botones para ella', async () => {
    const data = withRows([], new Map())
    const owner = text(await body(data, true))
    expect(owner).toContain('Todavía no hay proveedores')
    expect(owner).toContain('Cargar una compra')
    expect(owner).toContain('Pegar la lista de mis proveedores')

    ui.readOnly = true
    const out = await body(data, false)
    expect(text(out)).toContain('Todavía no hay proveedores')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('compras/nueva')
    expect(text(out)).not.toContain('Pegar la lista')
  })

  it('si no se pudieron leer los saldos, lo dice y deja reintentar', async () => {
    const out = text(
      await body(
        {
          list: { ok: false, code: 'error', message: 'No pudimos cargar esto.' },
          classes: { ok: true, data: new Map() },
          plan: null,
          settings: { ok: true, data: null },
        },
        true,
      ),
    )
    expect(out).toContain('No pudimos cargar esto.')
    expect(out).toContain('Reintentar')
    expect(out).not.toContain('$ 0')
  })

  it('un bar con deuda de impuestos y sin proveedores: el primer paso, con el filtro a mano', async () => {
    const rentas = row({
      partyName: 'Rentas',
      partyKind: 'tax_agency',
      systemKey: 'rentas',
      debtCents: 900_000,
    })
    const out = text(await body(withRows([rentas], new Map()), true))
    expect(out).toContain('Todavía no hay proveedores')
    expect(out).toContain('Impuestos y sueldos')
    expect(out).not.toContain('Nadie en esta vista')
    const taxes = text(await body(withRows([rentas], new Map()), true, { filtro: 'impuestos' }))
    expect(taxes).toContain('Rentas')
    expect(taxes).toContain('$ 9.000')
  })

  it('una búsqueda sin resultados lo dice adentro de la hoja, con la salida', async () => {
    const s = sample()
    const read = text(await body(withRows(s.rows, s.classes), true, { q: 'zzz' }))
    expect(read).toContain('Nadie con «zzz» en esta vista.')
    expect(read).toContain('Ver todos')
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

describe('Comprobantes y Pagos: el botón del paso siguiente es solo de quien carga', () => {
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
  }

  it('quien carga, sin nada: «Cargar una compra», «Compra y pago» y «Cargar un pago»', async () => {
    empty()
    const docs = text(await tab('comprobantes', true))
    expect(docs).toContain('Todavía no cargaste nada en octubre')
    expect(docs).toContain('Cargar una compra')
    expect(docs).toContain('Compra y pago')
    // El filtro con / sin factura está aunque no haya nada que sumar.
    expect(docs).toContain('Todos')
    expect(docs).toContain('Con factura')
    expect(docs).toContain('Sin factura')
    expect(docs).not.toContain('$ 0')
    const pays = text(await tab('pagos', true))
    expect(pays).toContain('No hay pagos en octubre')
    expect(pays).toContain('Cargar un pago')
  })

  it('el segmento Compras · Pagos reemplaza a la solapa, y conserva el período', async () => {
    empty()
    const out = await htmlAsync(
      createElement(DocumentsTab, {
        mode: 'comprobantes',
        tenantId: 't-1',
        tenantSlug: SLUG,
        sp: { periodo: '2026-09' },
        today: TODAY,
        canWrite: true,
      }),
    )
    expect(text(out)).toContain('Compras')
    expect(text(out)).toContain('Pagos')
    expect(out).toContain('tab=comprobantes&amp;ver=pagos&amp;periodo=2026-09')
    expect(out).toContain('tab=comprobantes&amp;periodo=2026-09')
    // El exporte que ya existía sigue ahí.
    expect(text(out)).toContain('Exportar')
    // Y en Pagos no hay filtro de factura ni de estado.
    const pays = text(await tab('pagos', true))
    expect(pays).not.toContain('Con factura')
    expect(pays).not.toContain('Falta pagar')
  })

  it('la contadora ve el mismo vacío sin ningún botón de carga', async () => {
    ui.readOnly = true
    empty()
    const docs = await tab('comprobantes', false)
    expect(text(docs)).toContain('Todavía no cargaste nada en octubre')
    expect(text(docs)).not.toContain('Cargar una compra')
    expect(text(docs)).not.toContain('Compra y pago')
    expect(docs).not.toContain('compras/nueva')
    const pays = await tab('pagos', false)
    expect(text(pays)).toContain('No hay pagos en octubre')
    expect(text(pays)).not.toContain('Cargar un pago')
  })

  it('con comprobantes: ella ve la imputación, sin [Pagarle] ni la opción de ocultarla', async () => {
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
    expect(read).not.toContain('Ver imputación y vencimientos')
    expect(read).not.toContain('Ocultar imputación')
  })

  it('con comprobantes: quien carga ve [Pagarle] y puede pedir la imputación', async () => {
    empty()
    reads.listDocuments.mockResolvedValue({
      rows: [doc()],
      nextCursor: null,
      totalRows: 1,
      truncated: false,
    })
    const out = await tab('comprobantes', true)
    const read = text(out)
    expect(read).toContain('Barracuda Bebidas')
    expect(read).toContain('Pagarle')
    expect(read).not.toContain('Imputación')
    expect(read).toContain('Ver imputación y vencimientos')
    expect(out).toContain('vista=tabla')
  })

  it('con más páginas el total lo dice: no es el del período', async () => {
    empty()
    reads.listDocuments.mockResolvedValue({
      rows: [doc()],
      nextCursor: 'x',
      totalRows: 120,
      truncated: false,
    })
    const read = text(await tab('comprobantes', true))
    expect(read).toContain('Total de esta página')
    expect(read).toContain('Página 1 de 3')
  })

  it('si la lista no se pudo leer, lo dice adentro de la hoja', async () => {
    empty()
    reads.listDocuments.mockRejectedValue(new Error('boom'))
    const read = text(await tab('comprobantes', true))
    expect(read).toContain('No pudimos cargar esto')
    expect(read).toContain('Reintentar')
  })
})
