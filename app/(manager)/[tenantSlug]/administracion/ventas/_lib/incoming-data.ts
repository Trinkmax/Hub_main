import 'server-only'
import { listOpenItems, type OpenItemRow } from '@/lib/accounting/queries/parties'

/**
 * Las partidas por cobrar de los que te deben, para dibujar «Cuándo llega» día
 * por día. No hay un reporte que las traiga todas de una vez: se compone con la
 * lectura que ya existe (`listOpenItems`, una por pagador, en paralelo), sin
 * SQL propio. Por eso tiene tope: con más de `INCOMING_MAX_PARTIES` que deben,
 * el dibujo no se arma (la lista de abajo ya dice cada uno con su fecha).
 */

/** Hasta cuántos pagadores se leen para armar el día por día. */
export const INCOMING_MAX_PARTIES = 12

export type IncomingByDay =
  | { kind: 'items'; items: OpenItemRow[] }
  /** Hay más pagadores que el tope: el bloque no se dibuja. */
  | { kind: 'too_many' }

/**
 * `owingPartyIds`: los que deben y NO son una billetera (lo de Mercado Pago ya
 * está en la app: no «llega» ningún día). Lanza si una lectura falla (se
 * envuelve con `settleQuery`).
 */
export async function getIncomingByDay(
  tenantId: string,
  owingPartyIds: readonly string[],
): Promise<IncomingByDay> {
  const ids = [...new Set(owingPartyIds)]
  if (ids.length > INCOMING_MAX_PARTIES) return { kind: 'too_many' }
  const lists = await Promise.all(
    ids.map((partyId) => listOpenItems(tenantId, { partyId, side: 'debt' })),
  )
  return { kind: 'items', items: lists.flat() }
}
