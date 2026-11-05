import 'server-only'

import { listAccounts } from '@/lib/accounting/queries/accounts'
import { getParty, searchKey, searchParties } from '@/lib/accounting/queries/parties'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import type { PartyKind } from '@/lib/accounting/types'
import type { TexToolContext } from './tools/types'

/**
 * De lo que dice la gente («Coca», «la caja», «Mercado Pago») a lo que entiende el motor (un id). Si
 * Tex ya tiene el id, lo manda y listo. Si no hay uno solo, vuelve con las opciones para que pregunte:
 * Tex nunca elige a ojo entre dos proveedores.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Resolved<T> = { ok: true; value: T } | { ok: false; message: string }

function options(names: readonly string[]): string {
  return names.slice(0, 8).join(', ')
}

export type ResolvedTreasury = { id: string; name: string; kind: string }

/** Una caja, banco o billetera por su nombre. */
export async function resolveTreasury(
  ctx: TexToolContext,
  wanted: string,
): Promise<Resolved<ResolvedTreasury>> {
  const treasuries = await listTreasuryAccounts(ctx.tenantId)
  const key = searchKey(wanted)
  const found = UUID_RE.test(wanted)
    ? treasuries.filter((t) => t.id === wanted)
    : treasuries.filter((t) => searchKey(t.name) === key).length === 1
      ? treasuries.filter((t) => searchKey(t.name) === key)
      : treasuries.filter((t) => searchKey(t.name).includes(key) || key.includes(searchKey(t.name)))
  const [only] = found
  if (only && found.length === 1)
    return { ok: true, value: { id: only.id, name: only.name, kind: only.kind } }
  const all = options(treasuries.map((t) => t.name))
  if (found.length > 1) {
    return {
      ok: false,
      message: `«${wanted}» puede ser ${options(found.map((t) => t.name))}. Preguntale cuál.`,
    }
  }
  return { ok: false, message: `No hay una caja llamada «${wanted}». Las que hay: ${all}.` }
}

export type ResolvedParty = {
  id: string
  name: string
  kind: PartyKind
  taxId: string | null
  defaultAccountId: string | null
  paymentTermDays: number
}

/** Un proveedor, cliente o partícipe. `kinds` acota a quién se busca. */
export async function resolveParty(
  ctx: TexToolContext,
  wanted: string,
  kinds?: readonly PartyKind[],
): Promise<Resolved<ResolvedParty>> {
  // Con el id, directo: la búsqueda sin texto solo trae los primeros por nombre.
  if (UUID_RE.test(wanted)) {
    const party = await getParty(ctx.tenantId, wanted)
    if (!party || (kinds && !kinds.includes(party.kind))) {
      return { ok: false, message: `No encontré ese partícipe (${wanted}).` }
    }
    return {
      ok: true,
      value: {
        id: party.id,
        name: party.tradeName ?? party.name,
        kind: party.kind,
        taxId: party.taxId,
        defaultAccountId: party.defaultAccountId,
        paymentTermDays: party.paymentTermDays,
      },
    }
  }
  const matches = await searchParties(ctx.tenantId, { q: wanted, kinds, limit: 8 })
  const key = searchKey(wanted)
  const exact = matches.filter(
    (p) => searchKey(p.name) === key || (p.tradeName ? searchKey(p.tradeName) === key : false),
  )
  const pick = exact.length === 1 ? exact : matches
  const [only] = pick
  if (only && pick.length === 1) {
    return {
      ok: true,
      value: {
        id: only.id,
        name: only.tradeName ?? only.name,
        kind: only.kind,
        taxId: only.taxId,
        defaultAccountId: only.defaultAccountId,
        paymentTermDays: only.paymentTermDays,
      },
    }
  }
  if (pick.length > 1) {
    return {
      ok: false,
      message: `«${wanted}» puede ser ${options(pick.map((p) => p.tradeName ?? p.name))}. Preguntale cuál.`,
    }
  }
  return {
    ok: false,
    message: `No encontré a «${wanted}». Preguntale si es nuevo o si se llama de otra forma.`,
  }
}

export type ResolvedAccount = { id: string; code: string; name: string }

/** Una cuenta del plan, por nombre o por código. Solo las que se pueden imputar. */
export async function resolveAccount(
  ctx: TexToolContext,
  wanted: string,
): Promise<Resolved<ResolvedAccount>> {
  const accounts = await listAccounts(ctx.tenantId)
  const usable = accounts.filter((a) => a.active && a.postable)
  const key = searchKey(wanted)
  const found = UUID_RE.test(wanted)
    ? usable.filter((a) => a.id === wanted)
    : usable.filter((a) => a.code === wanted.trim() || searchKey(a.name) === key)
  const pick = found.length > 0 ? found : usable.filter((a) => searchKey(a.name).includes(key))
  const [only] = pick
  if (only && pick.length === 1) {
    return { ok: true, value: { id: only.id, code: only.code, name: only.name } }
  }
  if (pick.length > 1) {
    return {
      ok: false,
      message: `«${wanted}» puede ser ${options(pick.map((a) => `${a.code} ${a.name}`))}. Elegí una con buscar_cuenta o preguntale.`,
    }
  }
  return { ok: false, message: `No hay una cuenta «${wanted}». Buscala con buscar_cuenta.` }
}
