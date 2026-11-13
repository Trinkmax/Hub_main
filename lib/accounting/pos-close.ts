/**
 * El cierre del día, precargado con lo que cobró el punto de venta.
 *
 * En un bar con punto de venta, «Cargar cierre» ya no arranca en blanco: cada medio del cierre trae lo
 * que se cobró por su par del salón ese día de servicio. Es el paso que sigue a `withPosSales` (la
 * proyección se completa sola): allá el número es provisorio; acá, cuando la persona revisa y guarda,
 * va a los libros.
 *
 * Puro: no lee ni escribe. La pantalla precarga y la persona decide; guardar sigue pasando por la
 * acción de siempre, con sus validaciones. Lo prueba `administracion-cierre-pos.test.ts`.
 */

import { formatCentsShort } from '@/lib/money'
import { POS_METHOD_SYSTEM_KEY, type PosPayMethod } from './projection'

/** Lo que cobró el punto de venta un día de servicio (de `pos_sales_days`), sin lo de práctica. */
export type PosCloseDay = {
  day: string
  /** Por medio, venta + recargo (sin propinas). */
  byMethod: Partial<Record<PosPayMethod, number>>
  /** Señas descontadas de las cuentas cobradas ese día: plata que ya había entrado antes. */
  depositCents: number
  /** Propinas cobradas: no son venta. */
  tipCents: number
  /** Mesas cobradas. */
  tables: number
}

/** Lo que hace falta saber de un medio del cierre para encontrarle su par. */
export type PosCloseMethod = {
  id: string
  name: string
  /** `cash`, `transfer`, `qr_mp`, `debit`, `credit`… (`acc_sales_methods.system_key`). */
  systemKey: string | null
  channel: string
}

export type PosCloseFill = {
  /** Importe de cada medio del cierre (id → centavos). Solo los que cobraron algo. */
  fills: Record<string, number>
  /**
   * Lo cobrado por un medio del salón que no tiene par activo en el cierre («Otro», o un medio que el
   * bar desactivó en Ajustes). No se le inventa un destino: se dice cuánto es y lo carga la persona.
   */
  unmatched: Array<{ method: PosPayMethod; cents: number }>
  /** Todo lo cobrado ese día: lo precargado más lo que quedó sin par. */
  chargedCents: number
  /** Lo que quedó precargado. */
  filledCents: number
  depositCents: number
  tipCents: number
  tables: number
}

/** En el orden en que se cobran y se muestran siempre. */
const METHODS: readonly PosPayMethod[] = ['cash', 'transfer', 'qr', 'debit', 'credit', 'other']

/** Cómo se llama cada medio del salón (igual que `METHOD_LABEL` de `lib/pos/cash/types.ts`). */
export const POS_METHOD_NAME: Readonly<Record<PosPayMethod, string>> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  qr: 'QR',
  debit: 'Débito',
  credit: 'Crédito',
  other: 'Otro',
}

/**
 * Reparte lo cobrado entre los medios del cierre. El par de cada medio es el medio activo del canal
 * salón con su `system_key` (nunca por el nombre: el bar los puede haber renombrado). `null` si ese
 * día el punto de venta no cobró nada: no hay nada que precargar.
 */
export function posCloseFill(
  day: PosCloseDay,
  methods: readonly PosCloseMethod[],
): PosCloseFill | null {
  const byKey = new Map<string, PosCloseMethod>()
  for (const method of methods) {
    if (method.systemKey && method.channel === 'salon' && !byKey.has(method.systemKey)) {
      byKey.set(method.systemKey, method)
    }
  }
  const fills: Record<string, number> = {}
  const unmatched: PosCloseFill['unmatched'] = []
  let chargedCents = 0
  let filledCents = 0
  for (const method of METHODS) {
    const cents = Math.max(0, Math.round(day.byMethod[method] ?? 0))
    if (cents === 0) continue
    chargedCents += cents
    const key = POS_METHOD_SYSTEM_KEY[method]
    const target = key ? byKey.get(key) : undefined
    if (!target) {
      unmatched.push({ method, cents })
      continue
    }
    fills[target.id] = (fills[target.id] ?? 0) + cents
    filledCents += cents
  }
  if (chargedCents === 0) return null
  return {
    fills,
    unmatched,
    chargedCents,
    filledCents,
    depositCents: Math.max(0, Math.round(day.depositCents)),
    tipCents: Math.max(0, Math.round(day.tipCents)),
    tables: Math.max(0, Math.trunc(day.tables)),
  }
}

export type PosCloseWords = {
  /** La oración que afirma: «Precargado con lo que cobró el punto de venta: $ X en 12 mesas.» */
  headline: string
  /** Lo que hay que saber antes de guardar, una oración por cosa. */
  notes: string[]
}

/**
 * Lo que dice la pantalla arriba de los importes precargados. Nada de esto se guarda: explica de dónde
 * salen los números y qué quedó afuera a propósito.
 */
export function posCloseWords(fill: PosCloseFill): PosCloseWords {
  const tables =
    fill.tables === 1 ? ' en 1 mesa' : fill.tables > 1 ? ` en ${fill.tables} mesas` : ''
  const headline =
    fill.filledCents > 0
      ? `Precargado con lo que cobró el punto de venta: ${formatCentsShort(fill.filledCents)}${tables}.`
      : `El punto de venta cobró ${formatCentsShort(fill.chargedCents)}${tables}, pero ningún medio tiene su par en este cierre.`
  const notes: string[] = []
  for (const item of fill.unmatched) {
    notes.push(
      `Lo cobrado por «${POS_METHOD_NAME[item.method]}» (${formatCentsShort(item.cents)}) no tiene un medio en este cierre: cargalo a mano donde corresponda.`,
    )
  }
  if (fill.depositCents > 0) {
    notes.push(
      `Se descontaron ${formatCentsShort(fill.depositCents)} de señas que ya se habían cobrado: no están en estos importes.`,
    )
  }
  if (fill.tipCents > 0) {
    notes.push(
      `Las propinas (${formatCentsShort(fill.tipCents)}) no son venta: no están incluidas.`,
    )
  }
  return { headline, notes }
}

/**
 * Los medios que la persona ya había cargado con otro importe: antes de pisarlos se pregunta. Un medio
 * vacío no cuenta (no hay nada que perder).
 */
export function posCloseChanges(
  fills: Readonly<Record<string, number>>,
  current: Readonly<Record<string, number | null | undefined>>,
): Array<{ id: string; from: number; to: number }> {
  const out: Array<{ id: string; from: number; to: number }> = []
  for (const [id, to] of Object.entries(fills)) {
    const from = current[id]
    if (typeof from === 'number' && from !== to) out.push({ id, from, to })
  }
  return out
}
