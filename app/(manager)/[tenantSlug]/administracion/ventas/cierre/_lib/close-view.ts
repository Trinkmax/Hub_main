/**
 * Lo que el cierre del día MUESTRA: cómo se agrupan los medios por «de dónde saco
 * el número», a dónde va la plata de cada uno, el reparto «con factura / sin
 * factura» y los impuestos que se calculan solos. Puro: lo prueban
 * `administracion-cierre.test.ts` y `administracion-cierre-vista.test.tsx`.
 *
 * Acá no se arma nada de lo que se manda: el envío (`SalesCloseValues`) lo
 * sigue armando el formulario con su estado de siempre, y los medios viajan en
 * el orden de Ajustes › Medios de cobro. Esto solo decide cómo se ven.
 */

import { netFromGross } from '@/lib/accounting/iva'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import { closeTaxes, type TaxBase, type TaxSettings } from '@/lib/accounting/taxes'
import type { Channel, SalesMethodKind, TreasuryKind, VatRateBp } from '@/lib/accounting/types'
import { addDays, formatWeekdayDayMonth } from '@/lib/dates'

// ─── Los medios, agrupados ───────────────────────────────────────────────────

/** De dónde sale el número: billetes, el reporte de la billetera, el posnet, cada app… */
export type CloseMethodGroup = 'cash' | 'wallet' | 'cards' | 'delivery' | 'account' | 'advance'

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
  /**
   * La columna «Entró a»: la caja o quien te lo paga después («Caja», «Mercado Pago», «Tarjetas de
   * débito (Posnet)»). Sale del medio de cobro: en un cierre no se cambia.
   */
  entersTo: string
  /** A dónde va, en palabras y corto: «Entra a Caja», «Queda en camino», «Llega el jue 08/10». */
  destination: string
  /** Quién lo tiene o lo paga, para cuando hay lugar: «Mercado Pago», «Tarjetas de débito (Posnet)». */
  payer: string | null
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
 * Cómo se ve un medio en el cierre de un día: su grupo y a dónde va lo cobrado.
 * Sigue lo que hace el asiento: «a caja» entra en el momento; lo que se acredita
 * en el acto queda en camino hasta que se lo ve en la billetera; tarjetas y apps
 * llegan `settlementDays` después.
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
      return { group, entersTo: name, destination: `Entra a ${name}`, payer: null }
    }
    case 'settled_now': {
      const name = payer ?? lookup.treasury?.name ?? 'Mercado Pago'
      return { group, entersTo: name, destination: 'Queda en camino', payer: name }
    }
    case 'receivable': {
      const when = addDays(date, Math.max(0, method.settlementDays))
      return {
        group,
        entersTo: payer ?? 'A cobrar',
        destination: `Llega el ${formatWeekdayDayMonth(when)}`,
        payer,
      }
    }
    case 'customer_account':
      return {
        group,
        entersTo: 'Cuenta del cliente',
        destination: 'Queda en la cuenta de cada cliente',
        payer: null,
      }
    case 'advance':
      return {
        group,
        entersTo: 'Señas',
        destination: 'Se descuenta de las señas',
        payer: null,
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

/** Un renglón de «Cuándo entra» del ticket de un cierre ya guardado. */
export type ArrivalLine = { key: string; label: string; cents: number }

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

// ─── El total del sistema de caja ────────────────────────────────────────────

/**
 * El total que dice el sistema de caja contra lo cargado. Es un control
 * opcional: si está y no coincide, el cierre no se guarda (lo frena el motor),
 * así que la pantalla lo tiene que decir apenas pasa y con el importe.
 *
 * - `none`: no lo cargaron. `match`: coincide.
 * - `short`: el sistema dice más que lo cargado → falta cargar `cents`.
 * - `over`: se cargó `cents` de más.
 */
export type ControlCheck =
  | { kind: 'none' }
  | { kind: 'match' }
  | { kind: 'short'; cents: number }
  | { kind: 'over'; cents: number }

export function controlCheck(controlCents: number | null, soldCents: number): ControlCheck {
  if (controlCents === null) return { kind: 'none' }
  if (controlCents === soldCents) return { kind: 'match' }
  return controlCents > soldCents
    ? { kind: 'short', cents: controlCents - soldCents }
    : { kind: 'over', cents: soldCents - controlCents }
}

// ─── El objetivo del día ─────────────────────────────────────────────────────

/** Lo vendido ese día contra su objetivo, en el papel del ticket. */
export type TargetProgress = { targetCents: number; percent: number }

// ─── Lo que se calcula solo ──────────────────────────────────────────────────

export type CloseTaxLine = { key: string; label: string; cents: number }

export type CloseTaxView = {
  /** Un renglón por alícuota de lo facturado; sin nada facturado, el de la alícuota general en cero. */
  vat: CloseTaxLine[]
  /** Ingresos Brutos y Comercio e Industria. Vacío con los impuestos automáticos apagados. */
  accrued: CloseTaxLine[]
  /** Sobre qué se calculan los de `accrued`; `null` si están apagados. */
  base: TaxBase | null
}

/** La alícuota de un bar con factura de todos los días: la que se muestra mientras no hay nada. */
const GENERAL_VAT_BP: VatRateBp = 2100

/**
 * «Se calcula solo»: lo que el cierre va a registrar además de las ventas, con los mismos números del
 * asiento. El IVA sale de cada fila facturada como en `buildSalesClose` (las notas de crédito restan);
 * Ingresos Brutos y Comercio e Industria, de `closeTaxes`, con lo facturado sin IVA que ya calculó
 * `summarizeSalesClose`.
 */
export function closeTaxView(input: {
  invoiced: ReadonlyArray<{ totalCents: number; vatRateBp: VatRateBp; creditNote: boolean }>
  invoicedNetCents: number
  uninvoicedCents: number
  settings: TaxSettings | null | undefined
}): CloseTaxView {
  const byRate = new Map<VatRateBp, number>()
  for (const row of input.invoiced) {
    if (row.vatRateBp === 0) continue
    const vat = row.totalCents - netFromGross(row.totalCents, row.vatRateBp)
    byRate.set(row.vatRateBp, (byRate.get(row.vatRateBp) ?? 0) + (row.creditNote ? -vat : vat))
  }
  if (byRate.size === 0) byRate.set(GENERAL_VAT_BP, 0)
  const vat = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, cents]) => ({ key: `vat-${rate}`, label: `IVA ${vatRateLabel(rate)}`, cents }))

  const { settings } = input
  if (!settings?.auto) return { vat, accrued: [], base: null }
  const { iibbCents, municipalCents } = closeTaxes(
    { invoicedNetCents: input.invoicedNetCents, uninvoicedCents: input.uninvoicedCents },
    settings,
  )
  return {
    vat,
    accrued: [
      {
        key: 'iibb',
        label: `Ingresos Brutos ${vatRateLabel(settings.iibbBp)}`,
        cents: iibbCents,
      },
      {
        key: 'municipal',
        label: `Comercio e Industria ${vatRateLabel(settings.municipalBp)}`,
        cents: municipalCents,
      },
    ],
    base: settings.base,
  }
}
