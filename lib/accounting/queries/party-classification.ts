import 'server-only'
import { type PartyGroup, partyKindsOf } from './parties'
import { bool, isRecord, namesById, queryError, readerClient, str, strOrNull } from './shared'

/**
 * La clasificación de cada proveedor (pedido de los socios, 12/10/2026): la
 * «Cuenta habitual» de su ficha (`acc_parties.default_account_id`), para verla
 * y elegirla desde la lista. Va aparte de `listParties` porque los saldos
 * salen de un reporte que no trae la ficha.
 */
export type PartyClassification = {
  kind: string
  systemKey: string | null
  active: boolean
  defaultAccountId: string | null
  /** `null` si no tiene cuenta (o si la cuenta ya no está en el plan). */
  defaultAccountName: string | null
  /** Para la concurrencia optimista de `saveParty` (`p_expected_updated_at`). */
  updatedAt: string
}

const PAGE = 1000
/** Tope de vueltas: 10.000 partícipes de un grupo es más de lo que carga un bar. */
const MAX_PAGES = 10

/** La cuenta habitual de cada partícipe del grupo (id del partícipe → su clasificación). */
export async function listPartyClassifications(
  tenantId: string,
  group: PartyGroup,
): Promise<Map<string, PartyClassification>> {
  const supabase = await readerClient()
  const kinds = [...partyKindsOf(group)]
  const parties: Array<Omit<PartyClassification, 'defaultAccountName'> & { id: string }> = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from('acc_parties')
      .select('id, kind, system_key, active, default_account_id, updated_at')
      .eq('tenant_id', tenantId)
      .in('kind', kinds)
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw queryError('acc_parties', error)
    const batch = ((data ?? []) as unknown[]).filter(isRecord)
    for (const row of batch) {
      parties.push({
        id: str(row.id),
        kind: str(row.kind),
        systemKey: strOrNull(row.system_key),
        active: bool(row.active),
        defaultAccountId: strOrNull(row.default_account_id),
        updatedAt: str(row.updated_at),
      })
    }
    if (batch.length < PAGE) break
  }

  const accounts = await namesById(
    tenantId,
    'acc_accounts',
    parties.map((p) => p.defaultAccountId),
  )
  const out = new Map<string, PartyClassification>()
  for (const party of parties) {
    const account = party.defaultAccountId ? accounts.get(party.defaultAccountId) : undefined
    const { id, ...rest } = party
    out.set(id, { ...rest, defaultAccountName: account ? strOrNull(account.name) : null })
  }
  return out
}
