import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { SupplierParty } from './types'

/**
 * Las razones sociales de Administración unidas a los proveedores de Compras (`pur_supplier_parties`).
 * Todo con la sesión de quien mira: los nombres de Administración solo los ve quien tiene acceso allá (RLS
 * `apt_select_readers`); sin acceso, la unión aparece sin nombre.
 */

/** Un proveedor de Administración para unir: el nombre que se lee y con qué proveedor de Compras está. */
export type AccSupplierOption = {
  id: string
  name: string
  tradeName: string | null
  taxId: string | null
  active: boolean
  /** El proveedor de Compras al que ya está unido, o null. */
  supplierId: string | null
}

function fail(what: string, error: { code?: string; message?: string }): never {
  console.error('[purchasing.parties]', { what, code: error.code })
  throw new Error(`No se pudo leer ${what}.`)
}

/** Las uniones del bar, con el nombre de cada razón social (si quien mira la puede leer). */
export async function getSupplierParties(tenantId: string): Promise<SupplierParty[]> {
  const db = await createClient()
  const links = await db
    .from('pur_supplier_parties')
    .select('supplier_id, acc_party_id')
    .eq('tenant_id', tenantId)
  if (links.error) fail('las razones sociales', links.error)
  if (!links.data.length) return []
  const parties = await db
    .from('acc_parties')
    .select('id, name, trade_name, tax_id, active')
    .eq('tenant_id', tenantId)
    .in(
      'id',
      links.data.map((l) => l.acc_party_id),
    )
  if (parties.error) fail('las razones sociales', parties.error)
  const byId = new Map(parties.data.map((p) => [p.id, p]))
  return links.data.map((l) => {
    const p = byId.get(l.acc_party_id)
    return {
      supplierId: l.supplier_id,
      partyId: l.acc_party_id,
      name: p?.name ?? 'Razón social de Administración',
      tradeName: p?.trade_name ?? null,
      taxId: p?.tax_id ?? null,
      active: p?.active ?? true,
    }
  })
}

/** Los proveedores de Administración, para unir uno (solo si quien mira tiene acceso allá). */
export async function getAccSupplierOptions(
  tenantId: string,
  links: readonly SupplierParty[],
): Promise<AccSupplierOption[]> {
  const db = await createClient()
  const { data, error } = await db
    .from('acc_parties')
    .select('id, name, trade_name, tax_id, active')
    .eq('tenant_id', tenantId)
    .eq('kind', 'supplier')
    .is('system_key', null)
    .order('name')
    .limit(1000)
  if (error) fail('los proveedores de Administración', error)
  const linked = new Map(links.map((l) => [l.partyId, l.supplierId]))
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    tradeName: p.trade_name,
    taxId: p.tax_id,
    active: p.active,
    supplierId: linked.get(p.id) ?? null,
  }))
}

/** Desde la ficha de Administración: el proveedor de Compras de esta razón social y sus otras razones. */
export type ComprasLink = {
  supplierId: string
  supplierName: string
  /** Las otras razones sociales con las que factura el mismo proveedor. */
  siblings: { id: string; name: string }[]
}

export async function getComprasLinkForParty(
  tenantId: string,
  partyId: string,
): Promise<ComprasLink | null> {
  const db = await createClient()
  const link = await db
    .from('pur_supplier_parties')
    .select('supplier_id')
    .eq('tenant_id', tenantId)
    .eq('acc_party_id', partyId)
    .maybeSingle()
  // Sin acceso a Compras (la contadora) la RLS no devuelve nada: la ficha se ve igual, sin la unión.
  if (link.error || !link.data) return null
  const supplierId = link.data.supplier_id
  const [supplier, others] = await Promise.all([
    db
      .from('pur_suppliers')
      .select('name')
      .eq('tenant_id', tenantId)
      .eq('id', supplierId)
      .maybeSingle(),
    db
      .from('pur_supplier_parties')
      .select('acc_party_id')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .neq('acc_party_id', partyId),
  ])
  if (supplier.error || !supplier.data || others.error) return null
  let siblings: { id: string; name: string }[] = []
  if (others.data.length) {
    const names = await db
      .from('acc_parties')
      .select('id, name, trade_name')
      .eq('tenant_id', tenantId)
      .in(
        'id',
        others.data.map((o) => o.acc_party_id),
      )
    if (!names.error) siblings = names.data.map((p) => ({ id: p.id, name: p.name }))
  }
  return { supplierId, supplierName: supplier.data.name, siblings }
}
