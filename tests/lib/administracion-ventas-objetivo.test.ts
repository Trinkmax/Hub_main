import { describe, expect, it } from 'vitest'
import {
  buildTargets,
  DEFAULT_WEEK_PLAN,
  LEVEL_WEIGHTS,
  paceHint,
  type WeekPlan,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/target-builder'
import { salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { weekdayOf } from '@/lib/dates'

/**
 * «Armar el objetivo»: el reparto del objetivo del mes día por día. Lo que se
 * guarda es lo mismo que «Cargar una lista» (`saveSalesTargets`), así que acá
 * se fija que la suma dé exacta, que cada tipo de día pese distinto, que un
 * día cerrado quede sin objetivo y que el resultado pase el esquema de la
 * acción tal cual.
 */

/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const sum = (items: readonly { targetCents: number | null }[]) =>
  items.reduce((total, item) => total + (item.targetCents ?? 0), 0)

describe('buildTargets', () => {
  it('reparte el total del mes y la suma da exacta', () => {
    const built = buildTargets({
      month: '2026-10',
      totalCents: 3_800_000_000,
      plan: DEFAULT_WEEK_PLAN,
    })
    expect(built.items).toHaveLength(31)
    expect(built.days).toBe(31)
    expect(built.totalCents).toBe(3_800_000_000)
    expect(sum(built.items)).toBe(3_800_000_000)
    expect(built.items[0]?.day).toBe('2026-10-01')
    expect(built.items.at(-1)?.day).toBe('2026-10-31')
  })

  it('cada día queda en un número redondo (múltiplos de $ 1.000)', () => {
    const built = buildTargets({
      month: '2026-10',
      totalCents: 3_800_000_000,
      plan: DEFAULT_WEEK_PLAN,
    })
    for (const item of built.items) expect((item.targetCents ?? 0) % 100_000).toBe(0)
  })

  it('lo que no llega al millar va al último día fuerte, y la suma sigue exacta', () => {
    const total = 3_800_012_345
    const built = buildTargets({ month: '2026-10', totalCents: total, plan: DEFAULT_WEEK_PLAN })
    expect(sum(built.items)).toBe(total)
    const odd = built.items.filter((item) => (item.targetCents ?? 0) % 100_000 !== 0)
    expect(odd).toHaveLength(1)
    // El último día fuerte de octubre de 2026 es el sábado 31.
    expect(odd[0]?.day).toBe('2026-10-31')
  })

  it('«Flojo» no vale lo mismo que «Normal», ni «Normal» lo mismo que «Fuerte»', () => {
    expect(LEVEL_WEIGHTS.low).toBeLessThan(LEVEL_WEIGHTS.normal)
    expect(LEVEL_WEIGHTS.normal).toBeLessThan(LEVEL_WEIGHTS.strong)
    const plan: WeekPlan = { ...DEFAULT_WEEK_PLAN, 1: 'low' }
    const built = buildTargets({ month: '2026-10', totalCents: 3_800_000_000, plan })
    const of = (weekday: number) =>
      built.items.find((item) => weekdayOf(item.day) === weekday)?.targetCents ?? 0
    expect(of(1)).toBeLessThan(of(2)) // lunes flojo < martes normal
    expect(of(2)).toBeLessThan(of(5)) // martes normal < viernes fuerte
    // Las proporciones son las de los pesos (6 · 10 · 16), salvo el redondeo al millar.
    expect(of(1) / of(2)).toBeCloseTo(0.6, 2)
    expect(of(5) / of(2)).toBeCloseTo(1.6, 2)
  })

  it('un día «Cerrado» viaja sin objetivo (`null`), y lo suyo se reparte entre los demás', () => {
    const plan: WeekPlan = { ...DEFAULT_WEEK_PLAN, 1: 'closed' }
    const built = buildTargets({ month: '2026-10', totalCents: 3_000_000_000, plan })
    const mondays = built.items.filter((item) => weekdayOf(item.day) === 1)
    expect(mondays).toHaveLength(4)
    expect(mondays.every((item) => item.targetCents === null)).toBe(true)
    expect(built.days).toBe(27)
    expect(sum(built.items)).toBe(3_000_000_000)
  })

  it('pasa el esquema de la acción tal cual', () => {
    for (const plan of [DEFAULT_WEEK_PLAN, { ...DEFAULT_WEEK_PLAN, 0: 'closed', 1: 'low' }]) {
      const built = buildTargets({
        month: '2026-10',
        totalCents: 3_800_012_345,
        plan: plan as WeekPlan,
      })
      const parsed = salesTargetsSchema.parse({ items: built.items })
      expect(parsed.items).toHaveLength(31)
      expect(parsed.items.reduce((total, item) => total + (item.targetCents ?? 0), 0)).toBe(
        3_800_012_345,
      )
    }
  })

  it('sin total, con cero o con todos los días cerrados, ningún día tiene objetivo', () => {
    for (const totalCents of [null, 0, -500, Number.NaN]) {
      const built = buildTargets({ month: '2026-10', totalCents, plan: DEFAULT_WEEK_PLAN })
      expect(built.days).toBe(0)
      expect(built.totalCents).toBe(0)
      expect(built.items.every((item) => item.targetCents === null)).toBe(true)
    }
    const closed: WeekPlan = {
      0: 'closed',
      1: 'closed',
      2: 'closed',
      3: 'closed',
      4: 'closed',
      5: 'closed',
      6: 'closed',
    }
    expect(buildTargets({ month: '2026-10', totalCents: 1_000_000, plan: closed }).days).toBe(0)
  })

  it('un total que no alcanza para un millar por día va entero a un solo día', () => {
    const built = buildTargets({ month: '2026-10', totalCents: 50_000, plan: DEFAULT_WEEK_PLAN })
    expect(built.days).toBe(1)
    expect(built.totalCents).toBe(50_000)
  })

  it('un importe de nueve cifras y un febrero de 28 días', () => {
    const built = buildTargets({
      month: '2027-02',
      totalCents: 99_999_999_900,
      plan: DEFAULT_WEEK_PLAN,
    })
    expect(built.items).toHaveLength(28)
    expect(sum(built.items)).toBe(99_999_999_900)
  })

  it('un mes que no existe no arma nada', () => {
    expect(buildTargets({ month: '2026-13', totalCents: 1_000, plan: DEFAULT_WEEK_PLAN })).toEqual({
      items: [],
      totalCents: 0,
      days: 0,
    })
  })
})

describe('paceHint: una cuenta, no un pronóstico', () => {
  it('dice el promedio por noche y a cuánto cierra el mes a ese ritmo', () => {
    expect(paceHint({ averageCents: 126_543_200, month: '2026-10' })).toBe(
      `Venís vendiendo unos $${NB}1.265.000 por noche: a ese ritmo, el mes cierra cerca de $${NB}39.200.000.`,
    )
  })

  it('sin cierres no dice nada', () => {
    expect(paceHint({ averageCents: null, month: '2026-10' })).toBeNull()
    expect(paceHint({ averageCents: 0, month: '2026-10' })).toBeNull()
  })
})
