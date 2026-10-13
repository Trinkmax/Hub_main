/**
 * Lo que el cierre del día MUESTRA (rediseño de octubre 2026): cómo se agrupan
 * los medios por «de dónde saco el número», a dónde va la plata de cada uno,
 * cuándo entra y el reparto «con factura / sin factura». Puro: lo prueba
 * `administracion-cierre.test.ts`.
 *
 * Acá no se arma nada de lo que se manda: el envío (`SalesCloseValues`) lo
 * sigue armando el formulario con su estado de siempre, y los medios viajan en
 * el orden de Ajustes › Medios de cobro. Esto solo decide cómo se ven.
 */

import type { Channel, SalesMethodKind, TreasuryKind } from '@/lib/accounting/types'
import { addDays, formatWeekdayDayMonth } from '@/lib/dates'

// ─── Los medios, agrupados ───────────────────────────────────────────────────

/** De dónde sale el número: billetes, el reporte de la billetera, el posnet, cada app… */
export type CloseMethodGroup = 'cash' | 'wallet' | 'cards' | 'delivery' | 'account' | 'advance'

/** Un renglón de «Cuándo entra» del ticket: los medios con la misma `key` se suman. */
export type CloseArrival = {
  key: string
  /** Para ordenar: lo que ya está, lo que está en camino, lo que llega por fecha y el resto. */
  order: string
  /** «Entra a Caja», «En camino a Mercado Pago», «Jue 08/10». */
  label: string
}

/** Lo que la página sabe de un medio (del catálogo), sin nada de pantalla. */
export type CloseMethodSource = {
  kind: SalesMethodKind
  channel: Channel
  settlementDays: number
}

export type CloseMethodLookup = {
  /** La caja a la que entra (medios «a caja» y los que se acreditan en el acto). */
  treasury: { id: string; name: string; kind: TreasuryKind } | null
  /** Quién lo paga después: el posnet, la app, la billetera. */
  party: { id: string; name: string } | null
  /** Es el efectivo que se puede contar (lo decide la página, igual que siempre). */
  isCash: boolean
  /** Es de Mercado Pago: el medio del QR o de las transferencias, o va a su billetera. */
  mercadoPago: boolean
}

export type CloseMethodView = {
  group: CloseMethodGroup
  /** A dónde va, en palabras y corto: «Entra a Caja», «Queda en camino», «Llega el jue 08/10». */
  destination: string
  /** Quién lo tiene o lo paga, para cuando hay lugar: «Mercado Pago», «Tarjetas de débito (Posnet)». */
  payer: string | null
  arrival: CloseArrival
}

function groupOf(method: CloseMethodSource, lookup: CloseMethodLookup): CloseMethodGroup {
  if (method.kind === 'customer_account') return 'account'
  if (method.kind === 'advance') return 'advance'
  if (lookup.isCash) return 'cash'
  if (lookup.mercadoPago) return 'wallet'
  // Lo que alguien te paga después: una app de delivery o el posnet.
  if (method.kind === 'receivable') return method.channel === 'delivery' ? 'delivery' : 'cards'
  // Entra a un banco o a una billetera en el momento.
  return 'wallet'
}

/**
 * Cómo se ve un medio en el cierre de un día: su grupo, a dónde va lo cobrado
 * y en qué renglón de «Cuándo entra» suma. Sigue lo que hace el asiento: «a
 * caja» entra en el momento; lo que se acredita en el acto queda en camino
 * hasta que se lo ve en la billetera; tarjetas y apps llegan `settlementDays`
 * después.
 */
export function describeCloseMethod(
  method: CloseMethodSource,
  date: string,
  lookup: CloseMethodLookup,
): CloseMethodView {
  const group = groupOf(method, lookup)
  const payer = lookup.party?.name ?? null
  switch (method.kind) {
    case 'treasury': {
      const name = lookup.treasury?.name ?? 'Caja'
      return {
        group,
        destination: `Entra a ${name}`,
        payer: null,
        arrival: {
          key: `now:${lookup.treasury?.id ?? 'caja'}`,
          order: '0',
          label: `Entra a ${name}`,
        },
      }
    }
    case 'settled_now': {
      const name = payer ?? lookup.treasury?.name ?? 'Mercado Pago'
      return {
        group,
        destination: 'Queda en camino',
        payer: name,
        arrival: {
          key: `pending:${lookup.party?.id ?? lookup.treasury?.id ?? 'billetera'}`,
          order: '1',
          label: `En camino a ${name}`,
        },
      }
    }
    case 'receivable': {
      const when = addDays(date, Math.max(0, method.settlementDays))
      return {
        group,
        destination: `Llega el ${formatWeekdayDayMonth(when)}`,
        payer,
        arrival: {
          key: `due:${when}`,
          order: `2:${when}`,
          label: `Llega el ${formatWeekdayDayMonth(when)}`,
        },
      }
    }
    case 'customer_account':
      return {
        group,
        destination: 'Queda en la cuenta de cada cliente',
        payer: null,
        arrival: { key: 'account', order: '8', label: 'A cobrarle a clientes' },
      }
    case 'advance':
      return {
        group,
        destination: 'Se descuenta de las señas',
        payer: null,
        arrival: { key: 'advance', order: '9', label: 'Ya cobrado como seña' },
      }
  }
}

export type CloseMethodGroupBlock<M> = { group: CloseMethodGroup; methods: M[] }

/**
 * Los medios por grupo. Los grupos van en el orden en que aparecen en Ajustes ›
 * Medios de cobro y, adentro, los medios conservan ese orden: si en Ajustes ya
 * están juntos (lo habitual), la pantalla queda en el mismo orden que la
 * columna del sistema de caja, que es el que usa «pegar la columna».
 */
export function groupCloseMethods<M extends { group: CloseMethodGroup }>(
  methods: readonly M[],
): CloseMethodGroupBlock<M>[] {
  const blocks: CloseMethodGroupBlock<M>[] = []
  for (const method of methods) {
    const block = blocks.find((b) => b.group === method.group)
    if (block) block.methods.push(method)
    else blocks.push({ group: method.group, methods: [method] })
  }
  return blocks
}

// ─── Cuándo entra ────────────────────────────────────────────────────────────

export type ArrivalLine = { key: string; label: string; cents: number }

/**
 * «Cuándo entra» del ticket: lo cargado, sumado por lugar y fecha. Si se contó
 * el efectivo, a la caja entra lo CONTADO (es lo que registra el asiento), no
 * lo vendido. Lo que no tiene importe no figura.
 */
export function closeArrivals(
  methods: ReadonlyArray<{ id: string; arrival: CloseArrival }>,
  amountOf: (methodId: string) => number,
  cash: { methodId: string | null; countedCents: number | null },
): ArrivalLine[] {
  const lines = new Map<string, ArrivalLine & { order: string; index: number }>()
  methods.forEach((method, index) => {
    const counted = method.id === cash.methodId ? cash.countedCents : null
    const cents = counted ?? amountOf(method.id)
    if (cents <= 0) return
    const line = lines.get(method.arrival.key)
    if (line) line.cents += cents
    else {
      lines.set(method.arrival.key, {
        key: method.arrival.key,
        label: method.arrival.label,
        cents,
        order: method.arrival.order,
        index,
      })
    }
  })
  return [...lines.values()]
    .sort((a, b) => a.order.localeCompare(b.order) || a.index - b.index)
    .map(({ key, label, cents }) => ({ key, label, cents }))
}

// ─── Con factura / sin factura ───────────────────────────────────────────────

export type InvoiceSplit = {
  /**
   * - `empty`: todavía no hay nada vendido ni facturado.
   * - `none`: nada con factura (todo el día queda como venta sin factura).
   * - `mixed`: una parte con factura y otra sin.
   * - `all`: todo lo vendido tiene factura.
   * - `over`: se facturó más de lo vendido (el motor lo pregunta antes de guardar).
   */
  kind: 'empty' | 'none' | 'mixed' | 'all' | 'over'
  /** Σ de lo facturado con IVA (las notas de crédito restan). */
  invoicedCents: number
  /** Vendido − facturado; nunca negativo (lo de más va en `overCents`). */
  uninvoicedCents: number
  overCents: number
  /** Qué parte de lo vendido tiene factura, de 0 a 100 (entero). */
  invoicedPercent: number
}

/**
 * El reparto del día con los MISMOS números del asiento: recibe lo vendido y
 * lo facturado por canal tal como lo devuelve `summarizeSalesClose`.
 */
export function invoiceSplit(
  soldCents: number,
  channels: ReadonlyArray<{ invoicedTotalCents: number }>,
): InvoiceSplit {
  const invoicedCents = channels.reduce((sum, c) => sum + c.invoicedTotalCents, 0)
  if (soldCents <= 0 && invoicedCents === 0) {
    return { kind: 'empty', invoicedCents: 0, uninvoicedCents: 0, overCents: 0, invoicedPercent: 0 }
  }
  if (invoicedCents > soldCents) {
    return {
      kind: 'over',
      invoicedCents,
      uninvoicedCents: 0,
      overCents: invoicedCents - soldCents,
      invoicedPercent: 100,
    }
  }
  const uninvoicedCents = soldCents - invoicedCents
  if (invoicedCents <= 0) {
    return { kind: 'none', invoicedCents, uninvoicedCents, overCents: 0, invoicedPercent: 0 }
  }
  if (uninvoicedCents === 0) {
    return { kind: 'all', invoicedCents, uninvoicedCents: 0, overCents: 0, invoicedPercent: 100 }
  }
  // Con las dos partes, nunca «0 %» ni «100 %»: sería decir que una no existe.
  const percent = Math.min(99, Math.max(1, Math.round((invoicedCents * 100) / soldCents)))
  return { kind: 'mixed', invoicedCents, uninvoicedCents, overCents: 0, invoicedPercent: percent }
}

// ─── El objetivo del día ─────────────────────────────────────────────────────

export type TargetProgress = { targetCents: number; percent: number }

/**
 * Lo vendido ese día (este cierre más los turnos ya cargados) contra su
 * objetivo. Es sobre lo vendido en bruto: Ventas › Proyección descuenta además
 * las comisiones estimadas, por eso la pantalla lo aclara. `null` sin objetivo
 * (un objetivo en cero no se puede cumplir ni incumplir).
 */
export function targetProgress(
  targetCents: number | null,
  dayCents: number,
): TargetProgress | null {
  if (targetCents === null || targetCents <= 0) return null
  return { targetCents, percent: Math.max(0, Math.round((dayCents * 100) / targetCents)) }
}
