import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTargetsList } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/targets-import'
import {
  buildProjection,
  cashDiffText,
  complianceOf,
  complianceText,
  POS_METHOD_SYSTEM_KEY,
  type PosSalesOfDay,
  type ProjectionSourceDay,
  posDaySales,
  projectionFigures,
  withPosSales,
} from '@/lib/accounting/projection'
import { dailyCashSchema, salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import {
  parsePosSalesDay,
  parseProjectionRow,
  posCommissionRates,
} from '@/lib/accounting/queries/projection'

const NB = ' '
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Pesos → centavos. */
const p = (pesos: number) => pesos * 100

function row(day: string, over: Partial<ProjectionSourceDay> = {}): ProjectionSourceDay {
  return {
    day,
    targetCents: null,
    note: null,
    closes: 0,
    salonCents: 0,
    deliveryCents: 0,
    eventsCents: 0,
    salonCommissionCents: 0,
    deliveryCommissionCents: 0,
    eventsCommissionCents: 0,
    cashCountedCents: null,
    ...over,
  }
}

/** Seis días de octubre; «hoy» es el lunes 05/10. */
const OCTOBER: ProjectionSourceDay[] = [
  row('2026-10-01', {
    targetCents: p(1_000_000),
    closes: 1,
    salonCents: p(850_000),
    salonCommissionCents: p(50_000),
    cashCountedCents: p(840_000),
  }),
  row('2026-10-02', {
    targetCents: p(1_000_000),
    closes: 1,
    salonCents: p(1_000_000),
    salonCommissionCents: p(30_000),
    deliveryCents: p(300_000),
    deliveryCommissionCents: p(70_000),
  }),
  row('2026-10-03', {
    note: 'Día de la madre',
    closes: 1,
    salonCents: p(500_000),
    eventsCents: p(100_000),
    eventsCommissionCents: p(10_000),
    cashCountedCents: p(600_000),
  }),
  row('2026-10-04', { targetCents: p(1_000_000), cashCountedCents: p(50_000) }),
  row('2026-10-05', { targetCents: p(1_000_000) }),
  row('2026-10-06', { targetCents: p(2_000_000) }),
]

describe('proyección de ventas: las cuentas de la planilla', () => {
  const projection = buildProjection(OCTOBER, { serviceDay: '2026-10-05' })
  const byDay = new Map(projection.days.map((d) => [d.day, d]))

  it('venta real = bar − posnet; venta neta = real + delivery − su comisión; % = neta / objetivo', () => {
    const d1 = byDay.get('2026-10-01')
    expect(d1).toMatchObject({
      barCents: p(850_000),
      posnetCommissionCents: p(50_000),
      realCents: p(800_000),
      netCents: p(800_000),
      compliance: { kind: 'value', percent: 80, side: 'below', gapPercent: 20 },
    })
    const d2 = byDay.get('2026-10-02')
    expect(d2).toMatchObject({
      realCents: p(970_000),
      netCents: p(1_200_000),
      compliance: { kind: 'value', percent: 120, side: 'above', gapPercent: 20 },
    })
  })

  it('la venta bar junta salón y el canal Eventos, con sus comisiones', () => {
    expect(byDay.get('2026-10-03')).toMatchObject({
      barCents: p(600_000),
      posnetCommissionCents: p(10_000),
      realCents: p(590_000),
      netCents: p(590_000),
      compliance: { kind: 'no_target' },
    })
    expect(projection.totals.eventsCents).toBe(p(100_000))
  })

  it('un día sin cierre no es 0 %: «Sin cierre», «En curso» hoy, y el futuro solo muestra el objetivo', () => {
    expect(byDay.get('2026-10-04')?.compliance).toEqual({ kind: 'no_close' })
    expect(byDay.get('2026-10-05')).toMatchObject({
      moment: 'today',
      compliance: { kind: 'in_progress' },
    })
    expect(byDay.get('2026-10-06')).toMatchObject({
      moment: 'future',
      targetCents: p(2_000_000),
      compliance: { kind: 'future' },
    })
  })

  it('acumulados: objetivo y venta neta hasta cada día', () => {
    expect(projection.days.map((d) => d.targetAccumCents)).toEqual(
      [1, 2, 2, 3, 4, 6].map((m) => p(m * 1_000_000)),
    )
    expect(projection.days.map((d) => d.netAccumCents)).toEqual(
      [800_000, 2_000_000, 2_590_000, 2_590_000, 2_590_000, 2_590_000].map(p),
    )
  })

  it('total del mes', () => {
    expect(projection.totals).toEqual({
      targetCents: p(6_000_000),
      barCents: p(2_450_000),
      deliveryCents: p(300_000),
      deliveryCommissionCents: p(70_000),
      posnetCommissionCents: p(90_000),
      realCents: p(2_360_000),
      netCents: p(2_590_000),
      eventsCents: p(100_000),
    })
  })

  it('«Objetivo a hoy» llega hasta el último día terminado: hoy entra recién con su cierre', () => {
    expect(projection.summary).toMatchObject({
      monthState: 'current',
      hasTargets: true,
      soldCents: p(2_590_000),
      monthTargetCents: p(6_000_000),
      throughDay: '2026-10-04',
      targetToDateCents: p(3_000_000),
      pace: { percent: 86, side: 'below', gapPercent: 14 },
      remainingCents: p(3_410_000),
      surplusCents: 0,
      monthPercent: 43,
    })
    const withToday = buildProjection(
      OCTOBER.map((r) =>
        r.day === '2026-10-05' ? { ...r, closes: 1, salonCents: p(1_000_000) } : r,
      ),
      { serviceDay: '2026-10-05' },
    )
    expect(withToday.summary.throughDay).toBe('2026-10-05')
    expect(withToday.summary.targetToDateCents).toBe(p(4_000_000))
  })

  it('un objetivo en cero es un día sin objetivo', () => {
    const r = buildProjection(
      [row('2026-10-01', { targetCents: 0, closes: 1, salonCents: p(10) })],
      { serviceDay: '2026-10-05' },
    )
    expect(r.days[0]).toMatchObject({ targetCents: null, compliance: { kind: 'no_target' } })
    expect(r.summary.hasTargets).toBe(false)
    expect(r.summary.monthPercent).toBeNull()
  })

  it('mes terminado y mes que todavía no empezó', () => {
    const past = buildProjection(OCTOBER, { serviceDay: '2026-11-10' })
    expect(past.summary).toMatchObject({
      monthState: 'past',
      throughDay: '2026-10-06',
      targetToDateCents: p(6_000_000),
    })
    expect(past.days.every((d) => d.moment === 'past')).toBe(true)

    const future = buildProjection(OCTOBER, { serviceDay: '2026-09-20' })
    expect(future.summary).toMatchObject({
      monthState: 'future',
      throughDay: null,
      targetToDateCents: 0,
      pace: null,
    })
    expect(future.days.every((d) => d.compliance.kind === 'future')).toBe(true)
  })

  it('el objetivo cumplido no deja «falta» negativa', () => {
    const r = buildProjection(
      [row('2026-10-01', { targetCents: p(100), closes: 1, salonCents: p(130) })],
      { serviceDay: '2026-10-05' },
    )
    expect(r.summary).toMatchObject({ remainingCents: 0, surplusCents: p(30), monthPercent: 130 })
  })
})

describe('ventas contra caja', () => {
  const projection = buildProjection(OCTOBER, { serviceDay: '2026-10-05' })

  it('compara solo los días con las dos puntas; el resto dice qué falta', () => {
    expect(projection.days.map((d) => d.cash)).toEqual([
      // 840 que entraron contra 800 de venta real (850 del cierre − 50 de posnet).
      { kind: 'compared', diffCents: p(40_000) },
      { kind: 'missing_count' },
      { kind: 'compared', diffCents: p(10_000) },
      { kind: 'missing_close' },
      { kind: 'none' },
      { kind: 'none' },
    ])
  })

  it('los totales son de los días comparados (venta real del salón y eventos, sin delivery)', () => {
    expect(projection.cash).toEqual({
      comparedDays: 2,
      salesCents: p(1_390_000),
      countedCents: p(1_440_000),
      diffCents: p(50_000),
      missingCountDays: 1,
      missingCountPosDays: 0,
      missingCloseDays: 1,
    })
  })

  it('la diferencia va en palabras, nunca con un menos pelado', () => {
    expect(cashDiffText(0)).toBe('Coincide')
    expect(cashDiffText(-p(1_000))).toBe(`Faltan $${NB}1.000`)
    expect(cashDiffText(p(500))).toBe(`Sobran $${NB}500`)
    expect(cashDiffText(-50)).toBe(`Faltan $${NB}0,50`)
  })
})

describe('textos de la proyección', () => {
  it('cumplimiento en palabras y número', () => {
    expect(complianceText(complianceOf(p(800), p(1_000)))).toBe('80 % · 20 % abajo')
    expect(complianceText(complianceOf(p(1_200), p(1_000)))).toBe('120 % · 20 % arriba')
    expect(complianceText(complianceOf(p(1_000), p(1_000)))).toBe('100 % · justo el objetivo')
    expect(complianceText({ kind: 'no_target' })).toBe('Sin objetivo')
    expect(complianceText({ kind: 'no_close' })).toBe('Sin cierre')
    expect(complianceText({ kind: 'in_progress' })).toBe('En curso')
    expect(complianceText({ kind: 'future' })).toBeNull()
  })

  it('las tres cifras del mes en curso', () => {
    const { summary } = buildProjection(OCTOBER, { serviceDay: '2026-10-05' })
    expect(projectionFigures(summary)).toEqual({
      sold: {
        label: 'Vas vendiendo',
        value: `$${NB}2.590.000`,
        hint: 'Venta neta: sin las comisiones estimadas.',
      },
      target: {
        label: 'Objetivo a hoy',
        value: `$${NB}3.000.000`,
        hint: 'Hasta el dom 04/10: vas 14 % abajo.',
      },
      remaining: {
        label: 'Te falta vender',
        value: `$${NB}3.410.000`,
        hint: `Para llegar al objetivo del mes ($${NB}6.000.000).`,
      },
    })
  })

  it('mes terminado en pasado, objetivo cumplido y mes sin objetivos', () => {
    const past = projectionFigures(buildProjection(OCTOBER, { serviceDay: '2026-11-10' }).summary)
    expect(past.sold.label).toBe('Vendiste')
    expect(past.target).toEqual({
      label: 'Objetivo del mes',
      value: `$${NB}6.000.000`,
      hint: '43 % · 57 % abajo',
    })
    expect(past.remaining.label).toBe('Te faltó vender')

    const done = projectionFigures(
      buildProjection([row('2026-10-01', { targetCents: p(100), closes: 1, salonCents: p(130) })], {
        serviceDay: '2026-10-05',
      }).summary,
    )
    expect(done.remaining).toEqual({
      label: 'Objetivo cumplido',
      value: `$${NB}30`,
      hint: `Por arriba del objetivo del mes ($${NB}100).`,
    })

    const none = projectionFigures(
      buildProjection([row('2026-10-01', { closes: 1, salonCents: p(130) })], {
        serviceDay: '2026-10-05',
      }).summary,
    )
    expect(none.target.value).toBe('—')
    expect(none.remaining.value).toBe('—')
  })
})

describe('«Pegar una lista» de objetivos', () => {
  it('un monto por renglón desde el día 1; un renglón vacío deja ese día sin objetivo', () => {
    const r = parseTargetsList('1.200.000\n1.200.000\n\n2.500.000,50\n', '2026-10')
    expect(r.items).toEqual([
      { day: '2026-10-01', targetCents: 120_000_000 },
      { day: '2026-10-02', targetCents: 120_000_000 },
      { day: '2026-10-03', targetCents: null },
      { day: '2026-10-04', targetCents: 250_000_050 },
    ])
    expect(r).toMatchObject({
      withTarget: 3,
      totalCents: 490_000_050,
      cleared: 1,
      invalid: [],
      overflow: 0,
      headerSkipped: false,
    })
  })

  it('saltea el título de la columna; el cero es «sin objetivo»; lo que no se entiende se avisa', () => {
    const r = parseTargetsList('Objetivo\n$ 1.000.000\n0\nabc\n-5', '2026-10')
    expect(r.headerSkipped).toBe(true)
    expect(r.items).toEqual([
      { day: '2026-10-01', targetCents: 100_000_000 },
      { day: '2026-10-02', targetCents: null },
    ])
    expect(r.invalid).toEqual([
      { line: 4, day: '2026-10-03', text: 'abc' },
      { line: 5, day: '2026-10-04', text: '-5' },
    ])
  })

  it('si se copiaron dos columnas, el monto es la última', () => {
    const r = parseTargetsList('1/10\t1.500\n2/10\t2.000', '2026-10')
    expect(r.items).toEqual([
      { day: '2026-10-01', targetCents: 150_000 },
      { day: '2026-10-02', targetCents: 200_000 },
    ])
  })

  it('los renglones que sobran no se cargan (febrero tiene 28 días)', () => {
    const text = Array.from({ length: 30 }, () => '100').join('\n')
    const r = parseTargetsList(text, '2026-02')
    expect(r.items).toHaveLength(28)
    expect(r.items.at(-1)).toEqual({ day: '2026-02-28', targetCents: 10_000 })
    expect(r.overflow).toBe(2)
  })

  it('lo vacío del final no cuenta', () => {
    expect(parseTargetsList('100\n\n\n', '2026-10').items).toEqual([
      { day: '2026-10-01', targetCents: 10_000 },
    ])
    expect(parseTargetsList('', '2026-10').items).toEqual([])
  })
})

describe('lo que se manda a guardar', () => {
  const CAJA = '11111111-1111-4111-8111-111111111111'

  it('objetivos: viaja solo lo que cambia, el cero es «sin objetivo» y la nota va prolija', () => {
    const r = salesTargetsSchema.safeParse({
      items: [
        { day: '2026-10-01', targetCents: 0 },
        { day: '2026-10-02', note: '  2x1   burger ' },
        { day: '2026-10-03', targetCents: 5_000, note: '' },
      ],
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.items[0]).toEqual({ day: '2026-10-01', targetCents: null })
    expect(r.data.items[1]).toEqual({ day: '2026-10-02', note: '2x1 burger' })
    expect(r.data.items[1]?.targetCents).toBeUndefined()
    expect(r.data.items[2]).toEqual({ day: '2026-10-03', targetCents: 5_000, note: null })
  })

  it('objetivos: rechaza lo que la base también rechaza, con mensaje en castellano', () => {
    const message = (input: unknown) => {
      const r = salesTargetsSchema.safeParse(input)
      return r.success ? null : r.error.issues[0]?.message
    }
    expect(message({ items: [] })).toBe('Cargá al menos un día.')
    expect(message({ items: [{ day: '2026-10-01' }] })).toBe('Falta el objetivo o la nota.')
    expect(message({ items: [{ day: '2026-02-30', targetCents: 1 }] })).toBe('Esa fecha no existe.')
    expect(message({ items: [{ day: '2026-10-01', targetCents: -1 }] })).toBe(
      'El objetivo va sin signo menos.',
    )
    expect(message({ items: [{ day: '2026-10-01', note: 'x'.repeat(121) }] })).toBe(
      'La nota puede tener hasta 120 caracteres.',
    )
    expect(
      message({
        items: [
          { day: '2026-10-01', targetCents: 1 },
          { day: '2026-10-01', targetCents: 2 },
        ],
      }),
    ).toBe('Hay un día repetido en la lista.')
    const many = Array.from({ length: 63 }, (_, i) => ({
      day: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      targetCents: 1,
    }))
    expect(message({ items: many })).toBe('Hasta 62 días por vez.')
  })

  it('lo que entró: vacío es «sin cargar» (null), que no es cero', () => {
    const r = dailyCashSchema.safeParse({
      day: '2026-10-05',
      items: [{ treasuryAccountId: CAJA, amountCents: null }],
    })
    expect(r.success).toBe(true)
    const message = (items: unknown) => {
      const bad = dailyCashSchema.safeParse({ day: '2026-10-05', items })
      return bad.success ? null : bad.error.issues[0]?.message
    }
    expect(message([{ treasuryAccountId: CAJA, amountCents: -1 }])).toBe(
      'El importe va sin signo menos.',
    )
    expect(message([{ treasuryAccountId: 'caja', amountCents: 1 }])).toBe('Falta la caja.')
    expect(
      message([
        { treasuryAccountId: CAJA, amountCents: 1 },
        { treasuryAccountId: CAJA, amountCents: 2 },
      ]),
    ).toBe('Hay una caja repetida.')
  })
})

describe('la base y la pantalla hablan de lo mismo', () => {
  const report = readFileSync(
    `${ROOT}supabase/migrations/20261013120210_acc_ventas_proyeccion_report.sql`,
    'utf8',
  )
  const writes = readFileSync(
    `${ROOT}supabase/migrations/20261013120200_acc_ventas_proyeccion.sql`,
    'utf8',
  )

  it('cada columna de acc_report_sales_projection llega a la fila que usa la pantalla', () => {
    const table = /returns table \(([^)]*)\)/.exec(report)?.[1] ?? ''
    const columns = table.split(',').map((c) => c.trim().split(/\s+/)[0])
    const raw: Record<string, unknown> = {
      day: '2026-10-05',
      target_cents: '120000000',
      note: '2x1 burger',
      closes: 2,
      salon_cents: '75953280',
      delivery_cents: '8886240',
      events_cents: '100',
      salon_commission_cents: '2168614',
      delivery_commission_cents: '2091463',
      events_commission_cents: '7',
      cash_counted_cents: '6000000',
    }
    expect(columns).toEqual(Object.keys(raw))
    expect(parseProjectionRow(raw)).toEqual({
      day: '2026-10-05',
      targetCents: 120_000_000,
      note: '2x1 burger',
      closes: 2,
      salonCents: 75_953_280,
      deliveryCents: 8_886_240,
      eventsCents: 100,
      salonCommissionCents: 2_168_614,
      deliveryCommissionCents: 2_091_463,
      eventsCommissionCents: 7,
      cashCountedCents: 6_000_000,
    })
  })

  it('sin objetivo ni caja cargada llegan como null, no como cero', () => {
    const parsed = parseProjectionRow({ day: '2026-10-07', target_cents: null, closes: 0 })
    expect(parsed).toMatchObject({ targetCents: null, cashCountedCents: null, salonCents: 0 })
    expect(parseProjectionRow({ target_cents: 1 })).toBeNull()
  })

  it('las claves que mandan las acciones son las que aceptan las RPC', () => {
    expect(writes).toContain("k not in ('day', 'target_cents', 'note')")
    expect(writes).toContain("k not in ('treasury_account_id', 'amount_cents')")
    expect(writes).toContain('jsonb_array_length(p_items) not between 1 and 62')
  })
})

// ─── Con punto de venta: la proyección se completa sola ──────────────────────

describe('las ventas del punto de venta en la proyección', () => {
  /** Las comisiones de Ajustes, en puntos básicos: transferencia y QR 1,5 %, débito 3,14 %, crédito 6,29 %. */
  const RATES = { transfer: 150, qr: 150, debit: 314, credit: 629 }
  const sales = (day: string, over: Partial<PosSalesOfDay> = {}): PosSalesOfDay => ({
    day,
    byMethod: {},
    depositCents: 0,
    ...over,
  })
  const TODAY = '2026-11-13'

  it('la comisión se estima por medio, como en los cierres; el efectivo y «otro» van enteros', () => {
    const day = posDaySales(
      sales('2026-11-10', {
        byMethod: { cash: p(100_000), debit: p(200_000), credit: p(100_000), other: p(5_000) },
        depositCents: p(40_000),
      }),
      RATES,
    )
    expect(day.chargedCents).toBe(p(405_000))
    expect(day.depositCents).toBe(p(40_000))
    // 200.000 × 3,14 % + 100.000 × 6,29 %
    expect(day.commissionCents).toBe(p(6_280) + p(6_290))
    // Sin porcentajes cargados no inventa nada.
    expect(
      posDaySales(sales('2026-11-10', { byMethod: { debit: p(200_000) } }), {}).commissionCents,
    ).toBe(0)
  })

  it('cada medio del punto de venta toma la comisión de su par de Administración', () => {
    expect(POS_METHOD_SYSTEM_KEY).toEqual({
      cash: 'cash',
      transfer: 'transfer',
      qr: 'qr_mp',
      debit: 'debit',
      credit: 'credit',
      other: null,
    })
  })

  it('un día sin cierre toma lo del punto de venta y se mide contra su objetivo', () => {
    const rows = withPosSales(
      [
        row('2026-11-10', { targetCents: p(500_000) }),
        row('2026-11-11', { targetCents: p(500_000) }),
      ],
      [sales('2026-11-10', { byMethod: { cash: p(300_000), debit: p(200_000) } })],
      RATES,
    )
    const projection = buildProjection(rows, { serviceDay: TODAY })
    const [sold, empty] = projection.days
    expect(sold).toMatchObject({
      hasClose: false,
      hasSales: true,
      source: 'pos',
      barCents: p(500_000),
      posnetCommissionCents: p(6_280),
      realCents: p(493_720),
      netCents: p(493_720),
    })
    expect(sold?.compliance).toEqual({ kind: 'value', percent: 99, side: 'below', gapPercent: 1 })
    // El día sin nada sigue diciendo que le falta el cierre: no es un cero.
    expect(empty).toMatchObject({ hasSales: false, source: null, netCents: 0 })
    expect(empty?.compliance).toEqual({ kind: 'no_close' })
    expect(projection.summary.soldCents).toBe(p(493_720))
  })

  it('con cierre manda el cierre: lo del punto de venta no se suma ni lo pisa', () => {
    const rows = withPosSales(
      [
        row('2026-11-10', {
          targetCents: p(500_000),
          closes: 1,
          salonCents: p(480_000),
          salonCommissionCents: p(5_000),
        }),
      ],
      [sales('2026-11-10', { byMethod: { cash: p(900_000) }, depositCents: p(50_000) })],
      RATES,
    )
    const [day] = buildProjection(rows, { serviceDay: TODAY }).days
    expect(day).toMatchObject({
      hasClose: true,
      source: 'close',
      depositCents: 0,
      barCents: p(480_000),
      netCents: p(475_000),
    })
  })

  it('la seña descontada cuenta como venta de esa noche, pero no en «ventas contra caja»', () => {
    const rows = withPosSales(
      [row('2026-11-10', { targetCents: p(1_000_000), cashCountedCents: p(600_000) })],
      [sales('2026-11-10', { byMethod: { cash: p(600_000) }, depositCents: p(400_000) })],
      RATES,
    )
    const projection = buildProjection(rows, { serviceDay: TODAY })
    const [day] = projection.days
    expect(day).toMatchObject({
      barCents: p(1_000_000),
      depositCents: p(400_000),
      netCents: p(1_000_000),
    })
    expect(day?.compliance).toMatchObject({ kind: 'value', percent: 100 })
    // Entraron $ 600.000 y eso es lo que se cobró: coincide, aunque la venta de la noche fue de un millón.
    expect(day?.cash).toEqual({ kind: 'compared', diffCents: 0 })
    expect(projection.cash).toMatchObject({ comparedDays: 1, salesCents: p(600_000), diffCents: 0 })
  })

  it('la noche en curso se ve, pero no se mide ni entra en «a hoy»', () => {
    const rows = withPosSales(
      [
        row('2026-11-12', { targetCents: p(500_000) }),
        row(TODAY, { targetCents: p(800_000) }),
        row('2026-11-14', { targetCents: p(800_000) }),
      ],
      [
        sales('2026-11-12', { byMethod: { cash: p(550_000) } }),
        sales(TODAY, { byMethod: { cash: p(120_000) } }),
      ],
      RATES,
    )
    const projection = buildProjection(rows, { serviceDay: TODAY })
    const [yesterday, today] = projection.days
    expect(today).toMatchObject({ source: 'pos', hasSales: true, netCents: p(120_000) })
    expect(today?.compliance).toEqual({ kind: 'in_progress' })
    // A la noche abierta no se le reclama la caja.
    expect(today?.cash).toEqual({ kind: 'none' })
    expect(yesterday?.cash).toEqual({ kind: 'missing_count' })
    expect(projection.cash).toMatchObject({ missingCountDays: 1, missingCountPosDays: 1 })
    // «Vas vendiendo» incluye lo de esta noche…
    expect(projection.summary.soldCents).toBe(p(670_000))
    // …pero «a hoy» llega hasta ayer, y compara ayer contra ayer: 550 sobre 500.
    expect(projection.summary.throughDay).toBe('2026-11-12')
    expect(projection.summary.targetToDateCents).toBe(p(500_000))
    expect(projection.summary.pace).toEqual({
      kind: 'value',
      percent: 110,
      side: 'above',
      gapPercent: 10,
    })
  })

  it('un día del punto de venta en cero no cuenta como venta: sigue faltando el cierre', () => {
    const rows = withPosSales(
      [row('2026-11-10', { targetCents: p(500_000) })],
      [sales('2026-11-10', { byMethod: { cash: 0 } })],
      RATES,
    )
    const [day] = buildProjection(rows, { serviceDay: TODAY }).days
    expect(day).toMatchObject({ hasSales: false, source: null })
    expect(day?.compliance).toEqual({ kind: 'no_close' })
  })

  it('sin punto de venta todo queda exactamente igual', () => {
    const plain = buildProjection(OCTOBER, { serviceDay: '2026-10-05' })
    const merged = buildProjection(withPosSales(OCTOBER, [], RATES), { serviceDay: '2026-10-05' })
    expect(merged).toEqual(plain)
    for (const day of plain.days) {
      expect(day.source).toBe(day.hasClose ? 'close' : null)
      expect(day.hasSales).toBe(day.hasClose)
      expect(day.depositCents).toBe(0)
    }
  })

  it('un día del punto de venta que no está en el mes pedido se ignora', () => {
    const rows = withPosSales(
      [row('2026-11-10')],
      [sales('2026-12-01', { byMethod: { cash: p(100_000) } })],
      RATES,
    )
    expect(rows).toEqual([row('2026-11-10')])
  })
})

describe('lo que llega del punto de venta y de Ajustes', () => {
  it('un día de pos_sales_days: por medio va venta + recargo; las propinas no son venta', () => {
    const day = parsePosSalesDay({
      day: '2026-11-13',
      sales_cents: 9_300_000,
      surcharge_cents: 112_000,
      tip_cents: 500_000,
      payments: 4,
      by_method: {
        cash: '4700000',
        debit: 2_000_000,
        credit: 1_232_000,
        qr: 1_480_000,
        transfer: 0,
      },
      tables: 3,
      people: 9,
      consumption_cents: 9_300_000,
      discount_cents: 0,
      deposit_cents: 250_000,
    })
    expect(day).toEqual({
      day: '2026-11-13',
      byMethod: { cash: 4_700_000, debit: 2_000_000, credit: 1_232_000, qr: 1_480_000 },
      depositCents: 250_000,
    })
    // Lo que no se entiende no se inventa.
    expect(parsePosSalesDay({ by_method: { cash: 100 } })).toBeNull()
    expect(parsePosSalesDay({ day: '2026-11-13', by_method: 'x', deposit_cents: -5 })).toEqual({
      day: '2026-11-13',
      byMethod: {},
      depositCents: 0,
    })
  })

  it('la comisión de cada medio es la del partícipe de su par en Administración', () => {
    const methods = [
      { system_key: 'cash', party_id: null },
      { system_key: 'transfer', party_id: 'mp' },
      { system_key: 'qr_mp', party_id: 'mp' },
      { system_key: 'debit', party_id: 'posnet-debito' },
      { system_key: 'credit', party_id: 'posnet-credito' },
      // Un medio que no es del punto de venta no pinta nada acá.
      { system_key: 'pedidosya', party_id: 'pedidosya' },
    ]
    const parties = [
      { id: 'mp', commission_bp: 150 },
      { id: 'posnet-debito', commission_bp: '314' },
      // Sin el porcentaje cargado: el medio se cuenta entero.
      { id: 'posnet-credito', commission_bp: null },
      { id: 'pedidosya', commission_bp: 2520 },
    ]
    expect(posCommissionRates(methods, parties)).toEqual({ transfer: 150, qr: 150, debit: 314 })
    expect(posCommissionRates([], parties)).toEqual({})
  })
})
