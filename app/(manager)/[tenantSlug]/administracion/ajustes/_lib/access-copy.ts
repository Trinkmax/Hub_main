/**
 * Cómo se cuenta cada acceso en Ajustes › Accesos (H.17): desde cuándo, quién
 * lo dio, con qué nivel y, en el historial, quién lo sacó. Solo nombres, nunca
 * emails. Puro.
 */

import type { AccountingScope } from '@/lib/accounting/access-levels'
import type { AccessPersonRow } from '@/lib/accounting/queries/access'
import { formatDate } from '@/lib/dates'

// ─── Los niveles ─────────────────────────────────────────────────────────────

/**
 * Cómo se nombra y se explica cada nivel: el nombre, UNA línea de «qué ve» (sin jerga: ni «permisos»
 * ni «roles») y para quién suele ser. Lo que dice cada línea es lo que la base deja ver: si cambia
 * allá, cambia acá.
 */
export const LEVEL_COPY: Readonly<
  Record<AccountingScope, { label: string; sees: string; forWhom: string }>
> = {
  purchases: {
    label: 'Solo compras y pagos',
    sees: 'Carga compras, gastos y pagos a proveedores, y ve lo que se le debe a cada uno. No ve ventas, sueldos, cajas ni libros.',
    forWhom: 'Para empleados',
  },
  full: {
    label: 'Completo',
    sees: 'Ve y carga todo: ventas, cierres, sueldos, gastos fijos, cajas y libros.',
    forWhom: 'Para socios',
  },
}

/** De menos a más: así se ofrecen siempre, en la fila de cada persona y al dar un acceso. */
export const LEVEL_ORDER: readonly AccountingScope[] = ['purchases', 'full']

/** «5 personas entran»: el titular. Personas, no socios: también entran empleados. */
export function entersWords(count: number): string {
  return count === 1 ? 'persona entra' : 'personas entran'
}

/**
 * El renglón de abajo del titular: cómo se reparten los que entran y cuántos faltan.
 * «3 ven todo · 2 solo compras y pagos · 1 todavía no entra». Sin nadie en el nivel acotado no se
 * aclara el reparto (todos ven todo), y sin nadie afuera tampoco eso: `null` si no queda nada que decir.
 */
export function accessFactsLine(counts: {
  full: number
  purchases: number
  /** Dueños del bar sin acceso. `0` si quien mira no los ve (la contadora). */
  outside: number
}): string | null {
  const parts: string[] = []
  if (counts.purchases > 0) {
    parts.push(`${counts.full} ${counts.full === 1 ? 've' : 'ven'} todo`)
    parts.push(`${counts.purchases} solo compras y pagos`)
  }
  if (counts.outside > 0) {
    parts.push(`${counts.outside} todavía no ${counts.outside === 1 ? 'entra' : 'entran'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Lo que se pregunta antes de bajar a alguien de «Completo» a «Solo compras y pagos»: qué deja de
 * ver, dicho entero. Subir de nivel no se pregunta (se puede bajar con un toque).
 */
export function downgradeCopy(input: { name: string; self: boolean; isAdmin: boolean }): {
  title: string
  description: string
  action: string
} {
  const action = 'Pasar a solo compras y pagos'
  if (input.self) {
    return {
      title: '¿Pasás a ver solo compras y pagos?',
      description:
        'Vas a dejar de ver ventas, cierres, sueldos, gastos fijos, los saldos de las cajas, el resumen, los libros y esta pantalla, y de dar accesos. Para volver a verlo todo, te lo tiene que subir otra persona que dé accesos.',
      action,
    }
  }
  const name = input.name.trim() || 'Esta persona'
  return {
    title: `¿${name} pasa a ver solo compras y pagos?`,
    description: `Deja de ver ventas, cierres, sueldos, gastos fijos, los saldos de las cajas, el resumen y los libros, y ya no puede anular comprobantes.${
      input.isAdmin ? ' También deja de dar accesos.' : ''
    } Sigue cargando compras, gastos y pagos a proveedores. Se lo podés volver a subir cuando quieras.`,
    action,
  }
}

type LevelState = { scope: AccountingScope; isAdmin: boolean }

/**
 * El aviso de «listo» después de dar o cambiar un acceso: dice lo que cambió, con el nombre.
 * `before` vacío = no tenía acceso.
 */
export function savedLine(
  before: LevelState | null,
  after: LevelState & { displayName: string },
): string {
  const name = after.displayName.trim() || 'Esa persona'
  if (!before) {
    if (after.scope === 'purchases') return `Listo: ${name} ya puede cargar compras y pagos.`
    return after.isAdmin
      ? `Listo: ${name} ya ve todo Administración y da accesos.`
      : `Listo: ${name} ya ve todo Administración.`
  }
  if (before.scope !== after.scope) {
    return after.scope === 'full'
      ? `Listo: ${name} ahora ve todo Administración.`
      : `Listo: ${name} ahora ve solo compras y pagos.`
  }
  if (before.isAdmin !== after.isAdmin) {
    return after.isAdmin
      ? `Listo: ${name} ahora también da accesos.`
      : `Listo: ${name} ya no da accesos.`
  }
  return `Listo: actualizamos el acceso de ${name}.`
}

// ─── Desde cuándo y quién ────────────────────────────────────────────────────

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
