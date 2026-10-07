import 'server-only'
import {
  bool,
  callRpcRows,
  isRecord,
  queryError,
  readerClient,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Accesos a Administración (H.17 «Accesos», H.18 «Administración es
 * privada»). Las filas de `acc_access` las ven los lectores (dueños con acceso
 * y la contadora); la lista de dueños sin acceso sale de `get_tenant_members`,
 * que solo puede llamar un dueño (la contadora no la ve).
 */

export type AccessSource = 'setup' | 'grant' | 'platform' | 'claim'

export type AccessPersonRow = {
  /** Fila de `acc_access`. */
  id: string
  userId: string
  displayName: string
  isAdmin: boolean
  source: AccessSource
  grantedByName: string | null
  grantedAt: string
  revokedAt: string | null
  revokedByName: string | null
  revokeReason: string | null
  updatedAt: string
}

export type MemberName = {
  userId: string
  /** Nombre del perfil; si no hay, la parte local del email (nunca el email entero). */
  name: string
}

export type AccessOverview = {
  /** Con acceso vigente: administradores primero, después por nombre. */
  active: AccessPersonRow[]
  /** Accesos quitados (historial), el más reciente primero. */
  revoked: AccessPersonRow[]
  /** Dueños del bar sin acceso vigente (solo si lo pide un dueño). */
  ownersWithoutAccess: MemberName[]
  /** Personas con el rol Contabilidad (solo si lo pide un dueño). */
  accountants: MemberName[]
  adminCount: number
}

function sourceOf(value: unknown): AccessSource {
  return value === 'setup' || value === 'platform' || value === 'claim' ? value : 'grant'
}

/** `user_id` → nombre visible en Administración (para «Cargado por», historia). */
export async function getMemberLabels(tenantId: string): Promise<Map<string, string>> {
  const raw = await callRpcRows('acc_member_labels', { p_tenant_id: tenantId })
  const out = new Map<string, string>()
  for (const row of raw) {
    const id = str(row.user_id)
    const label = str(row.label).trim()
    if (id && label) out.set(id, label)
  }
  return out
}

/** Quiénes dan accesos (para «Administración es privada»): solo nombres, sin repetir. */
export async function listAdminNames(tenantId: string): Promise<string[]> {
  const raw = await callRpcRows('acc_admin_names', { p_tenant_id: tenantId })
  const names: string[] = []
  for (const row of raw) {
    const name = str(row.display_name).trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

function memberName(row: UnknownRecord): string {
  const full = strOrNull(row.full_name)?.trim()
  if (full) return full
  const email = str(row.email)
  const local = email.split('@')[0]?.trim()
  return local || 'Sin nombre'
}

/**
 * La pestaña «Accesos» de Ajustes: quién ve Administración, quién da accesos,
 * el historial y (para un dueño) los dueños sin acceso y las contadoras.
 * `includeMembers` solo para dueños: `get_tenant_members` es de dueños.
 */
export async function getAccessOverview(
  tenantId: string,
  opts: { includeMembers: boolean },
): Promise<AccessOverview> {
  const supabase = await readerClient()
  const [accessResult, labels, members] = await Promise.all([
    supabase
      .from('acc_access')
      .select(
        'id, user_id, display_name, is_admin, source, granted_by_name, granted_at, revoked_at, revoked_by, revoke_reason, updated_at',
      )
      .eq('tenant_id', tenantId)
      .order('granted_at', { ascending: true })
      .limit(500),
    getMemberLabels(tenantId),
    opts.includeMembers
      ? supabase.rpc('get_tenant_members', { p_tenant: tenantId })
      : Promise.resolve(null),
  ])
  if (accessResult.error) throw queryError('acc_access', accessResult.error)

  const rows: AccessPersonRow[] = ((accessResult.data ?? []) as unknown[])
    .filter(isRecord)
    .map((row) => {
      const revokedBy = strOrNull(row.revoked_by)
      return {
        id: str(row.id),
        userId: str(row.user_id),
        displayName: str(row.display_name),
        isAdmin: bool(row.is_admin),
        source: sourceOf(row.source),
        grantedByName: strOrNull(row.granted_by_name),
        grantedAt: str(row.granted_at),
        revokedAt: strOrNull(row.revoked_at),
        revokedByName: revokedBy ? (labels.get(revokedBy) ?? null) : null,
        revokeReason: strOrNull(row.revoke_reason),
        updatedAt: str(row.updated_at),
      }
    })

  const active = rows
    .filter((r) => r.revokedAt === null)
    .sort(
      (a, b) =>
        Number(b.isAdmin) - Number(a.isAdmin) || a.displayName.localeCompare(b.displayName, 'es'),
    )
  const revoked = rows
    .filter((r) => r.revokedAt !== null)
    .sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''))

  const ownersWithoutAccess: MemberName[] = []
  const accountants: MemberName[] = []
  if (members) {
    if (members.error) throw queryError('get_tenant_members', members.error)
    const withAccess = new Set(active.map((r) => r.userId))
    for (const raw of (Array.isArray(members.data) ? members.data : []) as unknown[]) {
      if (!isRecord(raw)) continue
      const userId = str(raw.user_id)
      if (!userId) continue
      if (raw.role === 'owner' && !withAccess.has(userId)) {
        ownersWithoutAccess.push({ userId, name: memberName(raw) })
      } else if (raw.role === 'accountant') {
        accountants.push({ userId, name: memberName(raw) })
      }
    }
    ownersWithoutAccess.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    accountants.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  return {
    active,
    revoked,
    ownersWithoutAccess,
    accountants,
    adminCount: active.filter((r) => r.isAdmin).length,
  }
}
