/**
 * «Lo que llegó»: de lo que cobró cada medio, cuánto te llegó, cuánto se quedó en el camino y cuánto
 * sigue en camino. Puro: recibe las filas de `getNetByMethod`. Lo prueba
 * `administracion-ventas-cobrar.test.ts`.
 *
 * Son cifras por separado: no se afirma que sumen, porque una liquidación puede ser de ventas de otro
 * período.
 */

import type { NetByMethodRow } from '@/lib/accounting/queries/books'
import type { DocumentListRow } from '@/lib/accounting/queries/documents'
import { joinNames } from './planilla'

/** Los renglones que dicen algo: un medio sin ventas, sin cobros y sin nada en camino no va. */
export function netVisibleRows(rows: readonly NetByMethodRow[]): NetByMethodRow[] {
  return rows.filter((r) => r.soldCents !== 0 || r.creditedCents !== 0 || r.pendingCents !== 0)
}

export type NetTotals = {
  soldCents: number
  creditedCents: number
  /** Comisiones, su IVA, retenciones, otros cargos y lo sin explicar. */
  deductedCents: number
  pendingCents: number
}

export function netTotals(rows: readonly NetByMethodRow[]): NetTotals {
  const out: NetTotals = { soldCents: 0, creditedCents: 0, deductedCents: 0, pendingCents: 0 }
  for (const row of rows) {
    out.soldCents += row.soldCents
    out.creditedCents += row.creditedCents
    out.deductedCents +=
      Math.max(0, row.commissionCents) +
      Math.max(0, row.commissionVatCents) +
      Math.max(0, row.withholdingsCents) +
      Math.max(0, row.otherChargesCents) +
      Math.max(0, row.unexplainedCents)
    out.pendingCents += Math.max(0, row.pendingCents)
  }
  return out
}

/**
 * Un cobro de la lista: lo que entró a las cajas, lo que le descontaron (la liquidación menos lo que
 * entró) y a dónde fue. Sin el detalle de las cajas, lo que se ve es la liquidación entera.
 */
export function collectionAmounts(row: Pick<DocumentListRow, 'means' | 'totalCents'>) {
  const means = row.means ?? []
  if (means.length === 0) return { shown: row.totalCents, discount: 0, where: '' }
  const received = means.reduce((sum, item) => sum + item.amountCents, 0)
  return {
    shown: received,
    discount: Math.max(0, row.totalCents - received),
    where: joinNames(means.map((m) => m.label)),
  }
}
