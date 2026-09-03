'use server'

import type { ServiceAlert } from '@/lib/salon/alerts'
import { createClient } from '@/lib/supabase/server'
import {
  RESERVATION_OPERATOR_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export type CustomerSearchResult = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
  /**
   * Avisos permanentes (celíaca, alérgica…). Viaja en la misma query para que
   * el alta de reserva pueda avisar en el momento en que se elige al cliente,
   * sin un hop extra. Es dato de salud: solo llega a staff (el requireRole de
   * abajo ya lo acota) y nunca sale a una superficie pública.
   */
  service_alerts: ServiceAlert[]
}

export async function searchCustomers(
  slug: string,
  query: string,
): Promise<CustomerSearchResult[]> {
  if (query.trim().length < 2) return []

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(slug)
    // Devuelve PII de clientes: solo staff que vincula clientes (reserva/visita).
    // `editor` queda afuera a propósito — su mundo es la carta, no el CRM.
    requireRole(access.role, RESERVATION_OPERATOR_ROLES)
  } catch (error) {
    if (error instanceof TenantNotFoundError) return []
    if (error instanceof RoleRequiredError) return []
    throw error
  }

  const supabase = await createClient()
  const q = query.trim()
  const isDigits = /^[\d+\s\-()]+$/.test(q)
  let builder = supabase
    .from('customers')
    .select('id, first_name, last_name, phone, points_balance, service_alerts')
    .eq('tenant_id', access.tenant.id)
    .is('deleted_at', null)
    .limit(8)

  if (isDigits) {
    const digits = q.replace(/\D/g, '')
    builder = builder.ilike('phone', `%${digits}%`)
  } else {
    const safe = q.replace(/[%,]/g, '')
    builder = builder.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
  }

  const { data, error } = await builder
  if (error) return []
  return (data ?? []) as CustomerSearchResult[]
}
