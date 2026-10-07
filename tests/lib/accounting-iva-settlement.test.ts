import { describe, expect, it } from 'vitest'
import { sumSides } from '@/lib/accounting/balance'
import {
  buildIvaSettlement,
  computeIvaPosition,
  type IvaPositionFigures,
} from '@/lib/accounting/posting/iva-settlement'
import { assertGolden, E15A, E15B, E15C, prepare } from './accounting-fixtures'

describe('posición de IVA del mes (art. 24, E.5.15)', () => {
  it('E15a · a pagar 89.140.000', () => {
    expect(
      computeIvaPosition({
        df: 131_040_000,
        cf: 41_000_000,
        perc: 600_000,
        ret: 300_000,
        st0: 0,
        ld0: 0,
      }),
    ).toEqual({ technicalBalance: 90_040_000, toPay: 89_140_000, st1: 0, ld1: 0 })
  })

  it('E15b · a favor: saldo técnico 15.000.000 y libre disponibilidad 500.000', () => {
    expect(
      computeIvaPosition({ df: 20_000_000, cf: 35_000_000, perc: 500_000, ret: 0, st0: 0, ld0: 0 }),
    ).toEqual({ technicalBalance: -15_000_000, toPay: 0, st1: 15_000_000, ld1: 500_000 })
  })

  it('E15c · usa los saldos del mes anterior y paga 14.300.000', () => {
    expect(
      computeIvaPosition({
        df: 60_000_000,
        cf: 30_000_000,
        perc: 200_000,
        ret: 0,
        st0: 15_000_000,
        ld0: 500_000,
      }),
    ).toEqual({ technicalBalance: 15_000_000, toPay: 14_300_000, st1: 0, ld1: 0 })
  })

  it('saldo técnico positivo que no alcanza a cubrir los pagos a cuenta: queda libre disponibilidad', () => {
    expect(
      computeIvaPosition({
        df: 10_000_000,
        cf: 9_000_000,
        perc: 1_500_000,
        ret: 0,
        st0: 0,
        ld0: 200_000,
      }),
    ).toEqual({ technicalBalance: 1_000_000, toPay: 0, st1: 0, ld1: 700_000 })
  })

  it('propiedad: a pagar, ST₁ y LD₁ ≥ 0, DF − CF − ST₀ − PERC − RET − LD₀ = a pagar − ST₁ − LD₁, y el asiento cuadra', () => {
    // PRNG con semilla (mulberry32): determinista y sin dependencias.
    let seed = 0x5eed_1234
    const next = () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    }
    const cents = (max: number) => Math.floor(next() * max)
    const { ctx, meta } = prepare()
    for (let i = 0; i < 2_000; i++) {
      const f: IvaPositionFigures = {
        df: cents(500_000_000),
        cf: cents(500_000_000),
        perc: cents(20_000_000),
        ret: cents(20_000_000),
        st0: i % 3 === 0 ? 0 : cents(100_000_000),
        ld0: i % 4 === 0 ? 0 : cents(10_000_000),
      }
      const p = computeIvaPosition(f)
      expect(p.toPay).toBeGreaterThanOrEqual(0)
      expect(p.st1).toBeGreaterThanOrEqual(0)
      expect(p.ld1).toBeGreaterThanOrEqual(0)
      expect(f.df - f.cf - f.st0 - f.perc - f.ret - f.ld0).toBe(p.toPay - p.st1 - p.ld1)
      // Nunca a pagar y a favor a la vez.
      expect(p.toPay > 0 && p.st1 + p.ld1 > 0).toBe(false)

      const result = buildIvaSettlement({ month: '2026-10', figures: f }, ctx, meta)
      expect(result.ok, JSON.stringify(f)).toBe(true)
      if (result.ok) {
        for (const doc of result.bundle.documents) expect(sumSides(doc.lines).diff).toBe(0n)
      }
    }
  })
})

describe('liquidación de IVA (comprobante `iva_settlement`): los golden de E15', () => {
  for (const fixture of [E15A, E15B, E15C]) {
    it(`${fixture.id} · ${fixture.title}`, () => {
      const { r, ctx, meta } = prepare(fixture)
      assertGolden(buildIvaSettlement(fixture.input(r), ctx, meta), fixture, r)
    })
  }

  it('todo en cero: no hay comprobante (la RPC tampoco crea nada)', () => {
    const { ctx, meta } = prepare()
    const result = buildIvaSettlement(
      { month: '2026-10', figures: { df: 0, cf: 0, perc: 0, ret: 0, st0: 0, ld0: 0 } },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.documents).toEqual([])
      expect(result.preview).toEqual([])
    }
  })

  it('un mes con NC de más (débito fiscal negativo) da vuelta el lado de la línea', () => {
    const { r, ctx, meta } = prepare()
    const result = buildIvaSettlement(
      {
        month: '2026-10',
        figures: { df: -1_000_000, cf: 2_000_000, perc: 0, ret: 0, st0: 0, ld0: 0 },
      },
      ctx,
      meta,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.bundle.documents[0]?.lines.map((l) => [l.accountId, l.side, l.amountCents]),
    ).toEqual([
      [r.account('vat_debit'), 'credit', 1_000_000],
      [r.account('vat_credit'), 'credit', 2_000_000],
      [r.account('vat_technical_balance'), 'debit', 3_000_000],
    ])
  })
})
