/**
 * Agrupa los cargos del banco de un mismo día con su «madre» por proporción
 * (diseño §4.3.3, `banco.md` §2.11 y §3.9):
 *
 * - comisión → IVA al 21 % (al 10,5 % si la madre es un interés) → percepción
 *   de IVA RG 2408 al 3 % (o 1,5 %);
 * - cualquier movimiento → impuesto Ley 25.413 al 0,6 % (si el banco lo cobra
 *   por movimiento: A CONFIRMAR con un extracto de BNA).
 *
 * Tolerancia: ±1 centavo o 0,5 %. Si una línea de IVA no calza con una comisión
 * sola, se prueba con la suma de las comisiones del día. Sirve para explicar el
 * cargo en la revisión («$ 14.490 = 21 % de la comisión de $ 69.000») y para
 * validar la clasificación; el `bank_expense` del día lo arma la propuesta.
 */

import type { BankItem, Cents, IsoDate } from '../types'
import { type BankCategory, classifyBankItem } from './rules'

export type ChargeKind = 'iva_21' | 'iva_105' | 'perc_iva_3' | 'perc_iva_15' | 'ley25413'

export type DailyChargeChild = {
  /** Índice en la lista de movimientos. */
  readonly index: number
  readonly kind: ChargeKind
  /** Lo que daría la proporción exacta (para mostrar la cuenta). */
  readonly expectedCents: Cents
}

export type DailyChargeGroup = {
  readonly date: IsoDate
  /** Las madres (una o, si el IVA es de la suma del día, varias). */
  readonly motherIndexes: readonly number[]
  readonly children: readonly DailyChargeChild[]
}

export type DailyChargeGrouping = {
  readonly groups: readonly DailyChargeGroup[]
  /** IVA o percepciones que no calzaron con ninguna madre del día (a revisar). */
  readonly unmatched: readonly number[]
  /** La alícuota de cada línea de IVA que calzó (índice → `iva_21`/`iva_105`). */
  readonly ivaRates: Readonly<Record<number, 'iva_21' | 'iva_105'>>
}

type Movement = Pick<BankItem, 'date' | 'amount' | 'description' | 'counterpartyCuit'>

/** ¿`actual` es `base × bp / 10000` con ±1 centavo o 0,5 % de tolerancia? */
export function matchesRatio(actual: Cents, base: Cents, bp: number): boolean {
  const expected = Math.round((Math.abs(base) * bp) / 10000)
  if (expected === 0) return false
  const tolerance = Math.max(1, Math.round(expected * 0.005))
  return Math.abs(Math.abs(actual) - expected) <= tolerance
}

/**
 * Agrupa por día. `categories` (la categoría de cada movimiento) sale de
 * `classifyBankItem`; si no viene, se calcula con la tabla de fábrica.
 */
export function groupDailyCharges(
  items: readonly Movement[],
  categories?: readonly (BankCategory | null)[],
): DailyChargeGrouping {
  const cats = items.map((it, i) => categories?.[i] ?? classifyBankItem(it).category)
  const byDate = new Map<IsoDate, number[]>()
  items.forEach((it, i) => {
    const list = byDate.get(it.date) ?? []
    list.push(i)
    byDate.set(it.date, list)
  })

  const groups: DailyChargeGroup[] = []
  const unmatched: number[] = []
  const ivaRates: Record<number, 'iva_21' | 'iva_105'> = {}

  for (const [date, indexes] of byDate) {
    const amountOf = (i: number) => Math.abs(items[i]?.amount ?? 0)
    const debitOf = (i: number) => (items[i]?.amount ?? 0) < 0
    const mothers = indexes.filter(
      (i) => debitOf(i) && (cats[i] === 'comisiones' || cats[i] === 'intereses'),
    )
    const dayGroups = new Map<string, { motherIndexes: number[]; children: DailyChargeChild[] }>()
    const groupFor = (motherIndexes: number[]) => {
      const key = motherIndexes.join(',')
      let g = dayGroups.get(key)
      if (!g) {
        g = { motherIndexes, children: [] }
        dayGroups.set(key, g)
      }
      return g
    }
    const sumOf = (list: number[]) => list.reduce((a, i) => a + amountOf(i), 0)
    const ivaUsed = new Set<number>()

    // IVA: 21 % de una comisión (10,5 % de un interés); si no, de la suma del día.
    for (const i of indexes.filter((x) => cats[x] === 'iva_cf')) {
      let done = false
      for (const m of mothers) {
        if (ivaUsed.has(m)) continue
        const rates: Array<[number, 'iva_21' | 'iva_105']> =
          cats[m] === 'intereses'
            ? [
                [1050, 'iva_105'],
                [2100, 'iva_21'],
              ]
            : [
                [2100, 'iva_21'],
                [1050, 'iva_105'],
              ]
        const hit = rates.find(([bp]) => matchesRatio(amountOf(i), amountOf(m), bp))
        if (hit) {
          ivaUsed.add(m)
          ivaRates[i] = hit[1]
          groupFor([m]).children.push({
            index: i,
            kind: hit[1],
            expectedCents: Math.round((amountOf(m) * hit[0]) / 10000),
          })
          done = true
          break
        }
      }
      if (!done) {
        const fees = mothers.filter((m) => cats[m] === 'comisiones')
        const interests = mothers.filter((m) => cats[m] === 'intereses')
        const options: Array<[number[], number, 'iva_21' | 'iva_105']> = [
          [fees, 2100, 'iva_21'],
          [interests, 1050, 'iva_105'],
          [mothers, 2100, 'iva_21'],
        ]
        const hit = options.find(
          ([list, bp]) => list.length > 1 && matchesRatio(amountOf(i), sumOf(list), bp),
        )
        if (hit) {
          ivaRates[i] = hit[2]
          groupFor(hit[0]).children.push({
            index: i,
            kind: hit[2],
            expectedCents: Math.round((sumOf(hit[0]) * hit[1]) / 10000),
          })
          done = true
        }
      }
      if (!done) unmatched.push(i)
    }

    // Percepción de IVA: 3 % (o 1,5 %) de una comisión o de la suma del día.
    for (const i of indexes.filter((x) => cats[x] === 'perc_iva')) {
      const tryList = (list: number[]): boolean => {
        for (const [bp, kind] of [
          [300, 'perc_iva_3'],
          [150, 'perc_iva_15'],
        ] as const) {
          if (matchesRatio(amountOf(i), sumOf(list), bp)) {
            groupFor(list).children.push({
              index: i,
              kind,
              expectedCents: Math.round((sumOf(list) * bp) / 10000),
            })
            return true
          }
        }
        return false
      }
      const single = mothers.find((m) => tryList([m]))
      const fees = mothers.filter((m) => cats[m] === 'comisiones')
      if (single === undefined && !(fees.length > 1 && tryList(fees))) unmatched.push(i)
    }

    // Ley 25.413: 0,6 % de un movimiento del mismo día (crédito o débito).
    const taxed = new Set<number>()
    for (const i of indexes.filter((x) => cats[x] === 'ley25413')) {
      const base = indexes.find(
        (m) =>
          m !== i &&
          !taxed.has(m) &&
          cats[m] !== 'ley25413' &&
          cats[m] !== 'iva_cf' &&
          cats[m] !== 'perc_iva' &&
          cats[m] !== 'sircreb' &&
          matchesRatio(amountOf(i), amountOf(m), 60),
      )
      if (base !== undefined) {
        taxed.add(base)
        groupFor([base]).children.push({
          index: i,
          kind: 'ley25413',
          expectedCents: Math.round((amountOf(base) * 60) / 10000),
        })
      }
    }

    for (const g of dayGroups.values()) {
      if (g.children.length > 0)
        groups.push({ date, motherIndexes: g.motherIndexes, children: g.children })
    }
  }
  return { groups, unmatched, ivaRates }
}
