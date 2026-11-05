import { capitalizeFirst, monthName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/**
 * El IVA del mes en palabras: qué dice la posición y cómo viene mes a mes. Puro: todo sale de la misma
 * posición de IVA que usa la cuenta completa y el exporte (pantalla = CSV), sin una lectura más.
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
      /** En una línea: «A pagarle a ARCA.» */
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
    // Sin ventas con factura cargadas, «pagaste más IVA del que cobraste» se lee como un hecho
    // del mes; casi siempre es que todavía faltan los cierres del día. Se dice así.
    const noSales = p.status === 'open' && p.debitFiscal.totalCents === 0
    return {
      kind: 'in_favor',
      cents: p.inFavorCents,
      label: `IVA de ${noun} · a favor`,
      sentence: noSales
        ? `Por ahora solo cuenta el IVA de tus compras con Factura A: ${noun} todavía no tiene ventas con factura cargadas. Cuando cargues los cierres del día, este número cambia.`
        : 'Pagaste más IVA en tus compras del que cobraste en tus ventas. La diferencia queda para el mes que viene.',
      short: `${formatCentsShort(p.inFavorCents)} a favor`,
      brief: noSales ? 'A favor por ahora: faltan las ventas con factura.' : 'Te queda a favor.',
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
