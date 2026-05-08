'use server'

import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'

export type CustomerSearchResult = {
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
}

export async function searchCustomers(
  slug: string,
  query: string,
): Promise<CustomerSearchResult[]> {
  if (query.trim().length < 2) return []

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(slug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) return []
    throw error
  }

  const supabase = await createClient()
  const q = query.trim()
  const isDigits = /^[\d+\s\-()]+$/.test(q)
  let builder = supabase
    .from('customers')
    .select('id, first_name, last_name, phone, points_balance')
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
