import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerender } from 'react-dom/static'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthTable } from '@/app/(manager)/[tenantSlug]/administracion/compras/semana/_components/month-table'
import { StepNav } from '@/app/(manager)/[tenantSlug]/administracion/compras/semana/_components/step-nav'
import { WeekSheet } from '@/app/(manager)/[tenantSlug]/administracion/compras/semana/_components/week-sheet'
import WeekPlanPage from '@/app/(manager)/[tenantSlug]/administracion/compras/semana/page'
import { copyPreviousWeekBudgets, saveWeekBudgets } from '@/lib/accounting/actions/week-plan'
import { getMonthPlan, getWeekPlan, listPlanParties } from '@/lib/accounting/queries/week-plan'
import {
  addToPlanLayout,
  addWeeks,
  budgetPayload,
  buildMonthPlan,
  copyBudgetItems,
  initialPlanLayout,
  isMonday,
  mondayOf,
  nextPlanLayout,
  overdueBudgetItems,
  parseBudgetCell,
  parseMonthParam,
  parseWeekParam,
  paysOnReceipt,
  planLeft,
  planRows,
  pruneOverrides,
  restoreItems,
  revertOverrides,
  saveWeekBudgetsSchema,
  type WeekPlanRow,
  weekLabel,
  weekPlanTotals,
  weeksOfMonth,
} from '@/lib/accounting/week-plan'

/**
 * El Plan de la semana: la planilla «Pagos Proveedores» de Tomi. Las cuentas (lunes, falta, totales,
 * los botones del pie, el mes), que la planilla no salte mientras se escribe, lo que se lee y se
 * guarda en la base, y lo que ve cada uno ya dibujado.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  authorize: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: db.rpc, from: db.from }),
}))
vi.mock('@/lib/accounting/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/access')>()),
  authorizeAccounting: db.authorize,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/page-access', () => ({
  requireComprasAccess: async () => ({
    access: { tenant: { id: '00000000-0000-4000-8000-00000000000a' } },
    canWrite: !ui.readOnly,
  }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/compras/semana',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
const accounting = () => ({
  tenantSlug: 'hub',
  today: TODAY,
  access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
  readOnly: ui.readOnly,
  openAction: () => {},
  closeAction: () => {},
})
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => accounting(),
  useAccountingOptional: () => accounting(),
}))

const TODAY = '2026-11-04' // miércoles
const MONDAY = '2026-11-02'
const SLUG = 'hub'
const TENANT = '00000000-0000-4000-8000-00000000000a'
const P1 = '00000000-0000-4000-8000-000000000001'
const P2 = '00000000-0000-4000-8000-000000000002'
const P3 = '00000000-0000-4000-8000-000000000003'
const NB = String.fromCharCode(160)

function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(NB, ' ')
}
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function planRow(patch: Partial<WeekPlanRow> = {}): WeekPlanRow {
  return {
    partyId: P1,
    partyName: 'Distribuidora de Bebidas Demo SA',
    partyKind: 'supplier',
    defaultVoucherType: 'factura_a',
    debtCents: 0,
    overdueCents: 0,
    purchasedCents: 0,
    paidCents: 0,
    budgetCents: 0,
    ...patch,
  }
}

beforeEach(() => {
  db.authorize.mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: 'u1',
    slug: SLUG,
    access: {},
  })
})

afterEach(() => {
  ui.readOnly = false
  db.rpc.mockReset()
  db.from.mockReset()
  db.authorize.mockReset()
})

describe('la semana arranca el lunes', () => {
  it('el lunes de cualquier día, también si el domingo cae en otro mes', () => {
    expect(mondayOf(TODAY)).toBe(MONDAY)
    expect(mondayOf(MONDAY)).toBe(MONDAY)
    expect(mondayOf('2026-11-08')).toBe(MONDAY) // domingo
    expect(mondayOf('2026-11-01')).toBe('2026-10-26') // domingo: la semana arrancó en octubre
    expect(isMonday(MONDAY)).toBe(true)
    expect(isMonday(TODAY)).toBe(false)
    expect(isMonday('2026-02-30')).toBe(false)
    expect(isMonday(null)).toBe(false)
  })

  it('`?semana=` acepta cualquier día; lo que no es una fecha vuelve a la de hoy', () => {
    expect(parseWeekParam('2026-11-07', TODAY)).toBe(MONDAY)
    expect(parseWeekParam('2026-10-26', TODAY)).toBe('2026-10-26')
    expect(parseWeekParam('', TODAY)).toBe(MONDAY)
    expect(parseWeekParam('cualquiera', TODAY)).toBe(MONDAY)
    expect(parseWeekParam('2026-02-30', TODAY)).toBe(MONDAY)
    expect(parseWeekParam(null, TODAY)).toBe(MONDAY)
  })

  it('se mueve de a semanas y se nombra como en la planilla', () => {
    expect(addWeeks(MONDAY, 1)).toBe('2026-11-09')
    expect(addWeeks(MONDAY, -1)).toBe('2026-10-26')
    expect(weekLabel(MONDAY)).toBe('Semana del 02/11 al 08/11')
    expect(weekLabel('2026-12-28')).toBe('Semana del 28/12 al 03/01')
  })

  it('las semanas de un mes son las que arrancan en él: cada una es de un solo mes', () => {
    expect(weeksOfMonth('2026-11')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ])
    // Octubre termina el 31: la del 26/10 va entera en octubre, aunque el domingo sea de noviembre.
    expect(weeksOfMonth('2026-10')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ])
    // Un mes que arranca en lunes.
    expect(weeksOfMonth('2026-06')[0]).toBe('2026-06-01')
    expect(weeksOfMonth('no-es-un-mes')).toEqual([])
  })

  it('`?mes=`: sin un mes que exista, el de la semana que se estaba viendo', () => {
    expect(parseMonthParam('2026-09', MONDAY)).toBe('2026-09')
    expect(parseMonthParam('2026-13', MONDAY)).toBe('2026-11')
    expect(parseMonthParam('', MONDAY)).toBe('2026-11')
  })
})

describe('la celda se escribe en pesos y viaja en centavos', () => {
  it('lee lo que se tipea en una planilla', () => {
    expect(parseBudgetCell('450000')).toEqual({ ok: true, cents: 45_000_000 })
    expect(parseBudgetCell('450.000')).toEqual({ ok: true, cents: 45_000_000 })
    expect(parseBudgetCell('1.234,50')).toEqual({ ok: true, cents: 123_450 })
    expect(parseBudgetCell('$ 1.000')).toEqual({ ok: true, cents: 100_000 })
  })

  it('vacía es cero: es como se saca un presupuesto', () => {
    expect(parseBudgetCell('')).toEqual({ ok: true, cents: 0 })
    expect(parseBudgetCell('   ')).toEqual({ ok: true, cents: 0 })
  })

  it('lo que no se lee vuelve con su mensaje, y un negativo no entra', () => {
    const letras = parseBudgetCell('hola')
    expect(letras.ok).toBe(false)
    if (!letras.ok) expect(letras.message).toContain('hola')
    expect(parseBudgetCell('-500').ok).toBe(false)
    expect(parseBudgetCell('99999999999999999').ok).toBe(false)
  })
})

describe('lo que dice «Falta»', () => {
  it('sin presupuesto no hay contra qué medir', () => {
    expect(planLeft(0, 0)).toEqual({ kind: 'none' })
    expect(planLeft(0, 500)).toEqual({ kind: 'none' })
  })

  it('lo que queda, «Listo» si llegó, «Te pasaste» si se pasó', () => {
    expect(planLeft(1_000, 400)).toEqual({ kind: 'left', cents: 600 })
    expect(planLeft(1_000, 0)).toEqual({ kind: 'left', cents: 1_000 })
    expect(planLeft(1_000, 1_000)).toEqual({ kind: 'done' })
    expect(planLeft(1_000, 1_250)).toEqual({ kind: 'over', cents: 250 })
  })
})

describe('la suma de la planilla', () => {
  const rows = [
    planRow({
      debtCents: 3_336_600,
      overdueCents: 1_000_000,
      purchasedCents: 500_000,
      budgetCents: 1_000_000,
      paidCents: 400_000,
    }),
    planRow({ partyId: P2, budgetCents: 450_000, paidCents: 410_000, purchasedCents: 410_000 }),
    // Lo pagado sin presupuesto también salió esa semana.
    planRow({ partyId: P3, paidCents: 100_000 }),
  ]

  it('es la misma para el totalizador y para la fila del total', () => {
    expect(weekPlanTotals(rows)).toEqual({
      debtCents: 3_336_600,
      overdueCents: 1_000_000,
      purchasedCents: 910_000,
      budgetCents: 1_450_000,
      paidCents: 910_000,
      remainingCents: 540_000,
      overCents: 0,
      percent: 63,
    })
  })

  it('«Falta pagar» nunca es negativo y la barra no pasa de 100', () => {
    const over = weekPlanTotals([planRow({ budgetCents: 1_000, paidCents: 1_500 })])
    expect(over.remainingCents).toBe(0)
    expect(over.overCents).toBe(500)
    expect(over.percent).toBe(100)
  })

  it('sin presupuesto: la barra en cero, y pagar no es «pasarse»', () => {
    const none = weekPlanTotals([planRow({ paidCents: 1_500 })])
    expect(none.percent).toBe(0)
    expect(none.overCents).toBe(0)
    expect(weekPlanTotals([])).toMatchObject({ budgetCents: 0, paidCents: 0, percent: 0 })
  })
})

describe('«Paga al recibir»: los que no quedan debiendo, como la gaseosa', () => {
  it('sin deuda, con lo comprado ya pagado o con un presupuesto para esa compra', () => {
    expect(paysOnReceipt(planRow({ purchasedCents: 410_000, paidCents: 410_000 }))).toBe(true)
    expect(paysOnReceipt(planRow({ budgetCents: 450_000 }))).toBe(true)
  })

  it('quien debe, o quien solo terminó de pagar una deuda vieja, no es de estos', () => {
    expect(paysOnReceipt(planRow({ debtCents: 100, budgetCents: 450_000 }))).toBe(false)
    expect(paysOnReceipt(planRow({ paidCents: 900_000, budgetCents: 900_000 }))).toBe(false)
    expect(paysOnReceipt(planRow({ purchasedCents: 100, paidCents: 50 }))).toBe(false)
    expect(paysOnReceipt(planRow())).toBe(false)
  })
})

describe('los botones del pie', () => {
  it('«Traer lo vencido»: solo donde lo vencido es mayor que el presupuesto', () => {
    const rows = [
      planRow({ partyId: P1, overdueCents: 1_000, budgetCents: 0 }),
      planRow({ partyId: P2, overdueCents: 1_000, budgetCents: 1_500 }),
      planRow({ partyId: P3, overdueCents: 1_000, budgetCents: 1_000 }),
    ]
    expect(overdueBudgetItems(rows)).toEqual([{ partyId: P1, amountCents: 1_000 }])
    expect(overdueBudgetItems([planRow()])).toEqual([])
  })

  it('«Copiar la semana pasada»: lo que ya se escribió en esta semana no se pisa', () => {
    const current = [
      { partyId: P1, budgetCents: 700 },
      { partyId: P2, budgetCents: 0 },
    ]
    const previous = [
      { partyId: P1, budgetCents: 900 },
      { partyId: P2, budgetCents: 500 },
      // Esta semana no está en la lista (la base no lo trae): se suma.
      { partyId: P3, budgetCents: 300 },
    ]
    expect(copyBudgetItems(current, previous)).toEqual([
      { partyId: P2, amountCents: 500 },
      { partyId: P3, amountCents: 300 },
    ])
    expect(copyBudgetItems(current, [{ partyId: P3, budgetCents: 0 }])).toEqual([])
    expect(copyBudgetItems(current, [])).toEqual([])
  })

  it('deshacer vuelve a poner lo que tenía cada celda', () => {
    const before = new Map([[P1, 700]])
    expect(
      restoreItems(
        [
          { partyId: P1, amountCents: 1_000 },
          { partyId: P2, amountCents: 2_000 },
        ],
        (id) => before.get(id) ?? 0,
      ),
    ).toEqual([
      { partyId: P1, amountCents: 700 },
      { partyId: P2, amountCents: 0 },
    ])
  })
})

describe('la planilla no salta mientras se escribe', () => {
  const a = planRow({ partyId: P1, partyName: 'A', budgetCents: 900 })
  const b = planRow({ partyId: P2, partyName: 'B', budgetCents: 500 })

  it('una fila que la base reordena se queda en su lugar; las nuevas van al final', () => {
    const layout = initialPlanLayout([a, b])
    const c = planRow({ partyId: P3, partyName: 'C', budgetCents: 9_999 })
    // La base las manda por presupuesto: C primero y B antes que A.
    const next = nextPlanLayout(layout, [c, { ...b, budgetCents: 2_000 }, a])
    expect(next.ids).toEqual([P1, P2, P3])
    expect(next.source).toHaveLength(3)
  })

  it('una fila que deja de venir sigue a la vista, en cero', () => {
    const layout = nextPlanLayout(initialPlanLayout([a, b]), [a])
    expect(layout.ids).toEqual([P1, P2])
    const [first, second] = planRows(layout, [a], new Map())
    expect(first?.budgetCents).toBe(900)
    expect(second).toMatchObject({ partyId: P2, partyName: 'B', budgetCents: 0, paidCents: 0 })
  })

  it('«+ Agregar proveedor»: una fila más, y si ya estaba no se repite', () => {
    const layout = initialPlanLayout([a])
    const added = addToPlanLayout(layout, { partyId: P2, partyName: 'Gaseosas Demo' })
    expect(added.ids).toEqual([P1, P2])
    expect(planRows(added, [a], new Map())[1]).toMatchObject({
      partyName: 'Gaseosas Demo',
      budgetCents: 0,
    })
    expect(addToPlanLayout(added, { partyId: P2, partyName: 'Otra vez' })).toBe(added)
  })

  it('lo escrito se ve encima de lo que dice la base', () => {
    const layout = initialPlanLayout([a, b])
    const rows = planRows(layout, [a, b], new Map([[P2, 1_234]]))
    expect(rows.map((row) => row.budgetCents)).toEqual([900, 1_234])
    // Sin tocar lo que vino.
    expect(b.budgetCents).toBe(500)
  })

  it('lo que la base ya confirmó deja de pisarse; lo que no, sigue', () => {
    const overrides = new Map([
      [P1, 900],
      [P2, 1_234],
    ])
    expect([...pruneOverrides(overrides, [a, b])]).toEqual([[P2, 1_234]])
    // Una fila que no vino está en cero en la base.
    expect(pruneOverrides(new Map([[P3, 0]]), [a]).size).toBe(0)
    const same = new Map([[P2, 1_234]])
    expect(pruneOverrides(same, [a, b])).toBe(same)
  })

  it('si el guardado falla, la celda vuelve a lo de la base', () => {
    const overrides = new Map([
      [P1, 1_000],
      [P2, 2_000],
    ])
    const next = revertOverrides(
      overrides,
      [
        { partyId: P1, amountCents: 1_000 },
        { partyId: P2, amountCents: 2_000 },
      ],
      () => true,
    )
    expect(next.size).toBe(0)
  })

  it('un guardado viejo que falla no pisa lo que se escribió después', () => {
    const overrides = new Map([
      [P1, 1_000],
      [P2, 2_000],
    ])
    const next = revertOverrides(
      overrides,
      [
        { partyId: P1, amountCents: 1_000 },
        { partyId: P2, amountCents: 2_000 },
      ],
      (partyId) => partyId === P1,
    )
    expect([...next]).toEqual([[P2, 2_000]])
    expect(overrides.size).toBe(2)
  })
})

describe('el mes: las semanas una al lado de la otra', () => {
  const weeks = ['2026-11-02', '2026-11-09']
  const plan = buildMonthPlan('2026-11', [
    {
      weekStart: weeks[0] ?? '',
      rows: [
        planRow({
          partyId: P1,
          partyName: 'Bebidas',
          budgetCents: 1_000,
          purchasedCents: 800,
          paidCents: 1_000,
        }),
        planRow({ partyId: P2, partyName: 'Gaseosas', budgetCents: 500, paidCents: 700 }),
        // Solo deuda: una fila de rayas no dice nada acá.
        planRow({ partyId: P3, partyName: 'Sin movimiento', debtCents: 90_000 }),
      ],
    },
    {
      weekStart: weeks[1] ?? '',
      rows: [
        planRow({ partyId: P1, partyName: 'Bebidas', budgetCents: 2_000, paidCents: 500 }),
        planRow({ partyId: P3, partyName: 'Sin movimiento', debtCents: 90_000 }),
      ],
    },
  ])

  it('una fila por proveedor con algo en el mes, con una celda por semana', () => {
    expect(plan.month).toBe('2026-11')
    expect(plan.weeks).toEqual(weeks)
    expect(plan.rows.map((row) => row.partyName)).toEqual(['Bebidas', 'Gaseosas'])
    expect(plan.rows[0]?.cells).toEqual([
      { purchasedCents: 800, budgetCents: 1_000, paidCents: 1_000 },
      { purchasedCents: 0, budgetCents: 2_000, paidCents: 500 },
    ])
    // La semana en que no tuvo nada queda vacía.
    expect(plan.rows[1]?.cells[1]).toEqual({ purchasedCents: 0, budgetCents: 0, paidCents: 0 })
  })

  it('Total presupuesto · Total pagado · Variación: pagado menos presupuesto', () => {
    expect(plan.rows[0]).toMatchObject({
      budgetCents: 3_000,
      paidCents: 1_500,
      variationCents: -1_500,
    })
    expect(plan.rows[1]).toMatchObject({ budgetCents: 500, paidCents: 700, variationCents: 200 })
    expect(plan.totals).toMatchObject({
      budgetCents: 3_500,
      paidCents: 2_200,
      variationCents: -1_300,
    })
  })

  it('el total de cada semana suma sus filas', () => {
    expect(plan.totals.cells).toEqual([
      { purchasedCents: 800, budgetCents: 1_500, paidCents: 1_700 },
      { purchasedCents: 0, budgetCents: 2_000, paidCents: 500 },
    ])
  })

  it('sin nada en el mes, no inventa filas', () => {
    const empty = buildMonthPlan('2026-12', [{ weekStart: '2026-12-07', rows: [] }])
    expect(empty.rows).toEqual([])
    expect(empty.totals.budgetCents).toBe(0)
    expect(empty.totals.cells).toEqual([{ purchasedCents: 0, budgetCents: 0, paidCents: 0 }])
  })
})

describe('lo que entra por las acciones', () => {
  const valid = { weekStart: MONDAY, items: [{ partyId: P1, amountCents: 100 }] }

  it('la semana tiene que ser un lunes y el importe, centavos enteros y no negativos', () => {
    expect(saveWeekBudgetsSchema.safeParse(valid).success).toBe(true)
    expect(saveWeekBudgetsSchema.safeParse({ ...valid, weekStart: TODAY }).success).toBe(false)
    const item = (patch: object) => ({ ...valid, items: [{ ...valid.items[0], ...patch }] })
    expect(saveWeekBudgetsSchema.safeParse(item({ amountCents: -1 })).success).toBe(false)
    expect(saveWeekBudgetsSchema.safeParse(item({ amountCents: 1.5 })).success).toBe(false)
    expect(saveWeekBudgetsSchema.safeParse(item({ amountCents: 1e16 })).success).toBe(false)
    expect(saveWeekBudgetsSchema.safeParse(item({ partyId: 'x' })).success).toBe(false)
    expect(saveWeekBudgetsSchema.safeParse({ ...valid, items: [] }).success).toBe(false)
    const many = Array.from({ length: 501 }, () => valid.items[0])
    expect(saveWeekBudgetsSchema.safeParse({ ...valid, items: many }).success).toBe(false)
  })

  it('a la base van los nombres de sus columnas', () => {
    expect(budgetPayload(valid.items)).toEqual([{ party_id: P1, amount_cents: 100 }])
  })
})

describe('saveWeekBudgets', () => {
  it('sin permiso de escritura no llega a la base (la contadora)', async () => {
    db.authorize.mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
    })
    const result = await saveWeekBudgets(SLUG, {
      weekStart: MONDAY,
      items: [{ partyId: P1, amountCents: 100 }],
    })
    expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.authorize).toHaveBeenCalledWith(SLUG, 'write')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('lo que no pasa el esquema no llega a la base', async () => {
    const result = await saveWeekBudgets(SLUG, {
      weekStart: TODAY,
      items: [{ partyId: P1, amountCents: 100 }],
    })
    expect(result).toMatchObject({ ok: false, code: 'invalid' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('guarda en centavos, con el bar de la URL', async () => {
    db.rpc.mockResolvedValue({ data: { saved: 2 }, error: null })
    const result = await saveWeekBudgets(SLUG, {
      weekStart: MONDAY,
      items: [
        { partyId: P1, amountCents: 45_000_000 },
        { partyId: P2, amountCents: 0 },
      ],
    })
    expect(result).toMatchObject({ ok: true, data: { saved: 2 } })
    expect(db.rpc).toHaveBeenCalledWith('acc_save_payment_budget', {
      p_tenant_id: TENANT,
      p_week_start: MONDAY,
      p_items: [
        { party_id: P1, amount_cents: 45_000_000 },
        { party_id: P2, amount_cents: 0 },
      ],
    })
  })

  it('si la base no lo acepta, vuelve con el error y la celda se puede reintentar', async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'party_not_found', details: null, hint: null },
    })
    const result = await saveWeekBudgets(SLUG, {
      weekStart: MONDAY,
      items: [{ partyId: P1, amountCents: 100 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0)
  })

  it('una excepción no se escapa: vuelve como un error', async () => {
    db.rpc.mockRejectedValue(new Error('boom'))
    const result = await saveWeekBudgets(SLUG, {
      weekStart: MONDAY,
      items: [{ partyId: P1, amountCents: 100 }],
    })
    expect(result).toMatchObject({ ok: false, code: 'error' })
  })
})

describe('copyPreviousWeekBudgets', () => {
  const report = (rows: Array<Record<string, unknown>>) => ({ data: rows, error: null })

  /** Contesta los dos reportes (esta semana y la pasada) y el guardado. */
  const answer = (
    current: Array<Record<string, unknown>>,
    previous: Array<Record<string, unknown>>,
  ) => {
    db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'acc_save_payment_budget') return { data: { saved: 1 }, error: null }
      return args.p_week_start === MONDAY ? report(current) : report(previous)
    })
  }

  it('lee la semana de antes y copia solo en las filas en cero', async () => {
    answer(
      [
        { party_id: P1, budget_cents: 700 },
        { party_id: P2, budget_cents: 0 },
      ],
      [
        { party_id: P1, budget_cents: 900 },
        { party_id: P2, budget_cents: '500' },
      ],
    )
    const result = await copyPreviousWeekBudgets(SLUG, { weekStart: MONDAY })
    expect(result).toMatchObject({ ok: true, data: { items: [{ partyId: P2, amountCents: 500 }] } })
    if (result.ok) expect(result.message).toBe('Copiamos 1 presupuesto de la semana pasada.')
    expect(db.rpc).toHaveBeenCalledWith('acc_report_week_plan', {
      p_tenant_id: TENANT,
      p_week_start: '2026-10-26',
    })
    expect(db.rpc).toHaveBeenCalledWith('acc_save_payment_budget', {
      p_tenant_id: TENANT,
      p_week_start: MONDAY,
      p_items: [{ party_id: P2, amount_cents: 500 }],
    })
  })

  it('sin nada para copiar, lo dice y no escribe', async () => {
    answer([], [])
    const empty = await copyPreviousWeekBudgets(SLUG, { weekStart: MONDAY })
    expect(empty).toMatchObject({ ok: true, data: { items: [] } })
    if (empty.ok) expect(empty.message).toBe('La semana pasada no tiene presupuesto para copiar.')
    db.rpc.mockClear()
    answer([{ party_id: P1, budget_cents: 900 }], [{ party_id: P1, budget_cents: 900 }])
    const taken = await copyPreviousWeekBudgets(SLUG, { weekStart: MONDAY })
    if (taken.ok) expect(taken.message).toBe('Esas filas ya tienen presupuesto: no se copió nada.')
    const names = db.rpc.mock.calls.map((call) => call[0])
    expect(names).not.toContain('acc_save_payment_budget')
  })

  it('si no se pudo leer la semana, vuelve con el mensaje de la lectura y no escribe', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })
    const result = await copyPreviousWeekBudgets(SLUG, { weekStart: MONDAY })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('No pudimos cargar esto')
    const names = db.rpc.mock.calls.map((call) => call[0])
    expect(names).not.toContain('acc_save_payment_budget')
  })

  it('la contadora no llega', async () => {
    db.authorize.mockResolvedValue({
      ok: false,
      state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
    })
    expect(await copyPreviousWeekBudgets(SLUG, { weekStart: MONDAY })).toMatchObject({
      ok: false,
      code: 'forbidden',
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

describe('lo que se lee', () => {
  it('normaliza lo que manda la base (un bigint puede llegar como texto)', async () => {
    db.rpc.mockResolvedValue({
      data: [
        {
          party_id: P1,
          party_name: 'Bebidas',
          party_kind: 'supplier',
          default_voucher_type: null,
          debt_cents: '3336600',
          overdue_cents: 1000,
          purchased_cents: '-200',
          paid_cents: 0,
          budget_cents: '450000',
        },
      ],
      error: null,
    })
    expect(await getWeekPlan(TENANT, MONDAY)).toEqual([
      {
        partyId: P1,
        partyName: 'Bebidas',
        partyKind: 'supplier',
        defaultVoucherType: null,
        debtCents: 3_336_600,
        overdueCents: 1_000,
        purchasedCents: -200,
        paidCents: 0,
        budgetCents: 450_000,
      },
    ])
    expect(db.rpc).toHaveBeenCalledWith('acc_report_week_plan', {
      p_tenant_id: TENANT,
      p_week_start: MONDAY,
    })
  })

  it('una semana que no arranca el lunes no llega a la base', async () => {
    await expect(getWeekPlan(TENANT, TODAY)).rejects.toThrow('Esa semana no existe')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('el mes pide una lectura por semana', async () => {
    db.rpc.mockResolvedValue({ data: [], error: null })
    const plan = await getMonthPlan(TENANT, '2026-11')
    expect(db.rpc).toHaveBeenCalledTimes(5)
    expect(plan.weeks).toHaveLength(5)
    await expect(getMonthPlan(TENANT, 'no')).rejects.toThrow('Ese mes no existe')
  })

  it('los que se pueden agregar: proveedores y «otros», activos, de este bar', async () => {
    const filters: Array<[string, unknown]> = []
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return query
      },
      in: (column: string, value: unknown) => {
        filters.push([column, value])
        return query
      },
      order: async () => ({
        data: [{ id: P1, name: 'Gaseosas SA', trade_name: 'Gaseosas Demo', tax_id: null }],
        error: null,
      }),
    }
    db.from.mockReturnValue(query)
    expect(await listPlanParties(TENANT)).toEqual([
      { id: P1, name: 'Gaseosas SA', tradeName: 'Gaseosas Demo', taxId: null },
    ])
    expect(db.from).toHaveBeenCalledWith('acc_parties')
    expect(filters).toEqual([
      ['tenant_id', TENANT],
      ['kind', ['supplier', 'other']],
      ['active', true],
    ])
  })
})

// ─── Lo que se ve armado ─────────────────────────────────────────────────────

const ROWS = [
  planRow({
    partyId: P1,
    partyName: 'Distribuidora de Bebidas Demo SA',
    debtCents: 333_660_000,
    overdueCents: 121_000_000,
    purchasedCents: 50_000_000,
    budgetCents: 100_000_000,
    paidCents: 40_000_000,
  }),
  planRow({
    partyId: P2,
    partyName: 'Gaseosas Demo',
    purchasedCents: 41_000_000,
    budgetCents: 45_000_000,
    paidCents: 41_000_000,
  }),
  planRow({ partyId: P3, partyName: 'Hielo', budgetCents: 1_000_000, paidCents: 1_500_000 }),
]

const sheet = (canWrite: boolean, rows: readonly WeekPlanRow[] = ROWS) =>
  html(
    createElement(WeekSheet, {
      tenantSlug: SLUG,
      weekStart: MONDAY,
      rows,
      parties: canWrite ? [{ id: P3, name: 'Hielo', tradeName: null, taxId: null }] : null,
      canWrite,
      monthHref: `/${SLUG}/administracion/compras/semana?vista=mes&mes=2026-11`,
    }),
  )

describe('la planilla dibujada', () => {
  it('quien carga: las columnas de Tomi, el totalizador, la barra y las celdas', () => {
    const out = sheet(true)
    const read = text(out)
    for (const head of ['Proveedor', 'Deuda', 'Compró', 'Presupuesto', 'Pagó', 'Falta']) {
      expect(read).toContain(head)
    }
    for (const label of ['Presupuesto', 'Pagado', 'Falta pagar']) expect(read).toContain(label)
    // 1.000.000 + 450.000 + 10.000 presupuestados; 400.000 + 410.000 + 15.000 pagados.
    expect(read).toContain('$ 1.460.000')
    expect(read).toContain('$ 825.000')
    expect(read).toContain('$ 635.000')
    expect(out).toContain('adm-double-rule')
    expect(out).toContain('Pagaste el 57 % del presupuesto')
    // Cada celda, en pesos y con su nombre para lectores.
    expect(out).toContain('aria-label="Presupuesto de Gaseosas Demo"')
    expect(out).toContain('value="450.000"')
    // Lo vencido va en rojo.
    expect(out).toContain('text-destructive')
  })

  it('«Falta» dice lo que queda, y «Te pasaste» si se pasó', () => {
    const read = text(sheet(true))
    expect(read).toContain('$ 600.000')
    expect(read).toContain('Te pasaste $ 5.000')
    expect(read).toContain('$ 40.000')
  })

  it('«Listo» si llegó, y los que no quedan debiendo dicen «Paga al recibir»', () => {
    const read = text(sheet(true, [planRow({ budgetCents: 100, paidCents: 100 })]))
    expect(read).toContain('Listo')
    expect(text(sheet(true))).toContain('Paga al recibir')
  })

  it('[Pagar]: con deuda abre el pago; sin deuda es la compra pagada en el momento', () => {
    const out = sheet(true)
    expect(out).toContain('aria-label="Pagarle a Distribuidora de Bebidas Demo SA"')
    expect(out).toContain('aria-label="Cargar la compra y el pago de Gaseosas Demo"')
    expect(out).toContain('compras/nueva?modo=pago')
  })

  it('el pie: traer lo vencido, copiar, agregar y ver el mes', () => {
    const out = sheet(true)
    const read = text(out)
    expect(read).toContain('Traer lo vencido')
    expect(read).toContain('Copiar la semana pasada')
    expect(read).toContain('+ Agregar proveedor')
    expect(read).toContain('Ver el mes')
    expect(out).toContain('vista=mes&amp;mes=2026-11')
  })

  it('«Traer lo vencido» no se puede tocar si no hay nada que traer', () => {
    const out = sheet(true, [planRow({ overdueCents: 100, budgetCents: 500 })])
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Traer lo vencido/)
  })

  it('la contadora ve lo mismo en solo lectura: sin celdas, sin [Pagar], sin pie de carga', () => {
    ui.readOnly = true
    const out = sheet(false)
    const read = text(out)
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('compras/nueva')
    expect(read).toContain('$ 450.000')
    expect(read).toContain('Ver el mes')
    expect(read).not.toContain('Traer lo vencido')
    expect(read).not.toContain('Copiar la semana pasada')
    expect(read).not.toContain('Agregar proveedor')
    expect(read).not.toContain('Pagar ')
  })

  it('una semana vacía: una oración adentro de la hoja, con lo que se puede hacer', () => {
    const owner = text(sheet(true, []))
    expect(owner).toContain('Esta semana no hay deudas, presupuesto ni movimientos.')
    expect(owner).toContain('+ Agregar proveedor')
    expect(owner).toContain('Copiar la semana pasada')
    ui.readOnly = true
    const accountant = sheet(false, [])
    expect(text(accountant)).toContain('Esta semana no hay deudas')
    expect(accountant).not.toContain('<button')
  })

  it('sin presupuesto, la barra lo dice en vez de medir contra nada', () => {
    expect(sheet(true, [planRow({ debtCents: 100 })])).toContain('Todavía sin presupuesto')
  })
})

describe('la barra de arriba', () => {
  it('semana anterior ‹ «Semana del 02/11 al 08/11» › semana siguiente', () => {
    const out = html(
      createElement(StepNav, {
        label: weekLabel(MONDAY),
        prevHref: '/a',
        prevLabel: 'Semana anterior',
        nextHref: '/b',
        nextLabel: 'Semana siguiente',
      }),
    )
    expect(text(out)).toContain('Semana del 02/11 al 08/11')
    expect(out).toContain('aria-label="Semana anterior"')
    expect(out).toContain('aria-label="Semana siguiente"')
  })
})

describe('«Ver el mes» dibujado', () => {
  const plan = buildMonthPlan('2026-11', [
    {
      weekStart: '2026-11-02',
      rows: [planRow({ partyName: 'Bebidas', budgetCents: 100_000, paidCents: 150_000 })],
    },
    {
      weekStart: '2026-11-09',
      rows: [planRow({ partyName: 'Bebidas', budgetCents: 200_000, purchasedCents: 30_000 })],
    },
  ])

  it('Compró, Presup. y Pagó de cada semana, y los totales del mes', () => {
    const out = html(createElement(MonthTable, { tenantSlug: SLUG, plan }))
    const read = text(out)
    expect(read).toContain('Semana del 02/11')
    expect(read).toContain('Semana del 09/11')
    for (const head of [
      'Compró',
      'Presup.',
      'Pagó',
      'Total presupuesto',
      'Total pagado',
      'Variación',
    ]) {
      expect(read).toContain(head)
    }
    expect(read).toContain('$ 3.000')
    expect(read).toContain('$ 1.500')
    expect(read).toContain('−$ 1.500')
    expect(out).toContain('adm-double-rule')
    // Sin editar: ni celdas ni botones. Cada semana abre su planilla.
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
    expect(out).toContain('compras/semana?semana=2026-11-09')
  })

  it('lo que se pasó de lo presupuestado va en rojo y con su signo', () => {
    const over = buildMonthPlan('2026-11', [
      {
        weekStart: '2026-11-02',
        rows: [planRow({ partyName: 'Bebidas', budgetCents: 100_000, paidCents: 150_000 })],
      },
    ])
    const out = html(createElement(MonthTable, { tenantSlug: SLUG, plan: over }))
    expect(text(out)).toContain('+$ 500')
    expect(out).toContain('text-destructive')
  })

  it('un mes sin nada lo dice adentro de la hoja', () => {
    const empty = buildMonthPlan('2026-12', [{ weekStart: '2026-12-07', rows: [] }])
    expect(text(html(createElement(MonthTable, { tenantSlug: SLUG, plan: empty })))).toContain(
      'Este mes todavía no hay presupuesto ni movimientos.',
    )
  })
})

describe('la página entera', () => {
  const page = async (sp: Record<string, string>) => {
    const node = await WeekPlanPage({
      params: Promise.resolve({ tenantSlug: SLUG }),
      searchParams: Promise.resolve(sp),
    })
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
  const answer = (rows: Array<Record<string, unknown>>) => {
    db.rpc.mockResolvedValue({ data: rows, error: null })
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: async () => ({ data: [], error: null }),
    }
    db.from.mockReturnValue(query)
  }
  const COCA = {
    party_id: P1,
    party_name: 'Bebidas',
    party_kind: 'supplier',
    default_voucher_type: null,
    debt_cents: 100_000,
    overdue_cents: 0,
    purchased_cents: 0,
    paid_cents: 0,
    budget_cents: 50_000,
  }

  it('`?semana=` cualquier día lee el lunes de esa semana', async () => {
    answer([COCA])
    const out = await page({ semana: '2026-10-29' })
    const read = text(out)
    expect(out).toContain('sr-only')
    expect(read).toContain('Plan de la semana')
    expect(read).toContain('Semana del 26/10 al 01/11')
    expect(read).toContain('Bebidas')
    expect(read).toContain('Volver a esta semana')
    expect(out).toContain('aria-label="Semana anterior"')
    expect(out).toContain('semana=2026-10-19')
    expect(db.rpc).toHaveBeenCalledWith('acc_report_week_plan', {
      p_tenant_id: TENANT,
      p_week_start: '2026-10-26',
    })
  })

  it('la contadora ve la semana sin celdas y no se leen los proveedores para agregar', async () => {
    ui.readOnly = true
    answer([COCA])
    const out = await page({})
    expect(out).not.toContain('<input')
    expect(text(out)).toContain('Solo lectura')
    expect(db.from).not.toHaveBeenCalled()
  })

  it('`?vista=mes` trae una lectura por semana y deja volver a la semana', async () => {
    answer([COCA])
    const out = await page({ vista: 'mes', mes: '2026-11' })
    const read = text(out)
    expect(read).toContain('Noviembre de 2026')
    expect(read).toContain('Total presupuesto')
    expect(read).toContain('Ver la semana')
    expect(out).toContain('vista=mes&amp;mes=2026-10')
    expect(db.rpc).toHaveBeenCalledTimes(5)
  })

  it('si la lectura falla, lo dice adentro de la hoja y deja reintentar', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: async () => ({ data: [], error: null }),
    }
    db.from.mockReturnValue(query)
    const read = text(await page({}))
    expect(read).toContain('No pudimos cargar esto')
    expect(read).toContain('Reintentar')
  })
})
