/**
 * Lo puro de la hoja «¿Coincide la caja?»: qué se pregunta según la caja, el
 * resultado del conteo en palabras («Coincide», «Faltan $ 1.257»), el texto
 * del botón y qué cajas quedan sin contar. Sin React; lo prueba
 * `tests/lib/administracion-hojas-cajas.test.ts`.
 *
 * Las cuentas (la diferencia, el plan, lo que se queda la billetera) las sigue
 * haciendo la hoja como siempre: acá solo se decide CÓMO SE DICE.
 */

import { formatDayMonth } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import type { SheetTreasury } from '../cajas-ventas/types'

/**
 * - `cash`: la diferencia va sola a faltante o sobrante de caja.
 * - `bank`: gastos del banco, intereses u otra diferencia.
 * - `wallet`: billetera con su partícipe (Mercado Pago): entra lo que estaba en camino.
 * - `card`: la tarjeta de la empresa; se cuenta la DEUDA.
 * - `plain`: otra cuenta (o una billetera sin partícipe).
 */
export type CountMode = 'cash' | 'bank' | 'wallet' | 'card' | 'plain'
export type CountPlan = 'check' | 'adjust' | 'wallet' | 'bank_fees'
export type CountReason = 'bank_fees' | 'interest' | 'other'

/**
 * Plata tal cual es: sin centavos si es redonda («$ 393.500») y con centavos si
 * los tiene («$ 393.500,50»). En un conteo, redondear mostraría un número
 * distinto del que se escribió.
 */
export function exactMoney(cents: number): string {
  const abs = Math.abs(cents)
  return abs % 100 === 0 ? formatCentsShort(abs) : formatCents(abs)
}

export function countModeOf(t: Pick<SheetTreasury, 'kind' | 'bankPartyId'>): CountMode {
  switch (t.kind) {
    case 'cash':
      return 'cash'
    case 'bank':
      return 'bank'
    case 'wallet':
      return t.bankPartyId ? 'wallet' : 'plain'
    case 'credit_card':
      return 'card'
    default:
      return 'plain'
  }
}

/** La pregunta del importe y su ayuda, según qué se está contando. */
export function countQuestion(
  mode: CountMode | null,
  name: string,
): { label: string; hint: string } {
  switch (mode) {
    case 'wallet':
      return {
        label: `¿Cuánto dice la app de ${name}?`,
        hint: 'Abrí la app y copiá el dinero disponible.',
      }
    case 'bank':
      return { label: '¿Cuánto dice el banco?', hint: 'El saldo de hoy en el home banking.' }
    case 'card':
      return {
        label: `¿Cuánto debés en ${name}?`,
        hint: 'Lo que dice el resumen o la app de la tarjeta.',
      }
    case 'plain':
      return { label: '¿Cuánto hay de verdad?', hint: 'El saldo real de la cuenta.' }
    default:
      return {
        label: '¿Cuánto hay de verdad?',
        hint: 'Contá los billetes y las monedas, y escribí el total.',
      }
  }
}

// ─── El resultado ────────────────────────────────────────────────────────────

export type CountVerdict = {
  /** `idle`: todavía no hay número. Los demás son los tonos del cierre del día. */
  tone: 'idle' | 'ok' | 'warn' | 'info'
  /** «Coincide», «Faltan», «Sobran»… `null` mientras no hay número. */
  label: string | null
  /** El número grande, en positivo. `null`: no lleva. */
  amountCents: number | null
  sentence: string
  /** Billetera: la app dice lo mismo que el sistema con ventas tildadas → ofrece destildarlas. */
  offerUntick: boolean
  /** Efectivo con faltante: la aclaración de «cargalo primero como gasto». */
  note: string | null
}

export const VERDICT_IDLE = 'Escribí lo que contaste y te decimos si coincide.'
const FOR_ACCOUNTANT = 'Queda aparte para que lo revise la contadora.'

/**
 * El resultado del conteo. `diff` es lo contado menos lo que dice el sistema
 * (Debe − Haber: en la tarjeta, negativo = debés más). `ticked` son las ventas
 * en camino que quedaron tildadas (solo billetera) y `pendingTicked` cuánto
 * suman; `countedCents` es lo que la persona escribió (en positivo).
 */
export function countVerdict(input: {
  mode: CountMode
  name: string
  diff: number | null
  countedCents: number | null
  ticked: number
  pendingTicked: number
  /** El día del conteo, si no es hoy (`yyyy-MM-dd`). */
  countedOn?: string | null
}): CountVerdict {
  const { mode, name, diff } = input
  const base = { offerUntick: false, note: null } as const
  if (diff === null) {
    return { tone: 'idle', label: null, amountCents: null, sentence: VERDICT_IDLE, ...base }
  }
  const money = exactMoney
  const amountCents = Math.abs(diff)

  if (mode === 'wallet' && input.ticked > 0) {
    if (diff === 0) {
      return {
        tone: 'warn',
        label: 'Todavía no entró nada',
        amountCents: null,
        sentence:
          'La app dice lo mismo que el sistema. Si todavía no te entró, destildá esas ventas.',
        offerUntick: true,
        note: null,
      }
    }
    if (diff < 0) {
      return {
        tone: 'warn',
        label: 'Hay menos plata que antes',
        amountCents,
        sentence: `Si todavía no te entró, destildá esas ventas. Si pagaste algo desde ${name}, cerrá esto y cargá primero ese gasto.`,
        ...base,
      }
    }
    // Lo que estaba en camino menos lo que entró: lo que se quedó la billetera.
    const kept = input.pendingTicked - diff
    const sentence =
      kept > 0
        ? `De ${money(input.pendingTicked)} que estaban en camino, ${name} se quedó con ${money(kept)}.`
        : kept < 0
          ? `Entró todo lo que estaba en camino y ${money(kept)} más: quedan como plata que te rindió ${name}.`
          : 'Entró todo lo que estaba en camino.'
    return { tone: 'ok', label: 'Entraron', amountCents, sentence, ...base }
  }

  if (diff === 0) {
    const when = input.countedOn ? `el ${formatDayMonth(input.countedOn)}` : 'hoy'
    return {
      tone: 'ok',
      label: 'Coincide',
      amountCents: null,
      sentence: `No se guarda ningún movimiento: ${name} queda como contada ${when}.`,
      ...base,
    }
  }

  if (mode === 'cash') {
    const becomes =
      input.countedCents !== null ? ` y el sistema pasa a decir ${money(input.countedCents)}` : ''
    return diff < 0
      ? {
          tone: 'warn',
          label: 'Faltan',
          amountCents,
          sentence: `Queda anotado como faltante de caja${becomes}.`,
          offerUntick: false,
          note: `Si pagaste algo con la plata de la caja y no lo cargaste, cargalo primero como gasto pagado con ${name}: la diferencia desaparece sola.`,
        }
      : {
          tone: 'info',
          label: 'Sobran',
          amountCents,
          sentence: `Queda anotado como sobrante de caja${becomes}.`,
          ...base,
        }
  }

  if (mode === 'card') {
    const tail = `Si lo guardás así, la diferencia queda aparte para que la revise la contadora.`
    return diff < 0
      ? {
          tone: 'warn',
          label: 'Debés más de lo que dice el sistema',
          amountCents,
          sentence: `Puede faltar cargar una compra hecha con la tarjeta. ${tail}`,
          ...base,
        }
      : {
          tone: 'info',
          label: 'Debés menos de lo que dice el sistema',
          amountCents,
          sentence: `Puede faltar cargar un pago del resumen. ${tail}`,
          ...base,
        }
  }

  if (mode === 'wallet') {
    return diff > 0
      ? {
          tone: 'info',
          label: 'Hay más que en el sistema',
          amountCents,
          sentence: `Queda como plata que te rindió ${name}.`,
          ...base,
        }
      : {
          tone: 'warn',
          label: 'Hay menos que en el sistema',
          amountCents,
          sentence: `Decí abajo qué te descontaron. Lo que no expliques queda aparte para que lo revise la contadora.`,
          ...base,
        }
  }

  // Banco, u otra cuenta: con plata de más se pregunta por qué (también en el banco con menos).
  const asks = mode === 'bank' || diff > 0
  return {
    tone: diff < 0 ? 'warn' : 'info',
    label: diff < 0 ? 'Hay menos que en el sistema' : 'Hay más que en el sistema',
    amountCents,
    sentence: asks ? 'Decinos abajo por qué.' : FOR_ACCOUNTANT,
    ...base,
  }
}

// ─── ¿Por qué hay diferencia? ────────────────────────────────────────────────

export type ReasonOption = { value: CountReason; title: string; consequence: string }

/**
 * Las opciones de «¿Por qué hay diferencia?»: solo en un banco con diferencia y
 * en otra cuenta con plata de más (las mismas de siempre).
 */
export function reasonOptions(mode: CountMode | null, diff: number | null): ReasonOption[] {
  if (diff === null || diff === 0) return []
  const other: ReasonOption = {
    value: 'other',
    title: 'Es otra cosa o no sé',
    consequence: FOR_ACCOUNTANT,
  }
  const interest: ReasonOption = {
    value: 'interest',
    title: 'Son intereses o rendimientos',
    consequence: 'Queda como plata que te rindió la cuenta.',
  }
  if (mode === 'bank') {
    return diff < 0
      ? [
          {
            value: 'bank_fees',
            title: 'Son gastos del banco',
            consequence: `Comisiones o impuestos que te debitaron. Te llevamos a cargarlos, con ${exactMoney(diff)} ya puesto como total.`,
          },
          other,
        ]
      : [interest, other]
  }
  if (mode === 'plain' && diff > 0) return [interest, other]
  return []
}

// ─── El botón ────────────────────────────────────────────────────────────────

/** El texto del botón del pie, según lo que va a pasar al tocarlo. */
export function countSubmitLabel(plan: CountPlan | null, ticked: number): string {
  if (plan === null) return 'Guardar'
  if (plan === 'check') return 'Sí, coincide'
  if (plan === 'bank_fees') return 'Cargar los gastos del banco'
  if (plan === 'wallet' && ticked > 0) return 'Anotar lo que entró'
  return 'Guardar la diferencia'
}

// ─── «Contar otra después» ───────────────────────────────────────────────────

/**
 * Las cajas que quedan por contar en esta pasada: las que no se contaron hoy
 * ni en lo que va de la hoja abierta (`done`), en el orden de Ajustes.
 */
export function leftToCount<T extends Pick<SheetTreasury, 'id' | 'lastCheckedOn'>>(
  treasuries: readonly T[],
  today: string,
  done: ReadonlySet<string>,
): T[] {
  return treasuries.filter((t) => !done.has(t.id) && t.lastCheckedOn !== today)
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
}

/**
 * Lo que queda dicho arriba después de guardar con «Contar otra después»:
 * «Caja coincide.» · «Caja quedó en $ 393.500.» · «En Mercado Pago entraron
 * $ 1.357.000.», y lo que falta: «Te falta contar Mercado Pago y Banco Nación.»
 */
export function countSavedNote(input: {
  name: string
  outcome: 'matched' | 'adjusted' | 'arrived'
  /** `adjusted`: lo contado. `arrived`: lo que entró. */
  cents: number | null
  left: readonly string[]
}): string {
  const money = input.cents === null ? '' : exactMoney(input.cents)
  const first =
    input.outcome === 'matched'
      ? `${input.name} coincide.`
      : input.outcome === 'arrived'
        ? `En ${input.name} entraron ${money}.`
        : `${input.name} quedó en ${money}.`
  if (input.left.length === 0) return first
  return `${first} Te falta contar ${joinNames(input.left)}.`
}

// ─── «Ayudame a contar los billetes» ─────────────────────────────────────────

/** Los billetes que se cuentan, en pesos, del más grande al más chico. */
export const BILL_VALUES = [20_000, 10_000, 2_000, 1_000, 500, 200, 100] as const

/**
 * La suma del contador de billetes, en centavos. Solo suma: no se guarda
 * cuántos billetes había. Cantidades que no son un entero positivo no cuentan.
 */
export function billsTotalCents(
  quantities: Readonly<Record<number, number | null | undefined>>,
  looseCents: number | null,
): number {
  let total = Math.max(0, looseCents ?? 0)
  for (const value of BILL_VALUES) {
    const quantity = quantities[value]
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) continue
    total += quantity * value * 100
  }
  return total
}
