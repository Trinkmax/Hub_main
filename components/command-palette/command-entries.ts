import { actionHrefFrom } from '@/components/administracion/acciones/types'
import type { TenantFeatures } from '@/lib/platform/features'
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import { type CommandEntry, commandEntries } from './command-config'

/**
 * Qué entradas de ⌘K ve quién mira, y adónde lleva cada una. Lo comparten el ⌘K de la compu y el buscador
 * de «Más» en el celular: las dos puertas muestran lo mismo con las mismas reglas.
 */

export const COMMAND_GROUPS_ORDER = [
  'Acciones rápidas',
  'Administración',
  'Operación',
  'Ir a',
] as const

/** ¿Alcanza el acceso a Administración para esta entrada? (el flag ya viene adentro). */
function accountingOk(entry: CommandEntry, accounting: AccountingAccess): boolean {
  if (!entry.accounting) return true
  if (!accounting.enabled) return false
  if (entry.accounting === 'write') return accounting.write
  if (entry.accounting === 'read') return accounting.read
  return accounting.read || accounting.canSetUp
}

export function visibleCommandEntries({
  role,
  features,
  isPlatformAdmin,
  accounting,
}: {
  role: TenantRole
  features: TenantFeatures
  isPlatformAdmin: boolean
  accounting: AccountingAccess
}): CommandEntry[] {
  return commandEntries.filter((entry) => {
    const roleOk = (entry.roles ?? ['owner']).includes(role)
    // El flag de Administración no se saltea por ser superadmin (lo decide la base).
    const featureOk =
      !entry.feature ||
      (entry.feature !== 'accounting' && isPlatformAdmin) ||
      features[entry.feature]
    return roleOk && featureOk && accountingOk(entry, accounting)
  })
}

/**
 * Adónde lleva una entrada. Las hojas de Administración se abren sobre la pantalla actual si ya se está en
 * la sección (conservando ?tab=, ?mes=…); si no, sobre el Resumen.
 */
export function commandEntryHref(
  entry: CommandEntry,
  tenantSlug: string,
  pathname: string,
  search: string,
): string {
  return entry.accountingAction
    ? actionHrefFrom(tenantSlug, pathname, search, entry.accountingAction)
    : entry.href(tenantSlug)
}

/** Sin acentos ni mayúsculas: «administracion» encuentra «Administración». */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Las entradas que coinciden con lo escrito, las mejores primero: todas las palabras tienen que aparecer
 * (en el nombre o en sus palabras clave). Gana lo que empieza igual, después lo que está en el nombre y al
 * final lo que solo está en las palabras clave.
 */
export function searchCommandEntries(
  entries: readonly CommandEntry[],
  query: string,
  limit = 24,
): CommandEntry[] {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: { entry: CommandEntry; score: number; index: number }[] = []
  entries.forEach((entry, index) => {
    const label = foldText(entry.label)
    const haystack = `${label} ${foldText(entry.keywords?.join(' ') ?? '')}`
    if (!words.every((word) => haystack.includes(word))) return
    const first = words[0] ?? ''
    const score = label.startsWith(first) ? 0 : words.every((word) => label.includes(word)) ? 1 : 2
    scored.push({ entry, score, index })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry)
}
