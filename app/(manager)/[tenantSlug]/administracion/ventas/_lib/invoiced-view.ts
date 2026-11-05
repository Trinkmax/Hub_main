/**
 * «Facturas»: cuánto de lo vendido fue con factura y cuánto sin, por canal y
 * en total. Puro: recibe las filas de `getSalesSummary`. Lo prueba
 * `administracion-ventas-cobrar.test.ts`.
 *
 * Con factura y sin factura son dos formas de mirar las mismas ventas: las dos
 * quedan registradas en los libros. Ninguna es una alarma.
 */

import type { SalesSummaryRow } from '@/lib/accounting/queries/books'
import { CHANNEL_LABELS } from '@/lib/accounting/queries/labels'
import { CHANNELS } from '@/lib/accounting/types'
import { type InvoiceSplit, invoiceSplit } from '../cierre/_lib/close-view'

export type ChannelSales = {
  channel: string
  label: string
  soldCents: number
  /** Lo facturado sin el IVA. */
  invoicedNetCents: number
  vatCents: number
  /** Lo facturado con su IVA: la parte «con factura» de lo vendido. */
  invoicedCents: number
  uninvoicedCents: number
}

/** Lo vendido por canal (salón, delivery, eventos), sumando los meses del período. */
export function channelSales(rows: readonly SalesSummaryRow[]): ChannelSales[] {
  const known: readonly string[] = CHANNELS
  const extra = [...new Set(rows.map((r) => r.channel))].filter((c) => !known.includes(c))
  return [...known, ...extra].map((channel) => {
    const own = rows.filter((r) => r.channel === channel)
    const invoicedNetCents = own.reduce((sum, r) => sum + r.invoicedNetCents, 0)
    const vatCents = own.reduce((sum, r) => sum + r.vatCents, 0)
    return {
      channel,
      label: CHANNEL_LABELS[channel] ?? channel,
      soldCents: own.reduce((sum, r) => sum + r.soldCents, 0),
      invoicedNetCents,
      vatCents,
      invoicedCents: invoicedNetCents + vatCents,
      uninvoicedCents: own.reduce((sum, r) => sum + r.uninvoicedCents, 0),
    }
  })
}

export type InvoicedSummary = {
  /** Solo los canales con ventas o con algo facturado. */
  channels: ChannelSales[]
  soldCents: number
  invoicedCents: number
  uninvoicedCents: number
  /** El mismo reparto que el del cierre de cada noche. */
  split: InvoiceSplit
}

/** Los totales del período. `null` si no se vendió ni se facturó nada. */
export function invoicedSummary(rows: readonly SalesSummaryRow[]): InvoicedSummary | null {
  const channels = channelSales(rows).filter((c) => c.soldCents !== 0 || c.invoicedCents !== 0)
  if (channels.length === 0) return null
  const soldCents = channels.reduce((sum, c) => sum + c.soldCents, 0)
  const invoicedCents = channels.reduce((sum, c) => sum + c.invoicedCents, 0)
  const uninvoicedCents = channels.reduce((sum, c) => sum + c.uninvoicedCents, 0)
  const split = invoiceSplit(soldCents, [{ invoicedTotalCents: invoicedCents }])
  return { channels, soldCents, invoicedCents, uninvoicedCents, split }
}
