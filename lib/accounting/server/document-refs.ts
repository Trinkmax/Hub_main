/**
 * Qué partidas existentes referencia cada formulario (para cargarlas en
 * `ctx.openItems` con su abierto actual, E.2). Puro: lo usan la acción y la
 * vista previa en el servidor, y puede usarlo una página para precargar el
 * mismo contexto que va a usar el formulario.
 */

import type {
  CollectionInput,
  PaymentInput,
  PurchaseInput,
  SalesCloseInput,
  WalletCheckInput,
} from '@/lib/accounting/schemas'
import type { DocumentForm } from './document-types'

/** Lo que el contexto tiene que traer además de los datos maestros. */
export type DocumentRefs = {
  /** Partidas (líneas del diario) elegidas en el formulario, sin repetir. */
  lineIds: string[]
  /**
   * Factura mensual de comisiones (`settlesCommissions`): el partícipe cuyas
   * partidas abiertas de «IVA a documentar» libera FIFO (E.5.1).
   */
  commissionPartyId: string | null
}

type Applied = ReadonlyArray<{ lineId: string }>

function uniqueIds(...lists: Applied[]): string[] {
  const out: string[] = []
  for (const list of lists) {
    for (const item of list) if (!out.includes(item.lineId)) out.push(item.lineId)
  }
  return out
}

/**
 * Las referencias de un formulario ya validado por su esquema. Los datos
 * llegan como `unknown` tipado por formulario: cada rama sabe su forma.
 */
export function refsFor(form: DocumentForm, data: unknown): DocumentRefs {
  const none: DocumentRefs = { lineIds: [], commissionPartyId: null }
  switch (form) {
    case 'payment': {
      const d = data as Pick<PaymentInput, 'applications' | 'creditsUsed'>
      return { ...none, lineIds: uniqueIds(d.applications, d.creditsUsed) }
    }
    case 'collection': {
      const d = data as Pick<CollectionInput, 'applications' | 'creditsUsed'>
      return { ...none, lineIds: uniqueIds(d.applications, d.creditsUsed) }
    }
    case 'wallet_check': {
      const d = data as Pick<WalletCheckInput, 'items'>
      return { ...none, lineIds: uniqueIds(d.items) }
    }
    case 'sales_close': {
      const d = data as Pick<SalesCloseInput, 'instantSettlements'>
      return {
        ...none,
        lineIds: uniqueIds(
          ...d.instantSettlements.flatMap((s) => [s.applications, s.creditsUsed] as Applied[]),
        ),
      }
    }
    case 'purchase':
    case 'purchase_credit_note': {
      const d = data as Pick<PurchaseInput, 'settlesCommissions' | 'partyId' | 'docKind'>
      return {
        ...none,
        commissionPartyId:
          d.settlesCommissions && d.docKind === 'purchase' && d.partyId ? d.partyId : null,
      }
    }
    default:
      return none
  }
}
