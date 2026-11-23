/**
 * Lo que cambia en la lista de accesos cuando alguien toca algo, ANTES de que conteste el servidor:
 * la pantalla lo muestra al instante y, si el guardado falla, vuelve sola a como estaba (el panel lo
 * usa con `useOptimistic`). Tiene que dar lo mismo que después va a traer la base. Puro.
 */

import {
  type AccountingScope,
  canGrantOthers,
  compareAccessRows,
} from '@/lib/accounting/access-levels'
import type { AccessOverview, AccessPersonRow } from '@/lib/accounting/queries/access'

export type AccessChange =
  /** Dar un acceso, o cambiarle el nivel o «da accesos» a quien ya lo tiene. */
  | {
      type: 'set'
      userId: string
      /** Solo para quien todavía no entra: con qué nombre se lo muestra hasta que conteste la base. */
      name: string
      scope: AccountingScope
      isAdmin: boolean
      /** El momento del toque (ISO): la fecha del acceso nuevo mientras se guarda. */
      at: string
    }
  | { type: 'revoke'; userId: string }

function adminsIn(rows: readonly AccessPersonRow[]): number {
  return rows.filter((row) => row.isAdmin).length
}

export function applyAccessChange(overview: AccessOverview, change: AccessChange): AccessOverview {
  if (change.type === 'revoke') {
    const gone = overview.active.find((row) => row.userId === change.userId)
    if (!gone) return overview
    const active = overview.active.filter((row) => row.userId !== change.userId)
    return {
      ...overview,
      active,
      // Vuelve a la lista de quienes todavía no entran (sigue siendo dueño del bar).
      ownersWithoutAccess: [
        ...overview.ownersWithoutAccess,
        { userId: gone.userId, name: gone.displayName },
      ].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      adminCount: adminsIn(active),
    }
  }

  // Dar accesos pide el nivel completo: bajar de nivel también apaga «da accesos».
  const isAdmin = change.isAdmin && canGrantOthers(change.scope)
  const current = overview.active.find((row) => row.userId === change.userId)
  const row: AccessPersonRow = current
    ? { ...current, scope: change.scope, isAdmin }
    : {
        id: `pending-${change.userId}`,
        userId: change.userId,
        displayName: change.name,
        isAdmin,
        scope: change.scope,
        source: 'grant',
        grantedByName: null,
        grantedAt: change.at,
        revokedAt: null,
        revokedByName: null,
        revokeReason: null,
        updatedAt: change.at,
      }
  const active = [...overview.active.filter((r) => r.userId !== change.userId), row].sort(
    compareAccessRows,
  )
  return {
    ...overview,
    active,
    ownersWithoutAccess: overview.ownersWithoutAccess.filter((m) => m.userId !== change.userId),
    adminCount: adminsIn(active),
  }
}

/** Cuántos ven todo y cuántos solo compras y pagos. */
export function levelCounts(rows: ReadonlyArray<Pick<AccessPersonRow, 'scope'>>): {
  full: number
  purchases: number
} {
  const purchases = rows.filter((row) => row.scope === 'purchases').length
  return { full: rows.length - purchases, purchases }
}

/**
 * ¿Es la única persona que da accesos? A esa no se le puede sacar «da accesos» ni bajar de nivel: el
 * bar quedaría sin nadie que habilite a otros (la base lo rechaza con `last_admin`).
 */
export function isOnlyAdmin(
  row: Pick<AccessPersonRow, 'isAdmin'>,
  overview: Pick<AccessOverview, 'adminCount'>,
): boolean {
  return row.isAdmin && overview.adminCount <= 1
}
