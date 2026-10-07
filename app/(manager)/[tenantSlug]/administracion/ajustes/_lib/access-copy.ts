/**
 * Cómo se cuenta cada acceso en Ajustes › Accesos (H.17): desde cuándo, quién
 * lo dio y, en el historial, quién lo sacó. Solo nombres, nunca emails. Puro.
 */

import type { AccessPersonRow } from '@/lib/accounting/queries/access'
import { formatDate } from '@/lib/dates'

/** «Desde el 06/10/2026, lo dio Franco» · «Configuró Administración el 06/10/2026». */
export function grantLine(
  row: Pick<AccessPersonRow, 'source' | 'grantedAt' | 'grantedByName'>,
): string {
  const date = formatDate(row.grantedAt)
  const on = date ? ` el ${date}` : ''
  switch (row.source) {
    case 'setup':
      return `Configuró Administración${on}`
    case 'platform':
      return `Lo designó Soporte HUB${on}`
    case 'claim':
      return `Pasó a dar los accesos${on}`
    default: {
      const since = date ? `Desde el ${date}` : 'Con acceso'
      return row.grantedByName ? `${since}, lo dio ${row.grantedByName}` : since
    }
  }
}

/** «Franco le sacó el acceso el 10/10/2026 · Ya no es parte del equipo». */
export function revokedLine(
  row: Pick<AccessPersonRow, 'revokedAt' | 'revokedByName' | 'revokeReason'>,
): string {
  const date = formatDate(row.revokedAt)
  const who = row.revokedByName ? `${row.revokedByName} le sacó el acceso` : 'Se le sacó el acceso'
  const reason = row.revokeReason?.trim()
  return `${who}${date ? ` el ${date}` : ''}${reason ? ` · ${reason}` : ''}`
}
