import type { SplitBarSegment } from '@/components/administracion/charts/split-bar'
import { capitalizeFirst, monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/**
 * El IVA del mes contado para un socio: el número, la oración que lo explica y
 * la barra «lo que cobraste / lo que ya tenías cubierto / lo que falta». Puro:
 * todo sale de la misma posición de IVA que usa la cascada de la contadora y
 * el exporte (pantalla = CSV), sin una lectura más.
 *
 * Regla de honestidad: la barra y la cuenta simple se dibujan SOLO si cierran
 * al centavo con el resultado que se muestra. La liquidación arrastra saldos de
 * dos maneras; si la suma simple no diera, va la cascada completa y nada más.
 */

/** Lo que hace falta de la posición (`IvaPosition` y la del checklist lo cumplen). */
export type IvaLike = {
  applies: boolean
  status: 'open' | 'closed'
  toPayCents: number
  inFavorCents: number
  isZero: boolean
  debitFiscal: { totalCents: number }
  creditFiscal: { totalCents: number }
  technicalBalancePrevCents: number
  freeBalancePrevCents: number
  perceptionsCents: number
  withholdingsCents: number
}

export type IvaSimpleMath = {
  /** IVA de lo que vendiste con factura (débito fiscal). */
  debit: number
  /** IVA de tus compras con Factura A (crédito fiscal). */
  credit: number
  /** Saldo a favor que venía de meses anteriores (técnico + libre disponibilidad). */
  carried: number
  /** Percepciones y retenciones que ya te cobraron. */
  withheld: number
  /** Positivo = a pagar; negativo = queda a favor. */
  result: number
  /** Redondeando cada renglón a pesos, la suma a la vista sigue dando el resultado. */
  wholePesos: boolean
}

/**
 * La cuenta simple del IVA, la misma guarda que usa el Resumen
 * (`_resumen/iva-block.tsx`): `null` si no cierra con «a pagar − a favor».
 */
export function ivaSimpleMath(p: IvaLike): IvaSimpleMath | null {
  const carried = p.technicalBalancePrevCents + p.freeBalancePrevCents
  const withheld = p.perceptionsCents + p.withholdingsCents
  const debit = p.debitFiscal.totalCents
  const credit = p.creditFiscal.totalCents
  const result = debit - credit - carried - withheld
  if (result !== p.toPayCents - p.inFavorCents) return null
  const pesos = (cents: number) => Math.round(cents / 100)
  const wholePesos =
    pesos(debit) - pesos(credit) - pesos(carried) - pesos(withheld) === pesos(result)
  return { debit, credit, carried, withheld, result, wholePesos }
}

/** Ni ventas, ni compras, ni saldos que vengan de antes: todavía no hay nada con factura. */
export function ivaNothingLoaded(p: IvaLike): boolean {
  return (
    p.debitFiscal.totalCents === 0 &&
    p.creditFiscal.totalCents === 0 &&
    p.technicalBalancePrevCents === 0 &&
    p.freeBalancePrevCents === 0 &&
    p.perceptionsCents === 0 &&
    p.withholdingsCents === 0
  )
}

export type IvaHero =
  | {
      kind: 'to_pay' | 'in_favor'
      /** El número grande. */
      cents: number
      /** «IVA de septiembre · a pagar». */
      label: string
      sentence: string
      /** Para una línea: «$ 4.117.062 a pagar». */
      short: string
      /** Para el pie del número chico de `/libros`: «A pagarle a ARCA.» */
      brief: string
    }
  | {
      kind: 'zero' | 'not_registered'
      /** Nunca «$ 0»: en cero se dice con palabras. */
      cents: null
      title: string
      sentence: string | null
      short: string
      brief: string
    }

/**
 * Qué dice el héroe del IVA. En cero NO devuelve número: «$ 0» afirmaría una
 * cuenta que quizá nadie hizo (un mes sin nada con factura).
 */
export function ivaHero(p: IvaLike, month: string): IvaHero {
  const noun = monthName(Number(month.slice(5, 7)))
  const name = capitalizeFirst(noun)
  if (!p.applies) {
    return {
      kind: 'not_registered',
      cents: null,
      title: 'El bar no liquida IVA',
      sentence:
        'Según los datos del bar no es responsable inscripto. Si cambió, avisale a tu contadora.',
      short: 'no liquida IVA',
      brief: 'El bar no liquida IVA.',
    }
  }
  if (p.toPayCents > 0) {
    return {
      kind: 'to_pay',
      cents: p.toPayCents,
      label: `IVA de ${noun} · a pagar`,
      sentence:
        'Es lo que le pasás a ARCA: el IVA de lo que vendiste con factura, menos el de tus compras con Factura A.',
      short: `${formatCentsShort(p.toPayCents)} a pagar`,
      brief: 'A pagarle a ARCA.',
    }
  }
  if (p.inFavorCents > 0) {
    return {
      kind: 'in_favor',
      cents: p.inFavorCents,
      label: `IVA de ${noun} · a favor`,
      sentence:
        'Pagaste más IVA en tus compras del que cobraste en tus ventas. La diferencia queda para el mes que viene.',
      short: `${formatCentsShort(p.inFavorCents)} a favor`,
      brief: 'Te queda a favor.',
    }
  }
  return {
    kind: 'zero',
    cents: null,
    title: ivaNothingLoaded(p)
      ? `${name} todavía no tiene IVA`
      : `${name} no tiene IVA para pagar ni a favor`,
    sentence: ivaNothingLoaded(p)
      ? `Aparece cuando cargás ventas con factura o compras con Factura A.`
      : null,
    short: 'sin IVA para pagar ni a favor',
    brief: ivaNothingLoaded(p)
      ? `${name} todavía no tiene IVA: aparece cuando cargás ventas con factura o compras con Factura A.`
      : `${name} no tiene IVA para pagar ni a favor.`,
  }
}

export type IvaCoverBar = {
  kind: 'to_pay' | 'in_favor'
  segments: SplitBarSegment[]
  /** Qué es la barra entera. */
  totalLabel: string
  totalCents: number
  /** El título que afirma. */
  title: string
  sentence: string
}

/** Los rótulos, los mismos del Resumen («¿Cómo se calcula?» de la franja de IVA). */
export const IVA_LABELS = {
  debit: 'IVA de lo que vendiste con factura',
  credit: 'IVA de tus compras con Factura A',
  withheld: 'Percepciones y retenciones que ya te cobraron',
  carried: 'Saldo a favor que venía de meses anteriores',
  toPay: 'A pagar',
  inFavor: 'Te queda a favor',
  covers: 'Cubre el IVA de lo que vendiste con factura',
} as const

/**
 * La barra del IVA.
 *
 * - **A pagar**: la barra entera es lo que cobraste de IVA; se parte en lo que
 *   ya tenías cubierto (compras, percepciones, saldo de antes) y lo que falta.
 * - **A favor**: la barra entera es lo que ya tenías pagado; se parte en lo que
 *   cubre el IVA de tus ventas y lo que te queda a favor.
 *
 * `null` (no se dibuja; va la tabla) si la cuenta simple no cierra, si algún
 * tramo da negativo, o si un lado es cero (una barra de un solo tramo no es un
 * gráfico).
 */
export function ivaCoverBar(p: IvaLike): IvaCoverBar | null {
  if (!p.applies) return null
  const math = ivaSimpleMath(p)
  if (!math) return null
  const { debit, credit, carried, withheld } = math
  if (debit < 0 || credit < 0 || carried < 0 || withheld < 0) return null
  const covered = credit + withheld + carried

  if (p.toPayCents > 0 && p.inFavorCents === 0) {
    if (debit <= 0 || covered <= 0) return null
    const segments: SplitBarSegment[] = [
      { key: 'credit', label: IVA_LABELS.credit, cents: credit, swatch: 'bg-adm-s1' },
      { key: 'withheld', label: IVA_LABELS.withheld, cents: withheld, swatch: 'bg-adm-s6' },
      { key: 'carried', label: IVA_LABELS.carried, cents: carried, swatch: 'bg-adm-s4' },
      { key: 'to_pay', label: IVA_LABELS.toPay, cents: p.toPayCents, swatch: 'bg-adm-s2' },
    ].filter((s) => s.cents > 0)
    return {
      kind: 'to_pay',
      segments,
      totalLabel: IVA_LABELS.debit,
      totalCents: debit,
      title: `Cobraste ${formatCentsShort(debit)} de IVA y ya tenías cubiertos ${formatCentsShort(covered)}`,
      sentence: `La diferencia, ${formatCentsShort(p.toPayCents)}, es lo que le pasás a ARCA.`,
    }
  }

  if (p.inFavorCents > 0 && p.toPayCents === 0) {
    if (debit <= 0 || covered <= 0) return null
    return {
      kind: 'in_favor',
      segments: [
        { key: 'covers', label: IVA_LABELS.covers, cents: debit, swatch: 'bg-adm-s1' },
        { key: 'in_favor', label: IVA_LABELS.inFavor, cents: p.inFavorCents, swatch: 'bg-adm-s4' },
      ],
      totalLabel: 'IVA que ya tenías pagado',
      totalCents: covered,
      title: 'Tenías más IVA pagado del que cobraste',
      sentence: `Te quedan ${formatCentsShort(p.inFavorCents)} a favor para el mes que viene.`,
    }
  }
  return null
}

/**
 * Cuando la barra no se dibuja porque un lado es cero, la oración que lo dice
 * («todo queda a favor» / «no tenías nada cubierto»). `null` si no es ese caso.
 */
export function ivaOneSidedSentence(p: IvaLike, month: string): string | null {
  if (!p.applies || p.isZero) return null
  const math = ivaSimpleMath(p)
  if (!math) return null
  const name = capitalizeFirst(monthName(Number(month.slice(5, 7))))
  const covered = math.credit + math.withheld + math.carried
  if (math.debit === 0 && covered > 0 && p.inFavorCents > 0) {
    return math.credit > 0 && math.withheld === 0 && math.carried === 0
      ? `${name} todavía no tiene ventas con factura: todo el IVA de tus compras con Factura A queda a favor.`
      : `${name} todavía no tiene ventas con factura: todo el IVA que ya tenías pagado queda a favor.`
  }
  if (covered === 0 && math.debit > 0 && p.toPayCents > 0) {
    return `${name} todavía no tiene compras con Factura A ni saldo de antes: todo el IVA de lo que vendiste con factura es a pagar.`
  }
  return null
}

export type IvaTrendRow = {
  /** `yyyy-MM`. */
  month: string
  /** «Septiembre». */
  label: string
  /** «cerrado» · «estimado». */
  stateWord: 'cerrado' | 'estimado'
  toPayCents: number
  inFavorCents: number
  debitCents: number
  creditCents: number
  /** «$ 4.117.062 a pagar» · «a favor $ 120.000» · «sin IVA». */
  text: string
}

/**
 * «El IVA mes a mes»: un renglón por mes con libros, en orden. Los meses que
 * no se pudieron leer o donde el bar no liquida IVA no entran.
 */
export function ivaTrendRows(
  months: ReadonlyArray<{ month: string; position: IvaLike | null }>,
): IvaTrendRow[] {
  const rows: IvaTrendRow[] = []
  for (const { month, position: p } of months) {
    if (!p?.applies) continue
    rows.push({
      month,
      label: capitalizeFirst(monthName(Number(month.slice(5, 7)))),
      stateWord: p.status === 'closed' ? 'cerrado' : 'estimado',
      toPayCents: Math.max(0, p.toPayCents),
      inFavorCents: Math.max(0, p.inFavorCents),
      debitCents: p.debitFiscal.totalCents,
      creditCents: p.creditFiscal.totalCents,
      text:
        p.toPayCents > 0
          ? `${formatCentsShort(p.toPayCents)} a pagar`
          : p.inFavorCents > 0
            ? `a favor ${formatCentsShort(p.inFavorCents)}`
            : 'sin IVA',
    })
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month))
}

function trendClause(row: IvaTrendRow, compact: (cents: number) => string): string {
  if (row.toPayCents > 0) return `${compact(row.toPayCents)} a pagar`
  if (row.inFavorCents > 0) return `${compact(row.inFavorCents)} a favor`
  return 'sin IVA'
}

/**
 * «Septiembre: $ 4,1 M a pagar. Octubre viene en $ 0,9 M (estimado).» Habla de
 * los dos últimos meses; `compact` es la plata corta del eje (`compactCents`).
 */
export function ivaTrendTitle(
  rows: readonly IvaTrendRow[],
  compact: (cents: number) => string = formatCentsShort,
): string | null {
  const last = rows.at(-1)
  if (!last) return null
  const previous = rows.at(-2)
  const lastText =
    last.stateWord === 'estimado'
      ? last.toPayCents > 0
        ? `${last.label} viene en ${compact(last.toPayCents)} (estimado).`
        : last.inFavorCents > 0
          ? `${last.label} viene con ${compact(last.inFavorCents)} a favor (estimado).`
          : `${last.label} todavía no tiene IVA.`
      : `${last.label}: ${trendClause(last, compact)}.`
  if (!previous) return lastText
  return `${previous.label}: ${trendClause(previous, compact)}. ${lastText}`
}
